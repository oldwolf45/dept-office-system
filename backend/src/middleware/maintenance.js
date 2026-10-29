// S12 维护锁：数据恢复进行期间，写类接口（works/accounting/dicts/users/summaries 等）返回 5030
// 放行：GET/HEAD/OPTIONS、登录相关、恢复流程自身
import { fail } from './response.js';
import { isMaintenanceLocked } from '../services/backupService.js';

const READ_LIKES = new Set(['GET', 'HEAD', 'OPTIONS']);

function isBypassed(req) {
  const p = (req.originalUrl || req.url || '').split('?')[0];
  if (p.startsWith('/api/auth/')) return true; // 登录/改密/登出不阻断
  if (p.startsWith('/api/admin/restore')) return true; // 恢复流程自身
  if (p.startsWith('/api/system/') || p.startsWith('/api/bootstrap/')) return true; // 引导页/系统信息免维护锁
  return false;
}

export function maintenanceGuard(req, res, next) {
  if (!isMaintenanceLocked()) return next();
  if (READ_LIKES.has(req.method)) return next();
  if (isBypassed(req)) return next();
  return fail(res, 5030, '系统维护中（数据恢复进行中），暂时无法写入数据，请稍后再试', 503);
}
