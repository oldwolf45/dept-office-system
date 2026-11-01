import db from './db.js';

// 材料模块数据访问层（v1.1 / T0~T1）。
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
  }
};

export default materialsModel;
