// S8+S9+S10 记账域核心服务（契约 §3/§4/§5/§6）
// 结存口径：期末结存 = 上期结存 + 领用 − 发放 + 盘点确认差异（按物品独立、跨月累计）
// 结存金额 = Σ 剩余批次 remaining_qty × unit_price（不取平均价）
import db from '../models/db.js';

function pad2(n) { return String(n).padStart(2, '0'); }

function throwBiz(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function monthBounds(month) {
  const [y, m] = String(month).split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${pad2(lastDay)}` };
}

export function prevMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(y, m - 2, 1); // 月份 0 基：m=10(10月) → 上一月为 index 8
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// 单据编号：前缀 + yyyyMMdd + 3位流水，插入前查重（C27）
function nextDocNo(table, col, prefix, dateStr) {
  const ymd = String(dateStr).slice(0, 10).replace(/-/g, '');
  const like = `${prefix}${ymd}%`;
  const row = db.prepare(
    `SELECT ${col} AS no FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`
  ).get(like);
  let seq = 1;
  if (row) seq = Number(String(row.no).slice(-3)) + 1;
  return `${prefix}${ymd}${String(seq).padStart(3, '0')}`;
}

let batchSeq = 0;
function nextBatchNo() {
  const row = db.prepare(`SELECT batch_no AS no FROM material_batches ORDER BY id DESC LIMIT 1`).get();
  let n = 1;
  if (row) n = Number(String(row.no).slice(1)) + 1;
  return `B${String(n).padStart(4, '0')}`;
}

// ===== 月冻结（C24）：已出报表月份锁定，记账接口拒绝 =====
export function assertMonthEditable(deptCode, month) {
  const row = db.prepare(
    `SELECT 1 AS x FROM monthly_reports WHERE dept_code=? AND month=? AND locked=1 LIMIT 1`
  ).get(deptCode, month);
  if (row) throwBiz(4000, `${month} 已生成月度报表，当月账目只读；如需修改请联系科长解锁`);
}

// ===== 结存计算（按物品独立、跨月累计）=====
export function stockQtyAt(itemId, endDate) {
  const row = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(qty) FROM material_receipts WHERE item_id=? AND status='normal' AND substr(receipt_date,1,10)<=?),0)
      - COALESCE((SELECT SUM(qty) FROM material_issues WHERE item_id=? AND status='normal' AND substr(issue_date,1,10)<=?),0)
      + COALESCE((SELECT SUM(si.diff) FROM stocktaking_items si JOIN stocktakings t ON t.id=si.taking_id
                  WHERE si.item_id=? AND t.status='confirmed' AND substr(t.confirmed_at,1,10)<=?),0)
      AS qty
  `).get(itemId, endDate, itemId, endDate, itemId, endDate);
  return row ? row.qty : 0;
}

export function stockAmountNow(itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(remaining_qty * unit_price),0) AS amt FROM material_batches WHERE item_id=?`
  ).get(itemId);
  return row ? row.amt : 0;
}

export function plannedQtyOfItem(deptCode, itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(planned_qty),0) AS q, COALESCE(SUM(planned_amount),0) AS a FROM material_plans WHERE dept_code=? AND item_id=?`
  ).get(deptCode, itemId);
  return { qty: row.q, amount: row.a };
}

function cumReceiptQty(itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(qty),0) AS q FROM material_receipts WHERE item_id=? AND status='normal'`
  ).get(itemId);
  return row.q;
}

// ===== 物品 =====
export function listItems(deptCode) {
  return db.prepare(`SELECT * FROM material_items WHERE dept_code=? ORDER BY id`).all(deptCode)
    .map((r) => ({
      id: r.id, name: r.name, unit: r.unit, minStock: r.min_stock,
      stockQty: stockQtyAt(r.id, todayStr()), stockAmount: stockAmountNow(r.id),
      warning: stockQtyAt(r.id, todayStr()) < r.min_stock
    }));
}

export function createItem(deptCode, { name, unit = '', minStock = 0 }, operatorId) {
  if (!name) throwBiz(4000, '物品名称不能为空');
  const info = db.prepare(
    `INSERT INTO material_items (dept_code, name, unit, min_stock, created_by) VALUES (?, ?, ?, ?, ?)`
  ).run(deptCode, String(name).trim(), unit, Number(minStock) || 0, operatorId ?? null);
  return db.prepare(`SELECT * FROM material_items WHERE id=?`).get(Number(info.lastInsertRowid));
}

export function updateMinStock(deptCode, itemId, minStock) {
  const row = db.prepare(`SELECT * FROM material_items WHERE id=? AND dept_code=?`).get(itemId, deptCode);
  if (!row) throwBiz(4000, '物品不存在');
  db.prepare(`UPDATE material_items SET min_stock=? WHERE id=?`).run(Number(minStock) || 0, itemId);
  return { id: row.id, minStock: Number(minStock) || 0 };
}

// ===== 物料计划 =====
export function listPlans(deptCode, month) {
  const where = [`p.dept_code=?`];
  const params = [deptCode];
  if (month) { where.push(`month=?`); params.push(month); }
  return db.prepare(`
    SELECT p.*, i.name AS item_name, i.unit
    FROM material_plans p LEFT JOIN material_items i ON i.id=p.item_id
    WHERE ${where.join(' AND ')} ORDER BY p.id
  `).all(...params).map((r) => ({
    id: r.id, month: r.month, itemId: r.item_id, itemName: r.item_name, unit: r.unit,
    plannedQty: r.planned_qty, referencePrice: r.reference_price, plannedAmount: r.planned_amount,
    isAppend: r.is_append, appendNote: r.append_note, appendAt: r.append_at, appendBy: r.append_by,
    createdBy: r.created_by, createdAt: r.created_at
  }));
}

export function createPlan(deptCode, body, operator) {
  const month = String(body.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throwBiz(4000, '月份格式应为 YYYY-MM');
  let itemId = Number(body.itemId);
  if (!itemId) {
    const item = createItem(deptCode, { name: body.itemName, unit: body.unit }, operator.id);
    itemId = item.id;
  } else {
    const item = db.prepare(`SELECT * FROM material_items WHERE id=? AND dept_code=?`).get(itemId, deptCode);
    if (!item) throwBiz(4000, '物品不存在');
  }
  const plannedQty = Number(body.plannedQty);
  if (!Number.isInteger(plannedQty) || plannedQty <= 0) throwBiz(4000, '计划数量必须为正整数');
  const referencePrice = Number(body.referencePrice) || 0;
  const isAppend = body.isAppend === 1 ? 1 : 0;
  db.prepare(`
    INSERT INTO material_plans
      (dept_code, month, item_id, planned_qty, reference_price, planned_amount, is_append, append_note, append_at, append_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?)
  `).run(deptCode, month, itemId, plannedQty, referencePrice, plannedQty * referencePrice,
    isAppend, isAppend ? (body.appendNote || null) : null, isAppend ? operator.id : null, operator.id);
  // 追加后该物品累计计划额同步（C18）
  return { itemId, total: plannedQtyOfItem(deptCode, itemId) };
}

// ===== 领用（每次自动生成批次）=====
export function listReceipts(deptCode, month) {
  const where = [`r.dept_code=?`];
  const params = [deptCode];
  if (month) { where.push(`r.month=?`); params.push(month); }
  return db.prepare(`
    SELECT r.*, i.name AS item_name, i.unit FROM material_receipts r
    LEFT JOIN material_items i ON i.id=r.item_id
    WHERE ${where.join(' AND ')} ORDER BY r.id DESC
  `).all(...params).map((r) => ({
    id: r.id, receiptNo: r.receipt_no, month: r.month, itemId: r.item_id, itemName: r.item_name,
    unit: r.unit, qty: r.qty, unitPrice: r.unit_price, amount: r.amount, receiptDate: r.receipt_date,
    handler: r.handler, overPlan: r.over_plan, status: r.status, voidReason: r.void_reason
  }));
}

export function createReceipt(deptCode, body, operator) {
  const itemId = Number(body.itemId);
  const item = db.prepare(`SELECT * FROM material_items WHERE id=? AND dept_code=?`).get(itemId, deptCode);
  if (!item) throwBiz(4000, '物品不存在');
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty <= 0) throwBiz(4000, '领用数量必须为正整数');
  const unitPrice = Number(body.unitPrice) || 0;
  const receiptDate = String(body.receiptDate || todayStr()).slice(0, 10);
  const month = receiptDate.slice(0, 7);
  assertMonthEditable(deptCode, month);

  // 超计划标红不阻断（C17/C20 物料版）
  const plan = plannedQtyOfItem(deptCode, itemId);
  const overPlan = cumReceiptQty(itemId) + qty > plan.qty ? 1 : 0;

  const receiptNo = nextDocNo('material_receipts', 'receipt_no', 'LL', receiptDate);
  const info = db.prepare(`
    INSERT INTO material_receipts
      (receipt_no, dept_code, month, item_id, plan_id, qty, unit_price, amount, receipt_date, handler, voucher, over_plan, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(receiptNo, deptCode, month, itemId, body.planId ? Number(body.planId) : null,
    qty, unitPrice, qty * unitPrice, receiptDate, body.handler || operator.name, body.voucher || null, overPlan, operator.id);
  const receiptId = Number(info.lastInsertRowid);
  // 自动生成批次（FIFO 发放）
  db.prepare(`
    INSERT INTO material_batches (receipt_id, batch_no, item_id, total_qty, remaining_qty, unit_price, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(receiptId, nextBatchNo(), itemId, qty, qty, unitPrice, `${receiptDate} 00:00:00`);
  return { id: receiptId, receiptNo, overPlan, stockQty: stockQtyAt(itemId, todayStr()), stockAmount: stockAmountNow(itemId) };
}

// ===== 发放（FIFO 扣减批次）=====
function allocateBatches(itemId, qty) {
  const rows = db.prepare(
    `SELECT * FROM material_batches WHERE item_id=? AND remaining_qty>0 ORDER BY received_at, id`
  ).all(itemId);
  const alloc = [];
  let need = qty;
  for (const b of rows) {
    if (need <= 0) break;
    const take = Math.min(b.remaining_qty, need);
    alloc.push({ batchId: b.id, batchNo: b.batch_no, qty: take });
    need -= take;
  }
  if (need > 0) throwBiz(4000, `超过待发放数量：尚缺 ${need}，结存不足`); // C25
  return alloc;
}

export function listIssues(deptCode, month) {
  const where = [`i.dept_code=?`];
  const params = [deptCode];
  if (month) { where.push(`i.month=?`); params.push(month); }
  return db.prepare(`
    SELECT i.*, it.name AS item_name, u.name AS user_name FROM material_issues i
    LEFT JOIN material_items it ON it.id=i.item_id
    LEFT JOIN users u ON u.id=i.user_id
    WHERE ${where.join(' AND ')} ORDER BY i.id DESC
  `).all(...params).map((r) => ({
    id: r.id, issueNo: r.issue_no, month: r.month, itemId: r.item_id, itemName: r.item_name,
    userId: r.user_id, userName: r.user_name, qty: r.qty, issueDate: r.issue_date, handler: r.handler,
    batchAlloc: r.batch_alloc, status: r.status, voidReason: r.void_reason
  }));
}

export function createIssue(deptCode, body, operator) {
  const itemId = Number(body.itemId);
  const item = db.prepare(`SELECT * FROM material_items WHERE id=? AND dept_code=?`).get(itemId, deptCode);
  if (!item) throwBiz(4000, '物品不存在');
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty <= 0) throwBiz(4000, '发放数量必须为正整数');
  const issueDate = String(body.issueDate || todayStr()).slice(0, 10);
  const month = issueDate.slice(0, 7);
  assertMonthEditable(deptCode, month);

  const alloc = allocateBatches(itemId, qty); // 不足直接 4000（C25）
  for (const a of alloc) {
    db.prepare(`UPDATE material_batches SET remaining_qty = remaining_qty - ? WHERE id=?`).run(a.qty, a.batchId);
  }
  const issueNo = nextDocNo('material_issues', 'issue_no', 'FF', issueDate);
  const userId = body.userId ? Number(body.userId) : null;
  const info = db.prepare(`
    INSERT INTO material_issues
      (issue_no, dept_code, month, item_id, user_id, qty, issue_date, handler, batch_alloc, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(issueNo, deptCode, month, itemId, userId, qty, issueDate, body.handler || operator.name,
    JSON.stringify(alloc), operator.id);
  return { id: Number(info.lastInsertRowid), issueNo, batchAlloc: alloc,
    stockQty: stockQtyAt(itemId, todayStr()), stockAmount: stockAmountNow(itemId) };
}

// ===== 作废（当天自办；跨天走审批 C23）=====
function sameDay(createdAt) {
  return String(createdAt || '').slice(0, 10) === todayStr();
}

export function doVoidIssue(issueId, operator) {
  const r = db.prepare(`SELECT * FROM material_issues WHERE id=?`).get(issueId);
  if (!r) throwBiz(4000, '发放单不存在');
  if (r.status === 'void') throwBiz(4000, '该单已作废');
  const alloc = JSON.parse(r.batch_alloc || '[]');
  for (const a of alloc) {
    db.prepare(`UPDATE material_batches SET remaining_qty = remaining_qty + ? WHERE id=?`).run(a.qty, a.batchId);
  }
  db.prepare(`UPDATE material_issues SET status='void', void_reason=?, void_at=datetime('now','localtime'), void_by=? WHERE id=?`)
    .run(null, operator.id, issueId);
}

export function doVoidReceipt(receiptId, operator) {
  const r = db.prepare(`SELECT * FROM material_receipts WHERE id=?`).get(receiptId);
  if (!r) throwBiz(4000, '领用单不存在');
  if (r.status === 'void') throwBiz(4000, '该单已作废');
  const b = db.prepare(`SELECT * FROM material_batches WHERE receipt_id=?`).get(receiptId);
  if (b && b.remaining_qty < b.total_qty) throwBiz(4000, '该批次已部分发放，请走跨天修改/作废审批流程');
  if (b) db.prepare(`UPDATE material_batches SET remaining_qty=0, total_qty=0 WHERE id=?`).run(b.id);
  db.prepare(`UPDATE material_receipts SET status='void', void_reason=?, void_at=datetime('now','localtime'), void_by=? WHERE id=?`)
    .run(null, operator.id, receiptId);
}

export function doVoidExpense(expenseId, operator) {
  const r = db.prepare(`SELECT * FROM fund_expenses WHERE id=?`).get(expenseId);
  if (!r) throwBiz(4000, '支出单不存在');
  if (r.status === 'void') throwBiz(4000, '该单已作废');
  db.prepare(`UPDATE fund_expenses SET status='void', void_reason=?, void_at=datetime('now','localtime'), void_by=? WHERE id=?`)
    .run(null, operator.id, expenseId);
}

export function voidRecord(deptCode, targetType, id, reason, operator) {
  const table = targetType === 'receipt' ? 'material_receipts'
    : targetType === 'issue' ? 'material_issues' : 'fund_expenses';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!row) throwBiz(4000, '记录不存在');
  if (row.status === 'void') throwBiz(4000, '该记录已作废');
  if (!sameDay(row.created_at)) {
    // 跨天：转审批，原记录不变（C23）
    const info = db.prepare(`
      INSERT INTO accounting_approvals (dept_code, target_type, target_id, action, reason, requested_by)
      VALUES (?, ?, ?, 'void', ?, ?)
    `).run(deptCode, targetType, id, reason || null, operator.id);
    return { requiresApproval: true, approvalId: Number(info.lastInsertRowid) };
  }
  if (targetType === 'receipt') doVoidReceipt(id, operator);
  else if (targetType === 'issue') doVoidIssue(id, operator);
  else doVoidExpense(id, operator);
  return { requiresApproval: false, id };
}

// ===== 跨天修改请求 =====
export function createModifyRequest(deptCode, body, operator) {
  const targetType = String(body.targetType || '');
  if (!['receipt', 'issue', 'expense'].includes(targetType)) throwBiz(4000, '目标类型不支持');
  const targetId = Number(body.targetId);
  const action = String(body.action || '') === 'edit' ? 'edit' : 'void';
  const table = targetType === 'receipt' ? 'material_receipts'
    : targetType === 'issue' ? 'material_issues' : 'fund_expenses';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND dept_code=?`).get(targetId, deptCode);
  if (!row) throwBiz(4000, '目标记录不存在');
  if (!body.reason) throwBiz(4000, '跨天变更必须填写原因');
  const info = db.prepare(`
    INSERT INTO accounting_approvals (dept_code, target_type, target_id, action, changes, reason, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(deptCode, targetType, targetId, action, body.changes ? JSON.stringify(body.changes) : null, body.reason, operator.id);
  return { id: Number(info.lastInsertRowid), status: 'pending' };
}

export function listApprovals(deptCode) {
  return db.prepare(`
    SELECT * FROM accounting_approvals WHERE dept_code=? ORDER BY id DESC
  `).all(deptCode).map((r) => ({
    id: r.id, targetType: r.target_type, targetId: r.target_id, action: r.action,
    changes: r.changes ? JSON.parse(r.changes) : null, reason: r.reason, status: r.status,
    requestedBy: r.requested_by, requestedAt: r.requested_at,
    confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, confirmNote: r.confirm_note
  }));
}

function applyApproval(approval, confirmNote, operatorId) {
  // approval.changes 为 DB TEXT，必须先 JSON.parse（缺陷A）
  const changes = approval.changes ? JSON.parse(approval.changes) : null;
  const { target_type, target_id, action } = approval;
  if (action === 'void') {
    if (target_type === 'receipt') doVoidReceipt(target_id, { id: null });
    else if (target_type === 'issue') doVoidIssue(target_id, { id: null });
    else doVoidExpense(target_id, { id: null });
    db.prepare(`UPDATE ${target_type === 'receipt' ? 'material_receipts' : target_type === 'issue' ? 'material_issues' : 'fund_expenses'}
      SET void_reason=? WHERE id=?`).run(approval.reason, target_id);
  } else if (changes) {
    // edit：仅白名单标量字段，金额重算
    if (target_type === 'receipt') {
      const r = db.prepare(`SELECT * FROM material_receipts WHERE id=?`).get(target_id);
      const qty = changes.qty ?? r.qty;
      const unitPrice = changes.unitPrice ?? r.unit_price;
      db.prepare(`UPDATE material_receipts SET qty=?, unit_price=?, amount=?, handler=? WHERE id=?`)
        .run(qty, unitPrice, qty * unitPrice, changes.handler ?? r.handler, target_id);
    } else if (target_type === 'expense') {
      const r = db.prepare(`SELECT * FROM fund_expenses WHERE id=?`).get(target_id);
      db.prepare(`UPDATE fund_expenses SET amount=?, item=?, payee=? WHERE id=?`)
        .run(changes.amount ?? r.amount, changes.item ?? r.item, changes.payee ?? r.payee, target_id);
    }
  }
  db.prepare(`UPDATE accounting_approvals SET status='approved', confirmed_by=?, confirmed_at=datetime('now','localtime'), confirm_note=? WHERE id=?`)
    .run(operatorId ?? null, confirmNote ?? null, approval.id);
}

export function decideApproval(deptCode, id, approve, confirmNote, operator) {
  const row = db.prepare(`SELECT * FROM accounting_approvals WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!row) throwBiz(4000, '审批单不存在');
  if (row.status !== 'pending') throwBiz(4000, '该审批已处理');
  if (approve) applyApproval(row, confirmNote, operator.id);
  else db.prepare(`UPDATE accounting_approvals SET status='rejected', confirmed_by=?, confirmed_at=datetime('now','localtime'), confirm_note=? WHERE id=?`)
    .run(operator.id, confirmNote ?? null, id);
  return db.prepare(`SELECT * FROM accounting_approvals WHERE id=?`).get(id);
}

// ===== 我的物品（C26：仅物品/数量/日期/发放人）=====
export function myItems(userId) {
  return db.prepare(`
    SELECT i.id, i.qty, i.issue_date AS issueDate, i.handler, it.name AS itemName, it.unit
    FROM material_issues i LEFT JOIN material_items it ON it.id=i.item_id
    WHERE i.user_id=? AND i.status='normal' ORDER BY i.id DESC
  `).all(userId).map((r) => ({
    id: r.id, itemName: r.itemName, unit: r.unit, qty: r.qty, issueDate: r.issueDate, handler: r.handler
  }));
}

// ===== 库存汇总（含预警 C29）=====
export function stockSummary(deptCode) {
  const items = db.prepare(`SELECT * FROM material_items WHERE dept_code=? ORDER BY id`).all(deptCode);
  const today = todayStr();
  return items.map((r) => {
    const qty = stockQtyAt(r.id, today);
    return {
      itemId: r.id, name: r.name, unit: r.unit, minStock: r.min_stock,
      stockQty: qty, stockAmount: stockAmountNow(r.id), warning: qty < r.min_stock
    };
  });
}

// ===== 盘点（C30）=====
export function openStocktaking(deptCode, month, operator) {
  if (!/^\d{4}-\d{2}$/.test(month)) throwBiz(4000, '月份格式应为 YYYY-MM');
  const info = db.prepare(`
    INSERT INTO stocktakings (dept_code, month, created_by) VALUES (?, ?, ?)
  `).run(deptCode, month, operator.id);
  const takingId = Number(info.lastInsertRowid);
  const today = todayStr();
  const items = db.prepare(`SELECT * FROM material_items WHERE dept_code=?`).all(deptCode);
  for (const it of items) {
    db.prepare(`INSERT INTO stocktaking_items (taking_id, item_id, book_qty) VALUES (?, ?, ?)`)
      .run(takingId, it.id, stockQtyAt(it.id, today));
  }
  return getStocktaking(takingId);
}

export function getStocktaking(id) {
  const t = db.prepare(`SELECT * FROM stocktakings WHERE id=?`).get(id);
  if (!t) return null;
  const items = db.prepare(`
    SELECT si.*, it.name AS item_name, it.unit FROM stocktaking_items si
    LEFT JOIN material_items it ON it.id=si.item_id WHERE si.taking_id=?
  `).all(id).map((r) => ({
    id: r.id, itemId: r.item_id, itemName: r.item_name, unit: r.unit,
    bookQty: r.book_qty, actualQty: r.actual_qty, diff: r.diff, reason: r.reason
  }));
  return {
    id: t.id, deptCode: t.dept_code, month: t.month, status: t.status,
    createdAt: t.created_at, confirmedBy: t.confirmed_by, confirmedAt: t.confirmed_at,
    voidReason: t.void_reason, items
  };
}

export function listStocktakings(deptCode) {
  return db.prepare(`SELECT * FROM stocktakings WHERE dept_code=? ORDER BY id DESC`).all(deptCode)
    .map((t) => getStocktaking(t.id));
}

export function fillStocktakingItems(deptCode, id, items) {
  const t = db.prepare(`SELECT * FROM stocktakings WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!t) throwBiz(4000, '盘点单不存在');
  if (t.status !== 'open') throwBiz(4000, '盘点单已确认或作废，不能再录实盘');
  for (const it of items) {
    const row = db.prepare(`SELECT * FROM stocktaking_items WHERE id=? AND taking_id=?`).get(Number(it.itemId), id);
    // itemId 存的是明细行 id（前端按明细行回传）
    const line = row || db.prepare(`SELECT * FROM stocktaking_items WHERE taking_id=? AND item_id=?`).get(id, Number(it.itemId));
    if (!line) continue;
    const actual = Number(it.actualQty);
    if (!Number.isInteger(actual)) throwBiz(4000, '实盘数量必须为整数');
    const diff = actual - line.book_qty;
    if (diff !== 0 && !it.reason) throwBiz(4000, `盘盈盘亏必须填写原因（物品行 ${line.item_id}）`);
    db.prepare(`UPDATE stocktaking_items SET actual_qty=?, diff=?, reason=? WHERE id=?`)
      .run(actual, diff, diff !== 0 ? (it.reason || null) : null, line.id);
  }
  return getStocktaking(id);
}

export function confirmStocktaking(deptCode, id, operator) {
  const t = db.prepare(`SELECT * FROM stocktakings WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!t) throwBiz(4000, '盘点单不存在');
  if (t.status !== 'open') throwBiz(4000, '盘点单已处理');
  // 未录全实盘的行不允许确认
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM stocktaking_items WHERE taking_id=? AND actual_qty IS NULL`).get(id).n;
  if (pending > 0) throwBiz(4000, `还有 ${pending} 个物品未录实盘，不能确认`);
  db.prepare(`UPDATE stocktakings SET status='confirmed', confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?`)
    .run(operator.id, id);

  // 缺陷F整改：确认时同步回写批次，保证 Σ批次剩余 == 结存（否则盘盈无批次可扣、多发1支越账）
  // 方案：盘盈 → 生成一条单价0的调整批次（receipt_id=0 表示盘点调整来源）；
  //       盘亏 → FIFO 扣减既有批次剩余，直至扣完。
  const today = todayStr();
  const lines = db.prepare(`SELECT * FROM stocktaking_items WHERE taking_id=? AND diff != 0`).all(id);
  for (const ln of lines) {
    if (ln.diff > 0) {
      db.prepare(`
        INSERT INTO material_batches (receipt_id, batch_no, item_id, total_qty, remaining_qty, unit_price, received_at)
        VALUES (0, ?, ?, ?, ?, 0, ?)
      `).run(nextBatchNo(), ln.item_id, ln.diff, ln.diff, `${today} 00:00:00`);
    } else {
      let need = -ln.diff;
      const batches = db.prepare(
        `SELECT * FROM material_batches WHERE item_id=? AND remaining_qty>0 ORDER BY received_at, id`
      ).all(ln.item_id);
      for (const b of batches) {
        if (need <= 0) break;
        const take = Math.min(b.remaining_qty, need);
        db.prepare(`UPDATE material_batches SET remaining_qty = remaining_qty - ? WHERE id=?`).run(take, b.id);
        need -= take;
      }
    }
  }
  return getStocktaking(id);
}

export function voidStocktaking(deptCode, id, reason) {
  if (!reason) throwBiz(4000, '作废盘点单必须填写原因');
  const t = db.prepare(`SELECT * FROM stocktakings WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!t) throwBiz(4000, '盘点单不存在');
  if (t.status === 'void') throwBiz(4000, '已作废');
  if (t.status === 'confirmed') throwBiz(4000, '已确认的盘点单不能作废');
  db.prepare(`UPDATE stocktakings SET status='void', void_reason=? WHERE id=?`).run(reason, id);
  return getStocktaking(id);
}

// ===== 资金账与挂账 =====
export function listFundPlans(deptCode, month) {
  const where = [`dept_code=?`];
  const params = [deptCode];
  if (month) { where.push(`month=?`); params.push(month); }
  return db.prepare(`SELECT * FROM fund_plans WHERE ${where.join(' AND ')} ORDER BY id`)
    .all(...params).map((r) => ({
      id: r.id, month: r.month, item: r.item, plannedAmount: r.planned_amount,
      isAppend: r.is_append, appendNote: r.append_note, createdAt: r.created_at
    }));
}

export function createFundPlan(deptCode, body, operator) {
  const month = String(body.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throwBiz(4000, '月份格式应为 YYYY-MM');
  const item = String(body.item || '').trim();
  if (!item) throwBiz(4000, '事项不能为空');
  const plannedAmount = Number(body.plannedAmount);
  if (!(plannedAmount > 0)) throwBiz(4000, '计划金额必须大于0');
  const isAppend = body.isAppend === 1 ? 1 : 0;
  db.prepare(`
    INSERT INTO fund_plans (dept_code, month, item, planned_amount, is_append, append_note, append_at, append_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?)
  `).run(deptCode, month, item, plannedAmount, isAppend, isAppend ? (body.appendNote || null) : null,
    isAppend ? operator.id : null, operator.id);
  const total = db.prepare(`SELECT COALESCE(SUM(planned_amount),0) AS a FROM fund_plans WHERE dept_code=? AND month=?`)
    .get(deptCode, month).a;
  return { month, totalPlanned: total };
}

export function listExpenses(deptCode, month) {
  const where = [`e.dept_code=?`];
  const params = [deptCode];
  if (month) { where.push(`e.month=?`); params.push(month); }
  return db.prepare(`
    SELECT e.*, p.item AS plan_item FROM fund_expenses e
    LEFT JOIN fund_plans p ON p.id=e.plan_id
    WHERE ${where.join(' AND ')} ORDER BY e.id DESC
  `).all(...params).map((r) => ({
    id: r.id, expenseNo: r.expense_no, month: r.month, item: r.item, amount: r.amount,
    payee: r.payee, expenseDate: r.expense_date, handler: r.handler, planId: r.plan_id,
    settleStatus: r.settle_status, overPlan: r.over_plan, status: r.status, voidReason: r.void_reason
  }));
}

export function expenseRemaining(row) {
  const settled = db.prepare(`SELECT COALESCE(SUM(settle_amount),0) AS a FROM fund_settlements WHERE expense_id=?`)
    .get(row.id).a;
  return Math.round((row.amount - settled) * 10000) / 10000;
}

export function createExpense(deptCode, body, operator) {
  const month = String(body.expenseDate || todayStr()).slice(0, 7);
  const expenseDate = String(body.expenseDate || todayStr()).slice(0, 10);
  assertMonthEditable(deptCode, month);
  const item = String(body.item || '').trim();
  if (!item) throwBiz(4000, '事项不能为空');
  const amount = Number(body.amount);
  if (!(amount > 0)) throwBiz(4000, '金额必须大于0');
  const planId = body.planId ? Number(body.planId) : null;
  let settleStatus = '挂账';
  let overPlan = 0;
  if (planId) {
    const plan = db.prepare(`SELECT * FROM fund_plans WHERE id=? AND dept_code=?`).get(planId, deptCode);
    if (!plan) throwBiz(4000, '所选资金计划不存在');
    settleStatus = '计划内';
    // 超计划标红仍登记（C20）
    const used = db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS a FROM fund_expenses WHERE dept_code=? AND month=? AND plan_id=? AND status='normal'`
    ).get(deptCode, month, planId).a;
    if (used + amount > plan.planned_amount) overPlan = 1;
  }
  const prefix = planId ? 'ZC' : 'GZ'; // 无计划=挂账单号 GZ
  const expenseNo = nextDocNo('fund_expenses', 'expense_no', prefix, expenseDate);
  const info = db.prepare(`
    INSERT INTO fund_expenses
      (expense_no, dept_code, month, item, amount, payee, expense_date, handler, voucher, plan_id, settle_status, over_plan, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(expenseNo, deptCode, month, item, amount, body.payee || null, expenseDate,
    body.handler || operator.name, body.voucher || null, planId, settleStatus, overPlan, operator.id);
  return { id: Number(info.lastInsertRowid), expenseNo, settleStatus, overPlan };
}

export function settleExpense(deptCode, id, body, operator) {
  const row = db.prepare(`SELECT * FROM fund_expenses WHERE id=? AND dept_code=?`).get(id, deptCode);
  if (!row) throwBiz(4000, '支出记录不存在');
  if (row.status !== 'normal') throwBiz(4000, '记录已作废，不能销账');
  if (row.settle_status === '已结清') throwBiz(4000, '该记录已结清');
  const remaining = expenseRemaining(row);
  const settleAmount = Number(body.settleAmount);
  if (!(settleAmount > 0)) throwBiz(4000, '销账金额必须大于0');
  if (settleAmount > remaining + 1e-9) throwBiz(4000, `销账金额超过剩余挂账 ${remaining}`);
  const planId = body.planId ? Number(body.planId) : row.plan_id;
  if (planId) {
    const plan = db.prepare(`SELECT * FROM fund_plans WHERE id=? AND dept_code=?`).get(planId, deptCode);
    if (!plan) throwBiz(4000, '所选资金计划不存在');
  }
  if (Math.abs(settleAmount - remaining) > 1e-9 && !body.diffReason) {
    throwBiz(4000, `销账金额（${settleAmount}）与剩余挂账（${remaining}）不一致，必须填写差额说明`);
  }
  db.prepare(`
    INSERT INTO fund_settlements (expense_id, plan_id, settle_amount, diff_reason, settled_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, planId, settleAmount, body.diffReason || null, operator.id);
  if (row.plan_id == null) {
    db.prepare(`UPDATE fund_expenses SET plan_id=? WHERE id=?`).run(planId, id);
  }
  const newRemaining = Math.round((remaining - settleAmount) * 10000) / 10000;
  const newStatus = newRemaining <= 1e-9 ? '已结清' : '部分销账';
  db.prepare(`UPDATE fund_expenses SET settle_status=? WHERE id=?`).run(newStatus, id);
  return { id, settleAmount, remaining: newRemaining, settleStatus: newStatus };
}

// 挂账清单（含30天提醒 C22）
export function ledgerList(deptCode) {
  const rows = db.prepare(`
    SELECT * FROM fund_expenses WHERE dept_code=? AND status='normal'
      AND settle_status IN ('挂账','部分销账') ORDER BY expense_date
  `).all(deptCode);
  const today = todayStr();
  return rows.map((r) => {
    const remaining = expenseRemaining(r);
    const days = Math.floor((Date.parse(today) - Date.parse(r.expense_date)) / 86400000);
    return {
      id: r.id, expenseNo: r.expense_no, item: r.item, amount: r.amount,
      expenseDate: r.expense_date, remaining, days,
      planLinked: r.plan_id != null, settleStatus: r.settle_status, over30: days > 30
    };
  });
}

// ===== 月度报表聚合（D33 四表同源）=====
export function buildMaterialTable(deptCode, month) {
  const items = db.prepare(`SELECT * FROM material_items WHERE dept_code=? ORDER BY id`).all(deptCode);
  const { first, last } = monthBounds(month);
  const prevLast = monthBounds(prevMonth(month)).last;
  return items.map((it) => {
    const opening = stockQtyAt(it.id, prevLast);
    const plannedQty = db.prepare(`SELECT COALESCE(SUM(planned_qty),0) AS q, COALESCE(SUM(planned_amount),0) AS a FROM material_plans WHERE dept_code=? AND month=? AND item_id=?`)
      .get(deptCode, month, it.id);
    const received = db.prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM material_receipts WHERE dept_code=? AND item_id=? AND status='normal' AND substr(receipt_date,1,10) BETWEEN ? AND ?`)
      .get(deptCode, it.id, first, last).q;
    const issued = db.prepare(`SELECT COALESCE(SUM(qty),0) AS q FROM material_issues WHERE dept_code=? AND item_id=? AND status='normal' AND substr(issue_date,1,10) BETWEEN ? AND ?`)
      .get(deptCode, it.id, first, last).q;
    const adjust = db.prepare(`
      SELECT COALESCE(SUM(si.diff),0) AS q FROM stocktaking_items si JOIN stocktakings t ON t.id=si.taking_id
      WHERE t.dept_code=? AND si.item_id=? AND t.status='confirmed' AND substr(t.confirmed_at,1,10) BETWEEN ? AND ?
    `).get(deptCode, it.id, first, last).q;
    const ending = opening + received - issued + adjust;
    const pending = db.prepare(`SELECT COALESCE(SUM(remaining_qty),0) AS q FROM material_batches WHERE item_id=?`).get(it.id).q;
    return {
      itemId: it.id, name: it.name, unit: it.unit,
      opening, plannedQty: plannedQty.q, plannedAmount: plannedQty.a,
      received, issued, adjust, ending, pendingIssue: pending,
      warning: ending < it.min_stock,
      detail: { receipts: `/api/reports/${month}/material/detail?itemId=${it.id}` }
    };
  });
}

export function buildFundTable(deptCode, month) {
  const { first, last } = monthBounds(month);
  const plans = db.prepare(`SELECT item, planned_amount, is_append FROM fund_plans WHERE dept_code=? AND month=? ORDER BY id`)
    .all(deptCode, month).map((r) => ({ item: r.item, plannedAmount: r.planned_amount, isAppend: r.is_append }));
  const totalPlanned = plans.reduce((s, p) => s + p.plannedAmount, 0);
  const actual = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS a FROM fund_expenses
    WHERE dept_code=? AND month=? AND status='normal' AND plan_id IS NOT NULL
  `).get(deptCode, month).a;
  const ledgerAmount = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS a FROM fund_expenses
    WHERE dept_code=? AND month=? AND status='normal' AND plan_id IS NULL
  `).get(deptCode, month).a;
  return {
    plans, totalPlanned, actual, balance: Math.round((totalPlanned - actual) * 10000) / 10000,
    ledgerAmount: Math.round(ledgerAmount * 10000) / 10000,
    overPlanItems: db.prepare(`
      SELECT item, amount FROM fund_expenses WHERE dept_code=? AND month=? AND status='normal' AND over_plan=1
    `).all(deptCode, month)
  };
}

export function buildLedgerTable(deptCode) {
  const list = ledgerList(deptCode);
  return { items: list, over30Count: list.filter((x) => x.over30).length,
    totalRemaining: Math.round(list.reduce((s, x) => s + x.remaining, 0) * 10000) / 10000 };
}

// 看板/快照用轻量汇总
export function overview(deptCode) {
  const month = todayStr().slice(0, 7);
  const materialPlanAmount = db.prepare(`SELECT COALESCE(SUM(planned_amount),0) AS a FROM material_plans WHERE dept_code=? AND month=?`).get(deptCode, month).a;
  const receivedAmount = db.prepare(`SELECT COALESCE(SUM(amount),0) AS a FROM material_receipts WHERE dept_code=? AND month=? AND status='normal'`).get(deptCode, month).a;
  const items = db.prepare(`SELECT id, min_stock FROM material_items WHERE dept_code=?`).all(deptCode);
  let stockQty = 0; let stockAmount = 0; let warnings = 0;
  const today = todayStr();
  for (const it of items) {
    const q = stockQtyAt(it.id, today);
    stockQty += q;
    stockAmount += stockAmountNow(it.id);
    if (q < it.min_stock) warnings += 1;
  }
  const ledger = buildLedgerTable(deptCode);
  const pendingIssueQty = db.prepare(`SELECT COALESCE(SUM(remaining_qty),0) AS q FROM material_batches`).get().q;
  return {
    month,
    materialPlanAmount, receivedAmount,
    stockQty, stockAmount, lowStockWarnings: warnings,
    ledgerAmount: ledger.totalRemaining, ledgerOver30: ledger.over30Count,
    pendingIssueQty
  };
}
