import { onMounted, ref } from 'vue'
import { getMaterialsMe } from '@/api/materials'
import type { MaterialsMeResult, MaterialModuleRole } from '@/types/materials'

// 材料模块角色态（T10 按钮级权限前端侧）：后端仍按角色拒绝，前端仅做不渲染。
export function useMaterialsAccess() {
  const me = ref<MaterialsMeResult | null>(null)
  const roles = ref<MaterialModuleRole[]>([])
  const loading = ref(true)

  async function load(): Promise<void> {
    try {
      me.value = await getMaterialsMe()
      roles.value = me.value.roles.map((r) => r.role)
    } catch {
      me.value = null
      roles.value = []
    } finally {
      loading.value = false
    }
  }

  function hasRole(...rs: MaterialModuleRole[]): boolean {
    return rs.some((r) => roles.value.includes(r))
  }

  onMounted(load)

  return { me, roles, loading, hasRole, reload: load }
}
