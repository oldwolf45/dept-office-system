import db from './db.js';
import { nextMaterialCode, canTransitionMaterial } from '../services/materialsService.js';

// 材料模块数据访问层（v1.1 / T0~T11）。
// 全部查询走 db Proxy（db.prepare），软删除统一用 deleted_at IS NULL。
// 表结构由 models/db.js 的 runSchema() 幂等建表，本文件只做 CRUD。

const ROLE_LABELS = {
  workshop_director: '工段长',
  workshop_manager: '车间主任',
  supply: '供应科',
  section_agent: '科室经办'
};

const materialsModel = {
  // 模块访问权：未配置任何授权（module_access 空）时默认开放（T0/T10 过渡期）；
  // 一旦配置了授权，仅白名单内用户可见材料模块。
  hasModuleAccess(userId) {
    const anyConfigured = db.prepare(
      `SELECT 1 AS x FROM module_access WHERE deleted_at IS NULL LIMIT 1`
    ).get();
    if (!anyConfigured) return true;
    return !!db.prepare(
      `SELECT 1 AS x FROM module_access WHERE user_id = ? AND module_code = 'materials' AND deleted_at IS NULL`
    ).get(userId);
  },

  // 当前用户在材料模块内的角色映射（工段长/车间主任/供应科/科室经办）
  listModuleRoles(userId) {
    const rows = db.prepare(
      `SELECT role, unit_type AS unitType, unit_code AS unitCode, unit_name AS unitName
       FROM module_role_map WHERE user_id = ? AND deleted_at IS NULL`
    ).all(userId);
    return rows.map((r) => ({ ...r, roleLabel: ROLE_LABELS[r.role] || r.role }));
  },

  // ---- 材料类别（T1 起界面维护）----
  listCategories({ includeDisabled = false } = {}) {
    const where = ['deleted_at IS NULL'];
    if (!includeDisabled) where.push(`status = 'active'`);
    return db.prepare(
      `SELECT id, code, name, status, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
       FROM material_categories WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`
    ).all();
  },

  findCategoryById(id) {
    return db.prepare(
      `SELECT id, code, name, status, sort_order AS sortOrder FROM material_categories WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  createCategory({ code = null, name, sortOrder = 0, createdBy }) {
    const info = db.prepare(
      `INSERT INTO material_categories (code, name, sort_order, created_by) VALUES (?, ?, ?, ?)`
    ).run(code || null, name, sortOrder, createdBy ?? null);
    return this.findCategoryById(Number(info.lastInsertRowid));
  },

  updateCategory(id, { name, sortOrder }) {
    const sets = [`updated_at = datetime('now','localtime')`];
    const params = [];
    if (name !== undefined) { sets.unshift('name = ?'); params.push(name); }
    if (sortOrder !== undefined) { sets.unshift('sort_order = ?'); params.push(sortOrder); }
    params.push(id);
    db.prepare(`UPDATE material_categories SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...params);
    return this.findCategoryById(id);
  },

  setCategoryStatus(id, status) {
    db.prepare(`UPDATE material_categories SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`).run(status, id);
    return this.findCategoryById(id);
  },

  // 类别是否被引用（材料/采购/计划行），已用不可停用
  categoryInUse(id) {
    for (const [t, col] of [['materials', 'category_id'], ['purchases', 'category_id'], ['plan_items', 'category_id']]) {
      const row = db.prepare(`SELECT 1 AS x FROM ${t} WHERE ${col} = ? AND deleted_at IS NULL LIMIT 1`).get(id);
      if (row) return true;
    }
    return false;
  },

  // ---- 收支分类（T0 种子；T1 起界面维护）----
  listFinanceCategories({ includeDisabled = false } = {}) {
    const where = ['deleted_at IS NULL'];
    if (!includeDisabled) where.push(`status = 'active'`);
    return db.prepare(
      `SELECT id, name, type, status, sort_order AS sortOrder FROM finance_categories
       WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`
    ).all();
  },

  findFinanceCategoryById(id) {
    return db.prepare(
      `SELECT id, name, type, status, sort_order AS sortOrder FROM finance_categories WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  createFinanceCategory({ name, type = 'expense', sortOrder = 0 }) {
    const info = db.prepare(
      `INSERT INTO finance_categories (name, type, sort_order) VALUES (?, ?, ?)`
    ).run(name, type, sortOrder);
    return this.findFinanceCategoryById(Number(info.lastInsertRowid));
  },

  updateFinanceCategory(id, { name, type, sortOrder }) {
    const sets = [`updated_at = datetime('now','localtime')`];
    const params = [];
    if (name !== undefined) { sets.unshift('name = ?'); params.push(name); }
    if (type !== undefined) { sets.unshift('type = ?'); params.push(type); }
    if (sortOrder !== undefined) { sets.unshift('sort_order = ?'); params.push(sortOrder); }
    params.push(id);
    db.prepare(`UPDATE finance_categories SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...params);
    return this.findFinanceCategoryById(id);
  },

  setFinanceCategoryStatus(id, status) {
    db.prepare(`UPDATE finance_categories SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`).run(status, id);
    return this.findFinanceCategoryById(id);
  },

  // ---- 计划（T2）----
  createPlan({ planNo, month, planType, unitCode, unitName, createdBy }) {
    const info = db.prepare(
      `INSERT INTO plans (plan_no, month, plan_type, unit_code, unit_name, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`
    ).run(planNo, month, planType, unitCode, unitName, createdBy);
    return this.findPlan(Number(info.lastInsertRowid));
  },

  findPlan(id) {
    return db.prepare(
      `SELECT id, plan_no AS planNo, month, plan_type AS planType, unit_code AS unitCode, unit_name AS unitName,
              status, reject_reason AS rejectReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM plans WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  addPlanItem({ planId, categoryId, materialName, plannedQty, referencePrice }) {
    const amount = Number(plannedQty) * Number(referencePrice);
    db.prepare(
      `INSERT INTO plan_items (plan_id, category_id, material_name, planned_qty, reference_price, planned_amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(planId, categoryId ?? null, materialName, plannedQty, referencePrice, amount);
  },

  listPlanItems(planId) {
    return db.prepare(
      `SELECT id, plan_id AS planId, category_id AS categoryId, material_name AS materialName,
              planned_qty AS plannedQty, reference_price AS referencePrice, planned_amount AS plannedAmount
       FROM plan_items WHERE plan_id = ? AND deleted_at IS NULL ORDER BY id ASC`
    ).all(planId);
  },

  listPlans({ month = '', planType = '', status = '', unitCode = '' } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (month) { where.push('month = ?'); params.push(month); }
    if (planType) { where.push('plan_type = ?'); params.push(planType); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (unitCode) { where.push('unit_code = ?'); params.push(unitCode); }
    return db.prepare(
      `SELECT id, plan_no AS planNo, month, plan_type AS planType, unit_code AS unitCode, unit_name AS unitName,
              status, reject_reason AS rejectReason, created_by AS createdBy, created_at AS createdAt
       FROM plans WHERE ${where.join(' AND ')} ORDER BY id DESC`
    ).all(...params);
  },

  updatePlanStatus(id, status, rejectReason = null) {
    db.prepare(
      `UPDATE plans SET status = ?, reject_reason = ?, updated_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`
    ).run(status, rejectReason, id);
    return this.findPlan(id);
  },

  // ---- 采购（T3）----
  createPurchase({ purchaseNo, planId, categoryId, supplier, itemDesc, amount, fundCategoryId, purchaseDate, handler, createdBy }) {
    const info = db.prepare(
      `INSERT INTO purchases (purchase_no, plan_id, category_id, supplier, item_desc, amount, fund_category_id, purchase_date, handler, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?)`
    ).run(purchaseNo, planId ?? null, categoryId ?? null, supplier || null, itemDesc, amount, fundCategoryId ?? null, purchaseDate, handler || null, createdBy ?? null);
    return this.findPurchase(Number(info.lastInsertRowid));
  },

  findPurchase(id) {
    return db.prepare(
      `SELECT id, purchase_no AS purchaseNo, plan_id AS planId, category_id AS categoryId, supplier, item_desc AS itemDesc,
              amount, fund_category_id AS fundCategoryId, purchase_date AS purchaseDate, handler, status, void_reason AS voidReason,
              created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM purchases WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  listPurchases({ month = '', categoryId = 0, fundCategoryId = 0, status = '' } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (month) { where.push('purchase_date LIKE ?'); params.push(`${month}%`); }
    if (categoryId) { where.push('category_id = ?'); params.push(categoryId); }
    if (fundCategoryId) { where.push('fund_category_id = ?'); params.push(fundCategoryId); }
    if (status) { where.push('status = ?'); params.push(status); }
    return db.prepare(
      `SELECT id, purchase_no AS purchaseNo, plan_id AS planId, category_id AS categoryId, supplier, item_desc AS itemDesc,
              amount, fund_category_id AS fundCategoryId, purchase_date AS purchaseDate, handler, status, created_at AS createdAt
       FROM purchases WHERE ${where.join(' AND ')} ORDER BY id DESC`
    ).all(...params);
  },

  voidPurchase(id, reason) {
    db.prepare(
      `UPDATE purchases SET status = 'void', void_reason = ?, updated_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`
    ).run(reason, id);
    return this.findPurchase(id);
  },

  // ============ 到货与编号（T4）============
  findMaterial(id) {
    return db.prepare(
      `SELECT id, material_code AS materialCode, purchase_id AS purchaseId, category_id AS categoryId, name, spec, unit,
              status, arrived_at AS arrivedAt, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM materials WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  listMaterials({ code = '', name = '', categoryId = 0, status = '' } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (code) { where.push('material_code = ?'); params.push(code); }
    if (name) { where.push('name LIKE ?'); params.push(`%${name}%`); }
    if (categoryId) { where.push('category_id = ?'); params.push(categoryId); }
    if (status) { where.push('status = ?'); params.push(status); }
    return db.prepare(
      `SELECT id, material_code AS materialCode, purchase_id AS purchaseId, category_id AS categoryId, name, spec, unit,
              status, arrived_at AS arrivedAt
       FROM materials WHERE ${where.join(' AND ')} ORDER BY id DESC`
    ).all(...params);
  },

  listMaterialEvents(materialId) {
    return db.prepare(
      `SELECT id, ref_type AS refType, ref_id AS refId, action, operator_id AS operatorId, operator_name AS operatorName,
              qty, amount, occur_at AS occurAt, created_at AS createdAt
       FROM material_events WHERE material_id = ? AND deleted_at IS NULL ORDER BY id ASC`
    ).all(materialId);
  },

  addMaterialEvent({ materialId, refType, refId, action, operatorId, operatorName, qty = 1, amount = null, occurAt }) {
    db.prepare(
      `INSERT INTO material_events (material_id, ref_type, ref_id, action, operator_id, operator_name, qty, amount, occur_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(materialId, refType, refId ?? null, action, operatorId ?? null, operatorName || null, qty, amount, occurAt || null);
  },

  setMaterialStatus(id, status) {
    db.prepare(`UPDATE materials SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`).run(status, id);
    return this.findMaterial(id);
  },

  // 到货登记：为每件材料生成唯一 CL 编号（CL+到货日期+类别两位+四位流水），初始 in_stock，写 arrive 事件
  createArrival({ purchaseId, arrivedAt, items, createdBy, operatorName }) {
    const created = [];
    const ymd = String(arrivedAt).replace(/-/g, '');
    for (const it of items) {
      const cat = it.categoryId ? this.findCategoryById(it.categoryId) : null;
      const catCode = cat && cat.code ? String(cat.code).padStart(2, '0') : '00';
      const qty = Number(it.qty) || 0;
      for (let i = 0; i < qty; i++) {
        const code = nextMaterialCode(catCode, ymd);
        const info = db.prepare(
          `INSERT INTO materials (material_code, purchase_id, category_id, name, spec, unit, status, arrived_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'in_stock', ?, ?)`
        ).run(code, purchaseId ?? null, it.categoryId ?? null, it.name, it.spec || null, it.unit || null, arrivedAt, createdBy ?? null);
        const mid = Number(info.lastInsertRowid);
        this.addMaterialEvent({ materialId: mid, refType: 'purchase', refId: purchaseId ?? null, action: 'arrive', operatorId: createdBy, operatorName, qty: 1, occurAt: arrivedAt });
        created.push(this.findMaterial(mid));
      }
    }
    return created;
  },

  // ============ 领用/回收/处置（T5）============
  findIssue(id) {
    return db.prepare(
      `SELECT id, issue_no AS issueNo, purchase_id AS purchaseId, material_ids AS materialIds, receive_unit_type AS receiveUnitType,
              receive_unit_code AS receiveUnitCode, receive_unit_name AS receiveUnitName, qty, handler, issue_date AS issueDate,
              status, void_reason AS voidReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM issue_records WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  // 领用：批量材料 in_stock→issued；科室领用同步写物料账领用记录（T8 联动）
  createIssue({ issueNo, purchaseId, materialIds, receiveUnitType, receiveUnitCode, receiveUnitName, handler, issueDate, createdBy, operatorName }) {
    const mats = [];
    for (const mid of materialIds) {
      const m = this.findMaterial(mid);
      if (!m) { const e = new Error('材料不存在'); e.code = 4040; throw e; }
      const chk = canTransitionMaterial(m.status, 'issued');
      if (!chk.ok) { const e = new Error(chk.reason); e.code = 4000; throw e; }
      mats.push(m);
    }
    const info = db.prepare(
      `INSERT INTO issue_records (issue_no, purchase_id, material_ids, receive_unit_type, receive_unit_code, receive_unit_name, qty, handler, issue_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?)`
    ).run(issueNo, purchaseId ?? null, JSON.stringify(materialIds), receiveUnitType, receiveUnitCode, receiveUnitName, materialIds.length, handler || null, issueDate, createdBy ?? null);
    const rid = Number(info.lastInsertRowid);
    for (const m of mats) {
      this.setMaterialStatus(m.id, 'issued');
      this.addMaterialEvent({ materialId: m.id, refType: 'issue', refId: rid, action: 'issue', operatorId: createdBy, operatorName, qty: 1, occurAt: issueDate });
    }
    // T8 联动：科室领用写入物料账领用记录，数量/编号一致
    if (receiveUnitType === 'section') {
      const codes = mats.map((m) => m.materialCode).join(',');
      const month = String(issueDate).slice(0, 7);
      db.prepare(
        `INSERT INTO material_issues (issue_no, dept_code, month, item_id, user_id, qty, issue_date, handler, batch_alloc, status, material_issue_id, material_codes, material_plan_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?)`
      ).run(issueNo, receiveUnitCode, month, mats[0] ? mats[0].id : 0, createdBy ?? null, materialIds.length, issueDate, handler || null, codes, rid, codes, null, createdBy ?? null);
    }
    return this.findIssue(rid);
  },

  findRecycle(id) {
    return db.prepare(
      `SELECT id, recycle_no AS recycleNo, issue_record_id AS issueRecordId, material_id AS materialId, qty, handler, recycle_date AS recycleDate, status, created_by AS createdBy, created_at AS createdAt
       FROM recycle_records WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  createRecycle({ issueRecordId, materialId, qty, handler, recycleDate, createdBy, operatorName }) {
    const m = this.findMaterial(materialId);
    if (!m) { const e = new Error('材料不存在'); e.code = 4040; throw e; }
    const chk = canTransitionMaterial(m.status, 'recycled');
    if (!chk.ok) { const e = new Error(chk.reason); e.code = 4000; throw e; }
    const info = db.prepare(
      `INSERT INTO recycle_records (issue_record_id, material_id, qty, handler, recycle_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'normal', ?)`
    ).run(issueRecordId ?? null, materialId, qty || 1, handler || null, recycleDate, createdBy ?? null);
    const rid = Number(info.lastInsertRowid);
    this.setMaterialStatus(materialId, 'recycled');
    this.addMaterialEvent({ materialId, refType: 'recycle', refId: rid, action: 'recycle', operatorId: createdBy, operatorName, qty: qty || 1, occurAt: recycleDate });
    return this.findRecycle(rid);
  },

  findDisposalBatch(id) {
    return db.prepare(
      `SELECT id, disposal_no AS disposalNo, category_id AS categoryId, dispose_type AS disposeType, total_qty AS totalQty, total_income AS totalIncome, handler, dispose_date AS disposeDate, status, void_reason AS voidReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM disposal_batches WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  listDisposalItems(batchId) {
    return db.prepare(
      `SELECT id, disposal_batch_id AS disposalBatchId, material_id AS materialId, name, qty, income FROM disposal_items WHERE disposal_batch_id = ? AND deleted_at IS NULL ORDER BY id ASC`
    ).all(batchId);
  },

  // 处置：批量材料 →disposed（issued/recycled 可转），记处置收入，写 dispose 事件
  createDisposalBatch({ disposalNo, categoryId, disposeType, items, handler, disposeDate, createdBy, operatorName }) {
    let totalQty = 0;
    let totalIncome = 0;
    const inserted = [];
    for (const it of items) {
      const m = this.findMaterial(it.materialId);
      if (!m) { const e = new Error('材料不存在'); e.code = 4040; throw e; }
      const chk = canTransitionMaterial(m.status, 'disposed');
      if (!chk.ok) { const e = new Error(chk.reason); e.code = 4000; throw e; }
      this.setMaterialStatus(it.materialId, 'disposed');
      this.addMaterialEvent({ materialId: it.materialId, refType: 'disposal', refId: null, action: 'dispose', operatorId: createdBy, operatorName, qty: it.qty || 1, amount: it.income || 0, occurAt: disposeDate });
      totalQty += Number(it.qty || 1);
      totalIncome += Number(it.income || 0);
      inserted.push({ materialId: it.materialId, name: it.name || m.name, qty: it.qty || 1, income: it.income || 0 });
    }
    const info = db.prepare(
      `INSERT INTO disposal_batches (disposal_no, category_id, dispose_type, total_qty, total_income, handler, dispose_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?)`
    ).run(disposalNo, categoryId ?? null, disposeType || null, totalQty, totalIncome, handler || null, disposeDate, createdBy ?? null);
    const bid = Number(info.lastInsertRowid);
    for (const d of inserted) {
      db.prepare(`INSERT INTO disposal_items (disposal_batch_id, material_id, name, qty, income) VALUES (?, ?, ?, ?, ?)`).run(bid, d.materialId, d.name, d.qty, d.income);
    }
    return this.findDisposalBatch(bid);
  },

  // ============ 汇总/概览（T7/T9）============
  listIssues({ receiveUnitType = '', status = '' } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (receiveUnitType) { where.push('receive_unit_type = ?'); params.push(receiveUnitType); }
    if (status) { where.push('status = ?'); params.push(status); }
    return db.prepare(
      `SELECT id, issue_no AS issueNo, receive_unit_type AS receiveUnitType, receive_unit_name AS receiveUnitName, qty, handler, issue_date AS issueDate, status
       FROM issue_records WHERE ${where.join(' AND ')} ORDER BY id DESC`
    ).all(...params);
  },

  listDisposalBatches({ status = '' } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    return db.prepare(
      `SELECT id, disposal_no AS disposalNo, dispose_type AS disposeType, total_qty AS totalQty, total_income AS totalIncome, handler, dispose_date AS disposeDate, status
       FROM disposal_batches WHERE ${where.join(' AND ')} ORDER BY id DESC`
    ).all(...params);
  },

  // 按月汇总：采购金额 / 处置收入 / 流转数量（issue/recycle/dispose）
  summaryMonthly() {
    const purchase = db.prepare(
      `SELECT substr(purchase_date,1,7) AS month, COALESCE(SUM(amount),0) AS amt FROM purchases WHERE status='normal' AND deleted_at IS NULL GROUP BY month ORDER BY month`
    ).all();
    const dispose = db.prepare(
      `SELECT substr(b.dispose_date,1,7) AS month, COALESCE(SUM(i.income),0) AS amt
       FROM disposal_items i JOIN disposal_batches b ON b.id = i.disposal_batch_id
       WHERE b.status='normal' AND b.deleted_at IS NULL GROUP BY month ORDER BY month`
    ).all();
    const flow = db.prepare(
      `SELECT substr(occur_at,1,7) AS month, action, COUNT(*) AS n FROM material_events
       WHERE deleted_at IS NULL AND action IN ('issue','recycle','dispose') GROUP BY month, action ORDER BY month`
    ).all();
    return { purchase, dispose, flow };
  },

  overview() {
    const plan = db.prepare(`SELECT status, COUNT(*) AS n FROM plans WHERE deleted_at IS NULL GROUP BY status`).all();
    const planMap = {};
    for (const r of plan) planMap[r.status] = r.n;
    const purchaseAmount = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amt FROM purchases WHERE status='normal' AND deleted_at IS NULL`).get().amt;
    const disposeIncome = db.prepare(
      `SELECT COALESCE(SUM(i.income),0) AS amt FROM disposal_items i JOIN disposal_batches b ON b.id = i.disposal_batch_id WHERE b.status='normal' AND b.deleted_at IS NULL`
    ).get().amt;
    const mat = db.prepare(`SELECT status, COUNT(*) AS n FROM materials WHERE deleted_at IS NULL GROUP BY status`).all();
    const matMap = {};
    for (const r of mat) matMap[r.status] = r.n;
    return {
      planStatus: planMap,
      purchaseAmount,
      disposeIncome,
      materialByStatus: matMap,
      pendingApproval: planMap.submitted || 0
    };
  },

  // ============ 模块角色（T10 按钮级权限，后端权威）============
  userHasModuleRole(userId, roles) {
    const my = this.listModuleRoles(userId).map((r) => r.role);
    return roles.some((r) => my.includes(r));
  },

  // ---- 角色配置（T10 补口：PRD 要求「人员↔模块角色↔单位」映射在账号维护时配置，
  //      此前只做了读取与门禁，没有任何写入入口，导致上线后无人有角色、所有写按钮不渲染）----

  // 全部有效映射（附工号姓名与单位），供配置页列表
  listModuleRoleMap() {
    const rows = db.prepare(
      `SELECT m.id, m.user_id AS userId, u.user_no AS userNo, u.name AS userName,
              u.role AS level, u.dept_name AS deptName,
              m.role, m.unit_type AS unitType, m.unit_code AS unitCode, m.unit_name AS unitName,
              m.created_at AS createdAt
       FROM module_role_map m
       JOIN users u ON u.id = m.user_id
       WHERE m.deleted_at IS NULL AND u.deleted_at IS NULL
       ORDER BY u.user_no, m.role`
    ).all();
    return rows.map((r) => ({ ...r, roleLabel: ROLE_LABELS[r.role] || r.role }));
  },

  // 同一人重复授予同一角色：按 user_id + role 判定（单位仅描述，不参与门禁）
  findModuleRoleByUserRole(userId, role) {
    return db.prepare(
      `SELECT id FROM module_role_map WHERE user_id = ? AND role = ? AND deleted_at IS NULL`
    ).get(userId, role);
  },

  addModuleRole({ userId, role, unitType, unitCode, unitName, createdBy = null }) {
    const info = db.prepare(
      `INSERT INTO module_role_map (user_id, role, unit_type, unit_code, unit_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, role, unitType, unitCode, unitName, createdBy);
    return Number(info.lastInsertRowid);
  },

  // 软删（撤销授权）；已撤销的返回 0
  revokeModuleRole(id) {
    const info = db.prepare(
      `UPDATE module_role_map SET deleted_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
       WHERE id = ? AND deleted_at IS NULL`
    ).run(id);
    return Number(info.changes);
  },

  findModuleRoleById(id) {
    return db.prepare(
      `SELECT id, user_id AS userId, role, unit_type AS unitType, unit_code AS unitCode, unit_name AS unitName
       FROM module_role_map WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
  },

  // 可授予角色的人员候选：全部在职用户（含 level 与科室，便于按科室挑人）
  listRoleCandidates() {
    return db.prepare(
      `SELECT id, user_no AS userNo, name, role AS level, dept_code AS deptCode, dept_name AS deptName, status
       FROM users WHERE deleted_at IS NULL AND status = 'active' ORDER BY role DESC, user_no`
    ).all();
  }
};

export default materialsModel;
