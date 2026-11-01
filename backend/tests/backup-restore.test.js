import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 备份/恢复（PRD 第7节，A10/A11）服务层测试。
// 必须在动态 import 之前设置环境变量：db.js 在 import 时就按 DATA_DIR 建库。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-test-'))
process.env.DATA_DIR = tmpDir
process.env.DISTRIBUTION_MODE = '1'
process.env.JWT_SECRET = 'test-secret-bak'

let db
let backup
let DATA_DIR
let UPLOAD_DIR
const operator = { id: 1, name: '备份演练员' }

// 造一份"有业务数据"的库：用户 + 材料模块各表各若干行
function seed() {
  const uid = Number(db.prepare(
    `INSERT INTO users (user_no, name, role, dept_code, dept_name, status, password_hash)
     VALUES ('B001','备份用户',3,'01','综合科','active','x')`
  ).run().lastInsertRowid)

  db.prepare(`INSERT INTO material_categories (code, name, created_by) VALUES ('01','钢材',?)`).run(uid)
  db.prepare(`INSERT INTO finance_categories (name, type, created_by) VALUES ('材料费','expense',?)`).run(uid)
  db.prepare(
    `INSERT INTO plans (plan_no, month, plan_type, unit_code, unit_name, status, created_by)
     VALUES ('JH20261101001','2026-11','workshop','W1','一车间','draft',?)`
  ).run(uid)
  db.prepare(
    `INSERT INTO purchases (purchase_no, item_desc, amount, purchase_date, created_by)
     VALUES ('CG20261101001','钢板',1000,'2026-11-01',?)`
  ).run(uid)
  for (const code of ['CL202611010101', 'CL202611010102']) {
    db.prepare(
      `INSERT INTO materials (material_code, name, arrived_at, created_by)
       VALUES (?, '钢板', '2026-11-01', ?)`
    ).run(code, uid)
  }
  db.prepare(
    `INSERT INTO material_events (material_id, action, operator_name, occur_at)
     VALUES (1,'arrive','备份用户','2026-11-01')`
  ).run()

  // 一条附件 + 对应物理文件，验证附件目录一并备份/恢复
  const storedName = 'stored-001.pdf'
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), Buffer.from('PDF-CONTENT'))
  db.prepare(
    `INSERT INTO attachments (work_id, uploader_id, original_name, stored_name, size)
     VALUES (1, ?, '原始.pdf', ?, 11)`
  ).run(uid, storedName)

  return uid
}

beforeAll(async () => {
  db = (await import('../src/models/db.js')).default
  DATA_DIR = (await import('../src/models/db.js')).DATA_DIR
  UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
  backup = await import('../src/services/backupService.js')
  seed()
})

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL`).get().n

describe('A10 备份：生成与清单校验', () => {
  it('备份包含材料模块新表的记录数，且逐文件 SHA-256 校验通过', () => {
    const zipPath = path.join(tmpDir, 'b1.zip')
    const { manifest, size } = backup.createBackup(zipPath)

    expect(size).toBeGreaterThan(0)
    // v1.1 材料模块 13 张表必须进清单，否则恢复后无从校验
    for (const t of ['material_categories', 'finance_categories', 'plans', 'purchases',
      'materials', 'material_events', 'issue_records', 'recycle_records',
      'disposal_batches', 'disposal_items', 'module_role_map', 'module_access']) {
      expect(Object.prototype.hasOwnProperty.call(manifest.recordCounts, t)).toBe(true)
    }
    expect(manifest.recordCounts.materials).toBe(2)
    expect(manifest.recordCounts.plans).toBe(1)
    expect(manifest.attachmentCount).toBe(1)

    // 重新校验（逐文件 SHA-256 + 版本）
    const mf = backup.verifyBackupFile(zipPath)
    expect(mf.recordCounts.materials).toBe(2)
  })

  it('runBackup 写备份记录与操作日志', () => {
    const r = backup.runBackup('manual', { backupDir: path.join(tmpDir, 'bk'), operator })
    expect(r.name).toMatch(/^ke_work_backup_.*_manual\.zip$/)
    const row = backup.getBackupRow(r.id)
    expect(row.status).toBe('success')
    expect(JSON.parse(row.record_counts).materials).toBe(2)
  })
})

describe('A11 恢复：预览 → 确认 → 校验', () => {
  it('恢复到备份时点：材料数据整体回退，无异常', () => {
    const zipPath = path.join(tmpDir, 'roundtrip.zip')
    backup.createBackup(zipPath)

    // 备份之后新增数据（模拟业务继续跑）
    db.prepare(
      `INSERT INTO materials (material_code, name, arrived_at, created_by)
       VALUES ('CL202611010103','新到的货','2026-11-02',1)`
    ).run()
    expect(count('materials')).toBe(3)

    const out = backup.swapFromZip(zipPath)
    expect(out.anomalies).toEqual([])
    expect(count('materials')).toBe(2)          // 回退到备份时点
    expect(out.recordCounts.plans).toBe(1)
    expect(count('attachments')).toBe(1)
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'stored-001.pdf'))).toBe(true)
  })

  it('预览令牌 → 确认恢复，二次确认字面量不符直接拒绝', () => {
    const zipPath = path.join(tmpDir, 'confirm.zip')
    backup.createBackup(zipPath)
    const { token } = backup.createPreviewToken(zipPath)

    expect(() => backup.confirmRestore({ token, overwrite: '确定', operator }))
      .toThrowError(/覆盖当前数据/)

    // token 未被消耗，正确字面量可继续
    const out = backup.confirmRestore({ token, overwrite: '覆盖当前数据', operator })
    expect(out.anomalies).toEqual([])
    expect(out.recordCounts.materials).toBe(2)
  })

  it('恢复中失败：自动回滚，数据保持恢复前状态，临时备份保留', () => {
    const before = count('materials')
    const zipPath = path.join(tmpDir, 'rollback.zip')
    backup.createBackup(zipPath)
    const { token } = backup.createPreviewToken(zipPath)

    backup.testHooks.onBeforeSwap = () => { throw new Error('注入失败') }
    let msg = ''
    try {
      backup.confirmRestore({ token, overwrite: '覆盖当前数据', operator })
    } catch (e) {
      msg = e.message
    }
    backup.testHooks.onBeforeSwap = null

    expect(msg).toContain('已回滚到恢复前状态')
    expect(count('materials')).toBe(before)

    const tmpRestore = path.join(DATA_DIR, 'restore-tmp')
    const kept = fs.readdirSync(tmpRestore).filter((f) => f.startsWith('pre-restore-'))
    expect(kept.length).toBeGreaterThan(0)
  })
})

describe('A11 异常包拦截', () => {
  it('缺 manifest 的包被拒', async () => {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    zip.addFile('db/app.db', Buffer.from('whatever'))
    const p = path.join(tmpDir, 'nomanifest.zip')
    zip.writeZip(p)
    expect(() => backup.verifyBackupFile(p)).toThrowError(/manifest/)
  })

  it('系统版本不兼容的包被拒', async () => {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      systemVersion: 'V1.0', dbSchemaVersion: 1, recordCounts: {}, files: []
    })))
    const p = path.join(tmpDir, 'oldver.zip')
    zip.writeZip(p)
    expect(() => backup.verifyBackupFile(p)).toThrowError(/版本不兼容/)
  })

  it('文件被篡改（SHA-256 不符）的包被拒', async () => {
    const zipPath = path.join(tmpDir, 'tamper.zip')
    backup.createBackup(zipPath)

    // 重新打包，改掉 db/app.db 内容但保留原清单
    const AdmZip = (await import('adm-zip')).default
    const src = new AdmZip(zipPath)
    const out = new AdmZip()
    for (const e of src.getEntries()) {
      if (e.entryName === 'db/app.db') out.addFile(e.entryName, Buffer.from('TAMPERED'))
      else out.addFile(e.entryName, src.readFile(e))
    }
    const p = path.join(tmpDir, 'tampered.zip')
    out.writeZip(p)
    expect(() => backup.verifyBackupFile(p)).toThrowError(/校验值不符/)
  })
})
