import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { changePasswordApi, getMe, loginApi } from '@/api/auth'
import type { AuthUser, ChangePasswordParams, LoginParams, MeResult, Permissions } from '@/types'
import { hasButton, hasMenu } from '@/utils/permission'

const TOKEN_KEY = 'token'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) || '')
  const userInfo = ref<AuthUser | null>(null)
  const permissions = ref<Permissions | null>(null)
  const mustChangePassword = ref<boolean>(false)

  const menus = computed<string[]>(() => permissions.value?.menus ?? [])
  const buttons = computed<string[]>(() => permissions.value?.buttons ?? [])

  function setToken(t: string): void {
    token.value = t
    localStorage.setItem(TOKEN_KEY, t)
  }

  function applyMe(me: MeResult): void {
    userInfo.value = me.user
    permissions.value = me.permissions
    mustChangePassword.value = !!me.user.mustChangePassword
  }

  async function login(params: LoginParams): Promise<void> {
    const res = await loginApi(params)
    setToken(res.token)
    userInfo.value = res.user
    mustChangePassword.value = !!res.mustChangePassword
    // 登录成功后拉取权限集（菜单/按钮/账目权限）
    const me = await getMe()
    applyMe(me)
  }

  async function fetchMe(): Promise<void> {
    const me = await getMe()
    applyMe(me)
  }

  async function changePassword(params: ChangePasswordParams): Promise<void> {
    await changePasswordApi(params)
    mustChangePassword.value = false
  }

  function checkMenu(menu: string): boolean {
    return hasMenu(menus.value, menu)
  }

  function checkButton(code: string): boolean {
    return hasButton(buttons.value, code)
  }

  function hasAccountView(): boolean {
    return !!permissions.value?.accounting?.view
  }

  /** 记账操作权限（记账员/有效代录人） */
  function hasAccountOperate(): boolean {
    return !!permissions.value?.accounting?.operate
  }

  /** 跨天确认/盘点确认/月末解锁：科长(3)或副科长(2) */
  function hasAccountConfirm(): boolean {
    const u = userInfo.value
    return !!u && (u.role === 2 || u.role === 3)
  }

  function logout(): void {
    token.value = ''
    userInfo.value = null
    permissions.value = null
    mustChangePassword.value = false
    localStorage.removeItem(TOKEN_KEY)
  }

  return {
    token,
    userInfo,
    permissions,
    mustChangePassword,
    menus,
    buttons,
    setToken,
    applyMe,
    login,
    fetchMe,
    changePassword,
    checkMenu,
    checkButton,
    hasAccountView,
    hasAccountOperate,
    hasAccountConfirm,
    logout
  }
})
