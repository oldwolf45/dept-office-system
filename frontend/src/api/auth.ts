import request from './request'
import type { ChangePasswordParams, LoginParams, LoginResult, MeResult } from '@/types'

export function loginApi(data: LoginParams): Promise<LoginResult> {
  return request.post<unknown, LoginResult>('/auth/login', data)
}

export function changePasswordApi(data: ChangePasswordParams): Promise<null> {
  return request.post<unknown, null>('/auth/change-password', data)
}

export function getMe(): Promise<MeResult> {
  return request.get<unknown, MeResult>('/auth/me')
}

export function logoutApi(): Promise<null> {
  return request.post<unknown, null>('/auth/logout')
}
