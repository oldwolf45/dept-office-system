import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/store/user'
import { useAppStore } from '@/store/app'
import { resolveBootstrapRedirect } from '@/utils/bootstrap'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/login/LoginView.vue')
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('@/views/login/ChangePasswordView.vue')
    },
    {
      path: '/403',
      name: 'forbidden',
      component: () => import('@/views/error/NoPermissionView.vue')
    },
    {
      // 发行模式首次启动建管理员引导（契约 §2.2，登录前置公开页）
      path: '/bootstrap',
      name: 'bootstrap',
      component: () => import('@/views/bootstrap/BootstrapView.vue')
    },
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/dashboard/DashboardView.vue'),
          meta: { menu: 'dashboard' }
        },
        {
          path: 'work',
          name: 'work',
          component: () => import('@/views/work/WorkView.vue'),
          meta: { menu: 'work' }
        },
        {
          path: 'work/subordinates',
          name: 'work-subordinates',
          component: () => import('@/views/work/SubordinateWorkView.vue'),
          meta: { menu: 'work' }
        },
        {
          path: 'work/:id',
          name: 'work-detail',
          component: () => import('@/views/work/WorkDetailView.vue'),
          meta: { menu: 'work' }
        },
        {
          path: 'personnel',
          name: 'personnel',
          component: () => import('@/views/personnel/PersonnelView.vue'),
          meta: { menu: 'personnel' }
        },
        {
          path: 'accounting',
          name: 'accounting',
          component: () => import('@/views/accounting/AccountingView.vue'),
          meta: { menu: 'accounting', accountAccess: true }
        },
        {
          path: 'my-items',
          name: 'my-items',
          component: () => import('@/views/accounting/MyItemsView.vue'),
          meta: { menu: 'my-items' }
        },
        {
          path: 'reports',
          name: 'reports',
          component: () => import('@/views/reports/ReportView.vue'),
          meta: { menu: 'reports', accountAccess: true }
        },
        {
          path: 'stats',
          name: 'stats',
          component: () => import('@/views/stats/StatsView.vue'),
          meta: { menu: 'stats' }
        },
        {
          path: 'summary',
          name: 'summary',
          component: () => import('@/views/summary/SummaryView.vue'),
          meta: { menu: 'summary' }
        },
        {
          path: 'experience',
          name: 'experience',
          component: () => import('@/views/experience/ExperienceView.vue'),
          meta: { menu: 'experience' }
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/settings/SettingsView.vue'),
          meta: { menu: 'settings' }
        },
        { path: '', redirect: '/dashboard' }
      ]
    }
  ]
})

router.beforeEach(async (to) => {
  const userStore = useUserStore()
  const appStore = useAppStore()
  const hasToken = !!localStorage.getItem('token')

  // 系统信息（系统名/引导开关）首次进入时拉取，失败保留兜底不阻塞
  if (!appStore.infoLoaded) {
    await appStore.loadSystemInfo()
  }
  // 发行模式首次启动（0 用户）：放行引导页，其余一律导向引导页（契约 §2.2）
  const bootstrapRedirect = resolveBootstrapRedirect(appStore.needsBootstrap, to.path)
  if (bootstrapRedirect) return bootstrapRedirect

  // 已登录访问登录页：按改密标记分流
  if (to.path === '/login') {
    if (!hasToken) return true
    try {
      if (!userStore.userInfo) await userStore.fetchMe()
    } catch {
      userStore.logout()
      return '/login'
    }
    return userStore.mustChangePassword ? '/change-password' : '/dashboard'
  }

  // 无 token 一律去登录页（含 /403、业务页）
  if (!hasToken) return '/login'

  // 有 token 但权限集未加载（刷新后），先拉 /me
  if (!userStore.userInfo) {
    try {
      await userStore.fetchMe()
    } catch {
      userStore.logout()
      return '/login'
    }
  }

  // 首次强制改密：业务路由全拦，改密页放行
  if (to.path === '/change-password') {
    return userStore.mustChangePassword ? true : '/dashboard'
  }
  if (userStore.mustChangePassword) {
    return '/change-password'
  }

  // 菜单权限：无权限菜单直接访问地址 → 统一无权限页，不泄露业务数据
  if (to.meta.menu && !userStore.checkMenu(to.meta.menu as string)) {
    return '/403'
  }
  // 账目权限：无账目查看权限者即使手输 /accounting 也拦截（契约 2.3）
  if (to.meta.accountAccess && !userStore.hasAccountView()) {
    return '/403'
  }
  return true
})

export default router
