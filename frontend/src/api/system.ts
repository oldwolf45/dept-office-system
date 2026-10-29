import request from './request'

/** GET /api/system/info（公开免登录，契约 §1.3/§2.1） */
export interface SystemInfo {
  system_name: string
  version?: string
  needsBootstrap: boolean
}

export function getSystemInfo(): Promise<SystemInfo> {
  return request.get<unknown, SystemInfo>('/system/info')
}

/** POST /api/bootstrap/admin（仅发行模式且用户数=0，契约 §1.2） */
export function postBootstrapAdmin(data: { name: string; password: string }): Promise<null> {
  return request.post<unknown, null>('/bootstrap/admin', data)
}
