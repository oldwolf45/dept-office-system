import { ok, fail } from '../middleware/response.js';
import userModel from '../models/userModel.js';
import logModel from '../models/logModel.js';
import { signToken } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { computePermissions, sanitizeUser } from '../services/permissionService.js';

function clientInfo(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ip: xff || req.ip || '',
    userAgent: req.headers['user-agent'] || ''
  };
}

// POST /api/auth/login  {userNo, password}
export async function login(req, res) {
  const { userNo, password } = req.body || {};
  if (!userNo || !password) {
    return fail(res, 4000, '工号和密码不能为空');
  }
  const { ip, userAgent } = clientInfo(req);
  const no = String(userNo).trim();
  const user = userModel.findByUserNo(no);

  // 账号不存在：统一返回错误，写 fail 日志
  if (!user) {
    logModel.addLoginLog({ userNo: no, userName: null, ip, userAgent, status: 'fail', failReason: '账号不存在' });
    return fail(res, 4000, '工号或密码错误');
  }

  // 停用账号拒绝登录
  if (user.status !== 'active') {
    logModel.addLoginLog({ userNo: user.userNo, userName: user.name, ip, userAgent, status: 'fail', failReason: '账号停用' });
    return fail(res, 4010, '账号已停用，禁止登录');
  }

  // 密码错误：累计连续失败，≥5 次本次日志 abnormal=1（标红依据）
  if (!verifyPassword(password, user.passwordHash)) {
    const consecutive = logModel.consecutiveFails(user.userNo) + 1;
    logModel.addLoginLog({
      userNo: user.userNo,
      userName: user.name,
      ip,
      userAgent,
      status: 'fail',
      failReason: '密码错误',
      abnormal: consecutive >= 5 ? 1 : 0
    });
    return fail(res, 4000, '工号或密码错误');
  }

  // 成功：写 success 日志（自然打断连续失败计数）
  logModel.addLoginLog({ userNo: user.userNo, userName: user.name, ip, userAgent, status: 'success' });
  const token = signToken(user.id);
  return ok(res, {
    token,
    user: sanitizeUser(user),
    mustChangePassword: !!user.mustChangePassword
  });
}

// POST /api/auth/change-password  {oldPassword, newPassword}
export async function changePassword(req, res) {
  const me = req.currentUser;
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return fail(res, 4000, '新密码至少6位');
  }
  if (!verifyPassword(oldPassword, me.passwordHash)) {
    return fail(res, 4000, '原密码不正确');
  }
  userModel.updatePassword(me.id, hashPassword(newPassword));
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'change_password',
    targetType: 'user',
    targetId: me.id
  });
  const fresh = userModel.findById(me.id);
  return ok(res, { user: sanitizeUser(fresh) });
}

// GET /api/auth/me
export async function me(req, res) {
  const user = req.currentUser;
  return ok(res, {
    user: sanitizeUser(user),
    permissions: computePermissions(user)
  });
}

// POST /api/auth/logout（前端清 localStorage 即可，后端仅留痕）
export async function logout(req, res) {
  return ok(res, null, '已退出');
}
