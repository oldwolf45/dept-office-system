import request from './request'
import type { LoginLogResult, OperationLogResult } from '@/types'

export interface LogQuery {
  page?: number
  pageSize?: number
  actionType?: string
  status?: string
}

export function getOperationLogs(params: LogQuery = {}): Promise<OperationLogResult> {
  return request.get<unknown, OperationLogResult>('/logs/operations', { params })
}

export function getLoginLogs(params: LogQuery = {}): Promise<LoginLogResult> {
  return request.get<unknown, LoginLogResult>('/logs/login', { params })
}
