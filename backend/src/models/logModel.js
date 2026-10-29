import db from './db.js';

// 登录日志 / 操作日志（契约第3、4.5节）
export default {
  addLoginLog({ userNo = null, userName = null, ip = '', userAgent = '', status, failReason = null, abnormal = 0 }) {
    db.prepare(`
      INSERT INTO login_logs (user_no, user_name, ip, user_agent, status, fail_reason, abnormal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userNo, userName, ip, userAgent, status, failReason, abnormal);
  },

  // 计算某账号最近连续失败次数（从最新一条往回数，遇到 success 即止）
  consecutiveFails(userNo) {
    const rows = db.prepare(
      `SELECT status FROM login_logs WHERE user_no = ? AND deleted_at IS NULL ORDER BY id DESC`
    ).all(userNo);
    let n = 0;
    for (const r of rows) {
      if (r.status === 'fail') n += 1;
      else break;
    }
    return n;
  },

  listLoginLogs({ status = '', startTime = '', endTime = '', page = 1, pageSize = 20 }) {
    const where = [`deleted_at IS NULL`];
    const params = [];
    if (status) { where.push(`status = ?`); params.push(status); }
    if (startTime) { where.push(`created_at >= ?`); params.push(startTime); }
    if (endTime) { where.push(`created_at <= ?`); params.push(endTime); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM login_logs WHERE ${where.join(' AND ')}`).get(...params).n;
    const list = db.prepare(`
      SELECT id, user_no AS userNo, user_name AS userName, ip, user_agent AS userAgent,
             status, fail_reason AS failReason, abnormal, created_at AS createdAt
      FROM login_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  },

  addOperationLog({ operatorId = null, operatorName = null, actionType, targetType = null, targetId = null, detail = null }) {
    db.prepare(`
      INSERT INTO operation_logs (operator_id, operator_name, action_type, target_type, target_id, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(operatorId, operatorName, actionType, targetType, targetId ?? null, detail ? JSON.stringify(detail) : null);
  },

  listOperationLogs({ actionType = '', operatorId = '', startTime = '', endTime = '', page = 1, pageSize = 20 }) {
    const where = [`deleted_at IS NULL`];
    const params = [];
    if (actionType) { where.push(`action_type = ?`); params.push(actionType); }
    if (operatorId) { where.push(`operator_id = ?`); params.push(Number(operatorId)); }
    if (startTime) { where.push(`created_at >= ?`); params.push(startTime); }
    if (endTime) { where.push(`created_at <= ?`); params.push(endTime); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM operation_logs WHERE ${where.join(' AND ')}`).get(...params).n;
    const list = db.prepare(`
      SELECT id, operator_id AS operatorId, operator_name AS operatorName, action_type AS actionType,
             target_type AS targetType, target_id AS targetId, detail, created_at AS createdAt
      FROM operation_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  }
};
