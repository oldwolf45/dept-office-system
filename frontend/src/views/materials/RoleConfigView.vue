<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getMaterialsRoleMap,
  grantMaterialsRole,
  revokeMaterialsRole
} from '@/api/materials'
import type {
  CodeLabel,
  MaterialModuleRole,
  ModuleRoleMapResult,
  ModuleRoleMapRow,
  ModuleUnitOption,
  RoleCandidate
} from '@/types/materials'

// 角色配置（T10 补口）
// 分工按接入管理 PRD：平台管「模块访问权」，角色归模块。
// 这里只管「谁在材料模块里担任什么角色」，不动平台层级、不建材料独立账号。

const loading = ref(false)
const saving = ref(false)
const data = ref<ModuleRoleMapResult | null>(null)

const form = reactive<{
  userId: number | null
  role: MaterialModuleRole | ''
  unitType: 'workshop' | 'section'
  unitName: string
}>({
  userId: null,
  role: '',
  unitType: 'section',
  unitName: ''
})

const candidates = computed<RoleCandidate[]>(() => data.value?.candidates ?? [])
const units = computed<ModuleUnitOption[]>(() => data.value?.units ?? [])
const roles = computed<CodeLabel[]>(() => data.value?.roles ?? [])
const unitTypes = computed<CodeLabel[]>(() => data.value?.unitTypes ?? [])
const list = computed<ModuleRoleMapRow[]>(() => data.value?.list ?? [])

// 人员下拉显示「工号 姓名（层级｜科室）」，避免同名混淆
function candidateLabel(c: RoleCandidate): string {
  return `${c.userNo} ${c.name}（L${c.level}｜${c.deptName || '-'}）`
}
function unitTypeLabel(t: string): string {
  return unitTypes.value.find((x) => x.code === t)?.label ?? t
}

async function load() {
  loading.value = true
  try {
    data.value = await getMaterialsRoleMap()
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

// 选人员时把单位预填成他所属科室，减少手工输入
function onUserChange(id: number | null) {
  const c = candidates.value.find((x) => x.id === id)
  if (c && !form.unitName) {
    form.unitName = c.deptName || ''
  }
}

async function submit() {
  if (!form.userId) return ElMessage.warning('请选择人员')
  if (!form.role) return ElMessage.warning('请选择材料模块角色')
  if (!form.unitName.trim()) return ElMessage.warning('请填写单位名称')

  saving.value = true
  try {
    await grantMaterialsRole({
      userId: form.userId,
      role: form.role,
      unitType: form.unitType,
      unitName: form.unitName.trim()
    })
    ElMessage.success('已授予')
    form.role = ''
    await load()
  } catch {
    /* 错误提示由请求拦截器统一弹出 */
  } finally {
    saving.value = false
  }
}

async function revoke(row: ModuleRoleMapRow) {
  try {
    await ElMessageBox.confirm(
      `确定撤销「${row.userName}」的「${row.roleLabel}」角色？撤销后该用户对应的操作按钮会立即失效。`,
      '撤销授权',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await revokeMaterialsRole(row.id)
    ElMessage.success('已撤销')
    await load()
  } catch {
    /* 同上 */
  }
}

// 按人聚合展示，一人多角色时并列显示
const grouped = computed(() => {
  const map = new Map<number, { userNo: string; userName: string; level: number; deptName: string; rows: ModuleRoleMapRow[] }>()
  for (const r of list.value) {
    const hit = map.get(r.userId)
    if (hit) hit.rows.push(r)
    else map.set(r.userId, { userNo: r.userNo, userName: r.userName, level: r.level, deptName: r.deptName, rows: [r] })
  }
  return Array.from(map.values())
})

onMounted(load)
</script>

<template>
  <div class="p-4">
    <div class="flex items-baseline gap-3 mb-1">
      <h2 class="text-lg font-bold">角色配置</h2>
      <span class="text-xs text-gray-500">决定谁在材料模块里能做什么；平台层级只决定能否进入本页</span>
    </div>

    <el-alert type="info" :closable="false" class="mb-4">
      <template #title>
        材料模块角色与平台账号层级是两回事：层级 5 的科长若没有「车间主任 / 供应科」角色，
        同样不能审核计划、不能登记采购。人员 ↔ 角色 ↔ 单位 的初始映射在此配置。
      </template>
    </el-alert>

    <el-card shadow="never" class="mb-4">
      <template #header><span class="font-medium">授予角色</span></template>
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="text-xs text-gray-500 mb-1">人员</div>
          <el-select
            v-model="form.userId"
            filterable
            placeholder="按工号或姓名搜索"
            style="width: 280px"
            @change="onUserChange"
          >
            <el-option v-for="c in candidates" :key="c.id" :label="candidateLabel(c)" :value="c.id" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-500 mb-1">材料模块角色</div>
          <el-select v-model="form.role" placeholder="选择角色" style="width: 160px">
            <el-option v-for="r in roles" :key="r.code" :label="r.label" :value="r.code" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-500 mb-1">单位类型</div>
          <el-select v-model="form.unitType" style="width: 140px">
            <el-option v-for="t in unitTypes" :key="t.code" :label="t.label" :value="t.code" />
          </el-select>
        </div>
        <div>
          <div class="text-xs text-gray-500 mb-1">单位名称</div>
          <el-select
            v-model="form.unitName"
            filterable
            allow-create
            default-first-option
            placeholder="选或直接输入"
            style="width: 200px"
          >
            <el-option v-for="u in units" :key="u.code" :label="u.name" :value="u.name" />
          </el-select>
        </div>
        <el-button type="primary" :loading="saving" @click="submit">授予</el-button>
      </div>
    </el-card>

    <el-table :data="grouped" v-loading="loading" border>
      <el-table-column prop="userNo" label="工号" width="110" />
      <el-table-column prop="userName" label="姓名" width="110" />
      <el-table-column label="平台层级" width="100">
        <template #default="{ row }">L{{ row.level }}</template>
      </el-table-column>
      <el-table-column prop="deptName" label="科室" width="150" />
      <el-table-column label="材料模块角色">
        <template #default="{ row }">
          <div class="flex flex-wrap items-center gap-1">
            <el-tag
              v-for="r in row.rows"
              :key="r.id"
              closable
              type="success"
              @close="revoke(r)"
            >
              {{ r.roleLabel }}·{{ r.unitName }}
              <span class="text-[10px] opacity-70">{{ unitTypeLabel(r.unitType) }}</span>
            </el-tag>
            <span v-if="!row.rows.length" class="text-gray-400 text-sm">未配置</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="最近授权" width="160">
        <template #default="{ row }">{{ row.rows[0]?.createdAt || '-' }}</template>
      </el-table-column>
    </el-table>

    <div class="mt-3 text-xs text-gray-500">
      共 {{ list.length }} 条授权，涉及 {{ grouped.length }} 人。标签上的 × 即撤销。
    </div>
  </div>
</template>
