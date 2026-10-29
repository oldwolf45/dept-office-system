<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useUserStore } from '@/store/user'
import { roleLabel } from '@/utils/permission'
import { getLoginLogs, getOperationLogs } from '@/api/logs'
import BackupPanel from './components/BackupPanel.vue'
import {
  createDict,
  disableDict,
  enableDict,
  getManageDicts,
  updateDict
} from '@/api/dict'
import { getStallDays, saveStallDays } from '@/api/settings'
import { DEFAULT_STALL_DAYS, isStallDaysValid, STALL_DAYS_MAX, STALL_DAYS_MIN } from '@/utils/work'
import type { DictItem, DictType, LoginLog, OperationLog } from '@/types'

const userStore = useUserStore()
const route = useRoute()
const user = computed(() => userStore.userInfo)
/** 首页 backupFailure 待办跳转 ?tab=backup 时高亮备份区 */
const backupAnchor = ref<boolean>(false)

// 日志区：科长及以上（level>=3，契约 4.5）
const isSenior = computed<boolean>(() => (userStore.userInfo?.role ?? 0) >= 3)
// 备份/字典：仅科长（契约 2.4）
const isSectionChief = computed<boolean>(() => userStore.userInfo?.role === 3)

// ============ 修改本人密码 ============
const pwdVisible = ref<boolean>(false)
const pwdLoading = ref<boolean>(false)
const pwdFormRef = ref<FormInstance | null>(null)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const validateConfirm = (_rule: unknown, value: string, callback: (e?: Error) => void): void => {
  if (!value) {
    callback(new Error('请再次输入新密码'))
  } else if (value !== pwdForm.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const pwdRules: FormRules<typeof pwdForm> = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' }
  ],
  confirmPassword: [{ required: true, validator: validateConfirm, trigger: 'blur' }]
}

async function submitPassword(): Promise<void> {
  if (!pwdFormRef.value) return
  const valid = await pwdFormRef.value.validate().catch(() => false)
  if (!valid) return
  pwdLoading.value = true
  try {
    await userStore.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    ElMessage.success('密码修改成功')
    pwdVisible.value = false
  } catch {
    // 拦截器已提示
  } finally {
    pwdLoading.value = false
  }
}

// ============ 操作记录 ============
const operationLogs = ref<OperationLog[]>([])
async function loadOperationLogs(): Promise<void> {
  if (!isSenior.value) return
  try {
    const res = await getOperationLogs()
    operationLogs.value = res.list || []
  } catch {
    operationLogs.value = []
  }
}

// ============ 登录日志 ============
const loginLogs = ref<LoginLog[]>([])
async function loadLoginLogs(): Promise<void> {
  if (!isSenior.value) return
  try {
    const res = await getLoginLogs()
    loginLogs.value = res.list || []
  } catch {
    loginLogs.value = []
  }
}

function loginLogRowClass({ row }: { row: LoginLog }): string {
  // abnormal=1 标红（连续失败≥5，契约第3节）
  return row.abnormal === 1 ? 'abnormal-row' : ''
}

// ============ 字典维护（S3，契约 §1；仅科长渲染） ============
const DICT_TABS: Array<{ type: DictType; label: string }> = [
  { type: 'work_category', label: '工作类别' },
  { type: 'priority', label: '优先级' },
  { type: 'item_category', label: '物品分类' },
  { type: 'status_tag', label: '状态标签' }
]

const activeDictType = ref<DictType>('work_category')
const dictList = ref<DictItem[]>([])
const dictLoading = ref<boolean>(false)

/** "上级安排工作"指派依赖，禁止停用（契约 §1） */
const PROTECTED_LABEL = '上级安排工作'

async function loadDicts(): Promise<void> {
  if (!isSectionChief.value) return
  dictLoading.value = true
  try {
    dictList.value = await getManageDicts(activeDictType.value)
  } catch {
    dictList.value = []
  } finally {
    dictLoading.value = false
  }
}

// 新增/编辑弹窗
const dictDialogVisible = ref<boolean>(false)
const dictEditing = ref<DictItem | null>(null)
const dictForm = reactive({ label: '', code: '', sortOrder: 1 })
const dictSaving = ref<boolean>(false)

function openDictCreate(): void {
  dictEditing.value = null
  dictForm.label = ''
  dictForm.code = ''
  dictForm.sortOrder = 1
  dictDialogVisible.value = true
}

function openDictEdit(row: DictItem): void {
  dictEditing.value = row
  dictForm.label = row.label
  dictForm.code = row.code || ''
  dictForm.sortOrder = row.sortOrder
  dictDialogVisible.value = true
}

async function submitDict(): Promise<void> {
  if (!dictForm.label.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  dictSaving.value = true
  try {
    if (dictEditing.value) {
      await updateDict(dictEditing.value.id, {
        label: dictForm.label.trim(),
        sortOrder: Number(dictForm.sortOrder)
      })
      ElMessage.success('已修改')
    } else {
      await createDict({
        type: activeDictType.value,
        label: dictForm.label.trim(),
        code: dictForm.code.trim() || undefined,
        sortOrder: Number(dictForm.sortOrder)
      })
      ElMessage.success('已新增，新建工作下拉即时可见')
    }
    dictDialogVisible.value = false
    loadDicts()
  } catch {
    // 拦截器已提示（同 type 下 label 唯一冲突等）
  } finally {
    dictSaving.value = false
  }
}

async function toggleDictStatus(row: DictItem): Promise<void> {
  try {
    if (row.status === 'active') {
      await disableDict(row.id)
      ElMessage.success('已停用，下拉不再显示')
    } else {
      await enableDict(row.id)
      ElMessage.success('已启用')
    }
    loadDicts()
  } catch {
    // 拦截器已提示（"上级安排工作"禁止停用）
  }
}

// ============ 停滞预警阈值（S3，契约 §2.7；仅科长，3-30，默认7） ============
const stallDays = ref<number>(DEFAULT_STALL_DAYS)
const stallLoading = ref<boolean>(false)
const stallSaving = ref<boolean>(false)

async function loadStallDays(): Promise<void> {
  if (!isSectionChief.value) return
  stallLoading.value = true
  try {
    const res = await getStallDays()
    stallDays.value = res?.days || DEFAULT_STALL_DAYS
  } catch {
    stallDays.value = DEFAULT_STALL_DAYS
  } finally {
    stallLoading.value = false
  }
}

async function submitStallDays(): Promise<void> {
  if (!isStallDaysValid(stallDays.value)) {
    ElMessage.warning(`阈值须为 ${STALL_DAYS_MIN}-${STALL_DAYS_MAX} 的整数`)
    return
  }
  stallSaving.value = true
  try {
    await saveStallDays(stallDays.value)
    ElMessage.success('已保存，停滞判定按新阈值即时重算')
  } catch {
    // 拦截器已提示
  } finally {
    stallSaving.value = false
  }
}

onMounted(() => {
  // 首页 backupFailure 待办跳转：?tab=backup 高亮备份区
  backupAnchor.value = route.query.tab === 'backup'
  loadOperationLogs()
  loadLoginLogs()
  loadDicts()
  loadStallDays()
})
</script>

<template>
  <div class="p-3 md:p-8">
    <h1 class="text-xl font-bold mb-4">系统设置</h1>

    <!-- 个人信息区：所有人可见 -->
    <el-card>
      <template #header><span class="font-bold">个人信息</span></template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="姓名">{{ user?.name }}</el-descriptions-item>
        <el-descriptions-item label="工号">{{ user?.userNo }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ roleLabel(user?.role ?? 0) }}</el-descriptions-item>
        <el-descriptions-item label="科室">{{ user?.deptName }}</el-descriptions-item>
      </el-descriptions>
      <el-button class="mt-3" type="primary" @click="pwdVisible = true">修改本人密码</el-button>
    </el-card>

    <!-- 备份恢复区（S12，仅科长渲染；首页 backupFailure 待办 ?tab=backup 跳转高亮） -->
    <BackupPanel v-if="isSectionChief" class="mt-4" :class="backupAnchor ? 'backup-anchor' : ''" />

    <!-- 字典维护：仅科长（S3 契约 §1） -->
    <el-card v-if="isSectionChief" class="mt-4">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">字典维护</span>
          <el-button type="primary" size="small" @click="openDictCreate">新增字典项</el-button>
        </div>
      </template>
      <el-tabs v-model="activeDictType" @tab-change="loadDicts">
        <el-tab-pane v-for="t in DICT_TABS" :key="t.type" :label="t.label" :name="t.type" />
      </el-tabs>
      <el-table :data="dictList" v-loading="dictLoading" border>
        <el-table-column prop="label" label="名称" min-width="160" />
        <el-table-column prop="code" label="编码" width="120">
          <template #default="{ row }: { row: DictItem }">{{ row.code || '-' }}</template>
        </el-table-column>
        <el-table-column prop="sortOrder" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: DictItem }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }: { row: DictItem }">
            <el-button size="small" link type="primary" @click="openDictEdit(row)">编辑</el-button>
            <el-button
              size="small"
              link
              :type="row.status === 'active' ? 'danger' : 'success'"
              :disabled="row.status === 'active' && row.label === PROTECTED_LABEL"
              @click="toggleDictStatus(row)"
            >
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 停滞预警设置：仅科长（契约 §2.7，3-30 默认7） -->
    <el-card v-if="isSectionChief" class="mt-4">
      <template #header><span class="font-bold">停滞预警设置</span></template>
      <div v-loading="stallLoading" class="flex items-center gap-3">
        <span>进行中工作超过</span>
        <el-input-number v-model="stallDays" :min="STALL_DAYS_MIN" :max="STALL_DAYS_MAX" :step="1" />
        <span>天无进度更新即标记停滞（默认 {{ DEFAULT_STALL_DAYS }} 天）</span>
        <el-button type="primary" :loading="stallSaving" @click="submitStallDays">保存</el-button>
      </div>
    </el-card>

    <!-- 字典新增/编辑弹窗 -->
    <el-dialog v-model="dictDialogVisible" :title="dictEditing ? '编辑字典项' : '新增字典项'" width="460px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="dictForm.label" maxlength="50" placeholder="必填，同类型下唯一" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="dictForm.code" placeholder="可选" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dictForm.sortOrder" :min="1" :max="999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dictDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dictSaving" @click="submitDict">保存</el-button>
      </template>
    </el-dialog>

    <!-- 操作记录区：科长及以上 -->
    <el-card v-if="isSenior" class="mt-4">
      <template #header><span class="font-bold">操作记录</span></template>
      <el-table :data="operationLogs" border>
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column prop="operatorName" label="操作人" width="100" />
        <el-table-column prop="actionType" label="动作" width="120" />
        <el-table-column prop="targetType" label="对象类型" width="120" />
        <el-table-column prop="detail" label="详情" />
      </el-table>
    </el-card>

    <!-- 登录日志区：科长及以上 -->
    <el-card v-if="isSenior" class="mt-4">
      <template #header><span class="font-bold">登录日志</span></template>
      <el-table :data="loginLogs" border :row-class-name="loginLogRowClass">
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column prop="userNo" label="工号" width="90" />
        <el-table-column prop="userName" label="姓名" width="90" />
        <el-table-column prop="ip" label="IP" width="130" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }: { row: LoginLog }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="异常">
          <template #default="{ row }: { row: LoginLog }">
            <el-tag v-if="row.abnormal === 1" type="danger">异常</el-tag>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
:deep(.abnormal-row) {
  background-color: #fef0f0;
}
:deep(.backup-anchor) {
  box-shadow: 0 0 0 2px #409eff;
}
</style>
