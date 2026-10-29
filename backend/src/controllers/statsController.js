import { ok, fail } from '../middleware/response.js';
import { resolveScope, aggregateWorks } from '../services/statsService.js';
import * as accountingSvc from '../services/accountingService.js';
import { accountingAbility } from '../middleware/accounting.js';

function readQuery(req) {
  return {
    personScope: String(req.query.personScope || 'mine'),
    personId: req.query.personId ? Number(req.query.personId) : undefined,
    startDate: String(req.query.startDate || '').slice(0, 10) || '',
    endDate: String(req.query.endDate || '').slice(0, 10) || '',
    category: String(req.query.category || '').trim(),
    status: String(req.query.status || '').trim()
  };
}

// GET /api/stats/work-summary
export async function workSummary(req, res) {
  const me = req.currentUser;
  const q = readQuery(req);
  const scope = resolveScope(me, q);
  if (scope.error) return fail(res, scope.error, scope.message);
  const agg = aggregateWorks(me, { ...scope, startDate: q.startDate, endDate: q.endDate, category: q.category, status: q.status });
  const { rows, ...stats } = agg;
  return ok(res, {
    ...stats,
    scopeDesc: scope.scopeDesc,
    personScope: scope.personScope
  });
}

// GET /api/stats/work-detail?page=&pageSize=
export async function workDetail(req, res) {
  const me = req.currentUser;
  const q = readQuery(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize) || 20));
  const scope = resolveScope(me, q);
  if (scope.error) return fail(res, scope.error, scope.message);
  const agg = aggregateWorks(me, { ...scope, startDate: q.startDate, endDate: q.endDate, category: q.category, status: q.status });

  const nowStr = agg.generatedAt.replace(' ', 'T');
  const list = agg.rows
    .slice((page - 1) * pageSize, page * pageSize)
    .map((w) => ({
      id: w.id,
      name: w.name,
      category: w.category,
      status: w.status,
      priority: w.priority,
      startTime: w.startTime,
      dueTime: w.dueTime,
      assigneeId: w.assigneeId,
      assigneeName: w.assigneeName,
      isOverdue: ['未开始', '进行中'].includes(w.status) && !!w.dueTime && String(w.dueTime).replace(' ', 'T') < nowStr
    }));

  // 与 summary 同源：把 summary 的关键数字一并带回，便于前端核对
  return ok(res, {
    list,
    total: agg.rows.length,
    page,
    pageSize,
    summary: {
      totalWork: agg.totalWork,
      completed: agg.completed,
      inProgress: agg.inProgress,
      notStarted: agg.notStarted,
      cancelled: agg.cancelled,
      overdue: agg.overdue,
      completionRate: agg.completionRate
    },
    scopeDesc: scope.scopeDesc,
    generatedAt: agg.generatedAt
  });
}

// GET /api/stats/accounting-summary?month=&type=material|fund|ledger （契约 §6，科员 4030）
export async function accountingSummary(req, res) {
  const me = req.currentUser;
  if (!accountingAbility(me).view) return fail(res, 4030, '科员无账目统计权限');
  const month = String(req.query.month || '').slice(0, 7) || accountingSvc.todayStr().slice(0, 7);
  const type = String(req.query.type || 'material');
  const dept = me.deptCode;
  if (type === 'material') {
    return ok(res, { month, rows: accountingSvc.buildMaterialTable(dept, month) });
  }
  if (type === 'fund') {
    const fund = accountingSvc.buildFundTable(dept, month);
    const rate = fund.totalPlanned > 0
      ? Math.round((fund.actual / fund.totalPlanned) * 10000) / 10000 : 0;
    return ok(res, { month, ...fund, executionRate: rate });
  }
  const ledger = accountingSvc.buildLedgerTable(dept);
  return ok(res, {
    month,
    totalRemaining: ledger.totalRemaining,
    over30Count: ledger.over30Count,
    items: ledger.items
  });
}
