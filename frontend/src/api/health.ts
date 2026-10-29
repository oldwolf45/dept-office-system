import request from './request'

export interface HealthStatus {
  status: string
  uptime: number
}

export function getHealth(): Promise<HealthStatus> {
  return request.get<unknown, HealthStatus>('/health')
}
