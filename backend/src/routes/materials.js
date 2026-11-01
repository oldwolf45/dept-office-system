import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireMaterialsAccess, requireMaterialsRole } from '../middleware/materials.js';
import {
  me,
  listCategories,
  manageCategories,
  createCategory,
  updateCategory,
  disableCategory,
  enableCategory,
  listFinanceCategories,
  manageFinanceCategories,
  createFinanceCategory,
  updateFinanceCategory,
  disableFinanceCategory,
  enableFinanceCategory,
  createPlan,
  listPlans,
  getPlan,
  submitPlan,
  approvePlan,
  rejectPlan,
  summaryPlans,
  createPurchase,
  listPurchases,
  getPurchase,
  voidPurchase,
  createArrival,
  listMaterials,
  getMaterial,
  createIssue,
  createRecycle,
  createDisposal,
  listIssues,
  listDisposalBatches,
  getDisposalBatch,
  getMonthlySummary,
  getOverview
} from '../controllers/materialsController.js';

const router = express.Router();
// 全局：先登录，再校验材料模块访问权（无权限 4030）
router.use(requireAuth);
router.use(requireMaterialsAccess);

// 当前用户模块访问态与角色（工作区壳渲染依据）
router.get('/me', me);

// 首页工作台概览（T9）/ 按月汇总（T7）
router.get('/dashboard/overview', getOverview);
router.get('/stats/monthly', getMonthlySummary);

// 材料类别（T1）
router.get('/categories', listCategories);
router.get('/categories/manage', manageCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.post('/categories/:id/disable', disableCategory);
router.post('/categories/:id/enable', enableCategory);

// 收支分类（T1）
router.get('/finance-categories', listFinanceCategories);
router.get('/finance-categories/manage', manageFinanceCategories);
router.post('/finance-categories', createFinanceCategory);
router.put('/finance-categories/:id', updateFinanceCategory);
router.post('/finance-categories/:id/disable', disableFinanceCategory);
router.post('/finance-categories/:id/enable', enableFinanceCategory);

// 计划管理（T2）：填报→提交→审核/驳回→汇总
// 填报限 工段长/科室经办；审核限 主任/供应科（T10 按钮级权限）
router.get('/plans/summary', summaryPlans); // 须先于 /plans/:id 注册，否则被 :id 吞掉
router.get('/plans', listPlans);
router.post('/plans', requireMaterialsRole('workshop_director', 'section_agent'), createPlan);
router.get('/plans/:id', getPlan);
router.post('/plans/:id/submit', submitPlan);
router.post('/plans/:id/approve', requireMaterialsRole('workshop_manager', 'supply'), approvePlan);
router.post('/plans/:id/reject', requireMaterialsRole('workshop_manager', 'supply'), rejectPlan);

// 采购管理（T3）：登记→查询→作废（登记限供应科）
router.get('/purchases', listPurchases);
router.post('/purchases', requireMaterialsRole('supply'), createPurchase);
router.get('/purchases/:id', getPurchase);
router.post('/purchases/:id/void', voidPurchase);

// 到货与编号（T4）：登记限供应科
router.post('/arrivals', requireMaterialsRole('supply'), createArrival);
router.get('/materials', listMaterials);
router.get('/materials/:id', getMaterial);

// 领用/回收/处置（T5）：写动作限供应科
router.post('/issues', requireMaterialsRole('supply'), createIssue);
router.post('/recycles', requireMaterialsRole('supply'), createRecycle);
router.post('/disposals', requireMaterialsRole('supply'), createDisposal);
router.get('/issues', listIssues);
router.get('/disposals', listDisposalBatches);
router.get('/disposals/:id', getDisposalBatch);

export default router;
