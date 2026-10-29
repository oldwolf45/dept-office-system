import type { Directive } from 'vue'
import { useUserStore } from '@/store/user'

/**
 * v-permission="'export'" —— 按钮级权限指令（契约 2.4）。
 * 无权限码时直接从 DOM 移除元素（不只是灰掉）。
 */
export const permission: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const userStore = useUserStore()
    if (!userStore.checkButton(binding.value)) {
      el.parentNode?.removeChild(el)
    }
  }
}
