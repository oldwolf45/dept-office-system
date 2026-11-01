<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getMaterialCategoriesManage,
  createMaterialCategory,
  updateMaterialCategory,
  disableMaterialCategory,
  enableMaterialCategory
} from '@/api/materials'
import type { MaterialCategory } from '@/types/materials'

const list = ref<MaterialCategory[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref<MaterialCategory | null>(null)
const form = reactive({ code: '', name: '', sortOrder: 0 })

async function load() {
  loading.value = true
  try {
    list.value = await getMaterialCategoriesManage()
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.code = ''
  form.name = ''
  form.sortOrder = 0
  dialogVisible.value = true
}

function openEdit(row: MaterialCategory) {
  editing.value = row
  form.code = row.code || ''
  form.name = row.name
  form.sortOrder = row.sortOrder
  dialogVisible.value = true
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (form.code && !/^\d{2}$/.test(form.code)) {
    ElMessage.warning('类别码须为两位数字')
    return
  }
  if (editing.value) {
    await updateMaterialCategory(editing.value.id, { name: form.name.trim(), sortOrder: form.sortOrder })
    ElMessage.success('已保存')
  } else {
    await createMaterialCategory({ code: form.code || null, name: form.name.trim(), sortOrder: form.sortOrder })
    ElMessage.success('已新增')
  }
  dialogVisible.value = false
  await load()
}

async function toggleStatus(row: MaterialCategory) {
  if (row.status === 'active') {
    await disableMaterialCategory(row.id)
  } else {
    await enableMaterialCategory(row.id)
  }
  await load()
}

onMounted(load)
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">材料类别</h2>
      <el-button type="primary" @click="openCreate">新增类别</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="code" label="类别码" width="100" />
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

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑类别' : '新增类别'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="类别码">
          <el-input v-model="form.code" placeholder="两位数字，如 05（留空自动）" maxlength="2" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="类别名称" />
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
