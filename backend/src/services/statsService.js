// S5 汇总统计 + S6 快照：唯一聚合口径（契约 §1/§2.2）
// 应完成 = 未开始+进行中+已完成（不含已取消/已改派）；完成率 = 已完成÷应完成（应完成为0时=0）
// overdue = 应完成且 dueTime<now 且状态未完成（未开始/进行中）
// 时间筛选口径：按工作开始时间 start_time 落在 [startDate, endDate]（YYYY-MM-DD）内。
import db from '../models/db.js';
import workModel from '../models/workModel.js';
import userModel from '../models/userModel.js';
import { downScopeIds } from './workService.js';
import { accountingAbility } from '../middleware/accounting.js';
import * as accountingSvc from './accountingService.js';

// 应完成状态集合
export const DONE_SCOPE_STATUSES = ['未开始', '进行中', '已完成'];
const OVERDUE_STATUSES = ['未开始', '进行中'];

function nowLocalStr() {
  // 与库内 datetime('now','localtime') 同格式：YYYY-MM-DD HH:MM:SS
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 解析人员范围。返回 { assigneeIds, scopeDesc, personScope } 或 { error, message }
export function resolveScope(me, { personScope = 'mine', personId } = {}) {
  // 科员只能统计本人（契约 §1）
  if (me.role === 1 && personScope !== 'mine') {
    return { error: 4030, message: '科员只能统计本人范围' };
  }
  let ids = [];
  let scopeDesc = '';
  if (personScope === 'dept') {
    ids = db.prepare(
      `SELECT id FROM users WHERE deleted_at IS NULL AND status='active' AND dept_code=?`
    ).all(me.deptCode).map((r) => r.id);
    scopeDesc = `全科室（${me.deptName}）`;
  } else if (personScope === 'subordinates') {
    if (me.role === 1) return { error: 4030, message: '科员只能统计本人范围' };
    ids = downScopeIds(me);
    scopeDesc = '看到底范围（本人及所辖下级）';
  } else {
    personScope = 'mine';
    ids = [me.id];
    scopeDesc = `本人（${me.name}）`;
  }

  if (personId !== undefined && personId !== null && personId !== '') {
    const pid = Number(personId);
    if (!Number.isInteger(pid) || !ids.includes(pid)) {
      return { error: 4030, message: '指定人员不在您的统计范围内' };
    }
    ids = [pid];
    const u = userModel.findById(pid);
    scopeDesc = `指定人员（${u ? u.name : pid}）`;
  }
  return { assigneeIds: ids, scopeDesc, personScope };
}

// 按过滤条件取出工作行（不聚合）。mine 范围额外纳入"我是协作者"的工作。
function queryWorksRows(me, { assigneeIds, personScope, startDate, endDate, category, status }) {
  const where = [`w.deleted_at IS NULL`];
  const params = [];
  if (assigneeIds.length) {
    where.push(`w.assignee_id IN (${assigneeIds.map(() => '?').join(',')})`);
    params.push(...assigneeIds);
  } else {
    where.push('1 = 0');
  }
  if (category) { where.push(`w.category = ?`); params.push(category); }
  if (status) { where.push(`w.status = ?`); params.push(status); }
  if (startDate) { where.push(`substr(w.start_time,1,10) >= ?`); params.push(String(startDate)); }
  if (endDate) { where.push(`substr(w.start_time,1,10) <= ?`); params.push(String(endDate)); }

  const rows = db.prepare(`
    SELECT w.id, w.name, w.category, w.status, w.priority, w.content,
           w.start_time AS startTime, w.due_time AS dueTime,
           w.assignee_id AS assigneeId, w.collaborator_ids AS collaboratorIds,
           u.name AS assigneeName
    FROM works w LEFT JOIN users u ON u.id = w.assignee_id AND u.deleted_at IS NULL
    WHERE ${where.join(' AND ')}
    ORDER BY w.id DESC
  `).all(...params);

  // mine：把"我作为协作者参与"的工作并入（assignee 不是我、可能不在 ids 里）
  if (personScope === 'mine') {
    const collab = workModel.listCollaborating(me.id).filter((w) => {
      if (rows.some((r) => r.id === w.id)) return false;
      if (category && w.category !== category) return false;
      if (status && w.status !== status) return false;
      if (startDate && String(w.startTime || '').slice(0, 10) < String(startDate)) return false;
      if (endDate && String(w.startTime || '').slice(0, 10) > String(endDate)) return false;
      return true;
    });
    for (const w of collab) {
      rows.push({
        id: w.id, name: w.name, category: w.category, status: w.status, priority: w.priority,
        content: w.content, startTime: w.startTime, dueTime: w.dueTime,
        assigneeId: w.assigneeId, collaboratorIds: w.collaboratorIds,
        assigneeName: userModel.findById(w.assigneeId)?.name || ''
      });
    }
  }
  return rows;
}

function isOverdue(w, nowStr) {
  if (!OVERDUE_STATUSES.includes(w.status)) return false;
  if (!w.dueTime) return false;
  return String(w.dueTime).replace(' ', 'T') < nowStr.replace(' ', 'T');
}

// 聚合（summary 与 detail 共用，保证数字一致）
export function aggregateWorks(me, opts) {
  const nowStr = nowLocalStr();
  const rows = queryWorksRows(me, opts);

  const notStarted = rows.filter((w) => w.status === '未开始');
  const inProgress = rows.filter((w) => w.status === '进行中');
  const completed = rows.filter((w) => w.status === '已完成');
  const cancelled = rows.filter((w) => w.status === '已取消');
  const overdue = rows.filter((w) => isOverdue(w, nowStr));

  const totalWork = notStarted.length + inProgress.length + completed.length;
  const completionRate = totalWork > 0 ? Math.round((completed.length / totalWork) * 10000) / 10000 : 0;

  // 类别分布：按应完成口径（不含已取消/已改派）
  const catMap = new Map();
  for (const w of [...notStarted, ...inProgress, ...completed]) {
    const c = w.category || '未分类';
    catMap.set(c, (catMap.get(c) || 0) + 1);
  }
  const categoryDistribution = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'zh'));

  // 每人工作量
  const userIds = [...new Set(rows.map((w) => w.assigneeId).filter(Boolean))];
  const perPerson = userIds.map((uid) => {
    const mine = rows.filter((w) => w.assigneeId === uid);
    const t = mine.filter((w) => DONE_SCOPE_STATUSES.includes(w.status)).length;
    const c = mine.filter((w) => w.status === '已完成').length;
    const u = userModel.findById(uid);
    return {
      userId: uid,
      userNo: u ? u.userNo : '',
      name: u ? u.name : String(uid),
      total: t,
      completed: c,
      rate: t > 0 ? Math.round((c / t) * 10000) / 10000 : 0
    };
  }).sort((a, b) => b.total - a.total || a.userId - b.userId);

  return {
    completionRate,
    totalWork,
    completed: completed.length,
    inProgress: inProgress.length,
    notStarted: notStarted.length,
    cancelled: cancelled.length,
    overdue: overdue.length,
    categoryDistribution,
    perPerson,
    generatedAt: nowStr,
    rows
  };
}

// 记账域月度报表用：按 dept_code 直聚本科室全员工作量（绕过科员范围限制，缺陷C整改）
// 口径同 aggregateWorks：应完成=未开始+进行中+已完成；逾期=应完成且 dueTime<now 且未完成
export function deptPersonStats(deptCode, { startDate, endDate } = {}) {
  const nowStr = nowLocalStr();
  const users = db.prepare(
    `SELECT id, user_no AS userNo, name FROM users WHERE dept_code=? AND deleted_at IS NULL`
  ).all(deptCode);
  const ids = users.map((u) => u.id);
  if (!ids.length) return [];
  const rows = db.prepare(`
    SELECT w.id, w.status, w.assignee_id AS assigneeId, w.due_time AS dueTime
    FROM works w
    WHERE w.deleted_at IS NULL AND w.assignee_id IN (${ids.map(() => '?').join(',')})
      AND substr(w.start_time,1,10) BETWEEN ? AND ?
  `).all(...ids, startDate || '0000-00-00', endDate || '9999-99-99');

  return users.map((u) => {
    const mine = rows.filter((r) => r.assigneeId === u.id);
    const should = mine.filter((w) => DONE_SCOPE_STATUSES.includes(w.status)).length;
    const completed = mine.filter((w) => w.status === '已完成').length;
    const overdue = mine.filter(
      (w) => OVERDUE_STATUSES.includes(w.status) && !!w.dueTime &&
        String(w.dueTime).replace(' ', 'T') < nowStr.replace(' ', 'T')
    ).length;
    return {
      userId: u.id, userNo: u.userNo, name: u.name,
      should, completed, undone: should - completed, overdue
    };
  });
}
export function buildSnapshot(me, { startDate, endDate, personScope, personId, contentType }) {
  const scope = resolveScope(me, { personScope, personId });
  if (scope.error) return scope;
  const agg = aggregateWorks(me, { ...scope, startDate, endDate });
  const { rows, ...stats } = agg;

  // 账目字段：仅账目可见角色填充；普通科员保持 null
  let materials = null;
  let funds = null;
  let ledger = null;
  if (accountingAbility(me).view) {
    materials = accountingSvc.overview(me.deptCode);
    funds = accountingSvc.buildFundTable(me.deptCode, stats.generatedAt.slice(0, 7));
    ledger = accountingSvc.buildLedgerTable(me.deptCode);
  }
  return {
    period: { start: startDate || null, end: endDate || null },
    personScope: scope.personScope,
    contentType: contentType || 'work',
    deptCode: me.deptCode,
    scopeDesc: scope.scopeDesc,
    generatedAt: stats.generatedAt,
    stats,
    materials,
    funds,
    ledger
  };
}
