export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDate(input: Date | string | number): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function formatDateTime(input: Date | string | number): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 金额：分（number）转元（字符串，保留两位小数） */
export function formatMoney(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '0.00'
  }
  return (cents / 100).toFixed(2)
}

/** 字节 → 可读大小（B/KB/MB/GB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

/** SHA-256 截断展示（前12 + … + 后6） */
export function shortSha256(sha: string): string {
  if (!sha) return '-'
  if (sha.length <= 24) return sha
  return `${sha.slice(0, 12)}…${sha.slice(-6)}`
}
