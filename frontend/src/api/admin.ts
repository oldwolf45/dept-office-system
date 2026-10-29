import axios from 'axios'
import request from './request'
import type {
  BackupCreateResult,
  BackupRecord,
  RestoreConfirmResult,
  RestorePreview,
  RestoreStatus,
  StorageInfo
} from '@/types'

/** 备份下载 / 恢复上传是 blob/multipart，不经过主拦截器的 {code,data} JSON 约定 */
const blobRequest = axios.create({ baseURL: '/api', timeout: 300000 })
blobRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ---------- S12 备份恢复（契约 §2.2，仅科长） ----------

/** POST /api/admin/backup 手动备份（同步生成 ZIP） */
export function createManualBackup(): Promise<BackupCreateResult> {
  return request.post<unknown, BackupCreateResult>('/admin/backup')
}

/** GET /api/admin/backups 备份记录列表 */
export function getBackups(): Promise<BackupRecord[]> {
  return request.get<unknown, BackupRecord[]>('/admin/backups')
}

/** GET /api/admin/storage 存储卡片（目录占用/磁盘剩余/保留数量/低阈值） */
export function getBackupStorage(): Promise<StorageInfo> {
  return request.get<unknown, StorageInfo>('/admin/storage')
}

/** GET /api/admin/backups/:id/download 下载 ZIP（blob 旁路） */
export async function downloadBackupBlob(id: number): Promise<Blob> {
  const res = await blobRequest.get(`/admin/backups/${id}/download`, { responseType: 'blob' })
  return res.data as Blob
}

/** POST /api/admin/restore/preview 上传 ZIP 校验并返回预览 */
export async function previewRestoreBlob(file: File): Promise<RestorePreview> {
  const form = new FormData()
  form.append('file', file)
  // multipart 走 blob 实例时后端仍返回 JSON，此处手动解包 { code, data }
  const res = await blobRequest.post<{ code: number; data: RestorePreview; message: string }>(
    '/admin/restore/preview',
    form
  )
  if (res.data.code !== 0) throw new Error(res.data.message || '校验失败')
  return res.data.data
}

/** POST /api/admin/restore/confirm { previewToken, overwrite:'覆盖当前数据' } */
export function confirmRestore(previewToken: string, overwrite: string): Promise<RestoreConfirmResult> {
  return request.post<unknown, RestoreConfirmResult>('/admin/restore/confirm', {
    previewToken,
    overwrite
  })
}

/** POST /api/admin/restore/abort 恢复失败回滚 */
export function abortRestore(): Promise<unknown> {
  return request.post<unknown, unknown>('/admin/restore/abort')
}

/** GET /api/admin/restore/status 维护锁状态（恢复期间显示维护提示） */
export function getRestoreStatus(): Promise<RestoreStatus> {
  return request.get<unknown, RestoreStatus>('/admin/restore/status')
}

/** 字典管理占位接口（契约 4.4，S3 实现） */
export function dictManage(): Promise<string> {
  return request.post<unknown, string>('/admin/dicts')
}
