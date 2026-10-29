// S8/S9 记账域接口控制器（契约 §7）
import { ok, fail } from '../middleware/response.js';
import logModel from '../models/logModel.js';
import * as svc from '../services/accountingService.js';

function wrap(fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (e) {
      return fail(res, e.code || 5000, e.message || '服务器内部错误');
    }
  };
}

function log(me, actionType, targetType, targetId, detail) {
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType, targetType, targetId, detail
  });
}

const dept = (req) => req.currentUser.deptCode;

// ===== 物品 =====
export const listItems = wrap(async (req, res) => ok(res, { list: svc.listItems(dept(req)) }));
export const createItem = wrap(async (req, res) => {
  const row = svc.createItem(dept(req), req.body || {}, req.currentUser.id);
  log(req.currentUser, 'create_item', 'material_item', row.id, { name: row.name });
  return ok(res, row, '物品已新增');
});
export const updateMinStock = wrap(async (req, res) => {
  const row = svc.updateMinStock(dept(req), Number(req.params.id), Number(req.body?.minStock));
  log(req.currentUser, 'update_min_stock', 'material_item', row.id, row);
  return ok(res, row);
});

// ===== 物料计划 =====
export const listPlans = wrap(async (req, res) =>
  ok(res, { list: svc.listPlans(dept(req), String(req.query.month || '')) }));
export const createPlan = wrap(async (req, res) => {
  const r = svc.createPlan(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, req.body?.isAppend === 1 ? 'append_material_plan' : 'create_material_plan',
    'material_plan', r.itemId, r.total);
  return ok(res, r, '计划已保存');
});

// ===== 领用 =====
export const listReceipts = wrap(async (req, res) =>
  ok(res, { list: svc.listReceipts(dept(req), String(req.query.month || '')) }));
export const createReceipt = wrap(async (req, res) => {
  const r = svc.createReceipt(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, 'create_receipt', 'material_receipt', r.id, { receiptNo: r.receiptNo, overPlan: r.overPlan });
  return ok(res, r, r.overPlan ? '已登记（超计划标红，请科长确认）' : '领用已登记');
});
export const voidReceipt = wrap(async (req, res) => {
  const r = svc.voidRecord(dept(req), 'receipt', Number(req.params.id), req.body?.reason, req.currentUser);
  log(req.currentUser, 'void_receipt', 'material_receipt', Number(req.params.id), r);
  return ok(res, r, r.requiresApproval ? '已发起跨天作废申请，待科长确认' : '已作废');
});

// ===== 发放 =====
export const listIssues = wrap(async (req, res) =>
  ok(res, { list: svc.listIssues(dept(req), String(req.query.month || '')) }));
export const createIssue = wrap(async (req, res) => {
  const r = svc.createIssue(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, 'create_issue', 'material_issue', r.id, { issueNo: r.issueNo });
  return ok(res, r, '发放已登记');
});
export const voidIssue = wrap(async (req, res) => {
  const r = svc.voidRecord(dept(req), 'issue', Number(req.params.id), req.body?.reason, req.currentUser);
  log(req.currentUser, 'void_issue', 'material_issue', Number(req.params.id), r);
  return ok(res, r, r.requiresApproval ? '已发起跨天作废申请，待科长确认' : '已作废');
});

// ===== 库存汇总 =====
export const stockSummary = wrap(async (req, res) => ok(res, { list: svc.stockSummary(dept(req)) }));

// ===== 我的物品 =====
export const myItems = wrap(async (req, res) => ok(res, { list: svc.myItems(req.currentUser.id) }));

// ===== 盘点 =====
export const listStocktakings = wrap(async (req, res) =>
  ok(res, { list: svc.listStocktakings(dept(req)) }));
export const openStocktaking = wrap(async (req, res) => {
  const r = svc.openStocktaking(dept(req), String(req.body?.month || '').slice(0, 7), req.currentUser);
  log(req.currentUser, 'open_stocktaking', 'stocktaking', r.id, { month: r.month });
  return ok(res, r, '盘点单已发起，账面已锁定');
});
export const fillStocktaking = wrap(async (req, res) => {
  const r = svc.fillStocktakingItems(dept(req), Number(req.params.id), (req.body?.items) || []);
  log(req.currentUser, 'fill_stocktaking', 'stocktaking', r.id);
  return ok(res, r, '实盘已录入');
});
export const confirmStocktaking = wrap(async (req, res) => {
  const r = svc.confirmStocktaking(dept(req), Number(req.params.id), req.currentUser);
  log(req.currentUser, 'confirm_stocktaking', 'stocktaking', r.id, { confirmedBy: req.currentUser.name });
  return ok(res, r, '盘点已确认，账面已调整');
});
export const voidStocktaking = wrap(async (req, res) => {
  const r = svc.voidStocktaking(dept(req), Number(req.params.id), req.body?.reason);
  log(req.currentUser, 'void_stocktaking', 'stocktaking', Number(req.params.id), { reason: r?.voidReason });
  return ok(res, r, '盘点单已作废（原行保留）');
});

// ===== 跨天修改/作废审批 =====
export const createModifyRequest = wrap(async (req, res) => {
  const r = svc.createModifyRequest(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, 'modify_request', 'accounting_approval', r.id, { target: req.body?.targetType, action: req.body?.action });
  return ok(res, r, '申请已发起，待科长确认（确认前原记录不变）');
});
export const listApprovals = wrap(async (req, res) => ok(res, { list: svc.listApprovals(dept(req)) }));
export const approveApproval = wrap(async (req, res) => {
  const r = svc.decideApproval(dept(req), Number(req.params.id), true, req.body?.confirmNote, req.currentUser);
  log(req.currentUser, 'approve_accounting', 'accounting_approval', r.id, { confirmedBy: req.currentUser.name });
  return ok(res, r, '已确认生效');
});
export const rejectApproval = wrap(async (req, res) => {
  const r = svc.decideApproval(dept(req), Number(req.params.id), false, req.body?.confirmNote, req.currentUser);
  log(req.currentUser, 'reject_accounting', 'accounting_approval', r.id, { confirmedBy: req.currentUser.name });
  return ok(res, r, '已驳回');
});

// ===== 资金 =====
export const listFundPlans = wrap(async (req, res) =>
  ok(res, { list: svc.listFundPlans(dept(req), String(req.query.month || '')) }));
export const createFundPlan = wrap(async (req, res) => {
  const r = svc.createFundPlan(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, req.body?.isAppend === 1 ? 'append_fund_plan' : 'create_fund_plan', 'fund_plan', null, r);
  return ok(res, r, '资金计划已保存');
});
export const listExpenses = wrap(async (req, res) =>
  ok(res, { list: svc.listExpenses(dept(req), String(req.query.month || '')) }));
export const createExpense = wrap(async (req, res) => {
  const r = svc.createExpense(dept(req), req.body || {}, req.currentUser);
  log(req.currentUser, 'create_expense', 'fund_expense', r.id, { expenseNo: r.expenseNo, settleStatus: r.settleStatus, overPlan: r.overPlan });
  return ok(res, r, r.settleStatus === '挂账' ? '已登记为挂账' : r.overPlan ? '已登记（超计划标红）' : '支出已登记');
});
export const settleExpense = wrap(async (req, res) => {
  const r = svc.settleExpense(dept(req), Number(req.params.id), req.body || {}, req.currentUser);
  log(req.currentUser, 'settle_expense', 'fund_expense', Number(req.params.id), r);
  return ok(res, r, '销账完成');
});
export const voidExpense = wrap(async (req, res) => {
  const r = svc.voidRecord(dept(req), 'expense', Number(req.params.id), req.body?.reason, req.currentUser);
  log(req.currentUser, 'void_expense', 'fund_expense', Number(req.params.id), r);
  return ok(res, r, r.requiresApproval ? '已发起跨天作废申请，待科长确认' : '已作废');
});
export const ledgerList = wrap(async (req, res) => ok(res, { list: svc.ledgerList(dept(req)) }));
