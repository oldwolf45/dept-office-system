import request from './request'
import type { CreateDictParams, DictItem, DictType, UpdateDictParams } from '@/types'

/** 供下拉：仅 active（登录即可调，契约 §1） */
export async function getActiveDicts(type: DictType | string): Promise<DictItem[]> {
  const res = await request.get<unknown, DictItem[] | { list: DictItem[] }>('/dicts', {
    params: { type }
  })
  return Array.isArray(res) ? res : res.list
}

/** 管理列表：含停用（仅科长） */
export async function getManageDicts(type?: DictType | string): Promise<DictItem[]> {
  const res = await request.get<unknown, DictItem[] | { list: DictItem[] }>('/dicts/manage', {
    params: type ? { type } : {}
  })
  return Array.isArray(res) ? res : res.list
}

export function createDict(data: CreateDictParams): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>('/dicts', data)
}

export function updateDict(id: number, data: UpdateDictParams): Promise<null> {
  return request.put<unknown, null>(`/dicts/${id}`, data)
}

export function disableDict(id: number): Promise<null> {
  return request.post<unknown, null>(`/dicts/${id}/disable`)
}

export function enableDict(id: number): Promise<null> {
  return request.post<unknown, null>(`/dicts/${id}/enable`)
}
