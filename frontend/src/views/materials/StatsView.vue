<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BaseChart from '@/components/BaseChart.vue'
import { getMonthlySummary } from '@/api/materials'
import type { MonthlySummary } from '@/types/materials'

const data = ref<MonthlySummary | null>(null)
const loading = ref(false)

const months = computed<string[]>(() => {
  if (!data.value) return []
  const set = new Set<string>()
  data.value.purchase.forEach((r) => set.add(r.month))
  data.value.dispose.forEach((r) => set.add(r.month))
  data.value.flow.forEach((r) => set.add(r.month))
  return Array.from(set).sort()
})

function amountMap(rows: Array<{ month: string; amt: number }>): Record<string, number> {
  const m: Record<string, number> = {}
  rows.forEach((r) => { m[r.month] = Number(r.amt) })
  return m
}
function flowMap(action: string): Record<string, number> {
  const m: Record<string, number> = {}
  ;(data.value?.flow || []).forEach((r) => { if (r.action === action) m[r.month] = Number(r.n) })
  return m
}

// 收支对比（采购支出 / 处置收入）
const amountOption = computed(() => {
  const pm = amountMap(data.value?.purchase || [])
  const dm = amountMap(data.value?.dispose || [])
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['采购支出', '处置收入'] },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: months.value },
    yAxis: { type: 'value' },
    series: [
      { name: '采购支出', type: 'bar', data: months.value.map((m) => pm[m] || 0) },
      { name: '处置收入', type: 'bar', data: months.value.map((m) => dm[m] || 0) }
    ]
  }
})

// 流转数量（领用/回收/处置 次数）
const flowOption = computed(() => {
  const i = flowMap('issue')
  const r = flowMap('recycle')
  const d = flowMap('dispose')
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['领用', '回收', '处置'] },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: months.value },
    yAxis: { type: 'value' },
    series: [
      { name: '领用', type: 'line', smooth: true, data: months.value.map((m) => i[m] || 0) },
      { name: '回收', type: 'line', smooth: true, data: months.value.map((m) => r[m] || 0) },
      { name: '处置', type: 'line', smooth: true, data: months.value.map((m) => d[m] || 0) }
    ]
  }
})

onMounted(async () => {
  loading.value = true
  try {
    data.value = await getMonthlySummary()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="p-4" v-loading="loading">
    <h2 class="text-lg font-bold mb-4">图表汇总</h2>

    <el-empty v-if="data && !months.length" description="暂无数据" />

    <template v-else>
      <el-card shadow="never" class="mb-5">
        <div class="font-medium mb-2">按月收支对比</div>
        <BaseChart :option="amountOption" height="340px" />
      </el-card>

      <el-card shadow="never">
        <div class="font-medium mb-2">按月流转数量</div>
        <BaseChart :option="flowOption" height="340px" />
      </el-card>
    </template>
  </div>
</template>
