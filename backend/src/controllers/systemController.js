// 全新部署：系统信息公开接口 + 首个管理员引导
import { ok, fail } from '../middleware/response.js';
import db, { DISTRIBUTION_MODE } from '../models/db.js';
import settingModel from '../models/settingModel.js';
import logModel from '../models/logModel.js';
import { hashPassword } from '../utils/password.js';
import { SYSTEM_VERSION } from '../services/backupService.js';

const DEFAULT_SYSTEM_NAME = '科室协同办公系统';

function activeUserCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL`).get().n;
}

// 发行模式且 0 账号 → 需要引导；正式模式恒 false
export function needsBootstrap() {
  return DISTRIBUTION_MODE && activeUserCount() === 0;
}

// GET /api/system/bootstrap-status（公开、免登录、维护锁外）
export async function bootstrapStatus(req, res) {
  return ok(res, { needsBootstrap: needsBootstrap() });
}

// GET /api/system/info（公开、免登录）：登录页渲染系统名用
export async function systemInfo(req, res) {
  return ok(res, {
    system_name: settingModel.get('system_name') || DEFAULT_SYSTEM_NAME,
    version: SYSTEM_VERSION,
    needsBootstrap: needsBootstrap()
  });
}

// POST /api/bootstrap/admin（仅发行模式且 0 账号；幂等拒绝）
export async function bootstrapAdmin(req, res) {
  if (!DISTRIBUTION_MODE) {
    return fail(res, 4000, '当前为正式模式，不允许引导管理员');
  }
  if (activeUserCount() > 0) {
    return fail(res, 4000, '系统已初始化，请勿重复引导');
  }
  const { name, password } = req.body || {};
  if (!name || !String(name).trim()) return fail(res, 4000, '姓名必填');
  if (!password || String(password).length < 6) return fail(res, 4000, '密码至少6位');

  // userNo 按现有规则：首位管理员固定 ADMIN001（dept 占位 '01'，后续由管理员在人员管理里扩展）
  const userNo = 'ADMIN001';
  const info = db.prepare(`
    INSERT INTO users (user_no, name, role, dept_code, dept_name, parent_id, status, is_bookkeeper, password_hash, must_change_password)
    VALUES (?, ?, 5, '01', '', NULL, 'active', 0, ?, 0)
  `).run(userNo, String(name).trim(), hashPassword(String(password)));
  const adminId = Number(info.lastInsertRowid);

  logModel.addOperationLog({
    operatorId: adminId,
    operatorName: String(name).trim(),
    actionType: 'bootstrap_admin',
    targetType: 'user',
    targetId: adminId,
    detail: { userNo, role: 5 }
  });

  return ok(res, { id: adminId, userNo, name: String(name).trim(), role: 5, mustChangePassword: false }, '管理员创建成功');
}
