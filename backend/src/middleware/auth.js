import jwt from 'jsonwebtoken';
import { fail } from './response.js';
import userModel from '../models/userModel.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '12h' });
}

// requireAuth：每次请求都从 DB 读最新用户状态（停用即失效），
// token 缺失/无效 → 4010；用户不存在或停用 → 4010。
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return fail(res, 4010, '未登录或登录已过期', 401);
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return fail(res, 4010, 'token无效或已过期', 401);
  }
  const user = userModel.findById(payload.userId);
  if (!user) {
    return fail(res, 4010, '账号不存在', 401);
  }
  if (user.status !== 'active') {
    return fail(res, 4010, '账号已停用', 401);
  }
  req.currentUser = user;
  return next();
}

// 最低层级：如 requireLevel(3) 表示科长及以上（level>=3）
export function requireLevel(minLevel) {
  return (req, res, next) => {
    if (!req.currentUser || req.currentUser.role < minLevel) {
      return fail(res, 4030, '无权限访问', 403);
    }
    return next();
  };
}

// 命中任一角色集合才放行（role 为层级 1-5）
export function requireAnyRoles(roles) {
  return (req, res, next) => {
    if (!req.currentUser || !roles.includes(req.currentUser.role)) {
      return fail(res, 4030, '无权限访问', 403);
    }
    return next();
  };
}

export { JWT_SECRET };
