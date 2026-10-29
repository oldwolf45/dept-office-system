<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import type {
  MonthlyReportMeta,
  ReportDetailRow,
  ReportTableData,
  ReportType
} from '@/types'
import {
  downloadBlob,
  exportReport,
  generateMonth,
  generateSummary,
  getReportDetail,
  getReportMeta,
  getReportTable,
  saveSummary,
  unlockReport
} from '@/api/reports'
import { buildReportDetailQuery, currentMonth, monthOptions } from '@/utils/accounting'
import { formatDateTime } from '@/utils/format'

const userStore = useUserStore()

const month = ref<string>(currentMonth())
const monthList = computed<string[]>(() => monthOptions(new Date(), 8))
const reportType = ref<ReportType>('material_plan')

const TYPE_OPTIONS: Array<{ label: string; value: ReportType }> = [
  { label: '物料计划执行表', value: 'material_plan' },
  { label: '资金执行表', value: 'fund_execution' },
  { label: '挂账清单', value: 'ledger' },
  { label: '人员工作完成表', value: 'person_work' }
]

const meta = ref<MonthlyReportMeta | null>(null)
const table = ref<ReportTableData | null>(null)
const loading = ref<boolean>(false)

async function loadMeta(): Promise<void> {
  try {
    meta.value = await getReportMeta(month.value)
  } catch {
    meta.value = null
  }
}

async function loadTable(): Promise<void> {
  loading.value = true
  try {
    table.value = await getReportTable(month.value, reportType.value)
  } catch {
    table.value = null
  } finally {
    loading.value = false
  }
}

async function loadAll(): Promise<void> {
  await Promise.all([loadMeta(), loadTable()])
}

watch([month, reportType], () => loadAll())

// ---------- 生成 / 导出 / 解锁 ----------
async function onGenerate(): Promise<void> {
  meta.value = await generateMonth(month.value)
  ElMessage.success('月度报表已生成（幂等，重复生成不重复建档）')
  await loadTable()
}

async function onExport(): Promise<void> {
  const blob = await exportReport(month.value)
  downloadBlob(blob, `${month.value}-月度报表.xlsx`)
  ElMessage.success('Excel 已导出')
}

async function onUnlock(): Promise<void> {
  meta.value = await unlockReport(month.value)
  ElMessage.success('已解锁（操作留痕），记账员可修改当月账目，再次生成报表将重新锁定')
}

// ---------- 下钻明细（D33：与汇总同源，前端不二次计算） ----------
const detailVisible = ref<boolean>(false)
const detailLoading = ref<boolean>(false)
const detailRows = ref<ReportDetailRow[]>([])

async function openDetail(row: Record<string, string | number | null>): Promise<void> {
  detailVisible.value = true
  detailLoading.value = true
  try {
    const q = buildReportDetailQuery({
      month: month.value,
      reportType: reportType.value,
      itemId: typeof row.itemId === 'number' ? row.itemId : undefined,
      personId: typeof row.personId === 'number' ? row.personId : undefined
    })
    detailRows.value = await getReportDetail(month.value, reportType.value, q)
  } catch {
    detailRows.value = []
  } finally {
    detailLoading.value = false
  }
}

// ---------- 汇总说明（D34：初稿→可编辑→存档） ----------
const summaryText = ref<string>('')
const summarySaving = ref<boolean>(false)
const summaryDirty = ref<boolean>(false)

watch(
  meta,
  (m) => {
    summaryText.value = m?.summaryText ?? ''
    summaryDirty.value = false
  },
  { immediate: true }
)

async function onGenerateSummary(): Promise<void> {
  const res = await generateSummary(month.value)
  summaryText.value = res.summaryText
  summaryDirty.value = true
  ElMessage.success('汇总说明初稿已生成（数字全部来自当期报表）')
}

async function onSaveSummary(): Promise<void> {
  summarySaving.value = true
  try {
    meta.value = await saveSummary(month.value, summaryText.value)
    summaryDirty.value = false
    ElMessage.success('汇总说明已随报表存档，并进入经验库样例候选')
  } finally {
    summarySaving.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="p-3 md:p-6" v-loading="loading">
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-xl font-bold">月度报表</h1>
      <div class="flex items-center gap-2">
        <span>月份</span>
        <el-select v-model="month" style="width: 130px">
          <el-option v-for="m in monthList" :key="m" :label="m" :value="m" />
        </el-select>
        <el-button v-if="userStore.hasAccountOperate()" @click="onGenerate">生成/重新生成</el-button>
        <el-button v-if="userStore.checkButton('export')" type="primary" plain @click="onExport">导出 Excel</el-button>
      </div>
    </div>

    <!-- 只读锁状态（C24） -->
    <el-alert
      v-if="meta?.locked"
      type="warning"
      :closable="false"
      class="mb-4"
    >
      <div class="flex items-center justify-between">
        <span>{{ month }} 已生成报表，当月账目默认只读。{{ meta.generatedAt ? `生成时间：${formatDateTime(meta.generatedAt)}` : '' }}</span>
        <el-button v-if="userStore.hasAccountConfirm()" size="small" @click="onUnlock">科长解锁（留痕）</el-button>
      </div>
    </el-alert>

    <!-- 四表切换 -->
    <el-radio-group v-model="reportType" class="mb-3">
      <el-radio-button v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</el-radio-button>
    </el-radio-group>

    <!-- 报表明细表（列由后端下发，数字点击下钻同源明细） -->
    <el-table v-if="table" :data="table.rows" border size="small">
      <el-table-column
        v-for="col in table.columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        min-width="110"
      />
      <el-table-column label="下钻明细" width="110" fixed="right">
        <template #default="{ row }: { row: Record<string, string | number | null> }">
          <el-button link type="primary" @click="openDetail(row)">查看明细</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else description="该月份暂无报表，请点击「生成/重新生成」" />

    <!-- 汇总说明（D34） -->
    <el-card class="mt-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">汇总说明（基于当期数据，可人工修改后存档）</span>
          <div>
            <el-button v-if="userStore.hasAccountOperate()" size="small" @click="onGenerateSummary">生成初稿</el-button>
            <el-button
              v-if="userStore.hasAccountOperate()"
              size="small"
              type="primary"
              :loading="summarySaving"
              :disabled="!summaryDirty && !summaryText"
              @click="onSaveSummary"
            >保存存档</el-button>
          </div>
        </div>
      </template>
      <el-input
        v-model="summaryText"
        type="textarea"
        :rows="6"
        placeholder="点击「生成初稿」基于当期报表数字生成，可人工修改；保存后随报表存档并进入经验库样例候选。"
        @input="summaryDirty = true"
      />
      <div v-if="meta?.summaryUpdatedAt" class="text-xs text-gray-400 mt-2">
        最近存档：{{ formatDateTime(meta.summaryUpdatedAt) }}{{ meta.summaryUpdatedByName ? ` · ${meta.summaryUpdatedByName}` : '' }}
      </div>
    </el-card>

    <!-- 下钻明细弹窗 -->
    <el-dialog v-model="detailVisible" title="报表明细（与汇总数字同源）" width="720px">
      <el-table v-loading="detailLoading" :data="detailRows" border size="small">
        <el-table-column prop="no" label="单号" width="140" />
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column prop="item" label="事项/物品" min-width="160" />
        <el-table-column prop="qty" label="数量" width="80" />
        <el-table-column label="金额" width="100">
          <template #default="{ row }: { row: ReportDetailRow }">{{ row.amount ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90" />
      </el-table>
    </el-dialog>
  </div>
</template>
