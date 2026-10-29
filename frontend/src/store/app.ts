import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSystemInfo, type SystemInfo } from '@/api/system'
import { APP_NAME } from '@/config'

/** 全局应用级状态：系统名 + 首次建管理员引导开关（全新部署引导模式） */
export const useAppStore = defineStore('app', () => {
  const systemName = ref<string>(APP_NAME)
  const needsBootstrap = ref<boolean>(false)
  const infoLoaded = ref<boolean>(false)

  /** 拉取公开系统信息；后端未就绪时保留构建兜底，不阻塞页面 */
  async function loadSystemInfo(force = false): Promise<void> {
    if (infoLoaded.value && !force) return
    try {
      const info: SystemInfo = await getSystemInfo()
      systemName.value = info.system_name || APP_NAME
      needsBootstrap.value = !!info.needsBootstrap
      infoLoaded.value = true
      document.title = systemName.value
    } catch {
      // 拦截器已提示；未就绪时保持兜底名
    }
  }

  /** 建管理员成功后：关闭引导开关，恢复正常登录流程 */
  function markBootstrapDone(): void {
    needsBootstrap.value = false
  }

  return { systemName, needsBootstrap, infoLoaded, loadSystemInfo, markBootstrapDone }
})
