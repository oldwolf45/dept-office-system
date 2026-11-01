<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { listMaterials, getMaterial, getMaterialCategories } from '@/api/materials'
import type { Material, MaterialCategory, MaterialDetail, MaterialEvent, MaterialStatus } from '@/types/materials'

const STATUS_LABELS: Record<MaterialStatus, string> = {
  in_stock: '在库',
  issued: '已领用',
  recycled: '已回收',
  disposed: '已处置'
}
const ACTION_LABELS: Record<string, string> = {
  arrive: '到货入库',
  issue: '领用',
  recycle: '回收',
  dispose: '处置'
}

const list = ref<Material[]>([])
const loading = ref(false)
const categories = ref<MaterialCategory[]>([])
const filters = reactive({ code: '', name: '', categoryId: 0, status: '' })

const drawer = ref(false)
const detail = ref<MaterialDetail | null>(null)

async function load() {
  loading.value = true
  try {
    list.value = await listMaterials({
      code: filters.code.trim(),
      name: filters.name.trim(),
      categoryId: filters.categoryId || undefined,
      status: filters.status
    })
  } finally {
    loading.value = false
  }
}

async function openDetail(row: Material) {
  detail.value = await getMaterial(row.id)
  drawer.value = true
}

function statusLabel(s: string): string {
  return STATUS_LABELS[(s as MaterialStatus)] ?? s
}
function actionLabel(a: string): string {
  return ACTION_LABELS[a] ?? a
}
function statusTagType(s: string): 'success' | 'warning' | 'info' | 'danger' {
  if (s === 'in_stock') return 'success'
  if (s === 'issued') return 'warning'
  if (s === 'recycled') return 'info'
  return 'danger'
}

onMounted(async () => {
  try {
    categories.value = await getMaterialCategories()
  } catch {
    /* 忽略 */
  }
  await load()
})
</script>

<template>
  <div class="p-4">
    <h2 class="text-lg font-bold mb-4">生命周期查询</h2>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <el-input v-model="filters.code" placeholder="材料编号（精确）" clearable style="width: 190px" />
      <el-input v-model="filters.name" placeholder="名称（模糊）" clearable style="width: 160px" />
      <el-select v-model="filters.categoryId" placeholder="类别" clearable style="width: 140px">
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 130px">
        <el-option v-for="(l, k) in STATUS_LABELS" :key="k" :label="l" :value="k" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="materialCode" label="材料编号" width="200" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="spec" label="规格" width="120" />
      <el-table-column prop="unit" label="单位" width="90" />
      <el-table-column prop="arrivedAt" label="到货日期" width="110" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">时间线</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer v-model="drawer" title="材料生命周期" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="材料编号">{{ detail.materialCode }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="规格">{{ detail.spec || '-' }}</el-descriptions-item>
          <el-descriptions-item label="单位">{{ detail.unit || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
          <el-descriptions-item label="到货日期">{{ detail.arrivedAt }}</el-descriptions-item>
        </el-descriptions>

        <el-timeline class="mt-4">
          <el-timeline-item
            v-for="e in (detail.events as MaterialEvent[])"
            :key="e.id"
            :timestamp="e.occurAt || e.createdAt"
            placement="top"
          >
            <div class="font-medium">{{ actionLabel(e.action) }}</div>
            <div class="text-sm text-gray-500">
              经办人：{{ e.operatorName || '-' }}
              <span v-if="e.amount">　金额：{{ Number(e.amount).toFixed(2) }}</span>
            </div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-drawer>
  </div>
</template>
