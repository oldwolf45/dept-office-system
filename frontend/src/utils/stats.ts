import type { PersonScope } from '@/types'
import { pad2 } from './format'

/** 时间快捷口径：day=今天 / week=本周一至今 / month=本月1日至今 / custom=自定义起止 */
export type TimePreset = 'day' | 'week' | 'month' | 'custom'

/** 页面筛选区状态（组件绑定用） */
export interface StatsFilters {
  preset: TimePreset
  /** preset=custom 时生效，YYYY-MM-DD */
  customStart: string
  customEnd: string
  personScope: PersonScope
  /** subordinates 口径下可选：指定某一下级；空=全部看到底范围 */
  personId: number | ''
  category: string
  status: string
}

/** 发给后端的查询参数（契约 §1） */
export interface WorkStatsQuery {
  startDate?: string
  endDate?: string
  personScope: PersonScope
  personId?: number
  category?: string
  status?: string
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 本周一（周一为一周起点） */
function mondayOf(d: Date): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = res.getDay() // 周日=0
  const diff = day === 0 ? -6 : 1 - day
  res.setDate(res.getDate() + diff)
  return res
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** 按快捷口径换算出起止日期（YYYY-MM-DD）；自定义时直接透传 */
export function resolveDateRange(preset: TimePreset, now: Date = new Date()): {
  startDate?: string
  endDate?: string
} {
  switch (preset) {
    case 'day':
      return { startDate: ymd(now), endDate: ymd(now) }
    case 'week':
      return { startDate: ymd(mondayOf(now)), endDate: ymd(now) }
    case 'month':
      return { startDate: ymd(firstOfMonth(now)), endDate: ymd(now) }
    default:
      return {}
  }
}

/**
 * 构造 /api/stats/work-summary 与 /work-detail 共用的查询参数。
 * 筛选即刷新都走这里，保证图表与下钻明细同源同参（前端不二次计算）。
 */
export function buildWorkStatsQuery(filters: StatsFilters): WorkStatsQuery {
  const q: WorkStatsQuery = { personScope: filters.personScope }

  if (filters.personScope === 'subordinates' && filters.personId !== '') {
    q.personId = filters.personId
  }

  if (filters.category) q.category = filters.category
  if (filters.status) q.status = filters.status

  if (filters.preset === 'custom') {
    if (filters.customStart) q.startDate = filters.customStart
    if (filters.customEnd) q.endDate = filters.customEnd
  } else {
    const range = resolveDateRange(filters.preset)
    q.startDate = range.startDate
    q.endDate = range.endDate
  }
  return q
}

/** 工作状态下拉选项（契约 §2.2 状态机五态；统计含已取消，不含已改派口径由后端定） */
export const WORK_STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '未开始', value: '未开始' },
  { label: '进行中', value: '进行中' },
  { label: '已完成', value: '已完成' },
  { label: '已取消', value: '已取消' }
]

/** 普通科员(role=1)只能统计本人，不开放下级/全科室口径（契约 §1） */
export function canViewSubordinateScope(role: number): boolean {
  return role >= 2
}
