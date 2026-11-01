import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireMaterialsAccess } from '../middleware/materials.js';
import { me } from '../controllers/materialsController.js';

const router = express.Router();
// 全局：先登录，再校验材料模块访问权（无权限 4030）
router.use(requireAuth);
router.use(requireMaterialsAccess);

// 当前用户模块访问态与角色（工作区壳渲染依据）
router.get('/me', me);

export default router;
