<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MyItem } from '@/types'
import { getMyItems } from '@/api/accounting'
import { formatDate } from '@/utils/format'

/**
 * 我的物品（PRD 5.15 / C26）：
 * 只显示发给本人的记录——物品、数量、发放日期、发放人；
 * 不显示单价、金额、结存，也看不到他人记录（后端按本人过滤）。
 */
const items = ref<MyItem[]>([])
const loading = ref<boolean>(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await getMyItems()
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6" v-loading="loading">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">我的物品</h1>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      class="mb-4"
      title="仅显示发给本人的物品记录，不含单价、金额与结存，也看不到他人记录（C26）。"
    />

    <el-empty v-if="!items.length" description="暂无发放记录" />
    <el-table v-else :data="items" border>
      <el-table-column prop="itemName" label="物品名称" min-width="160" />
      <el-table-column prop="qty" label="数量" width="100" />
      <el-table-column label="发放日期" width="140">
        <template #default="{ row }: { row: MyItem }">{{ formatDate(row.issueDate) }}</template>
      </el-table-column>
      <el-table-column prop="handler" label="发放人" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }: { row: MyItem }">
          <el-tag :type="row.status === 'void' ? 'info' : 'success'">
            {{ row.status === 'void' ? '已收回' : '持有中' }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
