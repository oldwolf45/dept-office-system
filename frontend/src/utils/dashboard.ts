import type { DashboardTodoType, NoticeType } from '@/types'

/**
 * 首页角色矩阵（S11 契约 §1.6，PRD 3.3）——前端渲染唯一依据，后端接口兜底。
 * role: 1 科员 / 2 副科长 / 3 科长 / 4 副总师 / 5 公司副经理。
 * 注意：记账员 role=1（is_bookkeeper=1），仍是"科员"层级。
 */

/** 是否有下级（副科长及以上；科员/记账员不渲染下级动态） */
export function hasSubordinates(role: number): boolean {
  return role >= 2
}

/**
 * 待办类型可见性（契约 §1.1 表）：
 * - pendingApprovals：科长(3)/副科长(2)
 * - delegationExpiring：仅科长(3)
 * - backupFailure：仅科长(3)
 * - stalled：有下级的角色（role>=2）
 * - 其余（assignedNew/dueToday/overdue/annotationsUnreplied）：全员
 */
export function todoTypeVisible(type: DashboardTodoType, role: number): boolean {
  switch (type) {
    case 'pendingApprovals':
      return role === 2 || role === 3
    case 'delegationExpiring':
      return role === 3
    case 'backupFailure':
      return role === 3
    case 'stalled':
      return role >= 2
    default:
      return true
  }
}

/** 全部待办类型（契约 §1.1 八类，按展示顺序） */
export const ALL_TODO_TYPES: DashboardTodoType[] = [
  'assignedNew',
  'dueToday',
  'overdue',
  'annotationsUnreplied',
  'pendingApprovals',
  'delegationExpiring',
  'stalled',
  'backupFailure'
]

/** 某角色可见的待办类型列表 */
export function visibleTodoTypes(role: number): DashboardTodoType[] {
  return ALL_TODO_TYPES.filter((t) => todoTypeVisible(t, role))
}

/** 待办类型 → 中文名 */
export const TODO_TYPE_LABELS: Record<DashboardTodoType, string> = {
  assignedNew: '被指派未推进',
  dueToday: '今日到期',
  overdue: '已逾期',
  annotationsUnreplied: '标注待回复',
  pendingApprovals: '待确认账目',
  delegationExpiring: '代录授权临期',
  stalled: '停滞工作',
  backupFailure: '自动备份失败'
}

/** 待办类型 → 标签颜色 */
export const TODO_TYPE_TAG: Record<DashboardTodoType, 'primary' | 'warning' | 'danger' | 'success' | 'info'> = {
  assignedNew: 'primary',
  dueToday: 'warning',
  overdue: 'danger',
  annotationsUnreplied: 'warning',
  pendingApprovals: 'warning',
  delegationExpiring: 'danger',
  stalled: 'danger',
  backupFailure: 'danger'
}

/** 未读类型映射（契约 §1.1：标注/被指派/账目确认为未读类型） */
export const TODO_TYPE_TO_NOTICE: Partial<Record<DashboardTodoType, NoticeType>> = {
  annotationsUnreplied: 'annotation',
  assignedNew: 'assigned',
  pendingApprovals: 'approval'
}

/** 待办点击去向（契约 §1.1 表） */
export type TodoTarget = 'workDetail' | 'accountingApprovals' | 'personnelDelegation' | 'settingsBackup'

export function todoTargetOf(type: DashboardTodoType): TodoTarget {
  switch (type) {
    case 'pendingApprovals':
      return 'accountingApprovals'
    case 'delegationExpiring':
      return 'personnelDelegation'
    case 'backupFailure':
      return 'settingsBackup'
    default:
      return 'workDetail'
  }
}

/** 恢复向导二次确认必须输入的字面量（契约 §2.2） */
export const RESTORE_OVERWRITE_LITERAL = '覆盖当前数据'

/** 校验恢复确认参数：overwrite 必须为字面量，否则拒绝 */
export function buildRestoreConfirm(previewToken: string, overwrite: string): {
  previewToken: string
  overwrite: string
} | null {
  if (!previewToken || overwrite !== RESTORE_OVERWRITE_LITERAL) return null
  return { previewToken, overwrite: RESTORE_OVERWRITE_LITERAL }
}

/** 备份记录状态展示映射 */
export function backupStatusLabel(status: 'success' | 'failed' | string): string {
  return status === 'success' ? '成功' : '失败'
}

export function backupTypeLabel(type: 'manual' | 'auto' | string): string {
  return type === 'manual' ? '手动' : '自动'
}

/** 下级动态三组的展示名 */
export const SUBORDINATE_GROUP_LABELS = {
  newProgress: '近7天新增进度',
  assigned: '近7天新指派',
  overdue: '下级逾期工作'
} as const
