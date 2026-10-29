<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { activateUser, createUser, deactivateUser, getUsers } from '@/api/users'
import {
  assignBookkeeper,
  createDelegation,
  getBookkeeper,
  getDelegations,
  revokeDelegation
} from '@/api/accounting'
import type { Bookkeeper, Delegation, UserListItem, WorkListItem } from '@/types'
import { useUserStore } from '@/store/user'
import { delegationDurationDays, MAX_DELEGATION_DAYS, roleLabel } from '@/utils/permission'
import { getWorks, transferWork } from '@/api/work'

const userStore = useUserStore()

// ============ 下级列表 ============
const users = ref<UserListItem[]>([])
const loading = ref<boolean>(false)
const keyword = ref<string>('')

async function loadUsers(): Promise<void> {
  loading.value = true
  try {
    const res = await getUsers({ keyword: keyword.value || undefined })
    users.value = res.list || []
  } catch {
    users.value = []
  } finally {
    loading.value = false
  }
}

// ============ 新增直接下级 ============
const createVisible = ref<boolean>(false)
const creating = ref<boolean>(false)
const createFormRef = ref<FormInstance | null>(null)
const createForm = reactive({ userNo: '', name: '', initialPassword: '123456' })

// 角色下拉固定为当前用户下一级，不可改（契约 4.2：role 必须=操作人 level-1）
const directRole = computed<number>(() => (userStore.userInfo?.role ?? 1) - 1)
const directRoleLabel = computed(() => roleLabel(directRole.value))
const canCreate = computed<boolean>(() => (userStore.userInfo?.role ?? 1) > 1)

const createRules: FormRules<typeof createForm> = {
  userNo: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  initialPassword: [{ required: true, message: '请输入初始密码', trigger: 'blur' }]
}

function openCreate(): void {
  createForm.userNo = ''
  createForm.name = ''
  createForm.initialPassword = '123456'
  createVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return
  creating.value = true
  try {
    await createUser({
      userNo: createForm.userNo,
      name: createForm.name,
      role: directRole.value,
      deptCode: userStore.userInfo?.deptCode ?? '',
      initialPassword: createForm.initialPassword
    })
    ElMessage.success('创建成功')
    createVisible.value = false
    loadUsers()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    creating.value = false
  }
}

// ============ 停用/启用 ============
async function toggleStatus(row: UserListItem): Promise<void> {
  if (row.status === 'active') {
    await ElMessageBox.confirm(`确定停用 ${row.name} 的账号吗？停用后其历史数据保留。`, '停用确认', {
      type: 'warning'
    }).catch(() => 'cancel')
      .then(async (action) => {
        if (action !== 'confirm') return
        try {
          await deactivateUser(row.id)
          ElMessage.success('已停用')
          loadUsers()
        } catch {
          // 拦截器已展示后端拒绝原因（如：目标是记账员需先指定新记账员）
        }
      })
  } else {
    try {
      await activateUser(row.id)
      ElMessage.success('已启用')
      loadUsers()
    } catch {
      // 拦截器已提示
    }
  }
}

// ============ 工作交接真流程（契约 §5.5 / S3S4 契约 §3 transfer） ============
// 改派权：科长(3)改派副科长/科员；副科长(2)改派科员；其他角色不显示入口
const canTransfer = computed<boolean>(() => {
  const r = userStore.userInfo?.role ?? 1
  return r === 2 || r === 3
})

const handoverVisible = ref<boolean>(false)
const handoverUser = ref<UserListItem | null>(null)
const handoverWorks = ref<WorkListItem[]>([])
const selectedWorkIds = ref<number[]>([])
const handoverReceiverId = ref<number | undefined>(undefined)
const handoverReason = ref<string>('')
const handoverSubmitting = ref<boolean>(false)
/** el-table ref 最小接口（避免 element-plus 泛型组件的 InstanceType 兼容问题） */
interface HandoverTableRef {
  clearSelection(): void
  toggleRowSelection(row: WorkListItem, selected?: boolean): void
}
const handoverTableRef = ref<HandoverTableRef | null>(null)

/** 未完成工作 = 未开始/进行中；已完成/已取消/已改派不可选（契约 §5.5） */
function isUnfinished(w: WorkListItem): boolean {
  return w.status === '未开始' || w.status === '进行中'
}

async function openHandover(row: UserListItem): Promise<void> {
  handoverUser.value = row
  handoverVisible.value = true
  handoverWorks.value = []
  selectedWorkIds.value = []
  handoverReceiverId.value = undefined
  handoverReason.value = ''
  try {
    // 拉该人员名下全部工作，前端按状态过滤；未完成默认全选
    const res = await getWorks({
      scope: 'subordinates',
      assigneeId: row.id,
      page: 1,
      pageSize: 200
    })
    handoverWorks.value = res.list || []
    // 默认全选未完成行（selection-change 同步 selectedWorkIds）
    await nextTick()
    handoverTableRef.value?.clearSelection()
    handoverWorks.value.forEach((w) => {
      if (isUnfinished(w)) handoverTableRef.value?.toggleRowSelection(w, true)
    })
  } catch {
    handoverWorks.value = []
  }
}

async function submitHandover(): Promise<void> {
  if (!handoverUser.value) return
  if (!selectedWorkIds.value.length) {
    ElMessage.warning('请勾选要交接的未完成工作')
    return
  }
  if (!handoverReceiverId.value) {
    ElMessage.warning('请选择接收人')
    return
  }
  if (!handoverReason.value.trim()) {
    ElMessage.warning('请填写交接原因')
    return
  }
  handoverSubmitting.value = true
  const failed: string[] = []
  // 逐件提交（契约：一次可多件，按后端 transfer 接口逐件调用）
  for (const wid of selectedWorkIds.value) {
    try {
      await transferWork(wid, handoverReceiverId.value, handoverReason.value.trim())
    } catch (err) {
      const work = handoverWorks.value.find((w) => w.id === wid)
      failed.push(`${work?.name ?? wid}：${err instanceof Error ? err.message : '失败'}`)
    }
  }
  handoverSubmitting.value = false
  if (failed.length === 0) {
    ElMessage.success(`已交接 ${selectedWorkIds.value.length} 件工作`)
    handoverVisible.value = false
  } else {
    ElMessageBox.alert(`部分交接失败：\n${failed.join('\n')}`, '交接结果', { type: 'warning' })
  }
}

// ============ 记账员管理（仅科长） ============
const isSectionChief = computed<boolean>(() => userStore.userInfo?.role === 3)
const bookkeeper = ref<Bookkeeper | null>(null)
const assignVisible = ref<boolean>(false)
const assignForm = reactive({ userId: undefined as number | undefined })

// 可指定为记账员的对象：本科室在职科员
const clerkOptions = computed<UserListItem[]>(() =>
  users.value.filter((u) => u.role === 1 && u.status === 'active')
)

async function loadBookkeeper(): Promise<void> {
  if (!isSectionChief.value) return
  try {
    bookkeeper.value = await getBookkeeper()
  } catch {
    bookkeeper.value = null
  }
}

function openAssign(): void {
  assignForm.userId = bookkeeper.value?.userId
  assignVisible.value = true
}

async function submitAssign(): Promise<void> {
  if (!assignForm.userId) {
    ElMessage.warning('请选择要指定的科员')
    return
  }
  try {
    await assignBookkeeper(assignForm.userId)
    ElMessage.success('记账员已指定')
    assignVisible.value = false
    loadBookkeeper()
  } catch {
    // 拦截器已提示
  }
}

// ============ 代录授权（仅科长） ============
const delegations = ref<Delegation[]>([])
const delegationForm = reactive({ delegateId: undefined as number | undefined })
const delegationRange = ref<[string, string] | null>(null)

async function loadDelegations(): Promise<void> {
  if (!isSectionChief.value) return
  try {
    delegations.value = await getDelegations()
  } catch {
    delegations.value = []
  }
}

async function submitDelegation(): Promise<void> {
  if (!delegationForm.delegateId) {
    ElMessage.warning('请选择代录人（科员）')
    return
  }
  const range = delegationRange.value
  if (!range || range.length !== 2) {
    ElMessage.warning('请选择授权起止时间')
    return
  }
  const [start, end] = range
  const days = delegationDurationDays(start, end)
  if (days <= 0) {
    ElMessage.warning('结束时间必须晚于开始时间')
    return
  }
  if (days > MAX_DELEGATION_DAYS) {
    ElMessage.warning(`单次代录授权不得超过 ${MAX_DELEGATION_DAYS} 天（当前约 ${days.toFixed(1)} 天）`)
    return
  }
  try {
    await createDelegation({ delegateId: delegationForm.delegateId, startTime: start, endTime: end })
    ElMessage.success('授权成功')
    delegationForm.delegateId = undefined
    delegationRange.value = null
    loadDelegations()
  } catch {
    // 拦截器已提示（如已有有效授权）
  }
}

async function handleRevoke(row: Delegation): Promise<void> {
  await ElMessageBox.confirm(`确定提前收回对 ${row.delegateName} 的代录授权吗？`, '收回确认', {
    type: 'warning'
  }).catch(() => 'cancel')
    .then(async (action) => {
      if (action !== 'confirm') return
      try {
        await revokeDelegation(row.id)
        ElMessage.success('已收回')
        loadDelegations()
      } catch {
        // 拦截器已提示
      }
    })
}

const delegationStatusLabel: Record<Delegation['status'], string> = {
  active: '生效中',
  revoked: '已收回',
  expired: '已过期'
}

onMounted(() => {
  loadUsers()
  loadBookkeeper()
  loadDelegations()
})
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">人员管理</h1>
      <div>
        <el-input
          v-model="keyword"
          placeholder="搜索工号/姓名"
          class="!w-48 mr-2"
          clearable
          @keyup.enter="loadUsers"
          @clear="loadUsers"
        />
        <el-button @click="loadUsers">查询</el-button>
        <el-button v-if="canCreate" type="primary" @click="openCreate">新增直接下级</el-button>
      </div>
    </div>

    <el-table :data="users" v-loading="loading" border>
      <el-table-column prop="userNo" label="工号" width="100" />
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }: { row: UserListItem }">{{ roleLabel(row.role) }}</template>
      </el-table-column>
      <el-table-column prop="deptName" label="科室" min-width="140" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }: { row: UserListItem }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
            {{ row.status === 'active' ? '在职' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="记账员" width="90">
        <template #default="{ row }: { row: UserListItem }">
          <el-tag v-if="row.isBookkeeper === 1" type="warning">是</el-tag>
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230">
        <template #default="{ row }: { row: UserListItem }">
          <el-button
            v-if="row.id !== userStore.userInfo?.id"
            size="small"
            :type="row.status === 'active' ? 'danger' : 'success'"
            @click="toggleStatus(row)"
          >
            {{ row.status === 'active' ? '停用' : '启用' }}
          </el-button>
          <el-button v-if="canTransfer" size="small" @click="openHandover(row)">工作交接</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 记账员管理区：仅科长可见 -->
    <el-card v-if="isSectionChief" class="mt-6">
      <template #header><span class="font-bold">记账员管理</span></template>
      <div class="mb-3">
        当前记账员：
        <b v-if="bookkeeper">{{ bookkeeper.name }}（{{ bookkeeper.userNo }}）</b>
        <span v-else class="text-gray-400">未指定</span>
      </div>
      <el-button type="primary" @click="openAssign">指定/更换记账员</el-button>
    </el-card>

    <!-- 代录授权区：仅科长可见 -->
    <el-card v-if="isSectionChief" class="mt-6">
      <template #header><span class="font-bold">代录授权</span></template>
      <el-form inline>
        <el-form-item label="代录人">
          <el-select v-model="delegationForm.delegateId" placeholder="选择在职科员" style="width: 160px">
            <el-option
              v-for="u in clerkOptions"
              :key="u.id"
              :label="`${u.name}（${u.userNo}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="delegationRange"
            type="datetimerange"
            value-format="YYYY-MM-DD HH:mm:ss"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitDelegation">新建授权</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="delegations" border class="mt-2">
        <el-table-column prop="delegateName" label="代录人" width="120" />
        <el-table-column prop="startTime" label="开始时间" width="170" />
        <el-table-column prop="endTime" label="结束时间" width="170" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }: { row: Delegation }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">
              {{ delegationStatusLabel[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作">
          <template #default="{ row }: { row: Delegation }">
            <el-button v-if="row.status === 'active'" size="small" type="danger" @click="handleRevoke(row)">
              提前收回
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增直接下级对话框 -->
    <el-dialog v-model="createVisible" title="新增直接下级" width="480px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="工号" prop="userNo">
          <el-input v-model="createForm.userNo" placeholder="科室编码+序号，如 01007" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-input :model-value="directRoleLabel" disabled />
        </el-form-item>
        <el-form-item label="初始密码" prop="initialPassword">
          <el-input v-model="createForm.initialPassword" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">确定</el-button>
      </template>
    </el-dialog>

    <!-- 指定记账员对话框 -->
    <el-dialog v-model="assignVisible" title="指定/更换记账员" width="420px">
      <el-select v-model="assignForm.userId" placeholder="选择在职科员" style="width: 100%">
        <el-option
          v-for="u in clerkOptions"
          :key="u.id"
          :label="`${u.name}（${u.userNo}）`"
          :value="u.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssign">确定</el-button>
      </template>
    </el-dialog>

    <!-- 工作交接对话框：选人员 → 勾选未完成工作 → 选接收人 → 填原因 -->
    <el-dialog v-model="handoverVisible" :title="`工作交接：${handoverUser?.name ?? ''}（${handoverUser?.userNo ?? ''}）`" width="640px">
      <div class="mb-2 text-sm text-gray-600">勾选要交接的未完成工作（已完成/已取消不可选）：</div>
      <el-table
        ref="handoverTableRef"
        :data="handoverWorks"
        border
        max-height="260"
        @selection-change="(rows: WorkListItem[]) => (selectedWorkIds = rows.map((r) => r.id))"
      >
        <el-table-column type="selection" width="46" :selectable="(row: WorkListItem) => isUnfinished(row)" />
        <el-table-column prop="name" label="工作名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="category" label="类别" width="120" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: WorkListItem }">
            <el-tag :type="row.status === '进行中' ? 'warning' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-form label-width="90px" class="mt-4">
        <el-form-item label="接收人">
          <el-select v-model="handoverReceiverId" placeholder="权限范围内本科室人员" style="width: 100%">
            <el-option
              v-for="u in users.filter((x) => x.id !== handoverUser?.id)"
              :key="u.id"
              :label="`${u.name}（${u.userNo} · ${roleLabel(u.role)}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交接原因">
          <el-input v-model="handoverReason" type="textarea" :rows="2" placeholder="必填，留痕可查" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handoverVisible = false">取消</el-button>
        <el-button type="primary" :loading="handoverSubmitting" @click="submitHandover">确认交接</el-button>
      </template>
    </el-dialog>
  </div>
</template>
