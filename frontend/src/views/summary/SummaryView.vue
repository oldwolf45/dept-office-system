<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import type {
  GenerateSummaryResult,
  PersonScope,
  ReferencedSample,
  SummaryArchive,
  SummaryContentType,
  SummarySnapshot,
  SummaryArchiveStatus,
  ValidationResult
} from '@/types'
import {
  exportSummaryPptx,
  exportSummaryWord,
  finalizeSummary,
  generateSummary,
  getSummaries,
  getSummaryDetail,
  preferSummary,
  rejectSummary,
  saveSummary,
  toggleSample
} from '@/api/summaries'
import {
  canFinalize,
  contentTypeLabel,
  mismatchCount,
  parseJsonField,
  SUMMARY_STATUS_LABELS,
  SUMMARY_STATUS_TAG_TYPE,
  versionTypeLabel,
  wordCountLabel
} from '@/utils/summary'
import { canViewSubordinateScope } from '@/utils/stats'
import { formatDateTime } from '@/utils/format'

const userStore = useUserStore()

// ---------- 生成区 ----------
const genForm = ref<{
  personScope: PersonScope
  range: [string, string] | []
  contentType: SummaryContentType
}>({
  personScope: 'mine',
  range: [],
  contentType: 'work'
})
const generating = ref<boolean>(false)

const canSeeSub = computed<boolean>(() =>
  canViewSubordinateScope(userStore.userInfo?.role ?? 1)
)
/** 标记优选/启用停用样例：仅科长（按钮权限码 mark-sample） */
const canMarkSample = computed<boolean>(() => userStore.checkButton('mark-sample'))

// ---------- 当前查看/编辑的存档版本 ----------
const current = ref<SummaryArchive | null>(null)
const currentContent = ref<string>('')
const loadingCurrent = ref<boolean>(false)

const validation = computed<ValidationResult | null>(() =>
  parseJsonField<ValidationResult | null>(current.value?.validation, null)
)
const snapshot = computed<SummarySnapshot | null>(() =>
  parseJsonField<SummarySnapshot | null>(current.value?.snapshot, null)
)
const referencedSamples = computed<ReferencedSample[]>(() =>
  parseJsonField<ReferencedSample[]>(current.value?.referencedSamples, [])
)

const hasMismatch = computed<boolean>(() => mismatchCount(validation.value) > 0)
/** E35：有未处理 mismatch 时定稿禁用 */
const finalizeDisabled = computed<boolean>(() => {
  if (!current.value) return true
  if (current.value.status !== 'draft') return true
  return !canFinalize(validation.value)
})

// ---------- 版本列表 ----------
const versions = ref<SummaryArchive[]>([])
const versionsTotal = ref<number>(0)
const loadingVersions = ref<boolean>(false)

async function loadVersions(): Promise<void> {
  loadingVersions.value = true
  try {
    const res = await getSummaries({ page: 1, pageSize: 50 })
    versions.value = res.list || []
    versionsTotal.value = res.total || 0
  } catch {
    versions.value = []
  } finally {
    loadingVersions.value = false
  }
}

async function loadDetail(id: number): Promise<void> {
  loadingCurrent.value = true
  try {
    const d = await getSummaryDetail(id)
    current.value = d
    currentContent.value = d.content || ''
  } catch {
    current.value = null
    currentContent.value = ''
  } finally {
    loadingCurrent.value = false
  }
}

// ---------- 生成 ----------
async function onGenerate(): Promise<void> {
  if (!genForm.value.range || genForm.value.range.length !== 2 || !genForm.value.range[0] || !genForm.value.range[1]) {
    ElMessage.warning('请选择总结期间起止日期')
    return
  }
  generating.value = true
  try {
    const res: GenerateSummaryResult = await generateSummary({
      personScope: genForm.value.personScope,
      startTime: genForm.value.range[0],
      endTime: genForm.value.range[1],
      contentType: genForm.value.contentType
    })
    current.value = res.archive
    currentContent.value = res.archive.content || ''
    ElMessage.success(
      res.usedFallback ? '模型调用失败，已回退模板稿生成并照常存档' : '初稿已生成并存档'
    )
    await loadVersions()
  } catch {
    // 拦截器已弹错
  } finally {
    generating.value = false
  }
}

// ---------- 操作 ----------
async function onSave(): Promise<void> {
  if (!current.value) return
  try {
    const updated = await saveSummary(current.value.id, currentContent.value)
    current.value = updated
    ElMessage.success('已保存为新版本（修改稿）')
    await loadVersions()
  } catch {
    /* 拦截器弹错 */
  }
}

async function onFinalize(): Promise<void> {
  if (!current.value || finalizeDisabled.value) return
  try {
    const updated = await finalizeSummary(current.value.id)
    current.value = updated
    ElMessage.success('已定稿')
    await loadVersions()
  } catch {
    /* 后端 4000：mismatch 未处理 */
  }
}

async function onReject(): Promise<void> {
  if (!current.value) return
  try {
    await ElMessageBox.confirm('标记为"不采用"后仍可查看与导出，确定？', '标记不采用', {
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    const updated = await rejectSummary(current.value.id)
    current.value = updated
    ElMessage.success('已标记不采用')
    await loadVersions()
  } catch {
    /* 拦截器弹错 */
  }
}

async function onPrefer(): Promise<void> {
  if (!current.value) return
  try {
    const updated = await preferSummary(current.value.id)
    current.value = updated
    ElMessage.success(updated.isPreferred === 1 ? '已标记优选样例' : '已取消优选')
    await loadVersions()
  } catch {
    /* 拦截器弹错 */
  }
}

async function onToggleSample(): Promise<void> {
  if (!current.value) return
  try {
    const updated = await toggleSample(current.value.id)
    current.value = updated
    ElMessage.success(updated.isEnabled === 1 ? '样例已启用' : '样例已停用（不再被检索引用）')
    await loadVersions()
  } catch {
    /* 拦截器弹错 */
  }
}

async function onExportWord(): Promise<void> {
  if (!current.value) return
  try {
    await exportSummaryWord(current.value.id)
  } catch {
    ElMessage.error('Word 导出失败')
  }
}

async function onExportPptx(): Promise<void> {
  if (!current.value) return
  try {
    await exportSummaryPptx(current.value.id)
  } catch {
    ElMessage.error('PPT 导出失败')
  }
}

function statusTag(s: SummaryArchiveStatus): { label: string; type: 'info' | 'success' | 'danger' } {
  return {
    label: SUMMARY_STATUS_LABELS[s] || s,
    type: SUMMARY_STATUS_TAG_TYPE[s] || 'info'
  }
}

onMounted(() => {
  loadVersions()
})
</script>

<template>
  <div class="p-3 md:p-6">
    <h1 class="text-xl font-bold mb-4">总结与PPT</h1>

    <!-- 生成区 -->
    <el-card class="mb-4">
      <template #header><span class="font-bold">生成总结</span></template>
      <el-form inline @submit.prevent>
        <el-form-item label="人员范围">
          <el-radio-group v-model="genForm.personScope">
            <el-radio value="mine">本人</el-radio>
            <el-radio value="subordinates" :disabled="!canSeeSub">看到底范围</el-radio>
            <el-radio value="dept" :disabled="!canSeeSub">全科室</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="期间">
          <el-date-picker
            v-model="genForm.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
        </el-form-item>
        <el-form-item label="内容类型">
          <el-radio-group v-model="genForm.contentType">
            <el-radio value="work">工作</el-radio>
            <el-radio value="accounting">记账</el-radio>
            <el-radio value="both">工作+记账</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="generating" @click="onGenerate">
            生成（调用模型，最长约30秒）
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 当前版本详情/编辑 -->
    <el-card v-loading="loadingCurrent" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">
            版本
            <template v-if="current">
              {{ current.version }} · {{ versionTypeLabel(current.versionType) }}
              <el-tag v-if="current.versionType === '模板稿'" type="warning" class="ml-1">模板稿</el-tag>
            </template>
          </span>
          <span v-if="current" class="text-sm text-gray-500">
            {{ formatDateTime(current.createdAt) }} · {{ current.createdByName || '' }} ·
            {{ wordCountLabel(current.wordCount) }}
            <el-tag v-if="current" :type="statusTag(current.status).type" class="ml-2">
              {{ statusTag(current.status).label }}
            </el-tag>
          </span>
        </div>
      </template>

      <el-empty v-if="!current" description="生成初稿或从下方版本列表选择一个版本查看" :image-size="60" />

      <div v-else>
        <!-- 数字校验结果（mismatch 标红，E35） -->
        <el-alert
          v-if="hasMismatch"
          type="error"
          :closable="false"
          class="mb-3"
          :title="`数字校验发现 ${mismatchCount(validation)} 处不一致：正文中出现了快照之外的数字，未处理不能定稿`"
        >
          <div class="text-red-600 font-bold">不一致数字：{{ validation?.mismatches?.join('、') }}</div>
        </el-alert>
        <el-alert
          v-else-if="current.status === 'draft'"
          type="success"
          :closable="false"
          title="数字校验通过：正文数字均来自本期统计快照"
          class="mb-3"
        />

        <!-- 快照数字 -->
        <div v-if="snapshot" class="grid grid-cols-4 gap-3 mb-3">
          <el-card shadow="never">
            <div class="text-gray-500 text-sm">应完成</div>
            <div class="text-2xl font-bold">{{ snapshot.totalWork ?? '-' }}</div>
          </el-card>
          <el-card shadow="never">
            <div class="text-gray-500 text-sm">已完成</div>
            <div class="text-2xl font-bold text-green-600">{{ snapshot.completed ?? '-' }}</div>
          </el-card>
          <el-card shadow="never">
            <div class="text-gray-500 text-sm">完成率</div>
            <div class="text-2xl font-bold">
              {{ snapshot.completionRate != null ? Math.round(snapshot.completionRate * 100) + '%' : '-' }}
            </div>
          </el-card>
          <el-card shadow="never">
            <div class="text-gray-500 text-sm">逾期</div>
            <div class="text-2xl font-bold" :class="(snapshot.overdue ?? 0) > 0 ? 'text-red-500' : ''">
              {{ snapshot.overdue ?? '-' }}
            </div>
          </el-card>
        </div>

        <!-- 引用样例 -->
        <el-card v-if="referencedSamples.length" shadow="never" class="mb-3">
          <template #header><span class="font-bold">引用样例（参考语气结构，不带入旧数字）</span></template>
          <ul class="list-disc pl-5 text-sm text-gray-700">
            <li v-for="(s, i) in referencedSamples" :key="i">
              {{ s.version || '' }} · {{ contentTypeLabel(s.contentType || '') }} ·
              {{ s.periodStart || '' }} ~ {{ s.periodEnd || '' }} ·
              {{ s.versionType || '' }}
              <el-tag v-if="s.isPreferred === 1" size="small" type="danger" class="ml-1">优选</el-tag>
            </li>
          </ul>
        </el-card>

        <!-- 正文编辑 -->
        <el-input
          v-model="currentContent"
          type="textarea"
          :rows="12"
          placeholder="初稿正文，可修改"
          class="mb-3"
        />

        <!-- 操作按钮 -->
        <div class="flex flex-wrap gap-2">
          <el-button type="primary" @click="onSave">保存修改（生成新版本）</el-button>
          <el-tooltip :disabled="!hasMismatch" content="存在未处理的数字不一致，不能定稿" placement="top">
            <span>
              <el-button type="success" :disabled="finalizeDisabled" @click="onFinalize">定稿</el-button>
            </span>
          </el-tooltip>
          <el-button @click="onReject">标记不采用</el-button>
          <el-button @click="onExportWord">导出 Word</el-button>
          <el-button @click="onExportPptx">生成 PPT</el-button>
          <template v-if="canMarkSample">
            <el-button @click="onPrefer">
              {{ current.isPreferred === 1 ? '取消优选' : '标记优选样例' }}
            </el-button>
            <el-button @click="onToggleSample">
              {{ current.isEnabled === 1 ? '停用样例' : '启用样例' }}
            </el-button>
          </template>
        </div>
      </div>
    </el-card>

    <!-- 版本列表（无删除入口，E32） -->
    <el-card v-loading="loadingVersions">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">历史版本（共 {{ versionsTotal }} 个，不可删除）</span>
        </div>
      </template>
      <!-- 手机端版本卡片（S13，与桌面表格同源） -->
      <div class="md:hidden space-y-2">
        <el-empty v-if="!versions.length" description="暂无历史版本" :image-size="60" />
        <div v-for="row in versions" :key="row.id" class="border rounded p-3">
          <div class="flex justify-between items-center">
            <b>{{ row.version }}</b>
            <el-tag :type="statusTag(row.status).type" size="small">{{ statusTag(row.status).label }}</el-tag>
          </div>
          <div class="text-sm text-gray-500 mt-1">
            {{ row.periodStart }} ~ {{ row.periodEnd }} · {{ contentTypeLabel(row.contentType) }}
          </div>
          <div class="text-sm text-gray-500">
            {{ row.createdByName }} · {{ formatDateTime(row.createdAt) }} · {{ wordCountLabel(row.wordCount) }}
          </div>
          <div class="mt-2">
            <el-button size="small" link type="primary" @click="loadDetail(row.id)">查看</el-button>
            <el-button size="small" link @click="exportSummaryWord(row.id)">Word</el-button>
            <el-button size="small" link @click="exportSummaryPptx(row.id)">PPT</el-button>
          </div>
        </div>
      </div>

      <el-table :data="versions" border class="hidden md:block">
        <el-table-column prop="version" label="版本" width="70" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }: { row: SummaryArchive }">
            <el-tag :type="row.versionType === '模板稿' ? 'warning' : 'info'">
              {{ versionTypeLabel(row.versionType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="期间" width="180">
          <template #default="{ row }: { row: SummaryArchive }">
            {{ row.periodStart }} ~ {{ row.periodEnd }}
          </template>
        </el-table-column>
        <el-table-column label="内容" width="90">
          <template #default="{ row }: { row: SummaryArchive }">
            {{ contentTypeLabel(row.contentType) }}
          </template>
        </el-table-column>
        <el-table-column prop="createdByName" label="生成人" width="100" />
        <el-table-column label="生成时间" width="150">
          <template #default="{ row }: { row: SummaryArchive }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="字数" width="90">
          <template #default="{ row }: { row: SummaryArchive }">
            {{ wordCountLabel(row.wordCount) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: SummaryArchive }">
            <el-tag :type="statusTag(row.status).type">{{ statusTag(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="220" fixed="right">
          <template #default="{ row }: { row: SummaryArchive }">
            <el-button link type="primary" @click="loadDetail(row.id)">查看</el-button>
            <el-button link @click="exportSummaryWord(row.id)">Word</el-button>
            <el-button link @click="exportSummaryPptx(row.id)">PPT</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
