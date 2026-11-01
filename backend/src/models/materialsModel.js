import db from './db.js';

// 材料模块数据访问层（v1.1 / T0 骨架）。
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

  // ---- 材料类别（T1 起界面维护；T0 仅提供基础读写）----
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

  // ---- 收支分类（T0 内置种子；T1 起界面维护）----
  listFinanceCategories({ includeDisabled = false } = {}) {
    const where = ['deleted_at IS NULL'];
    if (!includeDisabled) where.push(`status = 'active'`);
    return db.prepare(
      `SELECT id, name, type, status, sort_order AS sortOrder FROM finance_categories
       WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`
    ).all();
  }
};

export default materialsModel;
