import { ok, fail } from '../middleware/response.js';
import userModel from '../models/userModel.js';
import logModel from '../models/logModel.js';
import delegationModel from '../models/delegationModel.js';
import { formatDateTime } from '../utils/datetime.js';
import { sanitizeUser } from '../services/permissionService.js';

const MAX_DELEGATION_DAYS = 30;

// GET /api/accounting/bookkeeper
export async function getBookkeeper(req, res) {
  const bk = userModel.findBookkeeper();
  return ok(res, { user: bk ? sanitizeUser(bk) : null });
}

// POST /api/accounting/bookkeeper  {userId}  —— 仅科长(role=3)
export async function setBookkeeper(req, res) {
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可指定记账员');
  const target = userModel.findById(Number(req.body?.userId));
  if (!target) return fail(res, 4000, '目标账号不存在');
  if (target.role !== 1) return fail(res, 4000, '记账员必须从科员中指定');
  if (target.status !== 'active') return fail(res, 4000, '目标账号已停用');

  const old = userModel.findBookkeeper();
  let revokedCount = 0;
  if (old && old.id !== target.id) {
    userModel.setBookkeeper(old.id, 0);
    // 更换记账员：自动 revoke 全部 active 授权（契约 4.3/A10）
    revokedCount = delegationModel.revokeAllActive(me.id);
  }
  userModel.setBookkeeper(target.id, 1);
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'set_bookkeeper',
    targetType: 'user',
    targetId: target.id,
    detail: { oldBookkeeper: old ? old.userNo : null, newBookkeeper: target.userNo, revokedDelegations: revokedCount }
  });
  return ok(res, { user: sanitizeUser(userModel.findById(target.id)) });
}

// GET /api/accounting/delegations  —— 仅科长
export async function listDelegations(req, res) {
  if (req.currentUser.role !== 3) return fail(res, 4030, '仅科长可查看授权记录');
  return ok(res, { list: delegationModel.listAll() });
}

// POST /api/accounting/delegation  {delegateId, startTime, endTime}  —— 仅科长
export async function createDelegation(req, res) {
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可授权代录');

  const { delegateId, startTime, endTime } = req.body || {};
  const target = userModel.findById(Number(delegateId));
  if (!target) return fail(res, 4000, '目标账号不存在');
  if (target.role !== 1) return fail(res, 4000, '代录人必须为科员');
  if (target.status !== 'active') return fail(res, 4000, '目标账号已停用');

  const s = new Date(startTime);
  const e = new Date(endTime);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return fail(res, 4000, '起止时间格式不正确');
  if (e <= s) return fail(res, 4000, '结束时间必须晚于开始时间');
  if (e.getTime() - s.getTime() > MAX_DELEGATION_DAYS * 24 * 3600 * 1000) {
    return fail(res, 4000, `授权时长不能超过${MAX_DELEGATION_DAYS}天`);
  }

  const bookkeeper = userModel.findBookkeeper();
  if (!bookkeeper) return fail(res, 4000, '当前无记账员，无法授权代录');

  // 同一时间只能有一个有效授权
  if (delegationModel.findActiveNow()) {
    return fail(res, 4000, '已有有效代录授权，不能重复授权');
  }

  const row = delegationModel.create({
    bookkeeperId: bookkeeper.id,
    delegateId: target.id,
    delegateName: target.name,
    startTime: formatDateTime(s),
    endTime: formatDateTime(e),
    grantedById: me.id,
    grantedByName: me.name
  });
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'create_delegation',
    targetType: 'delegation',
    targetId: row.id,
    detail: { delegate: target.userNo, startTime: row.start_time, endTime: row.end_time }
  });
  return ok(res, row);
}

// POST /api/accounting/delegation/:id/revoke  —— 仅科长
export async function revokeDelegation(req, res) {
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可收回授权');
  const row = delegationModel.findById(Number(req.params.id));
  if (!row) return fail(res, 4000, '授权记录不存在');
  if (row.status !== 'active') return fail(res, 4000, '授权已失效，无需收回');
  const updated = delegationModel.revokeById(row.id, me.id);
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'revoke_delegation',
    targetType: 'delegation',
    targetId: row.id,
    detail: { delegateId: row.delegate_id }
  });
  return ok(res, updated);
}
