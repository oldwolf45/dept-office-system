import request from './request'

export interface StallDaysResult {
  days: number
}

/** 停滞阈值（契约 §2.7，登录可读） */
export function getStallDays(): Promise<StallDaysResult> {
  return request.get<unknown, StallDaysResult>('/settings/stall-days')
}

/** 保存阈值（仅科长，3-30） */
export function saveStallDays(days: number): Promise<null> {
  return request.put<unknown, null>('/settings/stall-days', { days })
}
