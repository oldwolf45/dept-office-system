import { ok, fail } from '../middleware/response.js';
import userModel from '../models/userModel.js';
import logModel from '../models/logModel.js';
import { hashPassword } from '../utils/password.js';
import { sanitizeUser } from '../services/permissionService.js';

// 可见范围：level>=2 的人看到底（自己+所有后代）；科员只看自己
function visibleIds(me) {
  if (me.role === 1) return [me.id];
  return [me.id, ...userModel.descendantsIds(me.id)];
}

// GET /api/users?keyword=&page=&pageSize=
export async function list(req, res) {
  const me = req.currentUser;
  const { keyword = '', page = 1, pageSize = 20 } = req.query;
  const result = userModel.search({
    ids: visibleIds(me),
    keyword: String(keyword),
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.max(1, Number(pageSize) || 20)
  });
  return ok(res, result);
}

// GET /api/users/:id
export async function detail(req, res) {
  const me = req.currentUser;
  const target = userModel.findById(Number(req.params.id));
  if (!target) return fail(res, 4000, '账号不存在');
  if (!visibleIds(me).includes(target.id)) return fail(res, 4030, '无权限查看该账号');
  return ok(res, sanitizeUser(target));
}

// POST /api/users  {userNo, name, role, deptCode?, initialPassword?}
export async function create(req, res) {
  const me = req.currentUser;
  const { userNo, name, role, deptCode, initialPassword } = req.body || {};
  if (!userNo || !name || !role) return fail(res, 4000, '工号、姓名、角色必填');

  const targetRole = Number(role);
  if (me.role <= 1) return fail(res, 4030, '您没有账号管理权限');
  // 只能创建直接下级：目标角色必须 = 操作人 level - 1
  if (targetRole !== me.role - 1) {
    return fail(res, 4000, `只能创建直接下级（角色${me.role - 1}）`);
  }
  const no = String(userNo).trim();
  if (userModel.findByUserNo(no)) return fail(res, 4000, '工号已存在');

  const dept = deptCode || '01';
  const created = userModel.create({
    userNo: no,
    name: String(name).trim(),
    role: targetRole,
    deptCode: dept,
    deptName: dept === '01' ? '综合科' : '',
    parentId: me.id,
    passwordHash: hashPassword(initialPassword || '123456')
  });
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'create_user',
    targetType: 'user',
    targetId: created.id,
    detail: { userNo: created.userNo, name: created.name, role: created.role }
  });
  const { passwordHash, ...safe } = created;
  return ok(res, safe);
}

// POST /api/users/:id/deactivate
export async function deactivate(req, res) {
  const me = req.currentUser;
  const target = userModel.findById(Number(req.params.id));
  if (!target) return fail(res, 4000, '账号不存在');
  if (target.id === me.id) return fail(res, 4000, '不能停用本人账号');
  if (target.parentId !== me.id) return fail(res, 4030, '只能停用直接下级');
  if (target.isBookkeeper === 1) return fail(res, 4000, '目标是记账员，请先指定新记账员后再停用');
  if (target.status !== 'active') return fail(res, 4000, '账号已是停用状态');

  const updated = userModel.setStatus(target.id, 'disabled');
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'deactivate_user',
    targetType: 'user',
    targetId: target.id,
    detail: { userNo: target.userNo, name: target.name }
  });
  return ok(res, sanitizeUser(updated));
}

// POST /api/users/:id/activate
export async function activate(req, res) {
  const me = req.currentUser;
  const target = userModel.findById(Number(req.params.id));
  if (!target) return fail(res, 4000, '账号不存在');
  if (target.parentId !== me.id) return fail(res, 4030, '只能启用直接下级');
  if (target.status === 'active') return fail(res, 4000, '账号已是启用状态');

  const updated = userModel.setStatus(target.id, 'active');
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'activate_user',
    targetType: 'user',
    targetId: target.id,
    detail: { userNo: target.userNo, name: target.name }
  });
  return ok(res, sanitizeUser(updated));
}
