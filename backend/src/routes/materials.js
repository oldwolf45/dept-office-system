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
  enableFinanceCategory
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

export default router;
