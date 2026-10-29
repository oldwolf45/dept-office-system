<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

interface EChartsOption {
  // echarts 配置项对象，由父组件传入
  [key: string]: unknown
}

const props = defineProps<{
  option: EChartsOption
  height?: string
}>()

/** 点击图形元素时抛出（下钻用），父组件可选监听 */
const emit = defineEmits<{
  (e: 'chartClick', params: { seriesName?: string; name?: string; data?: unknown }): void
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function render(): void {
  if (!chart) return
  chart.setOption(props.option, true)
}

function resize(): void {
  chart?.resize()
}

onMounted(() => {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  render()
  chart.on('click', (params: { seriesName?: string; name?: string; data?: unknown }) => {
    emit('chartClick', params)
  })
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  if (chart) {
    chart.off('click')
    chart.dispose()
    chart = null
  }
})

watch(
  () => props.option,
  () => render(),
  { deep: true }
)
</script>

<template>
  <div ref="chartRef" class="w-full" :style="{ height: height || '320px' }"></div>
</template>
