<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import {
  abortRestore,
  confirmRestore,
  createManualBackup,
  downloadBackupBlob,
  getBackupStorage,
  getBackups,
  getRestoreStatus,
  previewRestoreBlob
} from '@/api/admin'
import type { BackupCreateResult, BackupRecord, RestoreConfirmResult, RestorePreview, StorageInfo } from '@/types'
import { backupStatusLabel, backupTypeLabel, buildRestoreConfirm, RESTORE_OVERWRITE_LITERAL } from '@/utils/dashboard'
import { formatBytes, formatDateTime, shortSha256 } from '@/utils/format'

const router = useRouter()
const userStore = useUserStore()

// ============ 数据加载 ============
const backups = ref<BackupRecord[]>([])
const storage = ref<StorageInfo | null>(null)
const listLoading = ref<boolean>(false)

async function loadBackups(): Promise<void> {
  listLoading.value = true
  try {
    backups.value = await getBackups()
  } catch {
    backups.value = []
  } finally {
    listLoading.value = false
  }
  refreshAutoStatus()
}

async function loadStorage(): Promise<void> {
  try {
    storage.value = await getBackupStorage()
  } catch {
    storage.value = null
  }
}

onMounted(() => {
  loadBackups()
  loadStorage()
})

// ============ 手动备份 ============
type BackupState = 'idle' | 'waiting' | 'done' | 'failed'
const backupState = ref<BackupState>('idle')
const backupResult = ref<BackupCreateResult | null>(null)

async function handleManualBackup(): Promise<void> {
  backupState.value = 'waiting'
  backupResult.value = null
  try {
    const res = await createManualBackup()
    backupResult.value = res
    backupState.value = 'done'
    // 完成后立即下载（blob）
    try {
      const blob = await downloadBackupBlob(res.id)
      saveBlob(blob, res.name)
      ElMessage.success('备份完成，已开始下载')
    } catch {
      ElMessage.warning('备份已完成，下载失败可稍后在记录列表手动下载')
    }
    await Promise.all([loadBackups(), loadStorage()])
  } catch {
    backupState.value = 'failed'
    // 拦截器已提示失败原因（不生成半成品）
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function handleDownload(row: BackupRecord): Promise<void> {
  try {
    const blob = await downloadBackupBlob(row.id)
    saveBlob(blob, row.fileName)
  } catch {
    // 拦截器已提示
  }
}

// ============ 自动备份状态（最近7份 auto） ============
const autoBackups = ref<BackupRecord[]>([])
const autoFailedCount = ref<number>(0)
// computed-like：随 backups 刷新派生
function refreshAutoStatus(): void {
  const autos = backups.value.filter((b) => b.type === 'auto').slice(0, 7)
  autoBackups.value = autos
  autoFailedCount.value = backups.value.filter((b) => b.type === 'auto' && b.status === 'failed').length
}

// ============ 恢复向导（固定8步） ============
const wizardVisible = ref<boolean>(false)
const currentStep = ref<number>(0)
// 1 上传 / 2 校验中 / 3 预览 / 4 二次确认 / 5 恢复中 / 6 校验结果 / 7 完成(重新登录)
const STEPS = ['上传备份文件', '校验文件', '预览备份内容', '二次确认', '恢复中', '恢复校验', '恢复结果', '重新登录']

const selectedFile = ref<File | null>(null)
const preview = ref<RestorePreview | null>(null)
const restoreResult = ref<RestoreConfirmResult | null>(null)
const restoreError = ref<string>('')
const overwriteInput = ref<string>('')
const restoring = ref<boolean>(false)

function openWizard(): void {
  wizardVisible.value = true
  currentStep.value = 0
  selectedFile.value = null
  preview.value = null
  restoreResult.value = null
  restoreError.value = ''
  overwriteInput.value = ''
  restoring.value = false
}

function onFileChange(file: { raw?: File }): void {
  if (file.raw) selectedFile.value = file.raw
}

/** 第1步 → 校验（上传 ZIP → 完整性/清单/逐文件SHA/版本） */
async function doPreview(): Promise<void> {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择备份 ZIP 文件')
    return
  }
  restoreError.value = ''
  currentStep.value = 1
  try {
    preview.value = await previewRestoreBlob(selectedFile.value)
    currentStep.value = 2
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : '校验失败'
    currentStep.value = 0
    ElMessage.error(`备份校验未通过：${restoreError.value}（当前数据不受影响）`)
  }
}

/** 第3步二次确认：必须输入字面量，否则按钮禁用 */
const overwriteMatched = ref<boolean>(false)
function onOverwriteInput(): void {
  overwriteMatched.value = overwriteInput.value === RESTORE_OVERWRITE_LITERAL
}

/** 第4步 → 确认恢复（前端先做字面量校验，与后端契约一致） */
async function doConfirm(): Promise<void> {
  if (!preview.value) return
  const payload = buildRestoreConfirm(preview.value.previewToken, overwriteInput.value)
  if (!payload) {
    ElMessage.warning(`必须输入"${RESTORE_OVERWRITE_LITERAL}"才能继续`)
    return
  }
  restoring.value = true
  restoreError.value = ''
  currentStep.value = 4
  try {
    restoreResult.value = await confirmRestore(payload.previewToken, payload.overwrite)
    currentStep.value = 5
  } catch (e) {
    restoreError.value = e instanceof Error ? e.message : '恢复失败'
    // 恢复中失败：可回滚，当前数据已被后端自动恢复原状
    ElMessageBox.alert(
      `恢复失败：${restoreError.value}。系统已自动回滚到恢复前状态，当前数据不受影响。`,
      '恢复失败',
      { confirmButtonText: '知道了', type: 'error' }
    ).catch(() => undefined)
  } finally {
    restoring.value = false
  }
}

/** 恢复过程中失败时回滚（保留临时备份） */
async function handleAbort(): Promise<void> {
  try {
    await abortRestore()
    ElMessage.success('已回滚到恢复前状态，临时备份已保留')
  } catch {
    // 拦截器已提示
  }
}

/** 最后一步：重新登录（JWT 用户数据已替换） */
function doRelogin(): void {
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="flex items-center justify-between">
        <span class="font-bold">备份与恢复（仅科长）</span>
        <el-button v-permission="'backup'" type="primary" @click="openWizard">恢复数据</el-button>
      </div>
    </template>

    <!-- 手动备份 -->
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <el-button
        v-permission="'backup'"
        type="primary"
        :loading="backupState === 'waiting'"
        @click="handleManualBackup"
      >
        手动备份
      </el-button>
      <span v-if="backupState === 'waiting'" class="text-gray-500">等待中，正在生成备份包…</span>
      <span v-else-if="backupState === 'done'" class="text-green-600">
        完成：{{ backupResult?.name }}（{{ backupResult ? formatBytes(backupResult.size) : '' }}）
      </span>
      <span v-else-if="backupState === 'failed'" class="text-red-500">备份失败，请查看提示原因（原数据不受影响）</span>
    </div>

    <!-- 存储卡片 -->
    <el-descriptions :column="3" border class="mb-4">
      <el-descriptions-item label="备份目录占用">{{ storage ? formatBytes(storage.backupDirSize) : '-' }}</el-descriptions-item>
      <el-descriptions-item label="磁盘剩余">{{ storage ? formatBytes(storage.diskFree) : '-' }}</el-descriptions-item>
      <el-descriptions-item label="备份数量">
        {{ storage ? `${storage.retainedCount} / 保留 ${storage.retainLimit} 份` : '-' }}
      </el-descriptions-item>
    </el-descriptions>
    <el-alert
      v-if="storage?.lowThreshold"
      type="warning"
      :closable="false"
      title="磁盘空间偏低，请及时清理或转移备份文件"
      class="mb-4"
    />

    <!-- 备份记录列表 -->
    <el-table :data="backups" v-loading="listLoading" border size="small" class="mb-4">
      <el-table-column prop="fileName" label="文件名" min-width="260" show-overflow-tooltip />
      <el-table-column label="大小" width="100">
        <template #default="{ row }: { row: BackupRecord }">{{ formatBytes(row.fileSize) }}</template>
      </el-table-column>
      <el-table-column label="校验值" width="160">
        <template #default="{ row }: { row: BackupRecord }">{{ shortSha256(row.sha256) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }: { row: BackupRecord }">
          <el-tag :type="row.type === 'manual' ? 'primary' : 'info'" size="small">{{ backupTypeLabel(row.type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }: { row: BackupRecord }">
          <el-tooltip :content="row.reason || ''" :disabled="!row.reason" placement="top">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ backupStatusLabel(row.status) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="150">
        <template #default="{ row }: { row: BackupRecord }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }: { row: BackupRecord }">
          <el-button size="small" link type="primary" @click="handleDownload(row)">下载</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 自动备份状态（最近7份、失败原因） -->
    <el-alert
      v-if="autoFailedCount > 0"
      type="error"
      :closable="false"
      :title="`自动备份失败 ${autoFailedCount} 次，请查看下方失败记录原因；失败不删除原有备份`"
      class="mb-3"
    />
    <div v-if="autoBackups.length" class="text-sm text-gray-600">
      <div class="font-bold mb-1">自动备份（最近 {{ autoBackups.length }} 份，保留 7 份）：</div>
      <div v-for="b in autoBackups" :key="b.id" class="flex justify-between border-b py-1">
        <span>{{ b.fileName }}</span>
        <span>
          <el-tag :type="b.status === 'success' ? 'success' : 'danger'" size="small">{{ backupStatusLabel(b.status) }}</el-tag>
          <span v-if="b.reason" class="text-red-500 ml-2">原因：{{ b.reason }}</span>
        </span>
      </div>
    </div>

    <!-- 恢复向导（8步） -->
    <el-dialog v-model="wizardVisible" title="数据恢复向导" width="640px" :close-on-click-modal="false">
      <el-steps :active="currentStep" finish-status="success" align-center class="mb-5">
        <el-step v-for="(s, i) in STEPS" :key="i" :title="s" />
      </el-steps>

      <!-- 1 上传 -->
      <div v-if="currentStep === 0">
        <el-upload drag :auto-upload="false" :show-file-list="true" :limit="1" accept=".zip" :on-change="onFileChange">
          <div class="py-6">将备份 ZIP 拖到此处，或点击选择</div>
        </el-upload>
        <div v-if="restoreError" class="text-red-500 mt-2 text-sm">校验未通过：{{ restoreError }}（当前数据不受影响）</div>
        <el-button type="primary" class="mt-4" @click="doPreview">开始校验</el-button>
      </div>

      <!-- 2 校验中 -->
      <div v-else-if="currentStep === 1" class="text-center py-6">
        <el-icon class="is-loading text-4xl"><span class="inline-block animate-spin">◌</span></el-icon>
        <div class="mt-3 text-gray-500">正在校验文件完整性、清单、逐文件 SHA-256 与版本兼容性…</div>
      </div>

      <!-- 3 预览 -->
      <div v-else-if="currentStep === 2 && preview">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="备份时间">{{ formatDateTime(preview.backupTime) }}</el-descriptions-item>
          <el-descriptions-item label="记录数量">
            <div v-for="(v, k) in preview.recordCounts" :key="k">{{ k }}：{{ v }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="附件数量">{{ preview.attachmentCount }}</el-descriptions-item>
          <el-descriptions-item label="总大小">{{ formatBytes(preview.totalSize) }}</el-descriptions-item>
          <el-descriptions-item label="DB 结构版本">v{{ preview.schemaVersion }}</el-descriptions-item>
        </el-descriptions>
        <el-button type="primary" class="mt-4" @click="currentStep = 3">下一步</el-button>
      </div>

      <!-- 4 二次确认（必须输入字面量） -->
      <div v-else-if="currentStep === 3">
        <el-alert type="warning" :closable="false" title="恢复将整体覆盖当前数据库、附件与配置。恢复前系统会自动临时备份当前数据；恢复期间其他写操作将被锁定（系统维护中）。" class="mb-3" />
        <p class="mb-2">请输入「{{ RESTORE_OVERWRITE_LITERAL }}」以继续：</p>
        <el-input v-model="overwriteInput" placeholder="覆盖当前数据" @input="onOverwriteInput" />
        <el-button type="danger" class="mt-4" :disabled="!overwriteMatched" :loading="restoring" @click="doConfirm">
          确认恢复
        </el-button>
      </div>

      <!-- 5 恢复中（维护提示） -->
      <div v-else-if="currentStep === 4 || restoring" class="text-center py-6">
        <el-icon class="is-loading text-4xl"><span class="inline-block animate-spin">◌</span></el-icon>
        <div class="mt-3 font-bold">系统维护中，正在恢复数据，请不要关闭页面…</div>
        <div class="text-gray-400 text-sm mt-1">其他用户的写操作将暂时被拒绝（5030 维护提示）</div>
      </div>

      <!-- 6/7 校验结果 -->
      <div v-else-if="currentStep >= 5 && restoreResult">
        <el-result icon="success" title="恢复完成">
          <template #sub-title>
            <div class="text-left">
              <div>恢复时间：{{ formatDateTime(restoreResult.restoredAt) }}</div>
              <div v-for="(v, k) in restoreResult.restoredCounts" :key="k">{{ k }}：{{ v }}</div>
              <div v-if="restoreResult.missingItems.length" class="text-orange-500 mt-2">
                缺失项：{{ restoreResult.missingItems.join('、') }}
              </div>
              <div v-if="restoreResult.anomalies.length" class="text-orange-500 mt-1">
                异常项：{{ restoreResult.anomalies.join('、') }}
              </div>
            </div>
          </template>
        </el-result>
        <el-button type="primary" @click="doRelogin">重新登录</el-button>
      </div>

      <template #footer>
        <el-button v-if="currentStep >= 4 && restoreError" @click="handleAbort">回滚到恢复前</el-button>
        <el-button @click="wizardVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
