<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { UserListItem } from '@/types'
import { getUsers } from '@/api/users'
import { transferWork } from '@/api/work'
import { roleLabel } from '@/utils/permission'

const props = defineProps<{
  visible: boolean
  workId: number
  sourceAssigneeName: string
  /** 原负责人 id，接收人下拉中排除本人 */
  excludeUserId: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'success'): void
}>()

const receivers = ref<UserListItem[]>([])
const receiverId = ref<number | undefined>(undefined)
const reason = ref<string>('')
const submitting = ref<boolean>(false)

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    receiverId.value = undefined
    reason.value = ''
    try {
      const res = await getUsers({ page: 1, pageSize: 200 })
      // 操作人权限范围内的本科室人员（后端按契约校验），排除原负责人本人
      receivers.value = (res.list || []).filter((u) => u.id !== props.excludeUserId && u.status === 'active')
    } catch {
      receivers.value = []
    }
  }
)

async function submit(): Promise<void> {
  if (!receiverId.value) {
    ElMessage.warning('请选择接收人')
    return
  }
  if (!reason.value.trim()) {
    ElMessage.warning('请填写改派原因')
    return
  }
  submitting.value = true
  try {
    await transferWork(props.workId, receiverId.value, reason.value.trim())
    ElMessage.success('改派成功')
    emit('update:visible', false)
    emit('success')
  } catch {
    // 拦截器已提示（后端：已完成/已取消拒绝、接收人越权拒绝）
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="工作改派"
    width="520px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-alert type="info" :closable="false" class="mb-3">
      原负责人：{{ sourceAssigneeName }}。改派后原记录保留并标记"已改派"，新负责人生成新任务。
    </el-alert>
    <el-form label-width="90px">
      <el-form-item label="接收人">
        <el-select v-model="receiverId" placeholder="选择权限范围内人员" style="width: 100%">
          <el-option
            v-for="u in receivers"
            :key="u.id"
            :label="`${u.name}（${u.userNo} · ${roleLabel(u.role)}）`"
            :value="u.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="改派原因">
        <el-input v-model="reason" type="textarea" :rows="3" placeholder="必填" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">确认改派</el-button>
    </template>
  </el-dialog>
</template>
