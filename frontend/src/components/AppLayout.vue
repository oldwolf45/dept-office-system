<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { useAppStore } from '@/store/app'
import { roleLabel } from '@/utils/permission'
import { bottomNavItems } from '@/utils/mobile'

interface MenuItem {
  code: string
  path: string
  label: string
}

const MENU_REGISTRY: MenuItem[] = [
  { code: 'dashboard', path: '/dashboard', label: '工作台' },
  { code: 'work', path: '/work', label: '我的工作' },
  { code: 'my-items', path: '/my-items', label: '我的物品' },
  { code: 'personnel', path: '/personnel', label: '人员管理' },
  { code: 'accounting', path: '/accounting', label: '科室记账' },
  { code: 'reports', path: '/reports', label: '月度报表' },
  { code: 'stats', path: '/stats', label: '汇总统计' },
  { code: 'summary', path: '/summary', label: '总结与PPT' },
  { code: 'experience', path: '/experience', label: '汇总经验库' },
  { code: 'settings', path: '/settings', label: '系统设置' }
]

const userStore = useUserStore()
const appStore = useAppStore()
const route = useRoute()
const router = useRouter()

// 只渲染 /api/auth/me 返回权限集内的菜单
const menus = computed<MenuItem[]>(() =>
  MENU_REGISTRY.filter((m) => userStore.menus.includes(m.code))
)
// 手机端底部导航：固定子集按 menus 过滤，与桌面菜单同源（契约 §1.1/§1.3）
const bottomNav = computed(() => bottomNavItems(userStore.menus))
// 工作详情页属于"我的工作"菜单组，高亮时归并到 /work
const activeMenu = computed<string>(() =>
  route.path.startsWith('/work') ? '/work' : route.path
)
const activeNav = computed<string>(() => route.path)

const userLabel = computed(() => {
  const u = userStore.userInfo
  if (!u) return ''
  return `${u.name}（${u.userNo} · ${roleLabel(u.role)}）`
})

function handleSelect(path: string): void {
  router.push(path)
}

function handleChangePassword(): void {
  router.push('/settings')
}

function handleLogout(): void {
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="min-h-screen">
    <!-- 桌面侧边栏（≥md） -->
    <el-aside width="200px" class="bg-[#304156] hidden md:block">
      <div class="h-14 flex items-center justify-center text-white font-bold">{{ appStore.systemName }}</div>
      <el-menu :default-active="activeMenu" class="bg-[#304156] border-0" text-color="#bfcbd9"
        active-text-color="#409eff" @select="handleSelect">
        <el-menu-item v-for="m in menus" :key="m.code" :index="m.path">
          {{ m.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <!-- 桌面顶栏（≥md） -->
      <el-header class="flex items-center justify-end bg-white border-b hidden md:flex">
        <span class="mr-4 text-gray-600">{{ userLabel }}</span>
        <el-button link @click="handleChangePassword">修改密码</el-button>
        <el-button link type="danger" @click="handleLogout">退出登录</el-button>
      </el-header>

      <!-- 手机顶部精简栏（<md）：系统名+用户+退出 -->
      <div class="md:hidden sticky top-0 z-10 bg-white border-b px-3 h-12 flex items-center justify-between">
        <span class="font-bold">{{ appStore.systemName }}</span>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-600 max-w-[120px] truncate">{{ userLabel }}</span>
          <el-button link type="danger" size="small" @click="handleLogout">退出</el-button>
        </div>
      </div>

      <!-- 页面内容：手机端留底部导航高度 -->
      <el-main class="bg-gray-50 pb-20 md:pb-0">
        <router-view />
      </el-main>
    </el-container>

    <!-- 手机底部导航（<md 固定底部，按权限过滤） -->
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-white border-t flex h-16">
      <button
        v-for="item in bottomNav"
        :key="item.code"
        class="flex-1 flex flex-col items-center justify-center text-xs"
        :class="activeNav.startsWith(item.path === '/dashboard' ? '/dashboard' : item.path) ? 'text-blue-600 font-bold' : 'text-gray-500'"
        @click="handleSelect(item.path)"
      >
        <span class="text-lg leading-none">{{ item.icon }}</span>
        <span class="mt-1">{{ item.label }}</span>
      </button>
    </nav>
  </el-container>
</template>
