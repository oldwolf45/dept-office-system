import request from './request'
import type {
  DashboardAccounting,
  DashboardSummary,
  DashboardTodoItem,
  NoticeType,
  SubordinateActivity
} from '@/types'

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request.get<unknown, DashboardSummary>('/dashboard/summary')
}

export async function getDashboardTodo(): Promise<DashboardTodoItem[]> {
  const res = await request.get<unknown, DashboardTodoItem[] | { list: DashboardTodoItem[] }>(
    '/dashboard/todo'
  )
  return Array.isArray(res) ? res : res.list
}

/** GET /api/dashboard/accounting 首页账目概览（F43/F45，科员不渲染） */
export function getDashboardAccounting(): Promise<DashboardAccounting> {
  return request.get<unknown, DashboardAccounting>('/dashboard/accounting')
}

/** GET /api/dashboard/subordinate-activity 下级动态（近7天，有下级的角色；契约 §1.3） */
export function getSubordinateActivity(): Promise<SubordinateActivity> {
  return request.get<unknown, SubordinateActivity>('/dashboard/subordinate-activity')
}

/** POST /api/dashboard/notices/read 标记已读（幂等；契约 §1.1） */
export function markNoticeRead(type: NoticeType, refId: number): Promise<null> {
  return request.post<unknown, null>('/dashboard/notices/read', { type, refId })
}
