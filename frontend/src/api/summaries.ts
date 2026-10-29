import axios from 'axios'
import request from './request'
import type {
  GenerateSummaryResult,
  PersonScope,
  SummaryArchive,
  SummaryContentType,
  SummaryListResult
} from '@/types'

/** 生成总结入参（契约 §2.2-1） */
export interface GenerateSummaryParams {
  personScope: PersonScope
  startTime: string
  endTime: string
  contentType: SummaryContentType
}

/** 生成调用走大模型，最长 30s 超时，单独放宽 timeout */
export function generateSummary(
  data: GenerateSummaryParams
): Promise<GenerateSummaryResult> {
  return request.post<unknown, GenerateSummaryResult>('/summaries/generate', data, {
    timeout: 60000
  })
}

/** 人工修改保存 → 生成新版本（修改稿） */
export function saveSummary(id: number, content: string): Promise<SummaryArchive> {
  return request.post<unknown, SummaryArchive>(`/summaries/${id}/save`, { content })
}

/** 定稿（后端对 mismatch 二次校验，4000 拒绝） */
export function finalizeSummary(id: number): Promise<SummaryArchive> {
  return request.post<unknown, SummaryArchive>(`/summaries/${id}/finalize`)
}

/** 标记不采用（留痕，仍可查看导出） */
export function rejectSummary(id: number): Promise<SummaryArchive> {
  return request.post<unknown, SummaryArchive>(`/summaries/${id}/reject`)
}

/** 标记优选样例（仅科长） */
export function preferSummary(id: number): Promise<SummaryArchive> {
  return request.post<unknown, SummaryArchive>(`/summaries/${id}/prefer`)
}

/** 启用/停用样例（仅科长，停用后不再被检索引用） */
export function toggleSample(id: number): Promise<SummaryArchive> {
  return request.post<unknown, SummaryArchive>(`/summaries/${id}/toggle-sample`)
}

export interface SummaryListQuery {
  groupKey?: string
  status?: string
  page?: number
  pageSize?: number
}

export async function getSummaries(params: SummaryListQuery = {}): Promise<SummaryListResult> {
  const res = await request.get<unknown, SummaryListResult | SummaryArchive[]>('/summaries', {
    params
  })
  if (Array.isArray(res)) {
    return { list: res, total: res.length }
  }
  return res
}

export function getSummaryDetail(id: number): Promise<SummaryArchive> {
  return request.get<unknown, SummaryArchive>(`/summaries/${id}`)
}

/** 文件下载走 blob（主拦截器按 {code,data} JSON 约定会误判），与附件下载同模式 */
const blobRequest = axios.create({ baseURL: '/api', timeout: 120000 })
blobRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function triggerDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function exportSummaryWord(id: number): Promise<void> {
  const res = await blobRequest.get(`/summaries/${id}/export-word`, {
    responseType: 'blob'
  })
  triggerDownload(res.data as Blob, `总结-${id}.docx`)
}

export async function exportSummaryPptx(id: number): Promise<void> {
  const res = await blobRequest.get(`/summaries/${id}/export-pptx`, {
    responseType: 'blob'
  })
  triggerDownload(res.data as Blob, `总结-${id}.pptx`)
}
