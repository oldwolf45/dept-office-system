<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listPurchases,
  createPurchase,
  voidPurchase,
  getMaterialCategories,
  getFinanceCategories
} from '@/api/materials'
import type { Purchase, MaterialCategory, FinanceCategory, CreatePurchaseParams } from '@/types/materials'

const STATUS_LABELS: Record<Purchase['status'], string> = { normal: '正常', void: '已作废' }

function statusLabel(s: string): string {
  return STATUS_LABELS[(s as Purchase['status'])] ?? s
}

const list = ref<Purchase[]>([])
const loading = ref(false)
const filters = reactive({ month: '', categoryId: 0, status: '' })

const categories = ref<MaterialCategory[]>([])
const financeCats = ref<FinanceCategory[]>([])

const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive<CreatePurchaseParams>({
  planId: null,
  categoryId: null,
  supplier: '',
  itemDesc: '',
  amount: 0,
  fundCategoryId: null,
  purchaseDate: '',
  handler: ''
})

async function load() {
  loading.value = true
  try {
    list.value = await listPurchases({
      month: filters.month,
      categoryId: filters.categoryId || undefined,
      status: filters.status
    })
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    categories.value = await getMaterialCategories()
    financeCats.value = (await getFinanceCategories()).filter((c) => c.type === 'expense')
  } catch {
    /* 忽略，可选下拉 */
  }
}

function openCreate() {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  form.planId = null
  form.categoryId = null
  form.supplier = ''
  form.itemDesc = ''
  form.amount = 0
  form.fundCategoryId = null
  form.purchaseDate = new Date(d.getTime() - off).toISOString().slice(0, 10)
  form.handler = ''
  dialogVisible.value = true
}

async function submitCreate() {
  if (!form.itemDesc.trim()) {
    ElMessage.warning('采购摘要不能为空')
    return
  }
  if (!(form.amount >= 0)) {
    ElMessage.warning('金额须为非负数')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.purchaseDate)) {
    ElMessage.warning('采购日期格式应为 YYYY-MM-DD')
    return
  }
  submitting.value = true
  try {
    await createPurchase({
      planId: form.planId ?? null,
      categoryId: form.categoryId ?? null,
      supplier: form.supplier?.trim() || undefined,
      itemDesc: form.itemDesc.trim(),
      amount: form.amount,
      fundCategoryId: form.fundCategoryId ?? null,
      purchaseDate: form.purchaseDate,
      handler: form.handler?.trim() || undefined
    })
    ElMessage.success('已登记采购')
    dialogVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}

async function doVoid(row: Purchase) {
  try {
    const { value } = await ElMessageBox.prompt('请填写作废意见', '作废采购单', {
      inputType: 'textarea',
      inputValidator: (v) => (v && v.trim() ? true : '意见不能为空')
    })
    await voidPurchase(row.id, value.trim())
    ElMessage.success('已作废')
    await load()
  } catch {
    /* 取消 */
  }
}

onMounted(() => {
  loadOptions()
  load()
})
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">采购管理</h2>
      <el-button type="primary" @click="openCreate">登记采购</el-button>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <el-date-picker v-model="filters.month" type="month" value-format="YYYY-MM" placeholder="月份" clearable />
      <el-select v-model="filters.categoryId" placeholder="材料类别" clearable style="width: 150px">
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px">
        <el-option label="正常" value="normal" />
        <el-option label="已作废" value="void" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="purchaseNo" label="单据号" width="170" />
      <el-table-column prop="purchaseDate" label="日期" width="110" />
      <el-table-column prop="itemDesc" label="摘要" min-width="160" />
      <el-table-column prop="supplier" label="供应商" width="120" />
      <el-table-column prop="handler" label="经手人" width="90" />
      <el-table-column prop="amount" label="金额" width="110">
        <template #default="{ row }">{{ Number(row.amount).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'normal' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button v-if="row.status === 'normal'" link type="danger" @click="doVoid(row)">作废</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="登记采购" width="640px">
      <el-form label-width="90px">
        <el-form-item label="摘要" required>
          <el-input v-model="form.itemDesc" placeholder="采购物品摘要" />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="form.amount" :min="0" :precision="2" :step="10" />
        </el-form-item>
        <el-form-item label="采购日期" required>
          <el-date-picker v-model="form.purchaseDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="材料类别">
          <el-select v-model="form.categoryId" placeholder="可选" clearable style="width: 100%">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="收支分类">
          <el-select v-model="form.fundCategoryId" placeholder="支出类（可选）" clearable style="width: 100%">
            <el-option v-for="c in financeCats" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="供应商">
          <el-input v-model="form.supplier" placeholder="供应商（可选）" />
        </el-form-item>
        <el-form-item label="经手人">
          <el-input v-model="form.handler" placeholder="经手人（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
