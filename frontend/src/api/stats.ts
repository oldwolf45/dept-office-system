import request from './request'
import type {
  AccountingSummaryResult,
  AccountingSummaryType,
  PersonScope,
  StatsWorkDetailItem,
  StatsWorkDetailResult,
  WorkSummaryStats
} from '@/types'

/** 统计筛选查询参数（契约 §1）：category/status 可空=不过滤 */
export interface WorkSummaryQuery {
  startDate?: string
  endDate?: string
  personScope: PersonScope
  personId?: number
  category?: string
  status?: string
}

export function getWorkSummary(params: WorkSummaryQuery): Promise<WorkSummaryStats> {
  return request.get<unknown, WorkSummaryStats>('/stats/work-summary', { params })
}

export interface WorkDetailQuery extends WorkSummaryQuery {
  page?: number
  pageSize?: number
}

export async function getWorkDetail(
  params: WorkDetailQuery
): Promise<StatsWorkDetailResult> {
  const res = await request.get<
    unknown,
    StatsWorkDetailResult | { list: StatsWorkDetailItem[]; total: number }
  >('/stats/work-detail', { params })
  // 兜底：后端若直接返回数组，包装成分页结构
  if (Array.isArray(res)) {
    return { list: res, total: res.length }
  }
  return res
}

/** GET /api/stats/accounting-summary 账目类统计（§6：物料趋势/资金执行率/挂账账龄，科员 4030） */
export function getAccountingSummary(
  month: string,
  type: AccountingSummaryType
): Promise<AccountingSummaryResult> {
  return request.get<unknown, AccountingSummaryResult>('/stats/accounting-summary', {
    params: { month, type }
  })
}
