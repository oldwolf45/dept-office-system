import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireMaterialsAccess } from '../middleware/materials.js';
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
  voidPurchase
} from '../controllers/materialsController.js';

const router = express.Router();
// 全局：先登录，再校验材料模块访问权（无权限 4030）
router.use(requireAuth);
router.use(requireMaterialsAccess);

// 当前用户模块访问态与角色（工作区壳渲染依据）
router.get('/me', me);

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
router.get('/plans/summary', summaryPlans); // 须先于 /plans/:id 注册，否则被 :id 吞掉
router.get('/plans', listPlans);
router.post('/plans', createPlan);
router.get('/plans/:id', getPlan);
router.post('/plans/:id/submit', submitPlan);
router.post('/plans/:id/approve', approvePlan);
router.post('/plans/:id/reject', rejectPlan);

// 采购管理（T3）：登记→查询→作废
router.get('/purchases', listPurchases);
router.post('/purchases', createPurchase);
router.get('/purchases/:id', getPurchase);
router.post('/purchases/:id/void', voidPurchase);

export default router;
