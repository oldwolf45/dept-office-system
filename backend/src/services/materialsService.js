import db from '../models/db.js';

// 材料模块业务逻辑（v1.1 / T0 骨架）：
// - 单据编号：类型前缀 + 年月日(YYYYMMDD) + 3 位流水（PRD §5.1 / 开发计划 §2.3-12）
// - 材料编号：CL + 到货日期(YYYYMMDD) + 类别两位 + 当日四位流水（修正版 PRD §5.5/§12 / 开发计划 §2.3-13）
// - 材料状态机：在库 → 领用/回收/处置 正向流转校验
// - 收支分类种子
// 注意：后端为纯 JavaScript（Node ESM），不使用 TS 类型注解。

/** 本地日期 YYYYMMDD（与办公系统 datetime('now','localtime') 口径一致） */
export function todayYmd() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10).replace(/-/g, '');
}

/** 本地日期 YYYY-MM-DD（采购日期等字段用） */
export function todayDate() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * 生成单据编号：prefix + YYYYMMDD + 3 位流水（当日递增、唯一）。
 * @param {string} table 单据表名
 * @param {string} column 单据号列名
 * @param {string} prefix 类型前缀，如 LL(领用) / CG(采购) / CZ(处置)
 */
export function nextDocNo(table, column, prefix) {
  const ymd = todayYmd();
  const like = `${prefix}${ymd}%`;
  const { n } = db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ? AND deleted_at IS NULL`
  ).get(like);
  return `${prefix}${ymd}${String(n + 1).padStart(3, '0')}`;
}

/**
 * 生成材料编号：CL + 到货日期(YYYYMMDD) + 类别两位 + 当日四位流水。
 * @param {string} categoryCode 两位类别码（material_categories.code）
 * @param {string} [arriveDate] 到货日期 YYYYMMDD（缺省用今日）
 */
export function nextMaterialCode(categoryCode, arriveDate) {
  const ymd = arriveDate || todayYmd();
  const cat = String(categoryCode || '00').padStart(2, '0');
  const like = `CL${ymd}${cat}%`;
  const { n } = db.prepare(
    `SELECT COUNT(*) AS n FROM materials WHERE material_code LIKE ? AND deleted_at IS NULL`
  ).get(like);
  return `CL${ymd}${cat}${String(n + 1).padStart(4, '0')}`;
}

// 材料状态机（开发计划 T5 流转：在库→领用/回收/处置）
export const MATERIAL_STATUS_TRANSITIONS = {
  in_stock: ['issued', 'recycled', 'disposed'],
  issued: ['recycled', 'disposed'],
  recycled: ['disposed'],
  disposed: []
};

/** 校验材料状态正向流转是否合法；返回 { ok, reason } */
export function canTransitionMaterial(from, to) {
  if (from === to) return { ok: true };
  const allowed = MATERIAL_STATUS_TRANSITIONS[from] || [];
  if (allowed.includes(to)) return { ok: true };
  return { ok: false, reason: `材料状态不可从「${from}」流转到「${to}」` };
}

// 收支分类种子（空库一次性预置；T1 起可在界面维护）
export function ensureFinanceCategoriesSeed() {
  const { n } = db.prepare(
    `SELECT COUNT(*) AS n FROM finance_categories WHERE deleted_at IS NULL`
  ).get();
  if (n > 0) return;
  const insert = db.prepare(
    `INSERT INTO finance_categories (name, type, sort_order) VALUES (?, ?, ?)`
  );
  for (const [name, type, order] of [
    ['采购支出', 'expense', 1],
    ['处置收入', 'income', 2],
    ['回收残值', 'income', 3]
  ]) {
    insert.run(name, type, order);
  }
}
