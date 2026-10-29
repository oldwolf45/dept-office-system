/**
 * 首次建管理员引导路由逻辑（全新部署引导模式，纯函数可测）。
 * needsBootstrap=true（发行模式 + 0 用户）时：引导页放行，其余一律去 /bootstrap；
 * needsBootstrap=false 时不干预，走正常登录/业务流程。
 */
export const BOOTSTRAP_ROUTE = '/bootstrap'
export const LOGIN_ROUTE = '/login'

/** 返回需要重定向到的路径；null = 放行当前路由 */
export function resolveBootstrapRedirect(needsBootstrap: boolean, toPath: string): string | null {
  if (!needsBootstrap) return null
  if (toPath === BOOTSTRAP_ROUTE) return null
  // 登录页/业务页全部导向引导页（业务页本应拦到 /login，但引导优先级更高）
  return BOOTSTRAP_ROUTE
}

export const BOOTSTRAP_PASSWORD_MIN = 6

/** 引导表单校验，返回错误信息数组（空=通过） */
export function validateBootstrapInput(input: {
  name: string
  password: string
  confirm: string
}): string[] {
  const errs: string[] = []
  const name = input.name.trim()
  if (!name) errs.push('请输入管理员姓名')
  else if (name.length < 2 || name.length > 20) errs.push('姓名长度需为 2-20 字')
  if (!input.password) errs.push('请输入密码')
  else if (input.password.length < BOOTSTRAP_PASSWORD_MIN)
    errs.push(`密码至少 ${BOOTSTRAP_PASSWORD_MIN} 位`)
  if (!input.confirm) errs.push('请再次输入密码')
  else if (input.confirm !== input.password) errs.push('两次输入的密码不一致')
  return errs
}
