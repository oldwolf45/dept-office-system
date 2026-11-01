<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getMaterialsMe, getDashboardOverview } from '@/api/materials'
import { MATERIAL_ROLE_LABELS } from '@/types/materials'
import type { MaterialsMeResult, MaterialModuleRoleMap, DashboardOverview } from '@/types/materials'

const me = ref<MaterialsMeResult | null>(null)
const overview = ref<DashboardOverview | null>(null)
const loading = ref<boolean>(true)

// 各功能入口（T4~T7 已完成，均可点进）
// 角色配置只在平台层级 >= 3 时出现（后端同样以 requireLevel(3) 兜住）
const featureCards = computed(() => {
  const base = [
    { key: 'plan', title: '计划管理', desc: '车间/科室需求填报、审核、全厂汇总', to: '/materials/plans' },
    { key: 'purchase', title: '采购管理', desc: '按类登记采购与金额、作废', to: '/materials/purchases' },
    { key: 'arrival', title: '到货与编号', desc: '到货登记、批量生成材料编号', to: '/materials/arrivals' },
    { key: 'issue', title: '领用/回收/处置', desc: '状态机正向流转、处置收入', to: '/materials/flow' },
    { key: 'lifecycle', title: '生命周期查询', desc: '按编号/名称追溯全链路时间线', to: '/materials/list' },
    { key: 'chart', title: '图表汇总', desc: '按月收支对比与流转数量', to: '/materials/stats' }
  ]
  if (me.value?.canManageRoles) {
    base.push({ key: 'roles', title: '角色配置', desc: '给人员授予材料模块角色（工段长/车间主任/供应科/科室经办）', to: '/materials/roles' })
  }
  return base
})

function roleText(roles: MaterialModuleRoleMap[]): string {
  if (!roles.length) return '未分配材料模块角色'
  return roles.map((r) => `${MATERIAL_ROLE_LABELS[r.role]}（${r.unitName}）`).join('、')
}

onMounted(async () => {
  try {
    me.value = await getMaterialsMe()
    if (me.value.hasAccess) overview.value = await getDashboardOverview()
  } catch {
    me.value = null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="p-4">
    <el-card v-if="loading" shadow="never">
      <span class="text-gray-500">加载中…</span>
    </el-card>

    <el-card v-else-if="!me || !me.hasAccess" shadow="never">
      <el-result icon="warning" title="无访问权限" sub-title="您当前未被授予「材料管理」模块访问权，请联系管理员在账号管理中开通。">
      </el-result>
    </el-card>

    <div v-else>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">材料管理工作台</h2>
        <el-tag type="info">{{ roleText(me.roles) }}</el-tag>
      </div>

      <!-- 概览（T9）-->
      <el-row v-if="overview" :gutter="16" class="mb-4">
        <el-col :xs="12" :sm="6" class="mb-3">
          <el-card shadow="hover"><div class="text-sm text-gray-500">待审批计划</div><div class="text-2xl font-bold">{{ overview.pendingApproval }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6" class="mb-3">
          <el-card shadow="hover"><div class="text-sm text-gray-500">采购支出合计</div><div class="text-2xl font-bold">{{ Number(overview.purchaseAmount).toFixed(2) }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6" class="mb-3">
          <el-card shadow="hover"><div class="text-sm text-gray-500">处置收入合计</div><div class="text-2xl font-bold">{{ Number(overview.disposeIncome).toFixed(2) }}</div></el-card>
        </el-col>
        <el-col :xs="12" :sm="6" class="mb-3">
          <el-card shadow="hover"><div class="text-sm text-gray-500">在库材料</div><div class="text-2xl font-bold">{{ overview.materialByStatus.in_stock || 0 }}</div></el-card>
        </el-col>
      </el-row>

      <!-- 计划状态进度（T9）-->
      <el-card v-if="overview" shadow="never" class="mb-4">
        <div class="font-medium mb-2">计划流程状态</div>
        <div class="flex flex-wrap gap-3">
          <el-tag type="info">草稿 {{ overview.planStatus.draft || 0 }}</el-tag>
          <el-tag type="warning">已提交 {{ overview.planStatus.submitted || 0 }}</el-tag>
          <el-tag type="success">已通过 {{ overview.planStatus.approved || 0 }}</el-tag>
          <el-tag type="danger">已驳回 {{ overview.planStatus.rejected || 0 }}</el-tag>
        </div>
      </el-card>

      <div class="mb-4 flex gap-2 flex-wrap">
        <router-link to="/materials/plans"><el-button type="primary" plain>需求计划</el-button></router-link>
        <router-link to="/materials/purchases"><el-button type="primary" plain>采购管理</el-button></router-link>
        <router-link to="/materials/arrivals"><el-button type="primary" plain>到货登记</el-button></router-link>
        <router-link to="/materials/flow"><el-button type="primary" plain>领用/回收/处置</el-button></router-link>
        <router-link to="/materials/list"><el-button type="primary" plain>生命周期</el-button></router-link>
        <router-link to="/materials/stats"><el-button type="primary" plain>图表汇总</el-button></router-link>
        <router-link to="/materials/categories"><el-button plain>材料类别</el-button></router-link>
        <router-link to="/materials/finance"><el-button plain>收支分类</el-button></router-link>
      </div>

      <el-row :gutter="16">
        <el-col v-for="card in featureCards" :key="card.key" :xs="24" :sm="12" :md="8" class="mb-4">
          <router-link :to="card.to" class="no-underline">
            <el-card shadow="hover" :body-style="{ cursor: 'pointer' }">
              <div class="font-medium">{{ card.title }}</div>
              <div class="text-sm text-gray-500 mt-1">{{ card.desc }}</div>
              <el-tag class="mt-2" size="small" type="success">可用</el-tag>
            </el-card>
          </router-link>
        </el-col>
      </el-row>
    </div>
  </div>
</template>
