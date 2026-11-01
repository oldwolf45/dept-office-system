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

// 按钮级权限（T10）：按模块角色拒绝写操作。仅在已通过 requireMaterialsAccess 后使用。
// roles 为该动作允许的角色集合；用户无任一角色 → 4031。
export function requireMaterialsRole(...roles) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return fail(res, 4010, '未登录或登录已过期', 401);
    }
    if (!materialsModel.userHasModuleRole(req.currentUser.id, roles)) {
      return fail(res, 4031, '当前角色无权执行该操作', 403);
    }
    return next();
  };
}
