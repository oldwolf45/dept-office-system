import { ok, fail } from '../middleware/response.js';
import settingModel from '../models/settingModel.js';
import logModel from '../models/logModel.js';

// GET /api/settings/stall-days  —— 登录可读
export async function getStallDays(req, res) {
  return ok(res, { days: settingModel.stallDays() });
}

// PUT /api/settings/stall-days  —— 仅科长（路由层 requireLevel(3)），3-30
export async function putStallDays(req, res) {
  const me = req.currentUser;
  const days = Number((req.body || {}).days);
  if (!Number.isInteger(days) || days < 3 || days > 30) {
    return fail(res, 4000, '停滞阈值需为3-30的整数');
  }
  settingModel.set('stall_days', days, me.id);
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'update_stall_days', detail: { days } });
  return ok(res, { days });
}
