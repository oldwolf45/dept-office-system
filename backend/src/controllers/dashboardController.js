import { ok, fail } from '../middleware/response.js';
import db from '../models/db.js';
import workModel from '../models/workModel.js';
import userModel from '../models/userModel.js';
import { downScopeIds, decorateStall, dayKey, mondayKey, sundayKey, monthKey } from '../services/workService.js';
import * as accountingSvc from '../services/accountingService.js';
import { accountingAbility } from '../middleware/accounting.js';
import * as noticeSvc from '../services/noticeService.js';
import * as backupSvc from '../services/backupService.js';

const ACTIVE_STATUS = `w.status IN ('未开始','进行中')`;

function countWhere(where, params) {
  return db.prepare(`SELECT COUNT(*) AS n FROM works WHERE deleted_at IS NULL AND ${where}`).get(...params).n;
}

function fetchWorks(where, params) {
  const rows = db.prepare(`
    SELECT w.id, w.name, w.category, w.status, w.priority,
           w.due_time AS dueTime, w.source_id AS sourceId, w.assignee_id AS assigneeId,
           w.last_progress_at AS lastProgressAt, w.start_time AS startTime,
           u.name AS assigneeName
    FROM works w LEFT JOIN users u ON u.id = w.assignee_id AND u.deleted_at IS NULL
    WHERE w.deleted_at IS NULL AND ${where} ORDER BY w.id DESC
  `).all(...params);
  return rows.map((r) => decorateStall({
    id: r.id, name: r.name, category: r.category, status: r.status, priority: r.priority,
    dueTime: r.dueTime, sourceId: r.sourceId, assigneeId: r.assigneeId,
    lastProgressAt: r.lastProgressAt, startTime: r.startTime, assigneeName: r.assigneeName
  }));
}

// 停滞项携带最后一条进度时间与内容（progressText 取 progress_records 最近一条）
function latestProgressOf(workId) {
  return db.prepare(`
    SELECT content, created_at AS createdAt FROM progress_records
    WHERE work_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1
  `).get(workId) || null;
}

function todoItem(w) {
  const lp = latestProgressOf(w.id);
  return {
    workId: w.id,
    name: w.name,
    assigneeId: w.assigneeId,
    assigneeName: w.assigneeName,
    category: w.category,
    status: w.status,
    dueTime: w.dueTime,
    isStalled: w.isStalled,
    stalledDays: w.stalledDays,
    lastProgressAt: w.lastProgressAt,
    progressText: lp ? lp.content : null
  };
}

// S11 新增待办：待确认账目（科长/副科长）、代录授权将到期（科长）、自动备份失败（科长）
function extraTodoCounts(me) {
  const pendingApprovals = me.role >= 2
    ? db.prepare(`SELECT COUNT(*) AS n FROM accounting_approvals WHERE dept_code=? AND status='pending'`).get(me.deptCode).n
    : 0;
  const delegationExpiring = me.role === 3
    ? db.prepare(`
      SELECT COUNT(*) AS n FROM delegations
      WHERE status='active' AND deleted_at IS NULL
        AND end_time > datetime('now','localtime')
        AND end_time <= datetime('now','localtime','+7 days')
    `).get().n
    : 0;
  const backupFailure = me.role === 3 ? backupSvc.unresolvedAutoFailures().length : 0;
  return { pendingApprovals, delegationExpiring, backupFailure };
}

function extraTodoSections(me) {
  const out = [];
  if (me.role >= 2) {
    const rows = db.prepare(`
      SELECT id AS approvalId, target_type AS targetType, target_id AS targetId, action, reason,
             requested_by AS requestedBy, requested_at AS requestedAt
      FROM accounting_approvals WHERE dept_code=? AND status='pending' ORDER BY id DESC
    `).all(me.deptCode);
    for (const r of rows) out.push({ ...r, type: 'pendingApprovals' });
  }
  if (me.role === 3) {
    const dels = db.prepare(`
      SELECT id AS delegationId, delegate_name AS delegateName, end_time AS endTime
      FROM delegations
      WHERE status='active' AND deleted_at IS NULL
        AND end_time > datetime('now','localtime')
        AND end_time <= datetime('now','localtime','+7 days')
      ORDER BY end_time ASC
    `).all();
    for (const d of dels) {
      const daysLeft = Math.max(0, Math.ceil((Date.parse(String(d.endTime).replace(' ', 'T')) - Date.now()) / 86400000));
      out.push({ type: 'delegationExpiring', delegationId: d.delegationId, delegateName: d.delegateName, endTime: d.endTime, daysLeft });
    }
    for (const f of backupSvc.unresolvedAutoFailures()) {
      out.push({ type: 'backupFailure', backupLogId: f.id, fileName: f.fileName, reason: f.reason, createdAt: f.createdAt });
    }
  }
  return out;
}

// GET /api/dashboard/summary
export async function summary(req, res) {
  const me = req.currentUser;
  const today = dayKey();
  const mon = mondayKey();
  const sun = sundayKey();
  const monKey = monthKey();

  const assignedNew = countWhere(`assignee_id = ? AND source_id IS NOT NULL AND status = '未开始'`, [me.id]);
  const dueToday = countWhere(`assignee_id = ? AND status IN ('未开始','进行中') AND substr(due_time,1,10) = ?`, [me.id, today]);
  const overdue = countWhere(`assignee_id = ? AND status IN ('未开始','进行中') AND due_time IS NOT NULL AND substr(due_time,1,10) < ?`, [me.id, today]);
  const inProgress = countWhere(`assignee_id = ? AND status = '进行中'`, [me.id]);
  const dueThisWeek = countWhere(`assignee_id = ? AND status IN ('未开始','进行中') AND due_time IS NOT NULL AND substr(due_time,1,10) BETWEEN ? AND ?`, [me.id, mon, sun]);
  const completedThisMonth = countWhere(`assignee_id = ? AND status = '已完成' AND substr(updated_at,1,7) = ?`, [me.id, monKey]);

  // 停滞：看到底范围内的进行中工作，实时算（科长能看到下级停滞）
  const scope = downScopeIds(me);
  const stalledWorks = fetchWorks(
    `w.assignee_id IN (${scope.map(() => '?').join(',')}) AND w.status = '进行中' AND w.last_progress_at IS NOT NULL`,
    scope
  ).filter((w) => w.isStalled);

  const extra = extraTodoCounts(me);
  const unread = noticeSvc.unreadCountsFor(me.id, me.deptCode, accountingAbility(me).confirm);

  return ok(res, {
    todo: { assignedNew, dueToday, overdue, stalled: stalledWorks.length, ...extra },
    counts: { inProgress, dueThisWeek, overdue, completedThisMonth },
    annotationsUnreplied: workModel.countUnrepliedForAssignee(me.id),
    unread
  });
}

// GET /api/dashboard/todo  —— 待办明细（扁平列表，每项带 type 分组标记）
export async function todo(req, res) {
  const me = req.currentUser;
  const today = dayKey();
  const scope = downScopeIds(me);

  const sections = [
    { type: 'assignedNew', rows: fetchWorks(`w.assignee_id = ? AND w.source_id IS NOT NULL AND w.status = '未开始'`, [me.id]) },
    { type: 'dueToday', rows: fetchWorks(`w.assignee_id = ? AND ${ACTIVE_STATUS} AND substr(w.due_time,1,10) = ?`, [me.id, today]) },
    { type: 'overdue', rows: fetchWorks(`w.assignee_id = ? AND ${ACTIVE_STATUS} AND w.due_time IS NOT NULL AND substr(w.due_time,1,10) < ?`, [me.id, today]) },
    {
      type: 'stalled',
      rows: fetchWorks(
        `w.assignee_id IN (${scope.map(() => '?').join(',')}) AND w.status = '进行中' AND w.last_progress_at IS NOT NULL`,
        scope
      ).filter((w) => w.isStalled)
    }
  ];

  const list = sections.flatMap((s) => s.rows.map((w) => ({ ...todoItem(w), type: s.type })));
  for (const extra of extraTodoSections(me)) list.push(extra);
  return ok(res, { list });
}

// POST /api/dashboard/notices/read {type, refId} —— 幂等标记已读
export async function noticesRead(req, res) {
  const { type, refId } = req.body || {};
  if (!type || refId === undefined || refId === null) return fail(res, 4000, 'type/refId 必填');
  const okMarked = noticeSvc.markNoticeRead(req.currentUser.id, String(type), refId);
  if (!okMarked) return fail(res, 4000, `未知的未读类型: ${type}`);
  return ok(res, { ok: true });
}

// GET /api/dashboard/subordinate-activity —— 近7天下级动态（科员/记账员返回空数组）
export async function subordinateActivity(req, res) {
  const me = req.currentUser;
  const subs = userModel.descendantsIds(me.id);
  if (me.role === 1 || subs.length === 0) {
    return ok(res, { newProgress: [], assigned: [], overdue: [] });
  }
  const inClause = subs.map(() => '?').join(',');
  const since = db.prepare(`SELECT datetime('now','localtime','-7 days') AS t`).get().t;
  const today = dayKey();

  const newProgress = db.prepare(`
    SELECT p.id, p.work_id AS workId, p.content, p.created_at AS createdAt,
           w.name AS workName, u.name AS assigneeName
    FROM progress_records p
    JOIN works w ON w.id = p.work_id AND w.deleted_at IS NULL
    LEFT JOIN users u ON u.id = w.assignee_id AND u.deleted_at IS NULL
    WHERE w.assignee_id IN (${inClause}) AND p.deleted_at IS NULL AND p.created_at >= ?
    ORDER BY p.id DESC LIMIT 50
  `).all(...subs, since);

  const assigned = db.prepare(`
    SELECT w.id AS workId, w.name, w.source_id AS sourceId, w.status, w.created_at AS createdAt,
           u.name AS assigneeName
    FROM works w LEFT JOIN users u ON u.id = w.assignee_id AND u.deleted_at IS NULL
    WHERE w.assignee_id IN (${inClause}) AND w.source_id IS NOT NULL AND w.deleted_at IS NULL AND w.created_at >= ?
    ORDER BY w.id DESC LIMIT 50
  `).all(...subs, since);

  const overdue = db.prepare(`
    SELECT w.id AS workId, w.name, w.status, w.due_time AS dueTime, w.updated_at AS updatedAt,
           u.name AS assigneeName
    FROM works w LEFT JOIN users u ON u.id = w.assignee_id AND u.deleted_at IS NULL
    WHERE w.assignee_id IN (${inClause}) AND w.status IN ('未开始','进行中')
      AND w.due_time IS NOT NULL AND substr(w.due_time,1,10) < ? AND w.deleted_at IS NULL
    ORDER BY w.due_time ASC LIMIT 50
  `).all(...subs, today);

  return ok(res, { newProgress, assigned, overdue });
}

// GET /api/dashboard/accounting —— 首页账目概览（科员不可见，契约 §6/F43/F45）
export async function accounting(req, res) {
  const me = req.currentUser;
  if (!accountingAbility(me).view) return fail(res, 4030, '科员无账目访问权限');
  return ok(res, accountingSvc.overview(me.deptCode));
}
