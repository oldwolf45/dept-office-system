<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import type { ExperienceSample, SummaryContentType } from '@/types'
import { getExperienceSamples } from '@/api/experience'
import { preferSummary, toggleSample } from '@/api/summaries'
import { contentTypeLabel } from '@/utils/summary'
import { formatDateTime } from '@/utils/format'

const userStore = useUserStore()
const canMarkSample = computed<boolean>(() => userStore.checkButton('mark-sample'))

const list = ref<ExperienceSample[]>([])
const loading = ref<boolean>(false)
const typeFilter = ref<SummaryContentType | ''>('')

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await getExperienceSamples(typeFilter.value ? { type: typeFilter.value } : {})
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

async function onPrefer(row: ExperienceSample): Promise<void> {
  try {
    await preferSummary(row.id)
    ElMessage.success(row.isPreferred === 1 ? '已取消优选' : '已标记优选样例')
    await load()
  } catch {
    /* 拦截器弹错 */
  }
}

async function onToggle(row: ExperienceSample): Promise<void> {
  try {
    await toggleSample(row.id)
    ElMessage.success(row.isEnabled === 1 ? '已停用（不再被检索引用）' : '已启用')
    await load()
  } catch {
    /* 拦截器弹错 */
  }
}

onMounted(() => load())
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">汇总经验库</h1>
      <div>
        <el-select v-model="typeFilter" placeholder="全部类型" clearable style="width: 130px" @change="load">
          <el-option label="工作" value="work" />
          <el-option label="记账" value="accounting" />
          <el-option label="工作+记账" value="both" />
        </el-select>
        <el-button class="ml-2" @click="load">刷新</el-button>
      </div>
    </div>

    <el-card v-loading="loading">
      <el-empty v-if="!list.length" description="暂无样例：先在「总结与PPT」生成并定稿总结" :image-size="60" />
      <el-table v-else :data="list" border>
        <el-table-column prop="version" label="版本" width="70" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }: { row: ExperienceSample }">
            <el-tag :type="row.versionType === '模板稿' ? 'warning' : 'info'">
              {{ row.versionType }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容类型" width="100">
          <template #default="{ row }: { row: ExperienceSample }">
            {{ contentTypeLabel(row.contentType) }}
          </template>
        </el-table-column>
        <el-table-column label="期间" width="180">
          <template #default="{ row }: { row: ExperienceSample }">
            {{ row.periodStart }} ~ {{ row.periodEnd }}
          </template>
        </el-table-column>
        <el-table-column prop="createdByName" label="生成人" width="100" />
        <el-table-column label="生成时间" width="150">
          <template #default="{ row }: { row: ExperienceSample }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="状态标记" width="150">
          <template #default="{ row }: { row: ExperienceSample }">
            <el-tag v-if="row.isPreferred === 1" type="danger" class="mr-1">优选</el-tag>
            <el-tag :type="row.isEnabled === 1 ? 'success' : 'info'">
              {{ row.isEnabled === 1 ? '启用中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="摘要" min-width="240" show-overflow-tooltip />
        <el-table-column v-if="canMarkSample" label="管理" width="160" fixed="right">
          <template #default="{ row }: { row: ExperienceSample }">
            <el-button link @click="onPrefer(row)">
              {{ row.isPreferred === 1 ? '取消优选' : '标记优选' }}
            </el-button>
            <el-button link @click="onToggle(row)">
              {{ row.isEnabled === 1 ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
