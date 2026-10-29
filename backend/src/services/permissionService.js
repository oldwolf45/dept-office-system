// 权限计算服务（契约 2.1/2.2/2.4、4.1）：/api/auth/me 的 permissions 由此生成
import db from '../models/db.js';
import delegationModel from '../models/delegationModel.js';

// 工作指派范围（契约 2.2）：副经理(5)→4/3/2；副总师(4)→3/2；科长(3)→2/1；副科长(2)→1
const ASSIGNABLE_ROLE_MAP = { 5: [4, 3, 2], 4: [3, 2], 3: [2, 1], 2: [1], 1: [] };

export function getActiveDelegationFor(delegateId) {
  return delegationModel.findActiveForDelegate(delegateId);
}

export function listAssignableTargets(user) {
  const roles = ASSIGNABLE_ROLE_MAP[user.role] || [];
  if (!roles.length) return [];
  return db.prepare(`
    SELECT id, user_no AS userNo, name, role
    FROM users
    WHERE deleted_at IS NULL AND status = 'active'
      AND role IN (${roles.map(() => '?').join(',')})
      AND id != ?
    ORDER BY role DESC, id
  `).all(...roles, user.id);
}

export function computePermissions(user) {
  const level = user.role;
  const isBookkeeper = user.isBookkeeper === 1;
  const delegation = isBookkeeper ? null : getActiveDelegationFor(user.id);
  const isDelegate = !!delegation;

  // 账目可见：副科长及以上 + 记账员 + 有效代录人；普通科员不可见（契约 1.5.5/2.3）
  const accountingView = level >= 2 || isBookkeeper || isDelegate;
  // 账目可操作：记账员或有效代录人
  const accountingOperate = isBookkeeper || isDelegate;

  // 菜单码与前端 MENU_REGISTRY / 路由 meta.menu 逐项对齐（F53：my-work→work；
  // 前端 /work/subordinates 与 /work 共用 meta.menu='work'，不存在 subordinate-work 码，不再下发）
  const menus = ['dashboard', 'work', 'my-items', 'stats', 'summary', 'settings'];
  if (level >= 2) menus.push('personnel');
  if (accountingView) menus.push('accounting', 'reports');
  if (level >= 2 || isBookkeeper) menus.push('experience');

  // 按钮级权限（契约 2.4/4.1）：返回当前用户拥有的权限码数组，前端 includes 判断
  const buttons = [];
  if (accountingOperate || level >= 2) buttons.push('export');
  if (level === 3 || level === 2 || accountingOperate) buttons.push('delete');
  buttons.push('generate-summary');
  if (level === 3) buttons.push('mark-sample', 'backup', 'dict');

  return {
    menus,
    buttons,
    accounting: {
      view: accountingView,
      operate: accountingOperate,
      isDelegate,
      delegationInfo: delegation
        ? {
            authorizerId: delegation.granted_by,
            authorizerName: delegation.granted_by_name,
            startTime: delegation.start_time,
            endTime: delegation.end_time
          }
        : null
    },
    // 账号创建只能建直接下级：可创建角色 = 操作人 level - 1（契约 4.2）
    assignableRoles: level > 1 ? [level - 1] : [],
    assignableTargets: listAssignableTargets(user)
  };
}

// 返回给前端的用户对象（去掉 password_hash）
export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    userNo: user.userNo,
    name: user.name,
    role: user.role,
    level: user.role,
    deptCode: user.deptCode,
    deptName: user.deptName,
    parentId: user.parentId,
    status: user.status,
    isBookkeeper: user.isBookkeeper,
    mustChangePassword: !!user.mustChangePassword,
    createdAt: user.createdAt
  };
}
