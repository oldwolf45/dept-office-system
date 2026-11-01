import { fail } from './response.js';
import materialsModel from '../models/materialsModel.js';

// 材料模块访问权中间件：必须在 requireAuth 之后使用（依赖 req.currentUser）。
// 无模块访问权访问 /api/materials/* 一律 4030（接入管理 PRD §3.2 / M1）。
export function requireMaterialsAccess(req, res, next) {
  if (!req.currentUser) {
    return fail(res, 4010, '未登录或登录已过期', 401);
  }
  if (!materialsModel.hasModuleAccess(req.currentUser.id)) {
    return fail(res, 4030, '无材料模块访问权限', 403);
  }
  return next();
}
