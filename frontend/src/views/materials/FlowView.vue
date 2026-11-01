<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  listMaterials,
  listIssues,
  listDisposals,
  createIssue,
  createRecycle,
  createDisposal
} from '@/api/materials'
import { useMaterialsAccess } from '@/composables/useMaterialsAccess'
import type { Material, IssueRecord, DisposalBatch } from '@/types/materials'

const { hasRole } = useMaterialsAccess()
const canSupply = () => hasRole('supply')

const activeTab = ref<'issue' | 'recycle' | 'dispose'>('issue')
const all = ref<Material[]>([])
const issues = ref<IssueRecord[]>([])
const disposals = ref<DisposalBatch[]>([])
const loading = ref(false)

const inStock = computed(() => all.value.filter((m) => m.status === 'in_stock'))
const issuedMats = computed(() => all.value.filter((m) => m.status === 'issued'))
const disposable = computed(() => all.value.filter((m) => m.status === 'issued' || m.status === 'recycled'))

function todayStr(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

// 领用
const issueForm = reactive({
  materialIds: [] as number[],
  receiveUnitType: 'workshop' as 'workshop' | 'section',
  receiveUnitCode: '',
  receiveUnitName: '',
  handler: '',
  issueDate: ''
})

// 回收
const recycleForm = reactive({ materialId: null as number | null, handler: '', recycleDate: '' })

// 处置
const disposeForm = reactive({
  disposeType: '',
  handler: '',
  disposeDate: '',
  items: [] as Array<{ materialId: number | null; income: number }>
})

async function loadAll() {
  loading.value = true
  try {
    all.value = await listMaterials()
    issues.value = await listIssues()
    disposals.value = await listDisposals()
  } finally {
    loading.value = false
  }
}

function resetIssue() {
  issueForm.materialIds = []
  issueForm.receiveUnitType = 'workshop'
  issueForm.receiveUnitCode = ''
  issueForm.receiveUnitName = ''
  issueForm.handler = ''
  issueForm.issueDate = todayStr()
}
function resetRecycle() {
  recycleForm.materialId = null
  recycleForm.handler = ''
  recycleForm.recycleDate = todayStr()
}
function resetDispose() {
  disposeForm.disposeType = ''
  disposeForm.handler = ''
  disposeForm.disposeDate = todayStr()
  disposeForm.items = [{ materialId: null, income: 0 }]
}

async function submitIssue() {
  if (!canSupply()) return ElMessage.warning('仅供应科可登记领用')
  if (!issueForm.materialIds.length) return ElMessage.warning('请选择材料')
  if (!issueForm.receiveUnitCode.trim() || !issueForm.receiveUnitName.trim()) return ElMessage.warning('请填写领用单位')
  await createIssue({
    materialIds: issueForm.materialIds,
    receiveUnitType: issueForm.receiveUnitType,
    receiveUnitCode: issueForm.receiveUnitCode.trim(),
    receiveUnitName: issueForm.receiveUnitName.trim(),
    handler: issueForm.handler.trim(),
    issueDate: issueForm.issueDate
  })
  ElMessage.success('已登记领用')
  resetIssue()
  await loadAll()
}

async function submitRecycle() {
  if (!canSupply()) return ElMessage.warning('仅供应科可登记回收')
  if (!recycleForm.materialId) return ElMessage.warning('请选择材料')
  await createRecycle({
    materialId: recycleForm.materialId,
    handler: recycleForm.handler.trim(),
    recycleDate: recycleForm.recycleDate
  })
  ElMessage.success('已登记回收')
  resetRecycle()
  await loadAll()
}

function addDisposeItem() {
  disposeForm.items.push({ materialId: null, income: 0 })
}
function removeDisposeItem(i: number) {
  disposeForm.items.splice(i, 1)
}

async function submitDispose() {
  if (!canSupply()) return ElMessage.warning('仅供应科可登记处置')
  const items = disposeForm.items.filter((it) => it.materialId)
  if (!items.length) return ElMessage.warning('请选择处置材料')
  await createDisposal({
    disposeType: disposeForm.disposeType.trim() || null,
    handler: disposeForm.handler.trim(),
    disposeDate: disposeForm.disposeDate,
    items: items.map((it) => ({ materialId: it.materialId as number, qty: 1, income: it.income }))
  })
  ElMessage.success('已登记处置')
  resetDispose()
  await loadAll()
}

onMounted(async () => {
  resetIssue()
  resetRecycle()
  resetDispose()
  await loadAll()
})
</script>

<template>
  <div class="p-4">
    <h2 class="text-lg font-bold mb-4">领用 / 回收 / 处置</h2>
    <el-alert v-if="!canSupply()" type="warning" :closable="false" class="mb-3" title="仅供应科可登记流转动作" />

    <el-tabs v-model="activeTab">
      <!-- 领用 -->
      <el-tab-pane label="领用" name="issue">
        <el-form label-width="90px">
          <el-form-item label="选择材料" required>
            <el-select v-model="issueForm.materialIds" multiple filterable placeholder="在库材料" style="width: 100%">
              <el-option v-for="m in inStock" :key="m.id" :label="`${m.materialCode} ${m.name}`" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="领用单位">
            <el-radio-group v-model="issueForm.receiveUnitType">
              <el-radio value="workshop">车间/工段</el-radio>
              <el-radio value="section">科室</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="issueForm.receiveUnitCode" placeholder="编码" style="width: 130px; margin-right: 8px" />
            <el-input v-model="issueForm.receiveUnitName" placeholder="名称" style="width: 200px" />
          </el-form-item>
          <el-form-item label="经办人">
            <el-input v-model="issueForm.handler" placeholder="经办人" style="width: 200px" />
          </el-form-item>
          <el-form-item label="领用日期">
            <el-date-picker v-model="issueForm.issueDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :disabled="!canSupply()" @click="submitIssue">登记领用</el-button>
          </el-form-item>
        </el-form>

        <el-divider>领用记录</el-divider>
        <el-table :data="issues" border size="small">
          <el-table-column prop="issueNo" label="领用单号" width="170" />
          <el-table-column prop="receiveUnitName" label="领用单位" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ row.receiveUnitType === 'section' ? '科室' : '车间' }}</template>
          </el-table-column>
          <el-table-column prop="qty" label="数量" width="80" />
          <el-table-column prop="issueDate" label="日期" width="110" />
        </el-table>
      </el-tab-pane>

      <!-- 回收 -->
      <el-tab-pane label="回收" name="recycle">
        <el-form label-width="90px">
          <el-form-item label="选择材料" required>
            <el-select v-model="recycleForm.materialId" filterable placeholder="已领用材料" style="width: 100%">
              <el-option v-for="m in issuedMats" :key="m.id" :label="`${m.materialCode} ${m.name}`" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="经办人">
            <el-input v-model="recycleForm.handler" placeholder="经办人" style="width: 200px" />
          </el-form-item>
          <el-form-item label="回收日期">
            <el-date-picker v-model="recycleForm.recycleDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :disabled="!canSupply()" @click="submitRecycle">登记回收</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 处置 -->
      <el-tab-pane label="处置" name="dispose">
        <el-form label-width="90px">
          <el-form-item label="处置方式">
            <el-input v-model="disposeForm.disposeType" placeholder="如 报废/变卖" style="width: 200px" />
          </el-form-item>
          <el-form-item label="经办人">
            <el-input v-model="disposeForm.handler" placeholder="经办人" style="width: 200px" />
          </el-form-item>
          <el-form-item label="处置日期">
            <el-date-picker v-model="disposeForm.disposeDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
        </el-form>

        <el-table :data="disposeForm.items" border size="small">
          <el-table-column label="材料" min-width="220">
            <template #default="{ row }">
              <el-select v-model="row.materialId" filterable placeholder="已领用/已回收材料" style="width: 100%">
                <el-option v-for="m in disposable" :key="m.id" :label="`${m.materialCode} ${m.name}`" :value="m.id" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="处置收入" width="150">
            <template #default="{ row }"><el-input-number v-model="row.income" :min="0" :precision="2" /></template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeDisposeItem($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="mt-2 flex gap-2">
          <el-button type="dashed" @click="addDisposeItem">+ 添加材料</el-button>
          <el-button type="primary" :disabled="!canSupply()" @click="submitDispose">登记处置</el-button>
        </div>

        <el-divider>处置批次</el-divider>
        <el-table :data="disposals" border size="small">
          <el-table-column prop="disposalNo" label="处置单号" width="170" />
          <el-table-column prop="disposeType" label="方式" width="100" />
          <el-table-column prop="totalQty" label="数量" width="80" />
          <el-table-column prop="totalIncome" label="收入" width="110">
            <template #default="{ row }">{{ Number(row.totalIncome).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column prop="disposeDate" label="日期" width="110" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
