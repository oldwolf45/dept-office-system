<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createArrival, getMaterialCategories } from '@/api/materials'
import { useMaterialsAccess } from '@/composables/useMaterialsAccess'
import type { MaterialCategory, Material } from '@/types/materials'

const { hasRole } = useMaterialsAccess()
const canSupply = () => hasRole('supply')

const categories = ref<MaterialCategory[]>([])
const submitting = ref(false)
const result = ref<{ count: number; list: Material[] } | null>(null)

const form = reactive({
  arrivedAt: '',
  purchaseId: null as number | null,
  items: [] as Array<{ categoryId: number | null; name: string; spec: string; unit: string; qty: number }>
})

function todayStr(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

function reset() {
  form.arrivedAt = todayStr()
  form.purchaseId = null
  form.items = [{ categoryId: null, name: '', spec: '', unit: '', qty: 1 }]
  result.value = null
}

function addItem() {
  form.items.push({ categoryId: null, name: '', spec: '', unit: '', qty: 1 })
}
function removeItem(i: number) {
  form.items.splice(i, 1)
}

async function submit() {
  if (!canSupply()) {
    ElMessage.warning('仅供应科可登记到货')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.arrivedAt)) {
    ElMessage.warning('请选择到货日期')
    return
  }
  if (!form.items.length) {
    ElMessage.warning('至少一条明细')
    return
  }
  for (const it of form.items) {
    if (!it.name.trim()) {
      ElMessage.warning('物料名称不能为空')
      return
    }
    if (!(it.qty > 0)) {
      ElMessage.warning(`物料「${it.name}」数量须大于0`)
      return
    }
  }
  submitting.value = true
  try {
    result.value = await createArrival({
      arrivedAt: form.arrivedAt,
      purchaseId: form.purchaseId,
      items: form.items.map((it) => ({
        categoryId: it.categoryId,
        name: it.name.trim(),
        spec: it.spec.trim(),
        unit: it.unit.trim(),
        qty: it.qty
      }))
    })
    ElMessage.success(`已生成 ${result.value.count} 个材料编号`)
  } finally {
    submitting.value = false
  }
}

function printCodes() {
  window.print()
}

onMounted(async () => {
  reset()
  try {
    categories.value = await getMaterialCategories()
  } catch {
    /* 忽略 */
  }
})
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">到货登记与材料编号</h2>
      <el-tag type="info">编号规则 CL+到货日期+类别两位+四位流水</el-tag>
    </div>

    <el-alert v-if="!canSupply()" type="warning" :closable="false" class="mb-3" title="仅供应科可登记到货" />

    <el-form label-width="90px">
      <el-form-item label="到货日期" required>
        <el-date-picker v-model="form.arrivedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
      </el-form-item>
      <el-form-item label="关联采购">
        <el-input-number v-model="form.purchaseId" :min="0" placeholder="采购单ID（可选）" />
      </el-form-item>
    </el-form>

    <el-divider>到货明细</el-divider>
    <el-table :data="form.items" border>
      <el-table-column label="材料类别" width="160">
        <template #default="{ row }">
          <el-select v-model="row.categoryId" placeholder="可选" clearable>
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="名称" min-width="140">
        <template #default="{ row }"><el-input v-model="row.name" placeholder="物料名称" /></template>
      </el-table-column>
      <el-table-column label="规格" width="120">
        <template #default="{ row }"><el-input v-model="row.spec" placeholder="规格" /></template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="{ row }"><el-input v-model="row.unit" placeholder="单位" /></template>
      </el-table-column>
      <el-table-column label="数量" width="120">
        <template #default="{ row }"><el-input-number v-model="row.qty" :min="1" controls-position="right" /></template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeItem($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="mt-2 flex gap-2">
      <el-button type="dashed" @click="addItem">+ 添加明细</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSupply()" @click="submit">生成编号并入库</el-button>
    </div>

    <div v-if="result" class="mt-6">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-base font-bold">本次生成编号（{{ result.count }} 件）</h3>
        <el-button size="small" @click="printCodes">打印/抄录</el-button>
      </div>
      <el-table :data="result.list" border size="small">
        <el-table-column prop="materialCode" label="材料编号" width="200" />
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="spec" label="规格" width="120" />
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column prop="arrivedAt" label="到货日期" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag size="small">在库</el-tag></template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
