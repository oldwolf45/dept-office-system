<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getFinanceCategoriesManage,
  createFinanceCategory,
  updateFinanceCategory,
  disableFinanceCategory,
  enableFinanceCategory
} from '@/api/materials'
import type { FinanceCategory } from '@/types/materials'

const list = ref<FinanceCategory[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref<FinanceCategory | null>(null)
const form = reactive({ name: '', type: 'expense' as 'income' | 'expense', sortOrder: 0 })

async function load() {
  loading.value = true
  try {
    list.value = await getFinanceCategoriesManage()
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.type = 'expense'
  form.sortOrder = 0
  dialogVisible.value = true
}

function openEdit(row: FinanceCategory) {
  editing.value = row
  form.name = row.name
  form.type = row.type
  form.sortOrder = row.sortOrder
  dialogVisible.value = true
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (editing.value) {
    await updateFinanceCategory(editing.value.id, { name: form.name.trim(), type: form.type, sortOrder: form.sortOrder })
    ElMessage.success('已保存')
  } else {
    await createFinanceCategory({ name: form.name.trim(), type: form.type, sortOrder: form.sortOrder })
    ElMessage.success('已新增')
  }
  dialogVisible.value = false
  await load()
}

async function toggleStatus(row: FinanceCategory) {
  if (row.status === 'active') {
    await disableFinanceCategory(row.id)
  } else {
    await enableFinanceCategory(row.id)
  }
  await load()
}

onMounted(load)
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">收支分类</h2>
      <el-button type="primary" @click="openCreate">新增分类</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag :type="row.type === 'income' ? 'success' : 'warning'">
            {{ row.type === 'income' ? '收入' : '支出' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="sortOrder" label="排序" width="80" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            link
            :type="row.status === 'active' ? 'danger' : 'success'"
            @click="toggleStatus(row)"
          >
            {{ row.status === 'active' ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑分类' : '新增分类'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="类型">
          <el-select v-model="form.type" placeholder="请选择">
            <el-option label="支出" value="expense" />
            <el-option label="收入" value="income" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="分类名称" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
