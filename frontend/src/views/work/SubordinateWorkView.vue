<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { UserListItem, WorkListItem, WorkStatus } from '@/types'
import { getUsers } from '@/api/users'
import { getWorks } from '@/api/work'
import { roleLabel } from '@/utils/permission'
import { formatDate } from '@/utils/format'
import WorkTabs from './components/WorkTabs.vue'

const router = useRouter()

// 人员选择：看到底列表（后端按角色范围返回）
const users = ref<UserListItem[]>([])
const selectedUserId = ref<number | undefined>(undefined)

const list = ref<WorkListItem[]>([])
const loading = ref<boolean>(false)
const keyword = ref<string>('')
const statusFilter = ref<WorkStatus | ''>('')
const page = ref<number>(1)
const pageSize = ref<number>(10)
const total = ref<number>(0)

const STATUS_OPTIONS: Array<{ label: string; value: WorkStatus | '' }> = [
  { label: '全部状态', value: '' },
  { label: '未开始', value: '未开始' },
  { label: '进行中', value: '进行中' },
  { label: '已完成', value: '已完成' },
  { label: '已取消', value: '已取消' },
  { label: '已改派', value: '已改派' }
]

async function loadUsers(): Promise<void> {
  try {
    const res = await getUsers({ page: 1, pageSize: 200 })
    users.value = res.list || []
    // 默认选中第一人，便于直接看其工作
    if (users.value.length && !selectedUserId.value) {
      selectedUserId.value = users.value[0].id
      await loadList()
    }
  } catch {
    users.value = []
  }
}

async function loadList(): Promise<void> {
  if (!selectedUserId.value) {
    list.value = []
    return
  }
  loading.value = true
  try {
    const res = await getWorks({
      scope: 'subordinates',
      assigneeId: selectedUserId.value,
      status: statusFilter.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value
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

function onUserChange(): void {
  page.value = 1
  loadList()
}

function goDetail(row: WorkListItem): void {
  // 详情页复用：有写标注权的上级在此可见"写标注"框
  router.push(`/work/${row.id}`)
}

function statusTagType(status: WorkStatus): 'success' | 'warning' | 'info' {
  switch (status) {
    case '进行中':
      return 'warning'
    case '已完成':
      return 'success'
    default:
      return 'info'
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<template>
  <div class="p-3 md:p-6">
    <div class="mb-4 flex items-center justify-between">
      <WorkTabs />
    </div>

    <div class="mb-3 flex items-center gap-2 flex-wrap">
      <span>选择人员：</span>
      <el-select v-model="selectedUserId" placeholder="下级人员" style="width: 220px" @change="onUserChange">
        <el-option
          v-for="u in users"
          :key="u.id"
          :label="`${u.name}（${u.userNo} · ${roleLabel(u.role)}）`"
          :value="u.id"
        />
      </el-select>
      <el-select v-model="statusFilter" style="width: 130px" @change="onUserChange">
        <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="搜索工作名称"
        class="!w-40 md:!w-56"
        clearable
        @keyup.enter="onUserChange"
        @clear="onUserChange"
      />
      <el-button type="primary" @click="onUserChange">查询</el-button>
    </div>

    <div v-loading="loading">
    <!-- 手机端卡片（S13，与桌面表格同源） -->
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
          {{ row.category }} · 计划完成 {{ formatDate(row.dueTime) }}
        </div>
        <el-tag v-if="row.isStalled" type="danger" size="small" class="mt-1">
          停滞{{ row.stalledDays ? row.stalledDays + '天' : '' }}
        </el-tag>
      </div>
    </div>

    <el-table :data="list" v-loading="loading" border class="hidden md:block">
      <el-table-column prop="name" label="名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="category" label="类别" width="130" />
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
      <el-table-column label="操作" width="120">
        <template #default="{ row }: { row: WorkListItem }">
          <el-button size="small" type="primary" link @click="goDetail(row)">查看/标注</el-button>
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
  </div>
</template>
