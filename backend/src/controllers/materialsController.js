import { ok, fail } from '../middleware/response.js';
import materialsModel from '../models/materialsModel.js';
import logModel from '../models/logModel.js';
import { nextDocNo, todayDate } from '../services/materialsService.js';

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

// ============ 计划管理（T2）============
// POST /api/materials/plans —— 工段长/科室经办填报（草稿）
export async function createPlan(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const month = String(body.month || '').trim();
  const planType = body.planType === 'section' ? 'section' : 'workshop';
  const unitCode = String(body.unitCode || '').trim();
  const unitName = String(body.unitName || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 4000, '月份格式应为 YYYY-MM');
  if (!unitCode || !unitName) return fail(res, 4000, '请填写单位编码与名称');
  if (!items.length) return fail(res, 4000, '计划至少包含一条物料');
  const planNo = nextDocNo('plans', 'plan_no', 'JH');
  const plan = materialsModel.createPlan({ planNo, month, planType, unitCode, unitName, createdBy: me.id });
  for (const it of items) {
    const name = String(it.materialName || '').trim();
    const qty = Number(it.plannedQty) || 0;
    const price = Number(it.referencePrice) || 0;
    if (!name) return fail(res, 4000, '物料名称不能为空');
    if (qty <= 0) return fail(res, 4000, `物料「${name}」数量须大于0`);
    materialsModel.addPlanItem({
      planId: plan.id,
      categoryId: it.categoryId ? Number(it.categoryId) : null,
      materialName: name,
      plannedQty: qty,
      referencePrice: price
    });
  }
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'create_plan',
    targetType: 'plan', targetId: plan.id, detail: { planNo, planType, unitName, month }
  });
  return ok(res, { ...plan, items: materialsModel.listPlanItems(plan.id) }, '已创建计划（草稿）');
}

// GET /api/materials/plans?month=&planType=&status=
export async function listPlans(req, res) {
  const month = String(req.query.month || '');
  const planType = String(req.query.planType || '');
  const status = String(req.query.status || '');
  return ok(res, { list: materialsModel.listPlans({ month, planType, status }) });
}

// GET /api/materials/plans/:id
export async function getPlan(req, res) {
  const id = Number(req.params.id);
  const plan = materialsModel.findPlan(id);
  if (!plan) return fail(res, 4040, '计划不存在');
  return ok(res, { ...plan, items: materialsModel.listPlanItems(id) });
}

// POST /api/materials/plans/:id/submit  draft→submitted
export async function submitPlan(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const plan = materialsModel.findPlan(id);
  if (!plan) return fail(res, 4040, '计划不存在');
  if (plan.status !== 'draft') return fail(res, 4000, '仅草稿可提交');
  const updated = materialsModel.updatePlanStatus(id, 'submitted');
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'submit_plan', targetType: 'plan', targetId: id });
  return ok(res, updated, '已提交');
}

// POST /api/materials/plans/:id/approve  submitted→approved（主任/科长审核；角色门禁 T10）
export async function approvePlan(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const plan = materialsModel.findPlan(id);
  if (!plan) return fail(res, 4040, '计划不存在');
  if (plan.status !== 'submitted') return fail(res, 4000, '仅已提交计划可审核');
  const updated = materialsModel.updatePlanStatus(id, 'approved');
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'approve_plan', targetType: 'plan', targetId: id });
  return ok(res, updated, '已通过');
}

// POST /api/materials/plans/:id/reject  submitted→rejected（驳回必填意见）
export async function rejectPlan(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const plan = materialsModel.findPlan(id);
  if (!plan) return fail(res, 4040, '计划不存在');
  if (plan.status !== 'submitted') return fail(res, 4000, '仅已提交计划可审核');
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return fail(res, 4000, '驳回须填写意见');
  const updated = materialsModel.updatePlanStatus(id, 'rejected', reason);
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'reject_plan', targetType: 'plan', targetId: id, detail: { reason } });
  return ok(res, updated, '已驳回');
}

// GET /api/materials/plans/summary?month=  供应科全厂汇总（车间+科室）
export async function summaryPlans(req, res) {
  const month = String(req.query.month || '');
  if (!month) return fail(res, 4000, '请指定月份');
  const all = materialsModel.listPlans({ month });
  const byUnit = {};
  for (const p of all) {
    if (!byUnit[p.unitName]) byUnit[p.unitName] = { unitName: p.unitName, planType: p.planType, count: 0, approved: 0, rejected: 0 };
    byUnit[p.unitName].count += 1;
    if (p.status === 'approved') byUnit[p.unitName].approved += 1;
    if (p.status === 'rejected') byUnit[p.unitName].rejected += 1;
  }
  return ok(res, { month, total: all.length, plans: all, byUnit: Object.values(byUnit) });
}

// ============ 采购管理（T3）============
// POST /api/materials/purchases —— 按类登记采购（CG 单据号）
export async function createPurchase(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const itemDesc = String(body.itemDesc || '').trim();
  const amount = Number(body.amount);
  const purchaseDate = String(body.purchaseDate || '').trim() || todayDate();
  if (!itemDesc) return fail(res, 4000, '采购摘要不能为空');
  if (!(amount >= 0)) return fail(res, 4000, '金额须为非负数');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return fail(res, 4000, '采购日期格式应为 YYYY-MM-DD');
  const purchaseNo = nextDocNo('purchases', 'purchase_no', 'CG');
  const created = materialsModel.createPurchase({
    purchaseNo,
    planId: body.planId ? Number(body.planId) : null,
    categoryId: body.categoryId ? Number(body.categoryId) : null,
    supplier: String(body.supplier || '').trim(),
    itemDesc,
    amount,
    fundCategoryId: body.fundCategoryId ? Number(body.fundCategoryId) : null,
    purchaseDate,
    handler: String(body.handler || '').trim(),
    createdBy: me.id
  });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'create_purchase',
    targetType: 'purchase', targetId: created.id, detail: { purchaseNo, itemDesc, amount }
  });
  return ok(res, created, '已登记采购');
}

// GET /api/materials/purchases?month=&categoryId=&fundCategoryId=&status=
export async function listPurchases(req, res) {
  const month = String(req.query.month || '');
  const categoryId = Number(req.query.categoryId) || 0;
  const fundCategoryId = Number(req.query.fundCategoryId) || 0;
  const status = String(req.query.status || '');
  return ok(res, { list: materialsModel.listPurchases({ month, categoryId, fundCategoryId, status }) });
}

// GET /api/materials/purchases/:id
export async function getPurchase(req, res) {
  const id = Number(req.params.id);
  const p = materialsModel.findPurchase(id);
  if (!p) return fail(res, 4040, '采购单不存在');
  return ok(res, p);
}

// POST /api/materials/purchases/:id/void  normal→void（作废必填意见）
export async function voidPurchase(req, res) {
  const me = req.currentUser;
  const id = Number(req.params.id);
  const p = materialsModel.findPurchase(id);
  if (!p) return fail(res, 4040, '采购单不存在');
  if (p.status !== 'normal') return fail(res, 4000, '仅正常状态可作废');
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return fail(res, 4000, '作废须填写意见');
  const updated = materialsModel.voidPurchase(id, reason);
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'void_purchase', targetType: 'purchase', targetId: id, detail: { reason } });
  return ok(res, updated, '已作废');
}

// ============ 到货与编号（T4）============
// POST /api/materials/arrivals —— 到货登记 + 批量生成 CL 编号
export async function createArrival(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const arrivedAt = String(body.arrivedAt || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrivedAt)) return fail(res, 4000, '到货日期格式应为 YYYY-MM-DD');
  if (!items.length) return fail(res, 4000, '到货明细至少一项');
  for (const it of items) {
    if (!String(it.name || '').trim()) return fail(res, 4000, '物料名称不能为空');
    if (!(Number(it.qty) > 0)) return fail(res, 4000, `物料「${it.name || '?'}」数量须大于0`);
  }
  try {
    const created = materialsModel.createArrival({
      purchaseId: body.purchaseId ? Number(body.purchaseId) : null,
      arrivedAt,
      items: items.map((it) => ({ categoryId: it.categoryId ? Number(it.categoryId) : null, name: String(it.name).trim(), spec: it.spec || '', unit: it.unit || '', qty: Number(it.qty) })),
      createdBy: me.id,
      operatorName: me.name
    });
    logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'arrive_material', targetType: 'material', targetId: created[0] ? created[0].id : 0, detail: { arrivedAt, count: created.length } });
    return ok(res, { count: created.length, list: created }, '已生成材料编号');
  } catch (e) {
    return fail(res, e.code || 5000, e.message || '到货登记失败');
  }
}

// GET /api/materials?code=&name=&categoryId=&status=
export async function listMaterials(req, res) {
  const code = String(req.query.code || '');
  const name = String(req.query.name || '');
  const categoryId = Number(req.query.categoryId) || 0;
  const status = String(req.query.status || '');
  return ok(res, { list: materialsModel.listMaterials({ code, name, categoryId, status }) });
}

// GET /api/materials/:id —— 详情含生命周期事件
export async function getMaterial(req, res) {
  const id = Number(req.params.id);
  const m = materialsModel.findMaterial(id);
  if (!m) return fail(res, 4040, '材料不存在');
  return ok(res, { ...m, events: materialsModel.listMaterialEvents(id) });
}

// ============ 领用/回收/处置（T5）============
// POST /api/materials/issues —— 领用（LL 编号）
export async function createIssue(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const materialIds = Array.isArray(body.materialIds) ? body.materialIds.map((x) => Number(x)).filter((x) => x) : [];
  const receiveUnitType = body.receiveUnitType === 'section' ? 'section' : 'workshop';
  const issueDate = String(body.issueDate || '').trim() || todayDate();
  if (!materialIds.length) return fail(res, 4000, '请选择至少一件材料');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return fail(res, 4000, '领用日期格式应为 YYYY-MM-DD');
  if (!String(body.receiveUnitCode || '').trim() || !String(body.receiveUnitName || '').trim()) return fail(res, 4000, '请填写领用单位');
  const issueNo = nextDocNo('issue_records', 'issue_no', 'LL');
  try {
    const created = materialsModel.createIssue({
      issueNo,
      purchaseId: body.purchaseId ? Number(body.purchaseId) : null,
      materialIds,
      receiveUnitType,
      receiveUnitCode: String(body.receiveUnitCode).trim(),
      receiveUnitName: String(body.receiveUnitName).trim(),
      handler: String(body.handler || '').trim(),
      issueDate,
      createdBy: me.id,
      operatorName: me.name
    });
    logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'issue_material', targetType: 'issue_record', targetId: created.id, detail: { issueNo, qty: materialIds.length, receiveUnitName: created.receiveUnitName } });
    return ok(res, created, '已登记领用');
  } catch (e) {
    return fail(res, e.code || 5000, e.message || '领用失败');
  }
}

// POST /api/materials/recycles —— 回收（issued→recycled）
export async function createRecycle(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const materialId = Number(body.materialId);
  const recycleDate = String(body.recycleDate || '').trim() || todayDate();
  if (!materialId) return fail(res, 4000, '请选择材料');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recycleDate)) return fail(res, 4000, '回收日期格式应为 YYYY-MM-DD');
  try {
    const created = materialsModel.createRecycle({
      issueRecordId: body.issueRecordId ? Number(body.issueRecordId) : null,
      materialId,
      qty: Number(body.qty) || 1,
      handler: String(body.handler || '').trim(),
      recycleDate,
      createdBy: me.id,
      operatorName: me.name
    });
    logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'recycle_material', targetType: 'recycle_record', targetId: created.id, detail: { materialId } });
    return ok(res, created, '已登记回收');
  } catch (e) {
    return fail(res, e.code || 5000, e.message || '回收失败');
  }
}

// POST /api/materials/disposals —— 处置批次（CZ 编号）
export async function createDisposal(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const disposeDate = String(body.disposeDate || '').trim() || todayDate();
  if (!items.length) return fail(res, 4000, '处置明细至少一项');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disposeDate)) return fail(res, 4000, '处置日期格式应为 YYYY-MM-DD');
  for (const it of items) {
    if (!Number(it.materialId)) return fail(res, 4000, '处置明细须关联材料');
    if (!(Number(it.qty) > 0)) return fail(res, 4000, '处置数量须大于0');
  }
  const disposalNo = nextDocNo('disposal_batches', 'disposal_no', 'CZ');
  try {
    const created = materialsModel.createDisposalBatch({
      disposalNo,
      categoryId: body.categoryId ? Number(body.categoryId) : null,
      disposeType: body.disposeType || null,
      items: items.map((it) => ({ materialId: Number(it.materialId), name: it.name || '', qty: Number(it.qty), income: Number(it.income) || 0 })),
      handler: String(body.handler || '').trim(),
      disposeDate,
      createdBy: me.id,
      operatorName: me.name
    });
    logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'dispose_material', targetType: 'disposal_batch', targetId: created.id, detail: { disposalNo, totalIncome: created.totalIncome } });
    return ok(res, created, '已登记处置');
  } catch (e) {
    return fail(res, e.code || 5000, e.message || '处置失败');
  }
}

// GET /api/materials/issues?receiveUnitType=&status=
export async function listIssues(req, res) {
  const receiveUnitType = String(req.query.receiveUnitType || '');
  const status = String(req.query.status || '');
  return ok(res, { list: materialsModel.listIssues({ receiveUnitType, status }) });
}

// GET /api/materials/disposals?status=
export async function listDisposalBatches(req, res) {
  const status = String(req.query.status || '');
  return ok(res, { list: materialsModel.listDisposalBatches({ status }) });
}

// GET /api/materials/disposals/:id —— 含明细
export async function getDisposalBatch(req, res) {
  const id = Number(req.params.id);
  const b = materialsModel.findDisposalBatch(id);
  if (!b) return fail(res, 4040, '处置批次不存在');
  return ok(res, { ...b, items: materialsModel.listDisposalItems(id) });
}

// ============ 汇总/概览（T6/T7/T9）============
// GET /api/materials/stats/monthly —— 按月收支与流转数量
export async function getMonthlySummary(req, res) {
  return ok(res, materialsModel.summaryMonthly());
}

// GET /api/materials/dashboard/overview —— 首页工作台概览
export async function getOverview(req, res) {
  return ok(res, materialsModel.overview());
}
