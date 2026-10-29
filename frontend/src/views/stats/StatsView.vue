<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import BaseChart from '@/components/BaseChart.vue'
import { useUserStore } from '@/store/user'
import type {
  DictItem,
  PersonScope,
  StatsWorkDetailItem,
  UserListItem,
  WorkSummaryStats
} from '@/types'
import { getActiveDicts } from '@/api/dict'
import { getUsers } from '@/api/users'
import { getAccountingSummary, getWorkDetail, getWorkSummary, type WorkSummaryQuery } from '@/api/stats'
import { formatDateTime } from '@/utils/format'
import { canViewSubordinateScope, WORK_STATUS_OPTIONS, buildWorkStatsQuery, type StatsFilters } from '@/utils/stats'
import type { AccountingSummaryResult, AccountingSummaryType } from '@/types'
import { currentMonth, fmtAmount, monthOptions } from '@/utils/accounting'

const userStore = useUserStore()

// ---------- 筛选 ----------
const filters = reactive<StatsFilters>({
  preset: 'month',
  customStart: '',
  customEnd: '',
  personScope: 'mine',
  personId: '',
  category: '',
  status: ''
})

const categories = ref<DictItem[]>([])
const subordinates = ref<UserListItem[]>([])

const canSeeSub = computed<boolean>(() =>
  canViewSubordinateScope(userStore.userInfo?.role ?? 1)
)

const PRESET_OPTIONS: Array<{ label: string; value: StatsFilters['preset'] }> = [
  { label: '按天', value: 'day' },
  { label: '按周', value: 'week' },
  { label: '按月', value: 'month' },
  { label: '自定义', value: 'custom' }
]

// ---------- 数据 ----------
const loading = ref<boolean>(false)
const stats = ref<WorkSummaryStats | null>(null)

const baseQuery = computed<WorkSummaryQuery>(() => buildWorkStatsQuery(filters))

async function load(): Promise<void> {
  loading.value = true
  try {
    stats.value = await getWorkSummary(baseQuery.value)
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

watch(filters, () => load(), { deep: true })

// ---------- 图表 option ----------
const percent = computed<number>(() =>
  stats.value ? Math.round((stats.value.completionRate || 0) * 100) : 0
)

const gaugeOption = computed(() => ({
  series: [
    {
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      progress: { show: true, width: 12 },
      axisLine: { lineStyle: { width: 12 } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: true },
      detail: { valueAnimation: true, formatter: '{value}%', fontSize: 22, offsetCenter: [0, '70%'] },
      data: [{ value: percent.value }]
    }
  ]
}))

const categoryOption = computed(() => {
  const dist = stats.value?.categoryDistribution ?? []
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: dist.map((d) => d.category) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'bar',
        barMaxWidth: 48,
        itemStyle: { color: '#409eff' },
        data: dist.map((d) => d.count)
      }
    ]
  }
})

const perPersonOption = computed(() => {
  const list = stats.value?.perPerson ?? []
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['应完成', '已完成'] },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: list.map((p) => p.name) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '应完成',
        type: 'bar',
        barMaxWidth: 32,
        itemStyle: { color: '#a0cfff' },
        data: list.map((p) => ({ value: p.total, userId: p.userId }))
      },
      {
        name: '已完成',
        type: 'bar',
        barMaxWidth: 32,
        itemStyle: { color: '#67c23a' },
        data: list.map((p) => ({ value: p.completed, userId: p.userId }))
      }
    ]
  }
})

// ---------- 下钻明细 ----------
const detailVisible = ref<boolean>(false)
const detailLoading = ref<boolean>(false)
const detailList = ref<StatsWorkDetailItem[]>([])
const detailTotal = ref<number>(0)
const detailPage = ref<number>(1)
const detailPageSize = ref<number>(10)
// 图表点击带来的附加筛选（类别/人员），与图表数字同源
const drilldown = reactive<{ category?: string; personId?: number }>({})

async function loadDetail(): Promise<void> {
  detailLoading.value = true
  try {
    const q: WorkSummaryQuery = { ...baseQuery.value }
    if (drilldown.category) q.category = drilldown.category
    if (drilldown.personId) q.personId = drilldown.personId
    const res = await getWorkDetail({
      ...q,
      page: detailPage.value,
      pageSize: detailPageSize.value
    })
    detailList.value = res.list
    detailTotal.value = res.total
  } catch {
    detailList.value = []
    detailTotal.value = 0
  } finally {
    detailLoading.value = false
  }
}

function openDetail(extra?: { category?: string; personId?: number }): void {
  drilldown.category = extra?.category
  drilldown.personId = extra?.personId
  detailPage.value = 1
  detailVisible.value = true
  loadDetail()
}

function onCategoryClick(params: { name?: string }): void {
  if (params.name) openDetail({ category: params.name })
}

function onPersonClick(params: { data?: unknown }): void {
  const d = params.data as { userId?: number } | number | null | undefined
  if (typeof d === 'object' && d && d.userId) openDetail({ personId: d.userId })
}

// ---------- 人员口径切换 ----------
function onScopeChange(v: PersonScope): void {
  filters.personScope = v
  if (v !== 'subordinates') filters.personId = ''
}

// ---------- 账目统计区（S8 接通：有权限渲染，无权限完全不渲染 D32） ----------
const acMonth = ref<string>(currentMonth())
const acType = ref<AccountingSummaryType>('material')
const acSummary = ref<AccountingSummaryResult | null>(null)
const acLoading = ref<boolean>(false)

async function loadAccounting(): Promise<void> {
  if (!userStore.hasAccountView()) return
  acLoading.value = true
  try {
    // 查询参数构造逻辑与 buildAccountingStatsQuery 一致（该纯函数单测覆盖）
    acSummary.value = await getAccountingSummary(acMonth.value, acType.value)
  } catch {
    acSummary.value = null
  } finally {
    acLoading.value = false
  }
}

watch([acMonth, acType], () => loadAccounting())

// 物料趋势：按 period 聚合（跨物品求和）
const materialOption = computed(() => {
  const trend = acSummary.value?.materialTrend ?? []
  const byPeriod = new Map<string, { received: number; issued: number; stock: number }>()
  trend.forEach((r) => {
    const cur = byPeriod.get(r.period) ?? { received: 0, issued: 0, stock: 0 }
    cur.received += r.receivedQty
    cur.issued += r.issuedQty
    cur.stock = r.stockQty
    byPeriod.set(r.period, cur)
  })
  const periods = [...byPeriod.keys()]
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['领用', '发放', '结存'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: periods },
    yAxis: { type: 'value' },
    series: [
      { name: '领用', type: 'bar', itemStyle: { color: '#409eff' }, data: periods.map((p) => byPeriod.get(p)!.received) },
      { name: '发放', type: 'bar', itemStyle: { color: '#e6a23c' }, data: periods.map((p) => byPeriod.get(p)!.issued) },
      { name: '结存', type: 'line', itemStyle: { color: '#67c23a' }, data: periods.map((p) => byPeriod.get(p)!.stock) }
    ]
  }
})

// 资金执行率：计划 vs 实际支出
const fundOption = computed(() => {
  const f = acSummary.value?.fundExecution
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['计划金额', '实际支出'] },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: ['本月'] },
    yAxis: { type: 'value' },
    series: [
      { name: '计划金额', type: 'bar', barMaxWidth: 60, itemStyle: { color: '#409eff' }, data: [f?.plannedAmount ?? 0] },
      { name: '实际支出', type: 'bar', barMaxWidth: 60, itemStyle: { color: '#f56c6c' }, data: [f?.spentAmount ?? 0] }
    ]
  }
})

// 挂账账龄分布
const ledgerOption = computed(() => {
  const aging = acSummary.value?.ledgerAging ?? []
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: aging.map((a) => a.bucket) },
    yAxis: { type: 'value' },
    series: [
      { name: '挂账金额', type: 'bar', barMaxWidth: 48, itemStyle: { color: '#e6a23c' }, data: aging.map((a) => a.amount) }
    ]
  }
})

// ---------- 初始化 ----------
async function initOptions(): Promise<void> {
  try {
    categories.value = await getActiveDicts('work_category')
  } catch {
    categories.value = []
  }
  if (canSeeSub.value) {
    try {
      const res = await getUsers()
      subordinates.value = res.list || []
    } catch {
      subordinates.value = []
    }
  }
}

onMounted(async () => {
  await initOptions()
  await load()
  await loadAccounting()
})

function refresh(): void {
  load()
  if (detailVisible.value) loadDetail()
}
</script>

<template>
  <div class="p-3 md:p-6" v-loading="loading">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">汇总统计</h1>
      <el-button @click="refresh">刷新</el-button>
    </div>

    <!-- 筛选区 -->
    <el-card class="mb-4">
      <el-form inline @submit.prevent>
        <el-form-item label="时间">
          <el-radio-group v-model="filters.preset">
            <el-radio-button v-for="o in PRESET_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-if="filters.preset === 'custom'"
            v-model="filters.customEnd"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="结束日期"
            class="ml-2"
          />
        </el-form-item>

        <el-form-item label="人员">
          <el-radio-group :model-value="filters.personScope" @change="onScopeChange">
            <el-radio value="mine">本人</el-radio>
            <el-radio value="subordinates" :disabled="!canSeeSub">看到底范围</el-radio>
            <el-radio value="dept" :disabled="!canSeeSub">全科室</el-radio>
          </el-radio-group>
          <el-select
            v-if="filters.personScope === 'subordinates'"
            v-model="filters.personId"
            placeholder="全部下级"
            clearable
            class="ml-2"
            style="width: 160px"
          >
            <el-option
              v-for="u in subordinates"
              :key="u.id"
              :label="`${u.name}（${u.userNo}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>

        <!-- S13：复杂筛选手机端收起（契约 §1.1），保留时间/人员简单筛选 -->
        <el-form-item label="工作类别" class="!hidden md:!flex">
          <el-select v-model="filters.category" placeholder="全部类别" clearable style="width: 160px">
            <el-option v-for="c in categories" :key="c.id" :label="c.label" :value="c.label" />
          </el-select>
        </el-form-item>

        <el-form-item label="工作状态" class="!hidden md:!flex">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px">
            <el-option v-for="s in WORK_STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 口径与数据截止时间 -->
    <el-alert
      v-if="stats"
      type="info"
      :closable="false"
      class="mb-4"
      :title="`统计口径：${stats.scopeDesc}　|　数据截止：${formatDateTime(stats.generatedAt)}　|　应完成=未开始+进行中+已完成，完成率=已完成÷应完成`"
    />

    <!-- 数字卡片 + 完成率仪表 -->
    <div class="grid grid-cols-4 gap-4 mb-4">
      <el-card class="cursor-pointer" @click="openDetail()">
        <div class="text-gray-500">应完成总数</div>
        <div class="text-3xl font-bold mt-1">{{ stats?.totalWork ?? 0 }}</div>
      </el-card>
      <el-card class="cursor-pointer" @click="openDetail()">
        <div class="text-gray-500">已完成</div>
        <div class="text-3xl font-bold mt-1 text-green-600">{{ stats?.completed ?? 0 }}</div>
      </el-card>
      <el-card class="cursor-pointer" @click="openDetail()">
        <div class="text-gray-500">进行中 / 未开始</div>
        <div class="text-3xl font-bold mt-1">
          {{ stats?.inProgress ?? 0 }} / {{ stats?.notStarted ?? 0 }}
        </div>
      </el-card>
      <el-card class="cursor-pointer" @click="openDetail()">
        <div class="text-gray-500">逾期</div>
        <div class="text-3xl font-bold mt-1" :class="(stats?.overdue ?? 0) > 0 ? 'text-red-500' : ''">
          {{ stats?.overdue ?? 0 }}
        </div>
      </el-card>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <el-card header="完成率">
        <BaseChart :option="gaugeOption" height="260px" />
      </el-card>
      <el-card header="各类工作数量对比（点击柱条下钻明细）">
        <BaseChart :option="categoryOption" height="260px" @chart-click="onCategoryClick" />
      </el-card>
    </div>

    <el-card class="mb-4" header="每人工作量与完成情况（点击柱条下钻明细）">
      <BaseChart :option="perPersonOption" height="300px" @chart-click="onPersonClick" />
      <el-table :data="stats?.perPerson ?? []" border size="small" class="mt-2">
        <el-table-column prop="name" label="人员" min-width="120" />
        <el-table-column prop="userNo" label="工号" width="100" />
        <el-table-column prop="total" label="应完成" width="90" />
        <el-table-column prop="completed" label="已完成" width="90" />
        <el-table-column label="完成率" width="120">
          <template #default="{ row }: { row: { rate: number } }">
            {{ Math.round((row.rate || 0) * 100) }}%
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 账目统计：有账目权限才渲染（D32），无权限完全不渲染 -->
    <el-card v-if="userStore.hasAccountView()" class="mb-4" v-loading="acLoading">
      <template #header>
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="font-bold">账目统计</span>
          <div class="flex items-center gap-2">
            <el-radio-group v-model="acType" size="small">
              <el-radio-button value="material">物料趋势</el-radio-button>
              <el-radio-button value="fund">资金执行率</el-radio-button>
              <el-radio-button value="ledger">挂账账龄</el-radio-button>
            </el-radio-group>
            <el-select v-model="acMonth" size="small" style="width: 120px">
              <el-option v-for="m in monthOptions(new Date(), 6)" :key="m" :label="m" :value="m" />
            </el-select>
          </div>
        </div>
      </template>

      <template v-if="acType === 'material'">
        <BaseChart :option="materialOption" height="280px" />
      </template>
      <template v-else-if="acType === 'fund'">
        <div class="mb-2 text-sm text-gray-600">
          计划 {{ fmtAmount(acSummary?.fundExecution?.plannedAmount ?? 0) }} 元 ·
          支出 {{ fmtAmount(acSummary?.fundExecution?.spentAmount ?? 0) }} 元 ·
          余额 {{ fmtAmount(acSummary?.fundExecution?.balance ?? 0) }} 元 ·
          执行率 {{ Math.round((acSummary?.fundExecution?.rate ?? 0) * 100) }}%
        </div>
        <BaseChart :option="fundOption" height="240px" />
      </template>
      <template v-else>
        <BaseChart :option="ledgerOption" height="260px" />
      </template>
    </el-card>

    <!-- 下钻明细弹窗 -->
    <el-dialog v-model="detailVisible" title="工作明细（与图表同源数据）" width="80%" destroy-on-close>
      <el-table v-loading="detailLoading" :data="detailList" border>
        <el-table-column prop="name" label="工作名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="category" label="类别" width="130" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }: { row: StatsWorkDetailItem }">
            <el-tag :type="row.status === '已完成' ? 'success' : row.status === '已取消' ? 'info' : ''">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" />
        <el-table-column prop="assigneeName" label="负责人" width="100" />
        <el-table-column label="计划完成" width="110">
          <template #default="{ row }: { row: StatsWorkDetailItem }">
            {{ row.dueTime ? formatDateTime(row.dueTime) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="停滞" width="90">
          <template #default="{ row }: { row: StatsWorkDetailItem }">
            <el-tag v-if="row.isStalled" type="danger">停滞{{ row.stalledDays ?? '' }}天</el-tag>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="mt-4 justify-end"
        layout="total, prev, pager, next"
        :total="detailTotal"
        :page-size="detailPageSize"
        :current-page="detailPage"
        @current-change="(p: number) => { detailPage = p; loadDetail() }"
      />
    </el-dialog>
  </div>
</template>
