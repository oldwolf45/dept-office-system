import type {
  SummaryArchiveStatus,
  SummaryContentType,
  SummaryVersionType,
  ValidationResult
} from '@/types'

/** 状态 → 中文标签（契约 §2.1：draft/final/rejected） */
export const SUMMARY_STATUS_LABELS: Record<SummaryArchiveStatus, string> = {
  draft: '草稿',
  final: '已定稿',
  rejected: '不采用'
}

/** 状态 → el-tag 类型 */
export const SUMMARY_STATUS_TAG_TYPE: Record<
  SummaryArchiveStatus,
  'info' | 'success' | 'danger'
> = {
  draft: 'info',
  final: 'success',
  rejected: 'danger'
}

/** 版本类型标签（初稿/修改稿/模板稿）；模板稿额外打标记（E36） */
export const VERSION_TYPE_LABELS: Record<string, string> = {
  '初稿': '初稿',
  '修改稿': '修改稿',
  '模板稿': '模板稿'
}

export function versionTypeLabel(v: string): string {
  return VERSION_TYPE_LABELS[v] || v || '-'
}

/** 内容类型中文（work/accounting/both） */
export const CONTENT_TYPE_LABELS: Record<SummaryContentType, string> = {
  work: '工作',
  accounting: '记账',
  both: '工作+记账'
}

export function contentTypeLabel(t: string): string {
  return CONTENT_TYPE_LABELS[t as SummaryContentType] || t
}

/**
 * 定稿按钮是否可用（E35）：
 * validation 里有未处理 mismatch → 禁用；后端 finalize 会二次校验。
 */
export function canFinalize(validation: ValidationResult | null | undefined): boolean {
  if (!validation) return true
  return !validation.mismatches || validation.mismatches.length === 0
}

/** mismatch 数量文案 */
export function mismatchCount(validation: ValidationResult | null | undefined): number {
  return validation?.mismatches?.length ?? 0
}

/**
 * snapshot/validation/referencedSamples/modelInfo 在存档行里是 JSON 文本，
 * 生成结果接口里可能已是对象；统一归一，解析失败给安全默认值。
 */
export function parseJsonField<T>(raw: string | T | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback
  if (typeof raw !== 'string') return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 字数展示：后端 wordCount 为准 */
export function wordCountLabel(n: number | undefined): string {
  if (!Number.isFinite(n) || (n as number) <= 0) return '0 字'
  return `${n} 字`
}
