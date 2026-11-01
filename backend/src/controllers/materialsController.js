import { ok, fail } from '../middleware/response.js';
import materialsModel from '../models/materialsModel.js';
import logModel from '../models/logModel.js';

// GET /api/materials/me —— 当前用户材料模块访问态与角色（前端渲染工作区壳的依据）
export async function me(req, res) {
  const user = req.currentUser;
  return ok(res, {
    hasAccess: materialsModel.hasModuleAccess(user.id),
    roles: materialsModel.listModuleRoles(user.id)
  });
}

// ============ 材料类别 ============
// GET /api/materials/categories —— 活动列表（下拉用）
export async function listCategories(req, res) {
  return ok(res, { list: materialsModel.listCategories({ includeDisabled: false }) });
}

// GET /api/materials/categories/manage —— 含停用（管理用）
export async function manageCategories(req, res) {
  return ok(res, { list: materialsModel.listCategories({ includeDisabled: true }) });
}

// POST /api/materials/categories
export async function createCategory(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return fail(res, 4000, '名称不能为空');
  const code = body.code ? String(body.code).trim() : null;
  if (code && !/^\d{2}$/.test(code)) return fail(res, 4000, '类别码须为两位数字');
  if (materialsModel.listCategories({ includeDisabled: true }).some((c) => c.name === name)) {
    return fail(res, 4000, `类别「${name}」已存在`);
  }
  const created = materialsModel.createCategory({ code, name, sortOrder: Number(body.sortOrder) || 0, createdBy: me.id });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'create_material_category',
    targetType: 'material_category', targetId: created.id, detail: { name, code }
  });
  return ok(res, created, '新增成功');
}

// PUT /api/materials/categories/:id
export async function updateCategory(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const cat = materialsModel.findCategoryById(id);
  if (!cat) return fail(res, 4040, '类别不存在');
  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  if (name !== undefined && !name) return fail(res, 4000, '名称不能为空');
  const updated = materialsModel.updateCategory(id, {
    name, sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined
  });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'update_material_category', targetType: 'material_category', targetId: id });
  return ok(res, updated);
}

// POST /api/materials/categories/:id/disable —— 已用不可停用
export async function disableCategory(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const cat = materialsModel.findCategoryById(id);
  if (!cat) return fail(res, 4040, '类别不存在');
  if (cat.status !== 'active') return fail(res, 4000, '该类别已是停用状态');
  if (materialsModel.categoryInUse(id)) return fail(res, 4000, '该类别已被使用，不可停用');
  const updated = materialsModel.setCategoryStatus(id, 'disabled');
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'disable_material_category', targetType: 'material_category', targetId: id });
  return ok(res, updated);
}

// POST /api/materials/categories/:id/enable
export async function enableCategory(req, res) {
  const id = Number(req.params.id);
  const cat = materialsModel.findCategoryById(id);
  if (!cat) return fail(res, 4040, '类别不存在');
  if (cat.status === 'active') return fail(res, 4000, '该类别已是启用状态');
  return ok(res, materialsModel.setCategoryStatus(id, 'active'));
}

// ============ 收支分类 ============
// GET /api/materials/finance-categories —— 活动列表
export async function listFinanceCategories(req, res) {
  return ok(res, { list: materialsModel.listFinanceCategories({ includeDisabled: false }) });
}

// GET /api/materials/finance-categories/manage —— 含停用
export async function manageFinanceCategories(req, res) {
  return ok(res, { list: materialsModel.listFinanceCategories({ includeDisabled: true }) });
}

// POST /api/materials/finance-categories
export async function createFinanceCategory(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return fail(res, 4000, '名称不能为空');
  const type = body.type === 'income' ? 'income' : 'expense';
  if (materialsModel.listFinanceCategories({ includeDisabled: true }).some((c) => c.name === name && c.type === type)) {
    return fail(res, 4000, `收支分类「${name}」已存在`);
  }
  const created = materialsModel.createFinanceCategory({ name, type, sortOrder: Number(body.sortOrder) || 0 });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'create_finance_category',
    targetType: 'finance_category', targetId: created.id, detail: { name, type }
  });
  return ok(res, created, '新增成功');
}

// PUT /api/materials/finance-categories/:id
export async function updateFinanceCategory(req, res) {
  const id = Number(req.params.id);
  const cat = materialsModel.findFinanceCategoryById(id);
  if (!cat) return fail(res, 4040, '收支分类不存在');
  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  if (name !== undefined && !name) return fail(res, 4000, '名称不能为空');
  const type = body.type === 'income' ? 'income' : body.type === 'expense' ? 'expense' : undefined;
  return ok(res, materialsModel.updateFinanceCategory(id, {
    name, type, sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined
  }));
}

// POST /api/materials/finance-categories/:id/disable
export async function disableFinanceCategory(req, res) {
  const id = Number(req.params.id);
  const cat = materialsModel.findFinanceCategoryById(id);
  if (!cat) return fail(res, 4040, '收支分类不存在');
  if (cat.status !== 'active') return fail(res, 4000, '该分类已是停用状态');
  return ok(res, materialsModel.setFinanceCategoryStatus(id, 'disabled'));
}

// POST /api/materials/finance-categories/:id/enable
export async function enableFinanceCategory(req, res) {
  const id = Number(req.params.id);
  if (!materialsModel.findFinanceCategoryById(id)) return fail(res, 4040, '收支分类不存在');
  return ok(res, materialsModel.setFinanceCategoryStatus(id, 'active'));
}
