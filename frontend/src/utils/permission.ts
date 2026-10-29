/** 角色层级 → 中文名（契约第1节） */
export const ROLE_LABELS: Record<number, string> = {
  1: '科员',
  2: '副科长',
  3: '科长',
  4: '副总师',
  5: '公司副经理'
}

export function roleLabel(role: number): string {
  return ROLE_LABELS[role] || `角色${role}`
}

/** 菜单过滤：只保留权限集内的菜单 */
export function filterMenus(all: string[], allowed: string[]): string[] {
  return all.filter((m) => allowed.includes(m))
}

export function hasMenu(allowed: string[], menu: string): boolean {
  return allowed.includes(menu)
}

/** 按钮级权限判断（契约 2.4：export/delete/generate-summary/mark-sample/backup/dict） */
export function hasButton(buttons: string[], code: string): boolean {
  return buttons.includes(code)
}

/** 代录授权最长 30 天（契约第11节已确认项2） */
export const MAX_DELEGATION_DAYS = 30

export function delegationDurationDays(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return ms / (1000 * 60 * 60 * 24)
}
