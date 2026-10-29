import express from 'express';
import {
  getBookkeeper, setBookkeeper,
  listDelegations, createDelegation, revokeDelegation
} from '../controllers/accountingController.js';
import {
  listItems, createItem, updateMinStock,
  listPlans, createPlan,
  listReceipts, createReceipt, voidReceipt,
  listIssues, createIssue, voidIssue,
  stockSummary, myItems,
  listStocktakings, openStocktaking, fillStocktaking, confirmStocktaking, voidStocktaking,
  createModifyRequest, listApprovals, approveApproval, rejectApproval,
  listFundPlans, createFundPlan,
  listExpenses, createExpense, settleExpense, voidExpense, ledgerList
} from '../controllers/accountingDomainController.js';
import { requireAuth } from '../middleware/auth.js';
import {
  requireAccountingView, requireAccountingOperate, requireAccountingConfirm
} from '../middleware/accounting.js';

const router = express.Router();
router.use(requireAuth);

// 记账员/代录授权管理（既有，科长 role=3 内部校验）
router.get('/bookkeeper', getBookkeeper);
router.post('/bookkeeper', setBookkeeper);
router.get('/delegations', listDelegations);
router.post('/delegation', createDelegation);
router.post('/delegation/:id/revoke', revokeDelegation);

// 物品
router.get('/items', requireAccountingView, listItems);
router.post('/items', requireAccountingOperate, createItem);
router.put('/items/:id/min-stock', requireAccountingOperate, updateMinStock);

// 物料计划
router.get('/plans', requireAccountingView, listPlans);
router.post('/plans', requireAccountingOperate, createPlan);

// 领用/发放
router.get('/receipts', requireAccountingView, listReceipts);
router.post('/receipts', requireAccountingOperate, createReceipt);
router.post('/receipts/:id/void', requireAccountingOperate, voidReceipt);
router.get('/issues', requireAccountingView, listIssues);
router.post('/issues', requireAccountingOperate, createIssue);
router.post('/issues/:id/void', requireAccountingOperate, voidIssue);

// 库存汇总（含预警）
router.get('/stock', requireAccountingView, stockSummary);

// 我的物品：唯一对科员开放的账目接口（仅本人）
router.get('/my-items', myItems);

// 盘点
router.get('/stocktaking', requireAccountingView, listStocktakings);
router.post('/stocktaking', requireAccountingOperate, openStocktaking); // 记账员/科长均可发起（service 层不再限 role2/3，契约：记账员或科长）
router.post('/stocktaking/:id/items', requireAccountingOperate, fillStocktaking);
router.post('/stocktaking/:id/confirm', requireAccountingConfirm, confirmStocktaking);
router.post('/stocktaking/:id/void', requireAccountingOperate, voidStocktaking);

// 跨天修改/作废审批
router.post('/modify-request', requireAccountingOperate, createModifyRequest);
router.get('/approvals', requireAccountingView, listApprovals);
router.post('/approvals/:id/approve', requireAccountingConfirm, approveApproval);
router.post('/approvals/:id/reject', requireAccountingConfirm, rejectApproval);

// 资金
router.get('/fund-plans', requireAccountingView, listFundPlans);
router.post('/fund-plans', requireAccountingOperate, createFundPlan);
router.get('/expenses', requireAccountingView, listExpenses);
router.post('/expenses', requireAccountingOperate, createExpense);
router.post('/expenses/:id/settle', requireAccountingOperate, settleExpense);
router.post('/expenses/:id/void', requireAccountingOperate, voidExpense);
router.get('/ledger', requireAccountingView, ledgerList);

export default router;
