<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMaterialsMe } from '@/api/materials'
import { MATERIAL_ROLE_LABELS } from '@/types/materials'
import type { MaterialsMeResult, MaterialModuleRoleMap } from '@/types/materials'

const me = ref<MaterialsMeResult | null>(null)
const loading = ref<boolean>(true)

// 各角色工作区占位卡片（T1+ 逐任务填充真实功能）
const featureCards = [
  { key: 'plan', title: '计划管理', desc: '车间/科室物料需求填报与审核' },
  { key: 'purchase', title: '采购管理', desc: '按类登记采购与金额' },
  { key: 'arrival', title: '到货与编号', desc: '到货登记、批量生成材料编号' },
  { key: 'issue', title: '领用/回收/处置', desc: '状态机正向流转' },
  { key: 'lifecycle', title: '生命周期查询', desc: '按编号/名称追溯全链路' },
  { key: 'chart', title: '图表汇总', desc: '按月/车间/类别收支与流转' }
]

function roleText(roles: MaterialModuleRoleMap[]): string {
  if (!roles.length) return '未分配材料模块角色'
  return roles.map((r) => `${r.roleLabel}（${r.unitName}）`).join('、')
}

onMounted(async () => {
  try {
    me.value = await getMaterialsMe()
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

      <el-alert class="mb-4" type="info" :closable="false" show-icon
        title="模块骨架已接入（v1.1 / T0）" description="下方为各角色工作区占位，计划/采购/到货/领用/回收/处置/图表/生命周期等功能将按开发计划在后续任务中逐步填充。" />

      <div class="mb-4 flex gap-2">
        <router-link to="/materials/plans"><el-button type="primary" plain>需求计划</el-button></router-link>
        <router-link to="/materials/categories"><el-button type="primary" plain>材料类别</el-button></router-link>
        <router-link to="/materials/finance"><el-button type="primary" plain>收支分类</el-button></router-link>
      </div>

      <el-row :gutter="16">
        <el-col v-for="card in featureCards" :key="card.key" :xs="24" :sm="12" :md="8" class="mb-4">
          <el-card shadow="hover" :body-style="{ cursor: card.key === 'plan' ? 'pointer' : 'default' }">
            <router-link v-if="card.key === 'plan'" to="/materials/plans" class="no-underline">
              <div class="font-medium">{{ card.title }}</div>
              <div class="text-sm text-gray-500 mt-1">{{ card.desc }}</div>
              <el-tag class="mt-2" size="small" type="success">可用</el-tag>
            </router-link>
            <template v-else>
              <div class="font-medium">{{ card.title }}</div>
              <div class="text-sm text-gray-500 mt-1">{{ card.desc }}</div>
              <el-tag class="mt-2" size="small" type="warning">建设中</el-tag>
            </template>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>
