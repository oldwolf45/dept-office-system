<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useUserStore } from '@/store/user'
import type {
  AssignableTarget,
  DictItem,
  UserListItem,
  WorkListItem,
  WorkStatus
} from '@/types'
import { getWorks, createWork, getCoworkers, getAssignableUsers } from '@/api/work'
import { getActiveDicts } from '@/api/dict'
import { ASSIGNED_CATEGORY_LABEL, isDueAfterStart } from '@/utils/work'
import { formatDate } from '@/utils/format'
import WorkTabs from './components/WorkTabs.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

/** 首页概览数字跳转的附加筛选（S11 F40：overdue/dueThisWeek/stalled，后端对齐后生效） */
const extraFilter = ref<{ overdue?: string; dueThisWeek?: string; stalled?: string }>({})

// ==================== 列表 ====================
const STATUS_OPTIONS: Array<{ label: string; value: WorkStatus | '' }> = [
  { label: '全部状态', value: '' },
  { label: '未开始', value: '未开始' },
  { label: '进行中', value: '进行中' },
  { label: '已完成', value: '已完成' },
  { label: '已取消', value: '已取消' },
  { label: '已改派', value: '已改派' }
]

const list = ref<WorkListItem[]>([])
const loading = ref<boolean>(false)
const statusFilter = ref<WorkStatus | ''>('')
const keyword = ref<string>('')
const page = ref<number>(1)
const pageSize = ref<number>(10)
const total = ref<number>(0)

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const res = await getWorks({
      scope: 'mine',
      status: statusFilter.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
      overdue: extraFilter.value.overdue,
      dueThisWeek: extraFilter.value.dueThisWeek,
      stalled: extraFilter.value.stalled
    })
    list.value = res.list || []
    total.value = res.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function handleSearch(): void {
  page.value = 1
  loadList()
}

function goDetail(row: WorkListItem): void {
  router.push(`/work/${row.id}`)
}

// ==================== 新建 / 指派弹窗 ====================
const dialogVisible = ref<boolean>(false)
const submitting = ref<boolean>(false)
const formRef = ref<FormInstance | null>(null)

const today = formatDate(new Date())
const form = reactive({
  name: '',
  category: '',
  priority: '',
  content: '',
  startTime: today,
  dueTime: '',
  collaboratorIds: [] as number[],
  assigneeId: undefined as number | undefined
})

const categoryOptions = ref<DictItem[]>([])
const priorityOptions = ref<DictItem[]>([])
const coworkerOptions = ref<UserListItem[]>([])
const assignableTargets = ref<AssignableTarget[]>([])

// 指派时类别强制"上级安排工作"（契约 §2.3），前端禁用类别选择
const forcedAssigned = computed<boolean>(() => form.assigneeId != null)

async function openDialog(): Promise<void> {
  dialogVisible.value = true
  form.name = ''
  form.category = ''
  form.content = ''
  form.startTime = today
  form.dueTime = ''
  form.collaboratorIds = []
  form.assigneeId = undefined
  // 动态字典，不写死（契约 §1：新增字典后即时出现在下拉）
  if (categoryOptions.value.length === 0) {
    categoryOptions.value = await getActiveDicts('work_category').catch(() => [])
  }
  if (priorityOptions.value.length === 0) {
    priorityOptions.value = await getActiveDicts('priority').catch(() => [])
    form.priority = '普通'
  }
  if (coworkerOptions.value.length === 0) {
    coworkerOptions.value = await getCoworkers().catch(() => [])
  }
  if (assignableTargets.value.length === 0) {
    assignableTargets.value = await getAssignableUsers().catch(() => [])
  }
}

const validateDue = (_rule: unknown, value: string, callback: (e?: Error) => void): void => {
  if (!value) {
    callback(new Error('请选择计划完成时间'))
  } else if (!isDueAfterStart(form.startTime, value)) {
    callback(new Error('计划完成时间不能早于开始时间'))
  } else {
    callback()
  }
}

const rules: FormRules<typeof form> = {
  name: [
    { required: true, message: '请输入工作名称', trigger: 'blur' },
    { min: 2, max: 100, message: '工作名称 2-100 字', trigger: 'blur' }
  ],
  category: [{ required: true, message: '请选择工作类别', trigger: 'change' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
  content: [{ required: true, message: '请输入工作内容', trigger: 'blur' }],
  startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  dueTime: [{ required: true, validator: validateDue, trigger: 'change' }]
}

async function submit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await createWork({
      name: form.name.trim(),
      category: forcedAssigned.value ? ASSIGNED_CATEGORY_LABEL : form.category,
      content: form.content.trim(),
      startTime: form.startTime,
      dueTime: form.dueTime,
      priority: form.priority,
      collaboratorIds: form.collaboratorIds,
      assigneeId: form.assigneeId
    })
    ElMessage.success(form.assigneeId ? '指派成功' : '创建成功')
    dialogVisible.value = false
    loadList()
  } catch {
    // 拦截器已提示（后端校验越界指派 / 类别唯一等）
  } finally {
    submitting.value = false
  }
}

// ==================== 状态标签样式 ====================
function statusTagType(status: WorkStatus): 'success' | 'warning' | 'info' | 'danger' {
  switch (status) {
    case '进行中':
      return 'warning'
    case '已完成':
      return 'success'
    case '已取消':
      return 'info'
    case '已改派':
      return 'info'
    default:
      return 'info'
  }
}

onMounted(() => {
  // 首页概览数字带筛选跳转（F40）：?status= / ?overdue=1 / ?dueThisWeek=1 / ?stalled=1
  const q = route.query
  if (typeof q.status === 'string' && STATUS_OPTIONS.some((o) => o.value === q.status)) {
    statusFilter.value = q.status as WorkStatus
  }
  if (q.overdue === '1') extraFilter.value.overdue = '1'
  if (q.dueThisWeek === '1') extraFilter.value.dueThisWeek = '1'
  if (q.stalled === '1') extraFilter.value.stalled = '1'
  loadList()
})
</script>

<template>
  <div class="p-3 md:p-6">
    <div class="mb-4 flex items-center justify-between">
      <WorkTabs />
      <el-button type="primary" @click="openDialog">新建工作</el-button>
    </div>

    <div class="mb-3 flex items-center gap-2 flex-wrap">
      <el-select v-model="statusFilter" style="width: 140px" @change="handleSearch">
        <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索工作名称"
        class="!w-40 md:!w-60"
        clearable
        @keyup.enter="handleSearch"
        @clear="handleSearch"
      />
      <el-button type="primary" @click="handleSearch">查询</el-button>
    </div>

    <!-- 手机端卡片列表 + 桌面端表格（同一数据源，S13 契约 §1.1） -->
    <div v-loading="loading">
    <!-- 手机端卡片 -->
    <div class="md:hidden space-y-2">
      <el-empty v-if="!list.length" description="暂无工作" :image-size="60" />
      <div
        v-for="row in list"
        :key="row.id"
        class="border rounded p-3 bg-white cursor-pointer"
        @click="goDetail(row)"
      >
        <div class="flex justify-between items-start gap-2">
          <b class="min-w-0 break-words">{{ row.name }}</b>
          <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
        </div>
        <div class="text-sm text-gray-500 mt-1">
          {{ row.category }} · {{ row.assigneeName }} · 计划完成 {{ formatDate(row.dueTime) }}
        </div>
        <el-tag v-if="row.isStalled" type="danger" size="small" class="mt-1">
          停滞{{ row.stalledDays ? row.stalledDays + '天' : '' }}
        </el-tag>
      </div>
    </div>

    <!-- 桌面端表格 -->
    <el-table :data="list" border class="hidden md:block">
      <el-table-column prop="name" label="名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="category" label="类别" width="130" />
      <el-table-column label="负责人" width="110">
        <template #default="{ row }: { row: WorkListItem }">{{ row.assigneeName }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }: { row: WorkListItem }">
          <el-tag :type="statusTagType(row.status)">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="priority" label="优先级" width="90" />
      <el-table-column label="计划完成" width="120">
        <template #default="{ row }: { row: WorkListItem }">{{ formatDate(row.dueTime) }}</template>
      </el-table-column>
      <el-table-column label="停滞标记" width="110">
        <template #default="{ row }: { row: WorkListItem }">
          <el-tag v-if="row.isStalled" type="danger">
            停滞{{ row.stalledDays ? row.stalledDays + '天' : '' }}
          </el-tag>
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }: { row: WorkListItem }">
          <el-button size="small" type="primary" link @click="goDetail(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-pagination
      class="mt-4 justify-end"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="loadList"
    />

    <!-- 新建 / 指派弹窗 -->
    <el-dialog v-model="dialogVisible" :title="forcedAssigned ? '新建并指派工作' : '新建工作'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="工作名称" prop="name">
          <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="2-100 字" />
        </el-form-item>
        <el-form-item label="工作类别" prop="category">
          <el-select
            v-model="form.category"
            :disabled="forcedAssigned"
            placeholder="请选择类别"
            style="width: 100%"
          >
            <el-option v-for="d in categoryOptions" :key="d.id" :label="d.label" :value="d.label" />
          </el-select>
          <div v-if="forcedAssigned" class="text-xs text-orange-500">
            指派工作类别固定为"{{ ASSIGNED_CATEGORY_LABEL }}"
          </div>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-select v-model="form.priority" placeholder="请选择优先级" style="width: 100%">
            <el-option v-for="d in priorityOptions" :key="d.id" :label="d.label" :value="d.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="工作内容" prop="content">
          <el-input v-model="form.content" type="textarea" :rows="4" maxlength="5000" show-word-limit />
        </el-form-item>
        <el-form-item label="开始时间" prop="startTime">
          <el-date-picker v-model="form.startTime" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="计划完成" prop="dueTime">
          <el-date-picker v-model="form.dueTime" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="协作者">
          <el-select
            v-model="form.collaboratorIds"
            multiple
            placeholder="本科室成员（可多选，可不选）"
            style="width: 100%"
          >
            <el-option
              v-for="u in coworkerOptions"
              :key="u.id"
              :label="`${u.name}（${u.userNo}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="指派对象">
          <el-select
            v-model="form.assigneeId"
            placeholder="不选=本人登记；选择后即指派给对方"
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="u in assignableTargets"
              :key="u.id"
              :label="`${u.name}（${u.userNo}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>
