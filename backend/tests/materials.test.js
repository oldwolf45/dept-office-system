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

describe('材料模块 T1 基础数据', () => {
  const h = () => ({ Authorization: `Bearer ${globalThis.__token}` })

  it('材料类别：新增→列表→编辑→停用(未用)→启用', async () => {
    const c = await supertest(app).post('/api/materials/categories').set(h()).send({ code: '05', name: '钢材' })
    expect(c.body.code).toBe(0)
    const id = c.body.data.id
    const list = await supertest(app).get('/api/materials/categories/manage').set(h())
    expect(list.body.data.list.some((x) => x.id === id)).toBe(true)
    const up = await supertest(app).put(`/api/materials/categories/${id}`).set(h()).send({ name: '钢材X' })
    expect(up.body.code).toBe(0)
    expect(up.body.data.name).toBe('钢材X')
    const dis = await supertest(app).post(`/api/materials/categories/${id}/disable`).set(h())
    expect(dis.body.code).toBe(0)
    expect(dis.body.data.status).toBe('disabled')
    const en = await supertest(app).post(`/api/materials/categories/${id}/enable`).set(h())
    expect(en.body.data.status).toBe('active')
  })

  it('材料类别：已用不可停用', async () => {
    const c = await supertest(app).post('/api/materials/categories').set(h()).send({ name: '线缆' })
    const id = c.body.data.id
    db.prepare(
      `INSERT INTO materials (material_code, name, status, arrived_at, category_id, created_by)
       VALUES (?, '某材料', 'in_stock', '2026-11-01', ?, ?)`
    ).run(materialsService.nextMaterialCode('99', '20261101'), id, globalThis.__userId)
    const dis = await supertest(app).post(`/api/materials/categories/${id}/disable`).set(h())
    expect(dis.body.code).toBe(4000)
  })

  it('收支分类：种子3条 + 新增→停用→启用', async () => {
    const f = await supertest(app).post('/api/materials/finance-categories').set(h()).send({ name: '运费', type: 'expense' })
    expect(f.body.code).toBe(0)
    const id = f.body.data.id
    const dis = await supertest(app).post(`/api/materials/finance-categories/${id}/disable`).set(h())
    expect(dis.body.data.status).toBe('disabled')
    const en = await supertest(app).post(`/api/materials/finance-categories/${id}/enable`).set(h())
    expect(en.body.data.status).toBe('active')
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

describe('材料模块 T2 计划管理', () => {
  const h = () => ({ Authorization: `Bearer ${globalThis.__token}` })

  // M1 已让 module_access 进入"已配置"态，这里把测试用户补进白名单，保证可访问。
  // 用 INSERT OR IGNORE 幂等，避免重复运行报错。
  beforeAll(() => {
    const exists = db.prepare(
      `SELECT 1 AS x FROM module_access WHERE user_id=? AND module_code='materials' AND deleted_at IS NULL`
    ).get(globalThis.__userId)
    if (!exists) {
      db.prepare(`INSERT INTO module_access (user_id, module_code, granted_by) VALUES (?, 'materials', ?)`)
        .run(globalThis.__userId, globalThis.__userId)
    }
  })

  it('创建计划：有效明细 → 草稿 + 编号格式 + 金额=数量×单价', async () => {
    const r = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026-11',
      planType: 'workshop',
      unitCode: 'W1',
      unitName: '一车间',
      items: [{ materialName: '氧气', plannedQty: 10, referencePrice: 25, categoryId: null }]
    })
    expect(r.body.code).toBe(0)
    expect(r.body.data.status).toBe('draft')
    expect(/^JH\d{11}$/.test(r.body.data.planNo)).toBe(true)
    expect(Array.isArray(r.body.data.items)).toBe(true)
    expect(r.body.data.items[0].plannedAmount).toBe(250)
  })

  it('创建计划：参数校验（月份/明细空/数量≤0）→ 4000', async () => {
    const badMonth = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026/11', planType: 'workshop', unitCode: 'W1', unitName: '一车间', items: []
    })
    expect(badMonth.body.code).toBe(4000)

    const emptyItems = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026-11', planType: 'workshop', unitCode: 'W1', unitName: '一车间', items: []
    })
    expect(emptyItems.body.code).toBe(4000)

    const badQty = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026-11', planType: 'workshop', unitCode: 'W1', unitName: '一车间',
      items: [{ materialName: '乙炔', plannedQty: 0, referencePrice: 10 }]
    })
    expect(badQty.body.code).toBe(4000)
  })

  it('流程：草稿→提交→审核通过 / 提交→驳回(必填意见)', async () => {
    const created = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026-11', planType: 'section', unitCode: 'S1', unitName: '综合科',
      items: [{ materialName: '焊条', plannedQty: 5, referencePrice: 12 }]
    })
    const id = created.body.data.id
    expect(created.body.data.status).toBe('draft')

    const submitted = await supertest(app).post(`/api/materials/plans/${id}/submit`).set(h())
    expect(submitted.body.code).toBe(0)
    expect(submitted.body.data.status).toBe('submitted')

    // 驳回必填意见
    const rejectNoReason = await supertest(app).post(`/api/materials/plans/${id}/reject`).set(h()).send({})
    expect(rejectNoReason.body.code).toBe(4000)
    const rejected = await supertest(app).post(`/api/materials/plans/${id}/reject`).set(h()).send({ reason: '数量偏高' })
    expect(rejected.body.code).toBe(0)
    expect(rejected.body.data.status).toBe('rejected')
    expect(rejected.body.data.rejectReason).toBe('数量偏高')

    // 新计划走审核通过
    const c2 = await supertest(app).post('/api/materials/plans').set(h()).send({
      month: '2026-11', planType: 'workshop', unitCode: 'W2', unitName: '二车间',
      items: [{ materialName: '螺栓', plannedQty: 100, referencePrice: 1 }]
    })
    const id2 = c2.body.data.id
    await supertest(app).post(`/api/materials/plans/${id2}/submit`).set(h())
    const approved = await supertest(app).post(`/api/materials/plans/${id2}/approve`).set(h())
    expect(approved.body.data.status).toBe('approved')
  })

  it('汇总：按单位聚合（数量/通过/驳回）', async () => {
    const r = await supertest(app).get('/api/materials/plans/summary?month=2026-11').set(h())
    expect(r.body.code).toBe(0)
    expect(r.body.data.month).toBe('2026-11')
    const byUnit = r.body.data.byUnit
    expect(Array.isArray(byUnit)).toBe(true)
    const w2 = byUnit.find((u) => u.unitName === '二车间')
    expect(w2).toBeTruthy()
    expect(w2.approved).toBeGreaterThanOrEqual(1)
    const s1 = byUnit.find((u) => u.unitName === '综合科')
    expect(s1.rejected).toBeGreaterThanOrEqual(1)
  })
})

describe('材料模块 T3 采购管理', () => {
  const h = () => ({ Authorization: `Bearer ${globalThis.__token}` })

  it('登记采购：CG 单据号 + 状态 normal + 金额入库', async () => {
    const r = await supertest(app).post('/api/materials/purchases').set(h()).send({
      itemDesc: '采购氧气瓶', amount: 1200.5, purchaseDate: '2026-11-02', supplier: '某供应商', handler: '张三'
    })
    expect(r.body.code).toBe(0)
    expect(r.body.data.status).toBe('normal')
    expect(/^CG\d{11}$/.test(r.body.data.purchaseNo)).toBe(true)
    expect(r.body.data.amount).toBe(1200.5)
  })

  it('登记采购：参数校验（摘要空/金额负/日期格式）→ 4000', async () => {
    const emptyDesc = await supertest(app).post('/api/materials/purchases').set(h()).send({ itemDesc: '', amount: 10 })
    expect(emptyDesc.body.code).toBe(4000)
    const neg = await supertest(app).post('/api/materials/purchases').set(h()).send({ itemDesc: 'X', amount: -5 })
    expect(neg.body.code).toBe(4000)
    const badDate = await supertest(app).post('/api/materials/purchases').set(h()).send({ itemDesc: 'X', amount: 5, purchaseDate: '2026/11/02' })
    expect(badDate.body.code).toBe(4000)
  })

  it('作废：normal→void 必填意见；重复作废→4000', async () => {
    const c = await supertest(app).post('/api/materials/purchases').set(h()).send({ itemDesc: '采购焊条', amount: 300, purchaseDate: '2026-11-03' })
    const id = c.body.data.id
    const noReason = await supertest(app).post(`/api/materials/purchases/${id}/void`).set(h()).send({})
    expect(noReason.body.code).toBe(4000)
    const voided = await supertest(app).post(`/api/materials/purchases/${id}/void`).set(h()).send({ reason: '重复采购' })
    expect(voided.body.code).toBe(0)
    expect(voided.body.data.status).toBe('void')
    expect(voided.body.data.voidReason).toBe('重复采购')
    const again = await supertest(app).post(`/api/materials/purchases/${id}/void`).set(h()).send({ reason: 'x' })
    expect(again.body.code).toBe(4000)
  })

  it('列表：按月份过滤', async () => {
    await supertest(app).post('/api/materials/purchases').set(h()).send({ itemDesc: '采购螺栓', amount: 80, purchaseDate: '2026-11-05' })
    const r = await supertest(app).get('/api/materials/purchases?month=2026-11').set(h())
    expect(r.body.code).toBe(0)
    expect(Array.isArray(r.body.data.list)).toBe(true)
    expect(r.body.data.list.length).toBeGreaterThanOrEqual(3)
    expect(r.body.data.list.every((p) => p.purchaseDate.startsWith('2026-11'))).toBe(true)
  })
})
