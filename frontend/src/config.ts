/**
 * 系统名单一来源。
 * 运行时显示优先级：后端 settings.system_name（登录后 / 未登录均经 GET /api/system/info）
 * > 构建注入 VITE_APP_NAME > 默认值。
 */
export const DEFAULT_APP_NAME = '科室协同办公系统'

export const APP_NAME: string =
  (import.meta.env.VITE_APP_NAME as string | undefined) || DEFAULT_APP_NAME
