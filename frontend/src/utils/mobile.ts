import { onBeforeUnmount, ref } from 'vue'

/**
 * S13 手机端适配工具（契约 §1）。
 * 断点与 Tailwind md(768px) 一致：<768 视为手机视口。
 */

export const MOBILE_BREAKPOINT = 768

/** 纯函数：判断给定宽度是否手机视口（可单测） */
export function isMobileWidth(width: number): boolean {
  return width < MOBILE_BREAKPOINT
}

/** 附件手机端引导上限（PRD 2.3：>50MB 建议电脑端上传；不改后端 200MB 硬上限） */
export const MOBILE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const MOBILE_UPLOAD_HINT = '文件超过50MB，请在电脑端上传'

/**
 * 上传前组合校验（UI 层引导）：
 * - 手机视口 && 超过 50MB → 拦截并提示在电脑端上传
 * - 其余情况放行（白名单/200MB 仍由 validateAttachmentFile 与后端二次校验）
 */
export function checkMobileUpload(isMobile: boolean, sizeBytes: number): { block: boolean; message: string } {
  if (isMobile && sizeBytes > MOBILE_MAX_UPLOAD_BYTES) {
    return { block: true, message: MOBILE_UPLOAD_HINT }
  }
  return { block: false, message: '' }
}

/** 底部导航固定入口（MENU_REGISTRY 子集，契约 §1.1：工作台/我的工作/记账/总结/设置等） */
export interface BottomNavItem {
  code: string
  path: string
  label: string
  icon: string
}

export const BOTTOM_NAV_REGISTRY: BottomNavItem[] = [
  { code: 'dashboard', path: '/dashboard', label: '工作台', icon: '🏠' },
  { code: 'work', path: '/work', label: '我的工作', icon: '📋' },
  { code: 'accounting', path: '/accounting', label: '记账', icon: '💰' },
  { code: 'summary', path: '/summary', label: '总结', icon: '📝' },
  { code: 'settings', path: '/settings', label: '设置', icon: '⚙️' }
]

/** 底部导航按 userStore.menus 过滤，与桌面菜单同源（契约 §1.3） */
export function bottomNavItems(allowedMenus: string[]): BottomNavItem[] {
  return BOTTOM_NAV_REGISTRY.filter((m) => allowedMenus.includes(m.code))
}

/** 响应式视口监听组件内组合式函数 */
export function useIsMobile() {
  const isMobile = ref<boolean>(isMobileWidth(typeof window !== 'undefined' ? window.innerWidth : 0))
  let mql: MediaQueryList | null = null
  const handler = (e: MediaQueryListEvent) => {
    isMobile.value = e.matches
  }
  if (typeof window !== 'undefined') {
    mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    isMobile.value = mql.matches
    mql.addEventListener('change', handler)
  }
  onBeforeUnmount(() => {
    mql?.removeEventListener('change', handler)
  })
  return isMobile
}
