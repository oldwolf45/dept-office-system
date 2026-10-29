<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import type {
  DashboardAccounting,
  DashboardSummary,
  DashboardTodoItem,
  DashboardTodoType,
  SubordinateActivity,
  SubordinateActivityItem
} from '@/types'
import { getDashboardAccounting, getDashboardSummary, getDashboardTodo, getSubordinateActivity, markNoticeRead } from '@/api/dashboard'
import { roleLabel } from '@/utils/permission'
import { formatDateTime } from '@/utils/format'
import { fmtAmount } from '@/utils/accounting'
import {
  ALL_TODO_TYPES,
  hasSubordinates,
  SUBORDINATE_GROUP_LABELS,
  TODO_TYPE_LABELS,
  TODO_TYPE_TAG,
  TODO_TYPE_TO_NOTICE,
  todoTargetOf,
  todoTypeVisible
} from '@/utils/dashboard'

const router = useRouter()
const userStore = useUserStore()

const summary = ref<DashboardSummary | null>(null)
const todos = ref<DashboardTodoItem[]>([])
const accounting = ref<DashboardAccounting | null>(null)
const activity = ref<SubordinateActivity | null>(null)
const loading = ref<boolean>(false)

const user = computed(() => userStore.userInfo)
const role = computed<number>(() => userStore.userInfo?.role ?? 1)
const canAccountingOperate = computed<boolean>(() => userStore.hasAccountOperate())
const showSubordinate = computed<boolean>(() => hasSubordinates(role.value))

async function load(): Promise<void> {
  loading.value = true
  try {
    const tasks: Array<Promise<unknown>> = [getDashboardSummary(), getDashboardTodo()]
    if (userStore.hasAccountView()) tasks.push(getDashboardAccounting())
    if (showSubordinate.value) tasks.push(getSubordinateActivity())
    const res = await Promise.all(tasks)
    summary.value = res[0] as DashboardSummary
    todos.value = (res[1] as DashboardTodoItem[]) || []
    let idx = 2
    if (userStore.hasAccountView()) {
      accounting.value = res[idx] as DashboardAccounting
      idx++
    } else {
      accounting.value = null
    }
    if (showSubordinate.value) {
      activity.value = (res[idx] as SubordinateActivity) || emptyActivity()
    } else {
      activity.value = null
    }
  } catch {
    summary.value = null
    todos.value = []
    accounting.value = null
    activity.value = null
  } finally {
    loading.value = false
  }
}

function emptyActivity(): SubordinateActivity {
  return { newProgress: [], assigned: [], overdue: [] }
}

/** 该角色可见的待办类型（契约 §1.6 矩阵） */
const visibleTypes = computed<DashboardTodoType[]>(() =>
  ALL_TODO_TYPES.filter((t) => todoTypeVisible(t, role.value))
)

/** 按类型分组（后端返回扁平 list + type 字段） */
const groupedTodos = computed<Array<{ type: DashboardTodoType; items: DashboardTodoItem[] }>>(() => {
  return visibleTypes.value
    .map((type) => ({
      type,
      items: todos.value.filter((t) => t.type === type)
    }))
    .filter((g) => g.items.length > 0)
})

function typeCount(type: DashboardTodoType): number {
  return summary.value?.todo?.[type] ?? todos.value.filter((t) => t.type === type).length
}

function typeUnread(type: DashboardTodoType): number {
  const u = summary.value?.unread
  if (!u) return todos.value.filter((t) => t.type === type && t.unread).length
  switch (type) {
    case 'annotationsUnreplied':
      return u.annotation
    case 'assignedNew':
      return u.assigned
    case 'pendingApprovals':
      return u.approval
    default:
      return 0
  }
}

function todoTime(row: DashboardTodoItem): string {
  return row.time ?? row.dueTime ?? row.lastProgressAt ?? ''
}

/** 待办点击：先标记未读类型为已读，再跳对应详情/列表（契约 §1.1/§3.4） */
async function onTodoClick(row: DashboardTodoItem): Promise<void> {
  const noticeType = TODO_TYPE_TO_NOTICE[row.type]
  if (noticeType && row.refId != null) {
    markNoticeRead(noticeType, row.refId)
      .then(() => load())
      .catch(() => undefined)
  }
  switch (todoTargetOf(row.type)) {
    case 'accountingApprovals':
      router.push('/accounting?tab=approvals')
      break
    case 'personnelDelegation':
      router.push('/personnel')
      break
    case 'settingsBackup':
      router.push('/settings?tab=backup')
      break
    default:
      if (row.workId != null) router.push(`/work/${row.workId}`)
  }
}

/** 工作概览数字点击：去我的工作带筛选（F40） */
function goOverview(kind: 'inProgress' | 'dueThisWeek' | 'overdue' | 'completedThisMonth'): void {
  const query: Record<string, string> = {}
  switch (kind) {
    case 'inProgress':
      query.status = '进行中'
      break
    case 'dueThisWeek':
      query.dueThisWeek = '1'
      break
    case 'overdue':
      query.overdue = '1'
      break
    case 'completedThisMonth':
      query.status = '已完成'
      break
  }
  router.push({ path: '/work', query })
}

function onActivityClick(row: SubordinateActivityItem): void {
  if (row.workId != null) router.push(`/work/${row.workId}`)
}

onMounted(() => {
  load()
})
</script>

<template>
  <div class="p-3 md:p-6" v-loading="loading">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">工作台</h1>
      <el-button @click="load">刷新</el-button>
    </div>

    <!-- 个人信息条 -->
    <el-card class="mb-4">
      <span>{{ user?.name }}</span>
      （{{ user?.userNo }} · {{ roleLabel(role) }} · {{ user?.deptName }}）
      <el-alert
        v-if="typeUnread('annotationsUnreplied') > 0"
        class="ml-4 inline-flex"
        type="warning"
        :closable="false"
        :title="`你负责的工作有 ${typeUnread('annotationsUnreplied')} 条标注待回复`"
      />
    </el-card>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- 左列：快捷入口 + 工作概览 + 待办区 -->
      <div class="lg:col-span-2">
        <!-- 快捷入口（契约 §1.5，按角色） -->
        <el-card class="mb-4">
          <template #header><span class="font-bold">快捷入口</span></template>
          <div class="flex gap-3 flex-wrap">
            <el-button type="primary" @click="router.push('/work')">新建工作</el-button>
            <el-button @click="router.push('/work')">追加进度</el-button>
            <el-button @click="router.push('/summary')">生成总结</el-button>
            <el-button v-if="canAccountingOperate" type="success" @click="router.push('/accounting')">
              进入记账
            </el-button>
          </div>
        </el-card>

        <!-- 工作概览（S4 保留，数字同源，点击带筛选跳转 F40） -->
        <el-card class="mb-4">
          <template #header><span class="font-bold">工作概览</span></template>
          <div class="grid grid-cols-4 gap-4">
            <div
              v-for="card in [
                { key: 'inProgress', label: '进行中', value: summary?.counts.inProgress ?? 0 },
                { key: 'dueThisWeek', label: '本周到期', value: summary?.counts.dueThisWeek ?? 0 },
                { key: 'overdue', label: '逾期', value: summary?.counts.overdue ?? 0 },
                { key: 'completedThisMonth', label: '本月完成', value: summary?.counts.completedThisMonth ?? 0 }
              ]"
              :key="card.key"
              class="text-center cursor-pointer hover:bg-gray-50 rounded p-2"
              @click="goOverview(card.key as 'inProgress' | 'dueThisWeek' | 'overdue' | 'completedThisMonth')"
            >
              <div class="text-gray-500 text-sm">{{ card.label }}</div>
              <div class="text-3xl font-bold mt-1" :class="card.label === '逾期' ? 'text-red-500' : ''">
                {{ card.value }}
              </div>
            </div>
          </div>
        </el-card>

        <!-- 待办区（F39：8 类全按角色矩阵渲染，未读高亮） -->
        <el-card>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-bold">待办事项</span>
              <span class="text-sm text-gray-500">
                {{
                  visibleTypes
                    .map((t) => `${TODO_TYPE_LABELS[t]} ${typeCount(t)}`)
                    .join(' · ')
                }}
              </span>
            </div>
          </template>

          <el-empty v-if="!groupedTodos.length" description="暂无待办，工作进展正常" :image-size="60" />

          <div v-for="g in groupedTodos" :key="g.type" class="mb-4 last:mb-0">
            <div class="flex items-center gap-2 mb-1">
              <el-tag :type="TODO_TYPE_TAG[g.type]">{{ TODO_TYPE_LABELS[g.type] }}</el-tag>
              <span class="text-sm text-gray-500">{{ g.items.length }} 项</span>
              <el-badge v-if="typeUnread(g.type) > 0" :value="typeUnread(g.type)" type="danger" />
            </div>
            <div
              v-for="row in g.items"
              :key="`${g.type}-${row.workId ?? row.refId ?? row.name}`"
              class="flex items-center justify-between border rounded px-3 py-2 mb-1 cursor-pointer hover:bg-blue-50"
              :class="row.unread ? 'border-blue-300 bg-blue-50' : ''"
              @click="onTodoClick(row)"
            >
              <div class="min-w-0">
                <span class="mr-2" :class="row.unread ? 'font-bold' : ''">{{ row.name }}</span>
                <span v-if="row.assigneeName" class="text-sm text-gray-500">（{{ row.assigneeName }}）</span>
                <div v-if="row.type === 'stalled' && row.progressText" class="text-sm text-gray-500 truncate">
                  最近进度：{{ row.progressText }}
                </div>
              </div>
              <div class="text-sm text-gray-400 whitespace-nowrap ml-4">
                {{ row.isStalled && row.stalledDays ? `停滞${row.stalledDays}天 · ` : '' }}
                {{ todoTime(row) ? formatDateTime(todoTime(row)) : '' }}
              </div>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 右列：下级动态 + 账目概览 -->
      <div>
        <!-- 下级动态（近7天；有下级的角色可见，记账员/科员不渲染） -->
        <el-card v-if="showSubordinate" class="mb-4">
          <template #header><span class="font-bold">下级动态（近7天）</span></template>
          <template v-if="activity">
            <div v-for="(group, gkey) in { newProgress: activity.newProgress, assigned: activity.assigned, overdue: activity.overdue }" :key="gkey" class="mb-3 last:mb-0">
              <div class="text-sm font-bold text-gray-600 mb-1">
                {{ SUBORDINATE_GROUP_LABELS[gkey as keyof typeof SUBORDINATE_GROUP_LABELS] }}（{{ group.length }}）
              </div>
              <el-empty v-if="!group.length" :image-size="40" description="无" />
              <div
                v-for="row in group"
                :key="`${gkey}-${row.workId}-${row.createdAt}`"
                class="text-sm border-b py-1 cursor-pointer hover:text-blue-600"
                @click="onActivityClick(row)"
              >
                <div>{{ row.workName }}</div>
                <div class="text-gray-400">
                  {{ gkey === 'newProgress' ? row.detailName : row.operatorName || row.detailName }}
                  · {{ formatDateTime(row.createdAt) }}
                </div>
              </div>
            </div>
          </template>
        </el-card>

        <!-- 账目概览（S8 保留，点击跳 /accounting 当月视图） -->
        <el-card v-if="userStore.hasAccountView()" @click="router.push(`/accounting?month=${accounting?.month ?? ''}`)" style="cursor: pointer">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-bold">账目概览（{{ accounting?.month ?? '' }}）</span>
              <span class="text-sm text-gray-400">点击进入当月记账视图</span>
            </div>
          </template>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-gray-500 text-sm">本月计划金额</div>
              <div class="text-lg font-bold mt-1">¥{{ fmtAmount(accounting?.plannedAmount ?? 0) }}</div>
            </div>
            <div>
              <div class="text-gray-500 text-sm">已领用金额</div>
              <div class="text-lg font-bold mt-1">¥{{ fmtAmount(accounting?.receivedAmount ?? 0) }}</div>
            </div>
            <div>
              <div class="text-gray-500 text-sm">结存（数量/金额）</div>
              <div class="text-lg font-bold mt-1">
                {{ accounting?.stockQty ?? 0 }} / ¥{{ fmtAmount(accounting?.stockAmount ?? 0) }}
              </div>
            </div>
            <div>
              <div class="text-gray-500 text-sm">挂账金额</div>
              <div class="text-lg font-bold mt-1" :class="(accounting?.overdueLedgerCount ?? 0) > 0 ? 'text-red-500' : ''">
                ¥{{ fmtAmount(accounting?.ledgerAmount ?? 0) }}
              </div>
            </div>
            <div>
              <div class="text-gray-500 text-sm">待发放数量</div>
              <div class="text-lg font-bold mt-1">{{ accounting?.pendingIssueQty ?? 0 }}</div>
            </div>
          </div>
          <el-alert
            v-if="(accounting?.lowStockItems?.length ?? 0) > 0"
            class="mt-3"
            type="warning"
            :closable="false"
            :title="`库存预警：${(accounting?.lowStockItems ?? []).map((i) => i.itemName).join('、')} 结存低于下限`"
          />
          <el-alert
            v-if="(accounting?.overdueLedgerCount ?? 0) > 0"
            class="mt-2"
            type="warning"
            :closable="false"
            :title="`挂账提醒：${accounting?.overdueLedgerCount} 笔挂账超过30天`"
          />
        </el-card>
      </div>
    </div>
  </div>
</template>
