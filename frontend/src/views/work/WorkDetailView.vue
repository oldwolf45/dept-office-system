<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import type { AnnotationItem, AttachmentItem, WorkDetail } from '@/types'
import {
  addAnnotation,
  addProgress,
  cancelWork,
  completeWork,
  deleteAttachment,
  downloadAttachmentBlob,
  getWorkDetail,
  replyAnnotation,
  unlockWork,
  uploadAttachment
} from '@/api/work'
import {
  canAddProgress,
  canCancelWork,
  canReplyAnnotation,
  canTransferWork,
  canUnlockWork,
  canWriteAnnotation,
  previewKind,
  validateAttachmentFile
} from '@/utils/work'
import { formatDateTime } from '@/utils/format'
import { checkMobileUpload, useIsMobile } from '@/utils/mobile'
import WorkTransferDialog from './components/WorkTransferDialog.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** S13：手机视口（描述列数/附件50MB引导） */
const isMobile = useIsMobile()

const workId = Number(route.params.id)
const loading = ref<boolean>(false)
const detail = ref<WorkDetail | null>(null)

const myId = computed<number>(() => userStore.userInfo?.id ?? -1)
const myRole = computed<number>(() => userStore.userInfo?.role ?? 0)
const isOwner = computed<boolean>(() => detail.value?.assigneeId === myId.value)
const isCollaborator = computed<boolean>(() =>
  (detail.value?.collaboratorIds ?? []).includes(myId.value)
)

// ==================== 操作按钮可见性（按状态与权限，纯函数在 utils/work.ts，单测覆盖） ====================
const canAddProgressBtn = computed<boolean>(() => {
  if (!detail.value) return false
  return canAddProgress(detail.value.status, detail.value.isUnlocked) && (isOwner.value || isCollaborator.value)
})
const canCompleteBtn = computed<boolean>(() =>
  !!detail.value && isOwner.value && canCancelWork(detail.value.status)
)
const canCancelBtn = computed<boolean>(() =>
  !!detail.value && isOwner.value && canCancelWork(detail.value.status)
)
const canUnlockBtn = computed<boolean>(() =>
  !!detail.value && canUnlockWork(myRole.value, detail.value.status, detail.value.isUnlocked)
)
const canTransferBtn = computed<boolean>(() =>
  !!detail.value && canTransferWork(detail.value.status) && (myRole.value === 3 || myRole.value === 2)
)
const canWriteAnn = computed<boolean>(() =>
  !!detail.value && canWriteAnnotation(myRole.value, isOwner.value)
)
// 删除附件：上传人本人或科长（契约 §3）
function canDeleteAttachment(att: AttachmentItem): boolean {
  return att.uploaderId === myId.value || myRole.value === 3
}

async function loadDetail(): Promise<void> {
  loading.value = true
  try {
    detail.value = await getWorkDetail(workId)
    await prefetchMediaUrls()
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
}

// ==================== 完成 / 取消 / 解锁 ====================
async function handleComplete(): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写完成总结（必填）', '完成工作', {
    confirmButtonText: '提交',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputValidator: (v: string) => (v && v.trim() ? true : '完成总结不能为空')
  }).catch(() => ({ value: '' }))
  if (!value || !value.trim()) return
  try {
    await completeWork(workId, value.trim())
    ElMessage.success('已完成')
    loadDetail()
  } catch {
    // 拦截器已提示
  }
}

async function handleCancel(): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写取消原因（必填）', '取消工作', {
    confirmButtonText: '确认取消',
    cancelButtonText: '返回',
    inputType: 'textarea',
    inputValidator: (v: string) => (v && v.trim() ? true : '取消原因不能为空')
  }).catch(() => ({ value: '' }))
  if (!value || !value.trim()) return
  try {
    await cancelWork(workId, value.trim())
    ElMessage.success('已取消')
    loadDetail()
  } catch {
    // 拦截器已提示
  }
}

async function handleUnlock(): Promise<void> {
  await ElMessageBox.confirm('解锁后可追加进度与补充说明，解锁操作会留痕。确认解锁？', '工作解锁', {
    type: 'warning'
  }).catch(() => 'cancel')
    .then(async (action) => {
      if (action !== 'confirm') return
      try {
        await unlockWork(workId)
        ElMessage.success('已解锁')
        loadDetail()
      } catch {
        // 拦截器已提示
      }
    })
}

// ==================== 追加进度 ====================
const progressText = ref<string>('')
const progressSending = ref<boolean>(false)
const timelineDesc = ref<boolean>(false) // 默认升序（最早→最新）

async function submitProgress(): Promise<void> {
  if (!progressText.value.trim()) {
    ElMessage.warning('请填写进度内容')
    return
  }
  progressSending.value = true
  try {
    await addProgress(workId, progressText.value.trim())
    ElMessage.success('进度已追加')
    progressText.value = ''
    loadDetail()
  } catch {
    // 拦截器已提示
  } finally {
    progressSending.value = false
  }
}

const sortedProgress = computed(() => {
  if (!detail.value) return []
  const arr = [...detail.value.progress]
  arr.sort((a, b) =>
    timelineDesc.value
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  return arr
})

// ==================== 附件（el-upload 前端预校验 + 内联预览） ====================
const uploading = ref<boolean>(false)
const mediaUrls = ref<Record<number, string>>({})

async function ensureMediaUrl(att: AttachmentItem): Promise<void> {
  if (mediaUrls.value[att.id]) return
  try {
    const blob = await downloadAttachmentBlob(att.id)
    mediaUrls.value[att.id] = URL.createObjectURL(blob)
  } catch {
    // 拦截器已提示（软删除附件 4040 等）
  }
}

async function prefetchMediaUrls(): Promise<void> {
  for (const att of detail.value?.attachments ?? []) {
    const kind = previewKind(att.originalName)
    if (kind === 'audio' || kind === 'video' || kind === 'image') {
      await ensureMediaUrl(att)
    }
  }
}

function beforeUpload(file: File): boolean {
  // S13：手机端 >50MB 引导电脑端上传（UI 层引导，不改后端 200MB 上限）
  const mobileGate = checkMobileUpload(isMobile.value, file.size)
  if (mobileGate.block) {
    ElMessage.warning(mobileGate.message)
    return false
  }
  const check = validateAttachmentFile(file.name, file.size)
  if (!check.ok) {
    ElMessage.error(check.message)
    return false
  }
  return true
}

interface UploadRaw {
  file: File
}

async function customUpload(req: UploadRaw): Promise<void> {
  uploading.value = true
  try {
    await uploadAttachment(workId, req.file)
    ElMessage.success('附件上传成功')
    loadDetail()
  } catch {
    // 拦截器已提示（后端白名单/超限二次校验）
  } finally {
    uploading.value = false
  }
}

async function handleDeleteAttachment(att: AttachmentItem): Promise<void> {
  await ElMessageBox.confirm(`确定删除附件「${att.originalName}」吗？删除为软删除并留痕。`, '删除附件', {
    type: 'warning'
  }).catch(() => 'cancel')
    .then(async (action) => {
      if (action !== 'confirm') return
      try {
        await deleteAttachment(att.id)
        ElMessage.success('已删除')
        loadDetail()
      } catch {
        // 拦截器已提示
      }
    })
}

async function handlePreviewDoc(att: AttachmentItem): Promise<void> {
  try {
    const blob = await downloadAttachmentBlob(att.id)
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  } catch {
    // 拦截器已提示
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024).toFixed(0)}KB`
}

// ==================== 标注 ====================
const annotationText = ref<string>('')
const annotationSending = ref<boolean>(false)

async function submitAnnotation(): Promise<void> {
  if (!annotationText.value.trim()) {
    ElMessage.warning('请填写标注内容')
    return
  }
  annotationSending.value = true
  try {
    await addAnnotation(workId, annotationText.value.trim())
    ElMessage.success('标注已发送')
    annotationText.value = ''
    loadDetail()
  } catch {
    // 拦截器已提示（科员 4030 等）
  } finally {
    annotationSending.value = false
  }
}

const replyTexts = ref<Record<number, string>>({})

async function submitReply(row: AnnotationItem): Promise<void> {
  const text = (replyTexts.value[row.id] || '').trim()
  if (!text) {
    ElMessage.warning('请填写回复内容')
    return
  }
  try {
    await replyAnnotation(row.id, text)
    ElMessage.success('回复成功')
    loadDetail()
  } catch {
    // 拦截器已提示（每条标注最多回复一条）
  }
}

// ==================== 改派弹窗 ====================
const transferVisible = ref<boolean>(false)

onMounted(() => {
  loadDetail()
})

onBeforeUnmount(() => {
  Object.values(mediaUrls.value).forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <div v-loading="loading" class="p-6">
    <el-page-header :icon="null" @back="router.push('/work')" class="mb-4">
      <template #content><span class="text-lg font-bold">{{ detail?.name || '工作详情' }}</span></template>
    </el-page-header>

    <template v-if="detail">
      <!-- 基本信息 -->
      <el-card>
        <el-descriptions :column="isMobile ? 1 : 3" border>
          <el-descriptions-item label="状态">
            <el-tag :type="detail.status === '进行中' ? 'warning' : detail.status === '已完成' ? 'success' : 'info'">
              {{ detail.status }}
            </el-tag>
            <el-tag v-if="detail.isStalled" type="danger" class="ml-2">
              停滞{{ detail.stalledDays ? detail.stalledDays + '天' : '' }}
            </el-tag>
            <el-tag v-if="detail.isUnlocked === 1" type="warning" class="ml-2">已解锁</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="类别">{{ detail.category }}</el-descriptions-item>
          <el-descriptions-item label="优先级">{{ detail.priority }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ detail.assigneeName }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.sourceName" label="来源">{{ detail.sourceName }}</el-descriptions-item>
          <el-descriptions-item label="开始 / 计划完成">
            {{ formatDateTime(detail.startTime).slice(0, 10) }} ~ {{ formatDateTime(detail.dueTime).slice(0, 10) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.collaboratorNames?.length" label="协作者" :span="3">
            {{ detail.collaboratorNames.join('、') }}
          </el-descriptions-item>
          <el-descriptions-item label="工作内容" :span="3">{{ detail.content }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.summary" label="完成总结" :span="3">
            <el-alert :title="detail.summary" type="success" :closable="false" />
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.cancelReason" label="取消原因" :span="3">
            <el-alert :title="detail.cancelReason" type="error" :closable="false" />
          </el-descriptions-item>
        </el-descriptions>

        <!-- 操作按钮按状态与权限渲染 -->
        <div class="mt-4 flex gap-2">
          <el-button v-if="canCompleteBtn" type="success" @click="handleComplete">完成并写总结</el-button>
          <el-button v-if="canCancelBtn" type="danger" plain @click="handleCancel">取消工作</el-button>
          <el-button v-if="canUnlockBtn" type="warning" @click="handleUnlock">解锁</el-button>
          <el-button v-if="canTransferBtn" @click="transferVisible = true">改派</el-button>
        </div>
      </el-card>

      <!-- 追加进度（负责人/协作者；已完成仅解锁后） -->
      <el-card v-if="canAddProgressBtn" class="mt-4">
        <template #header><span class="font-bold">追加进度</span></template>
        <el-input
          v-model="progressText"
          type="textarea"
          :rows="2"
          placeholder="记录实际进展（只增不删，第一条进度后工作转为进行中）"
        />
        <el-button type="primary" class="mt-2" :loading="progressSending" @click="submitProgress">
          提交进度
        </el-button>
      </el-card>

      <!-- 过程线 -->
      <el-card class="mt-4">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-bold">过程线（{{ detail.progress.length }} 条）</span>
            <el-radio-group v-model="timelineDesc" size="small">
              <el-radio-button :value="false">时间正序</el-radio-button>
              <el-radio-button :value="true">时间倒序</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-empty v-if="!detail.progress.length" description="暂无进度" :image-size="60" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="p in sortedProgress"
            :key="p.id"
            :timestamp="formatDateTime(p.createdAt)"
          >
            <div class="flex items-center gap-2">
              <b>{{ p.authorName }}</b>
              <el-tag size="small" :type="p.authorType === 'owner' ? 'primary' : 'info'">
                {{ p.authorType === 'owner' ? '负责人' : '协作者' }}
              </el-tag>
            </div>
            <div class="mt-1">{{ p.content }}</div>
          </el-timeline-item>
        </el-timeline>
      </el-card>

      <!-- 附件区 -->
      <el-card class="mt-4">
        <template #header><span class="font-bold">附件（≤200MB，{{ detail.attachments.length }} 个）</span></template>
        <el-upload
          class="mb-3"
          :show-file-list="false"
          :before-upload="beforeUpload"
          :http-request="customUpload"
          accept=".doc,.docx,.xls,.xlsx,.pdf,.jpg,.png,.mp3,.wav,.m4a,.mp4,.mov"
        >
          <el-button type="primary" :loading="uploading">上传附件</el-button>
        </el-upload>

        <el-empty v-if="!detail.attachments.length" description="暂无附件" :image-size="60" />
        <div v-else class="space-y-3">
          <div v-for="att in detail.attachments" :key="att.id" class="border rounded p-3">
            <div class="flex items-center justify-between">
              <div>
                <b>{{ att.originalName }}</b>
                <span class="text-gray-400 text-xs ml-2">
                  {{ formatSize(att.size) }} · {{ att.uploaderName || '' }} · {{ formatDateTime(att.createdAt) }}
                </span>
              </div>
              <el-button v-if="canDeleteAttachment(att)" size="small" type="danger" link @click="handleDeleteAttachment(att)">
                删除
              </el-button>
            </div>

            <!-- 图片预览 -->
            <div v-if="previewKind(att.originalName) === 'image' && mediaUrls[att.id]" class="mt-2">
              <el-image :src="mediaUrls[att.id]" fit="contain" style="max-height: 220px" :preview-src-list="[mediaUrls[att.id]]" />
            </div>
            <!-- 音频内联播放 -->
            <audio v-else-if="previewKind(att.originalName) === 'audio' && mediaUrls[att.id]" controls class="mt-2 w-full">
              <source :src="mediaUrls[att.id]" />
            </audio>
            <!-- 视频内联播放 -->
            <video v-else-if="previewKind(att.originalName) === 'video' && mediaUrls[att.id]" controls class="mt-2 max-h-72">
              <source :src="mediaUrls[att.id]" />
            </video>
            <!-- PDF / 文档：预览或下载链接 -->
            <div v-else class="mt-2">
              <el-button link type="primary" @click="handlePreviewDoc(att)">
                {{ previewKind(att.originalName) === 'pdf' ? '预览 PDF' : '下载文件' }}
              </el-button>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 标注区 -->
      <el-card class="mt-4">
        <template #header><span class="font-bold">标注（{{ detail.annotations.length }} 条）</span></template>

        <el-empty v-if="!detail.annotations.length" description="暂无标注" :image-size="60" />
        <div v-else class="space-y-3">
          <div v-for="row in detail.annotations" :key="row.id" class="border rounded p-3">
            <div class="flex items-center gap-2">
              <b>{{ row.authorName }}</b>
              <span class="text-gray-400 text-xs">{{ formatDateTime(row.createdAt) }}</span>
              <el-tag v-if="row.replyContent" size="small" type="success">已回复</el-tag>
              <el-tag v-else size="small" type="warning">待回复</el-tag>
            </div>
            <div class="mt-1">{{ row.content }}</div>
            <div v-if="row.replyContent" class="mt-2 ml-6 border-l-2 border-green-400 pl-2">
              <div class="text-green-700">负责人回复：{{ row.replyContent }}</div>
              <div class="text-gray-400 text-xs">{{ formatDateTime(row.replyAt || '') }}</div>
            </div>
            <!-- 回复框：仅负责人，每条一次 -->
            <div v-if="canReplyAnnotation(isOwner, !!row.replyContent)" class="mt-2 flex gap-2">
              <el-input v-model="replyTexts[row.id]" placeholder="回复说明（每条标注最多回复一条）" />
              <el-button type="primary" @click="submitReply(row)">回复</el-button>
            </div>
          </div>
        </div>

        <!-- 写标注框：有写标注权的上级对下级工作 -->
        <div v-if="canWriteAnn" class="mt-4 border-t pt-3">
          <el-input v-model="annotationText" type="textarea" :rows="2" placeholder="对该工作写标注/催办（不改变状态与进度）" />
          <el-button type="primary" class="mt-2" :loading="annotationSending" @click="submitAnnotation">发送标注</el-button>
        </div>
      </el-card>

      <WorkTransferDialog
        v-if="detail"
        v-model:visible="transferVisible"
        :work-id="detail.id"
        :source-assignee-name="detail.assigneeName"
        :exclude-user-id="detail.assigneeId"
        @success="loadDetail"
      />
    </template>
  </div>
</template>
