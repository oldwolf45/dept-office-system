import { ok } from '../middleware/response.js';
import materialsModel from '../models/materialsModel.js';

// GET /api/materials/me —— 当前用户材料模块访问态与角色（前端渲染工作区壳的依据）
export async function me(req, res) {
  const user = req.currentUser;
  return ok(res, {
    hasAccess: materialsModel.hasModuleAccess(user.id),
    roles: materialsModel.listModuleRoles(user.id)
  });
}
