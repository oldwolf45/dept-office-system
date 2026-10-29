import type { WorkStatus } from '@/types'

// ==================== 附件白名单与大小（契约 §2.5 / PRD 第11节已确认项8） ====================

export const ATTACHMENT_EXT_WHITELIST = [
  'doc',
  'docx',
  'xls',
  'xlsx',
  'pdf',
  'jpg',
  'png',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'mov'
] as const

export const MAX_ATTACHMENT_SIZE = 200 * 1024 * 1024 // 200MB

export function getFileExt(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

export interface AttachmentCheckResult {
  ok: boolean
  message: string
}

/** 前端预校验：扩展名白名单 + 200MB（服务端仍会二次校验） */
export function validateAttachmentFile(name: string, sizeBytes: number): AttachmentCheckResult {
  const ext = getFileExt(name)
  if (!ext || !(ATTACHMENT_EXT_WHITELIST as readonly string[]).includes(ext)) {
    return {
      ok: false,
      message: `不支持的附件类型 .${ext || '?'}，允许：${ATTACHMENT_EXT_WHITELIST.join('/')}`
    }
  }
  if (sizeBytes > MAX_ATTACHMENT_SIZE) {
    return { ok: false, message: `附件不能超过 200MB（当前 ${(sizeBytes / 1024 / 1024).toFixed(1)}MB）` }
  }
  return { ok: true, message: '' }
}

export type PreviewKind = 'audio' | 'video' | 'image' | 'pdf' | 'download'

/** 按扩展名决定预览方式：audio/video 内联播放、image/pdf 预览、其余下载 */
export function previewKind(name: string): PreviewKind {
  const ext = getFileExt(name)
  if (['mp3', 'wav', 'm4a'].includes(ext)) return 'audio'
  if (['mp4', 'mov'].includes(ext)) return 'video'
  if (['jpg', 'png'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'download'
}

// ==================== 工作状态机（契约 §2.2，唯一权威在后端，前端仅控制按钮渲染） ====================

/** 可取消：仅未开始/进行中；已完成/已改派无取消入口 */
export function canCancelWork(status: WorkStatus): boolean {
  return status === '未开始' || status === '进行中'
}

/** 可追加进度：未开始/进行中；已完成只读，解锁后可补 */
export function canAddProgress(status: WorkStatus, isUnlocked: 0 | 1): boolean {
  if (status === '未开始' || status === '进行中') return true
  return status === '已完成' && isUnlocked === 1
}

/** 可解锁（契约 §2.2 B14）：科长(3)或副科长(2)对【已完成且未解锁】的工作 */
export function canUnlockWork(role: number, status: WorkStatus, isUnlocked: 0 | 1): boolean {
  return (role === 3 || role === 2) && status === '已完成' && isUnlocked === 0
}

/** 可改派：未开始/进行中；已完成/已取消/已改派拒绝 */
export function canTransferWork(status: WorkStatus): boolean {
  return status === '未开始' || status === '进行中'
}

/**
 * 可写标注：有写标注权的角色（副经理5/副总师4/科长3/副科长2）对【下级】工作写；
 * 科员(1)无写标注权；对本人自己负责的工作也不展示写标注框。
 */
export function canWriteAnnotation(role: number, isOwnWork: boolean): boolean {
  return role >= 2 && !isOwnWork
}

/** 标注回复：仅工作负责人，每条最多回复一条（已有回复再由后端拒绝） */
export function canReplyAnnotation(isOwner: boolean, hasReplied: boolean): boolean {
  return isOwner && !hasReplied
}

/** 计划完成时间不能早于开始时间（前端校验） */
export function isDueAfterStart(start: string, due: string): boolean {
  if (!start || !due) return false
  return new Date(due).getTime() >= new Date(start).getTime()
}

/** 停滞阈值范围（契约 §2.7：3-30，默认7） */
export const STALL_DAYS_MIN = 3
export const STALL_DAYS_MAX = 30
export const DEFAULT_STALL_DAYS = 7

export function isStallDaysValid(days: number): boolean {
  return Number.isInteger(days) && days >= STALL_DAYS_MIN && days <= STALL_DAYS_MAX
}

/** 指派时类别强制为"上级安排工作"（契约 §2.3） */
export const ASSIGNED_CATEGORY_LABEL = '上级安排工作'
