import type { AccountingPerm, AccountingSummaryType, ReportType } from '@/types'
import { pad2 } from './format'

/** 当前月份 YYYY-MM（账单月份口径） */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
}

/** 上月 YYYY-MM */
export function prevMonth(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 月份下拉：本月向前推 count 个月（含本月） */
export function monthOptions(now: Date = new Date(), count = 6): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`)
  }
  return out
}

/**
 * 记账操作权限（记账员/有效代录人）。
 * 来源：/api/auth/me 的 permissions.accounting.operate，后端为唯一权威。
 */
export function canAccountingOperate(perm: AccountingPerm | null | undefined): boolean {
  return !!perm?.operate
}

/**
 * 跨天修改/作废确认、盘点确认、月末解锁权限：科长(3)或副科长(2)。
 * 上级(4/5)只读不确认；记账员(1)只发起不确认（S8S9S10 契约 §2）。
 */
export function canAccountingConfirm(role: number): boolean {
  return role === 2 || role === 3
}

/** 挂账提醒天数阈值（C22：超30天单独提醒） */
export const LEDGER_REMIND_DAYS = 30

/** 挂账天数：今日 - 发生日期（按自然日，忽略时分秒） */
export function ledgerDays(dateStr: string, today: Date = new Date()): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 0
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/** 是否超30天挂账（提醒依据） */
export function isLedgerOverdue(days: number): boolean {
  return days > LEDGER_REMIND_DAYS
}

/** 超计划判定：累计/本期使用 > 计划额（C17/C20：标红不阻断） */
export function isOverPlan(plannedAmount: number, usedAmount: number): boolean {
  return usedAmount > plannedAmount
}

/**
 * 报表下钻明细参数构造（D33：数字与明细同源，前端不二次计算，只透传筛选键）。
 * itemId=按物品下钻；personId=按人员下钻；空=整表明细。
 */
export interface ReportDetailParams {
  month: string
  reportType: ReportType
  itemId?: number
  personId?: number
}

export function buildReportDetailQuery(p: ReportDetailParams): Record<string, number | string> {
  const q: Record<string, number | string> = {}
  if (p.itemId) q.itemId = p.itemId
  if (p.personId) q.personId = p.personId
  return q
}

/** 账目统计区查询参数（GET /api/stats/accounting-summary） */
export function buildAccountingStatsQuery(
  month: string,
  type: AccountingSummaryType
): Record<string, string> {
  return { month, type }
}

/** 金额展示：元保留两位小数 */
export function fmtAmount(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}
