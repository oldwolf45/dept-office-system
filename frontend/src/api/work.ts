import axios from 'axios'
import request from './request'
import type {
  AnnotationItem,
  AttachmentItem,
  AssignableTarget,
  CreateWorkParams,
  UserListItem,
  WorkDetail,
  WorkListResult,
  WorkStatus
} from '@/types'

/** 附件下载/预览需要 blob，主拦截器按 {code,data} JSON 约定会误判，故独立实例 */
const blobRequest = axios.create({ baseURL: '/api', timeout: 120000 })
blobRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export async function downloadAttachmentBlob(id: number): Promise<Blob> {
  const res = await blobRequest.get(`/attachments/${id}`, { responseType: 'blob' })
  return res.data as Blob
}

export interface WorkQuery {
  scope: 'mine' | 'subordinates'
  status?: WorkStatus | ''
  assigneeId?: number
  keyword?: string
  page?: number
  pageSize?: number
  /** 首页概览数字跳转筛选（S11 F40，后端对齐后生效）：本周到期 */
  dueThisWeek?: string
  /** 逾期 */
  overdue?: string
  /** 停滞 */
  stalled?: string
}

export function getWorks(params: WorkQuery): Promise<WorkListResult> {
  return request.get<unknown, WorkListResult>('/works', { params })
}

export function createWork(data: CreateWorkParams): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>('/works', data)
}

export function getWorkDetail(id: number): Promise<WorkDetail> {
  return request.get<unknown, WorkDetail>(`/works/${id}`)
}

export function completeWork(id: number, summary: string): Promise<null> {
  return request.post<unknown, null>(`/works/${id}/complete`, { summary })
}

export function cancelWork(id: number, reason: string): Promise<null> {
  return request.post<unknown, null>(`/works/${id}/cancel`, { reason })
}

export function unlockWork(id: number): Promise<null> {
  return request.post<unknown, null>(`/works/${id}/unlock`)
}

export function addProgress(id: number, content: string): Promise<null> {
  return request.post<unknown, null>(`/works/${id}/progress`, { content })
}

/** multipart 上传附件，progressId 可选绑定具体进度 */
export function uploadAttachment(
  id: number,
  file: File,
  progressId?: number
): Promise<AttachmentItem> {
  const form = new FormData()
  form.append('file', file)
  if (progressId) form.append('progressId', String(progressId))
  return request.post<unknown, AttachmentItem>(`/works/${id}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000
  })
}

export function deleteAttachment(id: number): Promise<null> {
  return request.delete<unknown, null>(`/attachments/${id}`)
}

export function addAnnotation(workId: number, content: string): Promise<AnnotationItem> {
  return request.post<unknown, AnnotationItem>(`/works/${workId}/annotations`, { content })
}

export function replyAnnotation(id: number, content: string): Promise<null> {
  return request.post<unknown, null>(`/annotations/${id}/reply`, { content })
}

export function transferWork(
  workId: number,
  newAssigneeId: number,
  reason: string
): Promise<null> {
  return request.post<unknown, null>(`/works/${workId}/transfer`, { newAssigneeId, reason })
}

/** 可直接安排工作的人员（S2 契约 4.6） */
export function getAssignableUsers(): Promise<AssignableTarget[]> {
  return request.get<unknown, AssignableTarget[]>('/work/assignable-users')
}

/** 本科室 active 人员（协作者选择用，契约 §3） */
export async function getCoworkers(): Promise<UserListItem[]> {
  const res = await request.get<unknown, UserListItem[] | { list: UserListItem[] }>(
    '/users/coworkers'
  )
  return Array.isArray(res) ? res : res.list
}
