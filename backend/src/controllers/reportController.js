// S10 月度报表控制器（契约 §5：D33 四表同源 / D34 汇总说明进经验库候选）
import { ok, fail } from '../middleware/response.js';
import db from '../models/db.js';
import logModel from '../models/logModel.js';
import summaryModel from '../models/summaryModel.js';
import * as svc from '../services/accountingService.js';
import { aggregateWorks, resolveScope, deptPersonStats } from '../services/statsService.js';

function wrap(fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (e) {
      return fail(res, e.code || 5000, e.message || '服务器内部错误');
    }
  };
}

function validMonth(month) {
  return /^\d{4}-\d{2}$/.test(String(month || ''));
}

// 缺陷C整改：人员工作完成表按 dept_code 直聚本科室全员，不受记账员科员身份限制
function buildWorkTable(me, month) {
  const { first, last } = svc.monthBounds(month);
  return deptPersonStats(me.deptCode, { startDate: first, endDate: last });
}

// 汇总说明模板（数字全部来自报表 data，模型不参与计算）
function buildSummaryTemplate(month, data) {
  const m = data.material || [];
  const f = data.fund || { totalPlanned: 0, actual: 0, balance: 0, ledgerAmount: 0 };
  const l = data.ledger || { items: [], over30Count: 0 };
  const matLines = m.length
    ? m.map((x) => `${x.name}月初结存${x.opening}、计划${x.plannedQty}、领用${x.received}、发放${x.issued}、月末结存${x.ending}`).join('；')
    : '本月无物料收发存记录';
  return [
    `${month} 科室月度报表汇总说明（初稿）`,
    '',
    `一、物料计划执行：${matLines}。`,
    `二、资金执行：本月计划 ${f.totalPlanned} 元，实际支出 ${f.actual} 元，余额 ${f.balance} 元；计划外挂账 ${f.ledgerAmount} 元。`,
    `三、挂账情况：在挂 ${l.items.length} 笔，其中超30天 ${l.over30Count} 笔，需重点盯办。`,
    '',
    '（本说明为系统按报表数据生成的初稿，请人工修改确认后存档。）'
  ].join('\n');
}

// POST /api/reports/generate-month  {month?}  幂等：已生成则刷新并重锁
export const generateMonth = wrap(async (req, res) => {
  const me = req.currentUser;
  let month = String(req.body?.month || '').slice(0, 7);
  if (!validMonth(month)) {
    const d = new Date();
    d.setDate(1); d.setMonth(d.getMonth() - 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const data = {
    material: svc.buildMaterialTable(me.deptCode, month),
    fund: svc.buildFundTable(me.deptCode, month),
    ledger: svc.buildLedgerTable(me.deptCode),
    work: buildWorkTable(me, month)
  };
  const types = ['material', 'fund', 'ledger', 'work', 'summary'];
  for (const t of types) {
    db.prepare(`
      INSERT INTO monthly_reports (dept_code, month, report_type, status, data_json, generated_by, locked)
      VALUES (?, ?, ?, 'archived', ?, ?, 1)
      ON CONFLICT(dept_code, month, report_type) DO UPDATE SET
        data_json=excluded.data_json, status='archived', locked=1,
        generated_by=excluded.generated_by, generated_at=datetime('now','localtime')
    `).run(me.deptCode, month, t, JSON.stringify(t === 'summary' ? data : data[t]), me.id);
  }
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'generate_month_report',
    targetType: 'monthly_report', targetId: null, detail: { month }
  });
  return ok(res, { month, data, locked: true }, '月度报表已生成并锁定当月账目');
});

// GET /api/reports?month=
export const listReports = wrap(async (req, res) => {
  const month = String(req.query.month || '');
  const where = [`dept_code=?`];
  const params = [req.currentUser.deptCode];
  if (validMonth(month)) { where.push(`month=?`); params.push(month); }
  const rows = db.prepare(`
    SELECT id, month, report_type, status, locked, generated_at AS generatedAt,
           summary_updated_at AS summaryUpdatedAt, is_sample_candidate AS isSampleCandidate
    FROM monthly_reports WHERE ${where.join(' AND ')} ORDER BY month DESC, report_type
  `).all(...params);
  return ok(res, { list: rows });
});

// GET /api/reports/:month/:type
export const getReport = wrap(async (req, res) => {
  const { month, type } = req.params;
  if (!validMonth(month)) return fail(res, 4000, '月份格式错误');
  const row = db.prepare(
    `SELECT * FROM monthly_reports WHERE dept_code=? AND month=? AND report_type=?`
  ).get(req.currentUser.deptCode, month, type);
  if (!row) return ok(res, { month, type, data: null, generated: false });
  return ok(res, {
    month, type, locked: row.locked === 1, generated: true,
    data: row.data_json ? JSON.parse(row.data_json) : null,
    summaryText: row.summary_text, isSampleCandidate: row.is_sample_candidate === 1
  });
});

// GET /api/reports/:month/:type/detail?itemId=  —— 下钻明细
export const reportDetail = wrap(async (req, res) => {
  const { month, type } = req.params;
  const me = req.currentUser;
  const { first, last } = svc.monthBounds(month);
  if (type === 'material') {
    const itemId = Number(req.query.itemId);
    return ok(res, {
      receipts: db.prepare(`
        SELECT receipt_no, item_id, qty, unit_price, amount, receipt_date, handler, status, over_plan
        FROM material_receipts WHERE dept_code=? AND substr(receipt_date,1,10) BETWEEN ? AND ?
          AND (? = 0 OR item_id = ?) ORDER BY id
      `).all(me.deptCode, first, last, itemId || 0, itemId || 0),
      issues: db.prepare(`
        SELECT issue_no, item_id, qty, issue_date, handler, batch_alloc, status
        FROM material_issues WHERE dept_code=? AND substr(issue_date,1,10) BETWEEN ? AND ?
          AND (? = 0 OR item_id = ?) ORDER BY id
      `).all(me.deptCode, first, last, itemId || 0, itemId || 0)
    });
  }
  if (type === 'fund') {
    return ok(res, {
      plans: db.prepare(`SELECT * FROM fund_plans WHERE dept_code=? AND month=? ORDER BY id`).all(me.deptCode, month),
      expenses: db.prepare(`SELECT * FROM fund_expenses WHERE dept_code=? AND month=? AND status='normal' ORDER BY id`).all(me.deptCode, month)
    });
  }
  if (type === 'ledger') {
    return ok(res, { list: svc.ledgerList(me.deptCode) });
  }
  return ok(res, { list: svc.listPlans(me.deptCode, month) });
});

// POST /api/reports/:month/generate-summary  —— 生成模板初稿
export const generateSummary = wrap(async (req, res) => {
  const { month } = req.params;
  const me = req.currentUser;
  const row = db.prepare(`SELECT * FROM monthly_reports WHERE dept_code=? AND month=? AND report_type='summary'`).get(me.deptCode, month);
  if (!row) return fail(res, 4000, '该月报表尚未生成');
  const material = svc.buildMaterialTable(me.deptCode, month);
  const fund = svc.buildFundTable(me.deptCode, month);
  const ledger = svc.buildLedgerTable(me.deptCode);
  const text = buildSummaryTemplate(month, { material, fund, ledger });
  db.prepare(`UPDATE monthly_reports SET summary_text=?, summary_updated_by=?, summary_updated_at=datetime('now','localtime') WHERE id=?`)
    .run(text, me.id, row.id);
  return ok(res, { month, summaryText: text }, '初稿已生成，请人工修改后保存');
});

// POST /api/reports/:month/save-summary  {text}  —— 人工修改存档并进经验库候选（D34）
export const saveSummary = wrap(async (req, res) => {
  const { month } = req.params;
  const me = req.currentUser;
  const text = String(req.body?.text || '').trim();
  if (!text) return fail(res, 4000, '汇总说明不能为空');
  const row = db.prepare(`SELECT * FROM monthly_reports WHERE dept_code=? AND month=? AND report_type='summary'`).get(me.deptCode, month);
  if (!row) return fail(res, 4000, '该月报表尚未生成');
  db.prepare(`UPDATE monthly_reports SET summary_text=?, summary_updated_by=?, summary_updated_at=datetime('now','localtime'), is_sample_candidate=1 WHERE id=?`)
    .run(text, me.id, row.id);

  // D34：同时写 summary_archives（contentType='report'），检索条件放宽后可进 S6 经验库检索池
  const groupKey = `report|${me.deptCode}|${month}`;
  const existed = db.prepare(`SELECT id FROM summary_archives WHERE group_key=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`).get(groupKey);
  if (existed) {
    db.prepare(`UPDATE summary_archives SET content=?, word_count=?, is_sample_candidate=1 WHERE id=?`)
      .run(text, text.replace(/\s/g, '').length, existed.id);
  } else {
    summaryModel.create({
      deptCode: me.deptCode, periodStart: `${month}-01`, periodEnd: `${month}-28`,
      contentType: 'report', groupKey, version: 'v1', versionType: '月度报表汇总说明',
      content: text, status: 'draft', isPreferred: 0, isEnabled: 0,
      snapshot: null, referencedSamples: null, modelInfo: null, validation: { ok: true },
      createdBy: me.id, createdByName: me.name
    });
    // is_sample_candidate=1（检索放宽条件命中）
    db.prepare(`UPDATE summary_archives SET is_sample_candidate=1 WHERE group_key=?`).run(groupKey);
  }
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'save_report_summary',
    targetType: 'monthly_report', targetId: row.id, detail: { month, groupKey }
  });
  return ok(res, { month, isSampleCandidate: true }, '已保存为经验库样例候选');
});

// POST /api/reports/:month/unlock  —— 科长解锁当月只读（留痕）
export const unlockMonth = wrap(async (req, res) => {
  const { month } = req.params;
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可解锁月末锁定');
  const r = db.prepare(`UPDATE monthly_reports SET locked=0 WHERE dept_code=? AND month=? AND locked=1`)
    .run(me.deptCode, month);
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name, actionType: 'unlock_month_report',
    targetType: 'monthly_report', targetId: null, detail: { month, changed: r.changes }
  });
  return ok(res, { month, locked: false, affected: r.changes }, '已解锁，当月可记账（再次生成报表时重新锁定）');
});

// GET /api/reports/:month/export  —— Excel 导出（四表+汇总说明）
export const exportExcel = wrap(async (req, res) => {
  const { month } = req.params;
  const me = req.currentUser;
  const XLSX = (await import('xlsx')).default;
  const material = svc.buildMaterialTable(me.deptCode, month);
  const fund = svc.buildFundTable(me.deptCode, month);
  const ledger = svc.buildLedgerTable(me.deptCode);
  const work = buildWorkTable(me, month);
  const summaryRow = db.prepare(`SELECT summary_text FROM monthly_reports WHERE dept_code=? AND month=? AND report_type='summary'`)
    .get(me.deptCode, month);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(material.map((x) => ({
    '物品': x.name, '单位': x.unit, '月初结存': x.opening, '本月计划': x.plannedQty,
    '本月领用': x.received, '本月发放': x.issued, '月末结存': x.ending, '待发放': x.pendingIssue
  }))), '物料计划执行');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    '本月计划金额': fund.totalPlanned, '实际支出': fund.actual,
    '余额/超支': fund.balance, '计划外挂账': fund.ledgerAmount
  }, ...fund.plans.map((p) => ({ '事项': p.item, '计划金额': p.plannedAmount, '追加': p.isAppend }))]), '资金执行');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledger.items.map((x) => ({
    '挂账单号': x.expenseNo, '事项': x.item, '金额': x.amount, '发生日期': x.expenseDate,
    '剩余金额': x.remaining, '挂账天数': x.days, '已补计划': x.planLinked ? '是' : '否'
  }))), '挂账清单');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(work.map((x) => ({
    '姓名': x.name, '应完成': x.should, '已完成': x.completed, '未完成': x.undone, '逾期': x.overdue
  }))), '人员工作完成');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ '汇总说明': summaryRow?.summary_text || '' }]), '汇总说明');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = encodeURIComponent(`月度报表-${month}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${fname}`);
  return res.send(Buffer.from(buf));
});
