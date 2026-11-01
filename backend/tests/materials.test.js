import { describe, it, expect, beforeAll } from 'vitest'
import supertest from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 测试前必须设置环境变量，再动态 import（db.js 在 import 时读 DATA_DIR 建库）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-test-'))
process.env.DATA_DIR = tmpDir
process.env.DISTRIBUTION_MODE = '1'
process.env.JWT_SECRET = 'test-secret-mat'

let app
let db
let signToken
let materialsService

beforeAll(async () => {
  db = (await import('../src/models/db.js')).default
  ;({ signToken } = await import('../src/middleware/auth.js'))
  materialsService = await import('../src/services/materialsService.js')
  app = (await import('../src/index.js')).default

  // 插入一名测试用户（科长）并签发 token
  const info = db.prepare(
    `INSERT INTO users (user_no, name, role, dept_code, dept_name, status, password_hash)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run('T001', '测试员', 3, '01', '综合科', 'x')
  globalThis.__userId = Number(info.lastInsertRowid)
  globalThis.__token = signToken(globalThis.__userId)
})

describe('材料模块 T0 骨架', () => {
  it('建表：材料模块全部表存在', () => {
    const tables = ['material_categories', 'finance_categories', 'plans', 'plan_items',
      'purchases', 'materials', 'material_events', 'issue_records', 'recycle_records',
      'disposal_batches', 'disposal_items', 'module_role_map', 'module_access']
    for (const t of tables) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)
      expect(row, `缺少表 ${t}`).toBeTruthy()
    }
  })

  it('物料账领用表补充联动三列', () => {
    const cols = db.prepare(`PRAGMA table_info(material_issues)`).all().map((c) => c.name)
    expect(cols).toContain('material_issue_id')
    expect(cols).toContain('material_codes')
    expect(cols).toContain('material_plan_id')
  })

  it('收支分类种子：内置 3 条', () => {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM finance_categories WHERE deleted_at IS NULL`).get()
    expect(n).toBe(3)
  })

  it('单据编号：前缀+年月日+3位流水', () => {
    const no1 = materialsService.nextDocNo('plans', 'plan_no', 'JH')
    expect(/^JH\d{11}$/.test(no1)).toBe(true)
    db.prepare(
      `INSERT INTO plans (plan_no, month, plan_type, unit_code, unit_name, created_by)
       VALUES (?, '2026-11', 'workshop', 'W1', '一车间', ?)`
    ).run(no1, globalThis.__userId)
    const no2 = materialsService.nextDocNo('plans', 'plan_no', 'JH')
    expect(no2.endsWith('002')).toBe(true)
    expect(no2).not.toBe(no1)
  })

  it('材料编号：CL+到货日期+类别两位+当日四位流水', () => {
    const code = materialsService.nextMaterialCode('05', '20261101')
    expect(/^CL\d{8}05\d{4}$/.test(code)).toBe(true)
  })

  it('状态机：材料正向流转合法、逆向非法', () => {
    expect(materialsService.canTransitionMaterial('in_stock', 'issued').ok).toBe(true)
    expect(materialsService.canTransitionMaterial('in_stock', 'disposed').ok).toBe(true)
    expect(materialsService.canTransitionMaterial('issued', 'recycled').ok).toBe(true)
    expect(materialsService.canTransitionMaterial('issued', 'disposed').ok).toBe(true)
    expect(materialsService.canTransitionMaterial('disposed', 'in_stock').ok).toBe(false)
    expect(materialsService.canTransitionMaterial('issued', 'in_stock').ok).toBe(false)
    expect(materialsService.canTransitionMaterial('recycled', 'issued').ok).toBe(false)
  })
})

describe('材料模块访问权（M1）', () => {
  it('未登录访问 /api/materials/me → 4010', async () => {
    const res = await supertest(app).get('/api/materials/me')
    expect(res.body.code).toBe(4010)
  })

  it('未配置授权阶段：有账号即可见（默认开放）→ 200 + hasAccess', async () => {
    const res = await supertest(app).get('/api/materials/me').set('Authorization', `Bearer ${globalThis.__token}`)
    expect(res.body.code).toBe(0)
    expect(res.body.data.hasAccess).toBe(true)
    expect(res.body.data.roles).toEqual([])
  })

  it('一旦配置授权：非白名单用户 → 4030', async () => {
    // 给一个不存在的用户授权，使 module_access 进入"已配置"状态
    db.prepare(`INSERT INTO module_access (user_id, module_code, granted_by) VALUES (?, 'materials', 0)`).run(999999)
    const res = await supertest(app).get('/api/materials/me').set('Authorization', `Bearer ${globalThis.__token}`)
    expect(res.body.code).toBe(4030)
  })
})
