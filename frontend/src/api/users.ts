import request from './request'
import type { CreateUserParams, UserListResult } from '@/types'

export interface UserQuery {
  keyword?: string
  page?: number
  pageSize?: number
}

export function getUsers(params: UserQuery = {}): Promise<UserListResult> {
  return request.get<unknown, UserListResult>('/users', { params })
}

export function createUser(data: CreateUserParams): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>('/users', data)
}

export function deactivateUser(id: number): Promise<null> {
  return request.post<unknown, null>(`/users/${id}/deactivate`)
}

export function activateUser(id: number): Promise<null> {
  return request.post<unknown, null>(`/users/${id}/activate`)
}
