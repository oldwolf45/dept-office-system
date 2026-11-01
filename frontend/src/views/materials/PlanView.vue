<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listPlans,
  getPlan,
  createPlan,
  submitPlan,
  approvePlan,
  rejectPlan,
  summaryPlans
} from '@/api/materials'
import { useMaterialsAccess } from '@/composables/useMaterialsAccess'
import type { Plan, PlanItem, PlanStatus, PlanType, PlanSummaryResult, CreatePlanItemParams } from '@/types/materials'

const { hasRole } = useMaterialsAccess()
const canCreatePlan = (): boolean => hasRole('workshop_director', 'section_agent')
const canApprove = (): boolean => hasRole('workshop_manager', 'supply')

const STATUS_LABELS: Record<PlanStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回'
}
const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  workshop: '车间',
  section: '科室'
}

const list = ref<Plan[]>([])
const loading = ref(false)
const filters = reactive({ month: '', planType: '', status: '' })

const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive({
  month: '',
  planType: 'workshop' as PlanType,
  unitCode: '',
  unitName: '',
  items: [] as CreatePlanItemParams[]
})

const detailVisible = ref(false)
const detail = ref<Plan | null>(null)

const summary = ref<PlanSummaryResult | null>(null)

async function load() {
  loading.value = true
  try {
    list.value = await listPlans({
      month: filters.month,
      planType: filters.planType,
      status: filters.status
    })
    await loadSummary()
  } finally {
    loading.value = false
  }
}

async function loadSummary() {
  if (!filters.month) {
    summary.value = null
    return
  }
  try {
    summary.value = await summaryPlans(filters.month)
  } catch {
    summary.value = null
  }
}

function resetForm() {
  form.month = filters.month || ''
  form.planType = 'workshop'
  form.unitCode = ''
  form.unitName = ''
  form.items = [{ materialName: '', plannedQty: 1, referencePrice: 0, categoryId: null }]
}

function openCreate() {
  resetForm()
  dialogVisible.value = true
}

function addItem() {
  form.items.push({ materialName: '', plannedQty: 1, referencePrice: 0, categoryId: null })
}
function removeItem(idx: number) {
  form.items.splice(idx, 1)
}

async function submitCreate() {
  if (!/^\d{4}-\d{2}$/.test(form.month)) {
    ElMessage.warning('请选择月份')
    return
  }
  if (!form.unitCode.trim() || !form.unitName.trim()) {
    ElMessage.warning('请填写单位编码与名称')
    return
  }
  if (!form.items.length) {
    ElMessage.warning('至少添加一条物料')
    return
  }
  for (const it of form.items) {
    if (!it.materialName.trim()) {
      ElMessage.warning('物料名称不能为空')
      return
    }
    if (!(it.plannedQty > 0)) {
      ElMessage.warning(`物料「${it.materialName || '?'})」数量须大于0`)
      return
    }
  }
  submitting.value = true
  try {
    await createPlan({
      month: form.month,
      planType: form.planType,
      unitCode: form.unitCode.trim(),
      unitName: form.unitName.trim(),
      items: form.items.map((it) => ({
        materialName: it.materialName.trim(),
        plannedQty: it.plannedQty,
        referencePrice: it.referencePrice,
        categoryId: it.categoryId ?? null
      }))
    })
    ElMessage.success('已创建计划（草稿）')
    dialogVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function viewDetail(row: Plan) {
  detail.value = await getPlan(row.id)
  detailVisible.value = true
}

async function doSubmit(row: Plan) {
  await submitPlan(row.id)
  ElMessage.success('已提交')
  await load()
}

async function doApprove(row: Plan) {
  await approvePlan(row.id)
  ElMessage.success('已通过')
  await load()
}

async function doReject(row: Plan) {
  try {
    const { value } = await ElMessageBox.prompt('请填写驳回意见', '驳回计划', {
      inputType: 'textarea',
      inputValidator: (v) => (v && v.trim() ? true : '意见不能为空')
    })
    await rejectPlan(row.id, value.trim())
    ElMessage.success('已驳回')
    await load()
  } catch {
    /* 取消 */
  }
}

onMounted(load)
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">需求计划管理</h2>
      <el-button v-if="canCreatePlan()" type="primary" @click="openCreate">新增计划</el-button>
      <el-tag v-else type="info">当前角色仅可查看/提交</el-tag>
    </div>

    <!-- 筛选 -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <el-date-picker v-model="filters.month" type="month" value-format="YYYY-MM" placeholder="月份" clearable />
      <el-select v-model="filters.planType" placeholder="类型" clearable style="width: 120px">
        <el-option label="车间" value="workshop" />
        <el-option label="科室" value="section" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px">
        <el-option v-for="(l, k) in STATUS_LABELS" :key="k" :label="l" :value="k" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <!-- 计划列表 -->
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="planNo" label="单据号" width="170" />
      <el-table-column prop="month" label="月份" width="90" />
      <el-table-column label="类型" width="80">
        <template #default="{ row }">{{ PLAN_TYPE_LABELS[(row.planType as PlanType)] }}</template>
      </el-table-column>
      <el-table-column prop="unitName" label="填报单位" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : row.status === 'submitted' ? 'warning' : 'info'">
            {{ STATUS_LABELS[(row.status as PlanStatus)] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <el-button link type="primary" @click="viewDetail(row)">查看</el-button>
          <el-button v-if="row.status === 'draft'" link type="warning" @click="doSubmit(row)">提交</el-button>
          <el-button v-if="row.status === 'submitted' && canApprove()" link type="success" @click="doApprove(row)">通过</el-button>
          <el-button v-if="row.status === 'submitted' && canApprove()" link type="danger" @click="doReject(row)">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 供应科全厂汇总 -->
    <div v-if="summary" class="mt-6">
      <h3 class="text-base font-bold mb-2">全厂汇总（{{ summary.month }}）</h3>
      <el-alert :title="`共 ${summary.total} 份计划`" type="info" :closable="false" class="mb-2" />
      <el-table :data="summary.byUnit" border>
        <el-table-column prop="unitName" label="单位" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }">{{ PLAN_TYPE_LABELS[(row.planType as PlanType)] }}</template>
        </el-table-column>
        <el-table-column prop="count" label="计划数" width="90" />
        <el-table-column prop="approved" label="通过" width="90" />
        <el-table-column prop="rejected" label="驳回" width="90" />
      </el-table>
    </div>

    <!-- 新增计划 -->
    <el-dialog v-model="dialogVisible" title="新增需求计划（草稿）" width="760px">
      <el-form label-width="80px">
        <el-form-item label="月份" required>
          <el-date-picker v-model="form.month" type="month" value-format="YYYY-MM" placeholder="选择月份" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.planType">
            <el-radio value="workshop">车间</el-radio>
            <el-radio value="section">科室</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="单位" required>
          <el-input v-model="form.unitCode" placeholder="编码" style="width: 120px; margin-right: 8px" />
          <el-input v-model="form.unitName" placeholder="名称" style="width: 200px" />
        </el-form-item>
      </el-form>

      <el-divider>物料明细</el-divider>
      <el-table :data="form.items" border>
        <el-table-column label="物料名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.materialName" placeholder="名称" />
          </template>
        </el-table-column>
        <el-table-column label="计划数量" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.plannedQty" :min="0" :step="1" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="参考单价" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.referencePrice" :min="0" :precision="2" :step="1" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">{{ (Number(row.plannedQty) * Number(row.referencePrice)).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ $index }">
            <el-button link type="danger" @click="removeItem($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button class="mt-2" type="dashed" @click="addItem">+ 添加明细</el-button>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 计划详情 -->
    <el-dialog v-model="detailVisible" title="计划明细" width="680px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="单据号">{{ detail.planNo }}</el-descriptions-item>
          <el-descriptions-item label="月份">{{ detail.month }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ PLAN_TYPE_LABELS[detail.planType] }}</el-descriptions-item>
          <el-descriptions-item label="单位">{{ detail.unitName }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ STATUS_LABELS[detail.status] }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.rejectReason" label="驳回意见">{{ detail.rejectReason }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="(detail.items as PlanItem[]) || []" border class="mt-3">
          <el-table-column prop="materialName" label="物料" />
          <el-table-column prop="plannedQty" label="数量" width="90" />
          <el-table-column prop="referencePrice" label="单价" width="100" />
          <el-table-column prop="plannedAmount" label="金额" width="110" />
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>
