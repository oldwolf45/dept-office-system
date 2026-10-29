import { ok, fail } from '../middleware/response.js';
import { getActiveDelegationFor } from '../services/permissionService.js';

// POST /api/admin/dicts  —— 仅科长
export async function dicts(req, res) {
  return ok(res, { placeholder: '字典管理功能将在 S3 阶段实现，当前为占位接口' });
}

// POST /api/export/summary  —— 5/4/3/2/记账员（含有效代录人）；普通科员 4030
export async function exportSummary(req, res) {
  const me = req.currentUser;
  const allowed = me.role >= 2 || me.isBookkeeper === 1 || !!getActiveDelegationFor(me.id);
  if (!allowed) return fail(res, 4030, '无权限访问', 403);
  return ok(res, { placeholder: '总结导出功能将在 S6 阶段实现，当前为占位接口' });
}

// POST /api/admin/delete-records  —— 3(解锁)/2(确认)/记账员(发起，含有效代录人)；其他 4030
export async function deleteRecords(req, res) {
  const me = req.currentUser;
  const allowed = me.role === 3 || me.role === 2 || me.isBookkeeper === 1 || !!getActiveDelegationFor(me.id);
  if (!allowed) return fail(res, 4030, '无权限访问', 403);
  return ok(res, { placeholder: '记录删除/作废功能将在 S8/S9 阶段实现，当前为占位接口' });
}
