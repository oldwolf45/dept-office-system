import axios from 'axios'
import request from './request'
import type { MonthlyReportMeta, ReportDetailRow, ReportTableData, ReportType } from '@/types'

/** GET /api/reports?month= 月报元信息（含只读锁 C24、汇总说明 D34） */
export function getReportMeta(month: string): Promise<MonthlyReportMeta> {
  return request.get<unknown, MonthlyReportMeta>('/reports', { params: { month } })
}

/** GET /api/reports/:month/:type 四张表之一（数字与明细同源 D33） */
export function getReportTable(month: string, type: ReportType): Promise<ReportTableData> {
  return request.get<unknown, ReportTableData>(`/reports/${month}/${type}`)
}

/** GET /api/reports/:month/:type/detail 下钻明细（同源聚合） */
export function getReportDetail(
  month: string,
  type: ReportType,
  params: Record<string, number | string> = {}
): Promise<ReportDetailRow[]> {
  return request.get<unknown, ReportDetailRow[]>(`/reports/${month}/${type}/detail`, { params })
}

/** 手动触发生成上月报表（幂等） */
export function generateMonth(month: string): Promise<MonthlyReportMeta> {
  return request.post<unknown, MonthlyReportMeta>('/reports/generate-month', { month })
}

/** 基于当期数据生成汇总说明初稿（D34） */
export function generateSummary(month: string): Promise<{ summaryText: string }> {
  return request.post<unknown, { summaryText: string }>(`/reports/${month}/generate-summary`)
}

/** 保存人工修改后的汇总说明（随报表存档，进经验库样例候选） */
export function saveSummary(month: string, summaryText: string): Promise<MonthlyReportMeta> {
  return request.post<unknown, MonthlyReportMeta>(`/reports/${month}/save-summary`, {
    summaryText
  })
}

/** 科长解锁月末只读锁（留痕，C24） */
export function unlockReport(month: string): Promise<MonthlyReportMeta> {
  return request.post<unknown, MonthlyReportMeta>(`/reports/${month}/unlock`)
}

/**
 * 导出 Excel：GET /api/reports/:month/export（blob 下载）。
 * 导出走原始 axios：响应体是文件流而非 {code,data}，绕过统一解包拦截器。
 */
export async function exportReport(month: string): Promise<Blob> {
  const token = localStorage.getItem('token') || ''
  const res = await axios.get(`/api/reports/${month}/export`, {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  return res.data as Blob
}

/** 触发浏览器下载（前端不落盘） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}
