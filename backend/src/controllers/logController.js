import { ok } from '../middleware/response.js';
import logModel from '../models/logModel.js';

// GET /api/logs/operations  —— 科长及以上（requireLevel(3) 在路由层）
export async function listOperations(req, res) {
  const { actionType = '', operatorId = '', startTime = '', endTime = '', page = 1, pageSize = 20 } = req.query;
  return ok(res, logModel.listOperationLogs({
    actionType: String(actionType),
    operatorId: String(operatorId),
    startTime: String(startTime),
    endTime: String(endTime),
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.max(1, Number(pageSize) || 20)
  }));
}

// GET /api/logs/login  —— 科长及以上
export async function listLogin(req, res) {
  const { status = '', startTime = '', endTime = '', page = 1, pageSize = 20 } = req.query;
  return ok(res, logModel.listLoginLogs({
    status: String(status),
    startTime: String(startTime),
    endTime: String(endTime),
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.max(1, Number(pageSize) || 20)
  }));
}
