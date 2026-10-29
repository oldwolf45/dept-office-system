<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import type {
  AccountingApproval,
  FundExpense,
  FundPlan,
  LedgerRow,
  MaterialIssue,
  MaterialItem,
  MaterialPlan,
  MaterialReceipt,
  StockRow,
  Stocktaking
} from '@/types'
import {
  approveApproval,
  createExpense,
  createFundPlan,
  createIssue,
  createModifyRequest,
  createPlan,
  createReceipt,
  createStocktaking,
  createItem,
  getApprovals,
  getExpenses,
  getFundPlans,
  getItems,
  getIssues,
  getLedger,
  getPlans,
  getReceipts,
  getStock,
  getStocktakingList,
  rejectApproval,
  settleExpense,
  submitStocktakingItems,
  confirmStocktaking,
  updateItemMinStock,
  voidExpense,
  voidIssue,
  voidReceipt,
  voidStocktaking
} from '@/api/accounting'
import { getReportMeta } from '@/api/reports'
import { currentMonth, fmtAmount, isLedgerOverdue, isOverPlan, LEDGER_REMIND_DAYS, monthOptions } from '@/utils/accounting'
import { formatDateTime } from '@/utils/format'

const userStore = useUserStore()
const route = useRoute()

// ---------- 权限（契约 §2：记账员/代录可操作，科长副科长只读+确认，上级只读） ----------
const canOperate = computed<boolean>(() => userStore.hasAccountOperate())
const canConfirm = computed<boolean>(() => userStore.hasAccountConfirm())
// 只读角色：有账目查看权但无操作权 → 整页不出现操作按钮（2.5 通用界面规则）
const readOnly = computed<boolean>(() => !canOperate.value)

// ---------- 月份与月末只读锁（C24） ----------
const activeTab = ref<string>('plans')
const month = ref<string>(currentMonth())
const monthList = computed<string[]>(() => monthOptions(new Date(), 8))
const monthLocked = ref<boolean>(false)

async function loadLock(): Promise<void> {
  try {
    const meta = await getReportMeta(month.value)
    monthLocked.value = !!meta.locked
  } catch {
    // 报表接口未就绪时不阻塞记账页
    monthLocked.value = false
  }
}

// ---------- 公共数据 ----------
const items = ref<MaterialItem[]>([])
const loading = ref<boolean>(false)

async function loadItems(): Promise<void> {
  try {
    items.value = await getItems()
  } catch {
    items.value = []
  }
}

function itemName(id: number | null | undefined): string {
  if (!id) return '-'
  return items.value.find((i) => i.id === id)?.name ?? `#${id}`
}

const assignableUsers = computed(() => userStore.permissions?.assignableTargets ?? [])

// ---------- 1. 物料计划 ----------
const plans = ref<MaterialPlan[]>([])
async function loadPlans(): Promise<void> {
  plans.value = await getPlans(month.value)
}

const planForm = reactive({
  itemId: null as number | null,
  newName: '',
  newUnit: '',
  plannedQty: 0,
  referencePrice: 0,
  isAppend: false,
  appendNote: ''
})
const planDialogVisible = ref<boolean>(false)
const planDialogMode = ref<'plan' | 'append'>('plan')

const planAmountPreview = computed<number>(() =>
  Math.round(planForm.plannedQty * planForm.referencePrice * 100) / 100
)

function openPlanDialog(mode: 'plan' | 'append'): void {
  planDialogMode.value = mode
  planForm.isAppend = mode === 'append'
  planDialogVisible.value = true
}

async function submitPlan(): Promise<void> {
  let itemId = planForm.itemId
  if (!itemId) {
    if (!planForm.newName || !planForm.newUnit) {
      ElMessage.warning('请选择历史物品，或填写新物品名称与单位')
      return
    }
    const created = await createItem({ name: planForm.newName, unit: planForm.newUnit })
    itemId = created.id
    await loadItems()
  }
  await createPlan({
    month: month.value,
    itemId,
    plannedQty: planForm.plannedQty,
    referencePrice: planForm.referencePrice,
    isAppend: planForm.isAppend ? 1 : 0,
    appendNote: planForm.isAppend ? planForm.appendNote : undefined
  })
  ElMessage.success(planForm.isAppend ? '计划已追加' : '月度计划已编制')
  planDialogVisible.value = false
  planForm.newName = ''
  planForm.newUnit = ''
  await loadPlans()
}

// ---------- 2. 领用登记 ----------
const receipts = ref<MaterialReceipt[]>([])
async function loadReceipts(): Promise<void> {
  receipts.value = await getReceipts(month.value)
}

const receiptForm = reactive({
  itemId: null as number | null,
  planId: null as number | null,
  qty: 0,
  unitPrice: 0,
  receiptDate: '',
  handler: '',
  voucher: ''
})
const receiptDialogVisible = ref<boolean>(false)

const receiptItemPlans = computed<MaterialPlan[]>(() =>
  plans.value.filter((p) => p.itemId === receiptForm.itemId)
)

const receiptAmountPreview = computed<number>(() =>
  Math.round(receiptForm.qty * receiptForm.unitPrice * 100) / 100
)

function openReceiptDialog(): void {
  receiptForm.receiptDate = new Date().toISOString().slice(0, 10)
  receiptDialogVisible.value = true
}

async function submitReceipt(): Promise<void> {
  if (!receiptForm.itemId) {
    ElMessage.warning('请选择物品')
    return
  }
  await createReceipt({
    month: month.value,
    itemId: receiptForm.itemId,
    planId: receiptForm.planId,
    qty: receiptForm.qty,
    unitPrice: receiptForm.unitPrice,
    receiptDate: receiptForm.receiptDate,
    handler: receiptForm.handler,
    voucher: receiptForm.voucher || undefined
  })
  ElMessage.success('领用已登记（超计划时标红并提示科长确认，不阻断）')
  receiptDialogVisible.value = false
  await loadReceipts()
  await loadStockData()
}

async function onVoidReceipt(row: MaterialReceipt): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写作废原因（跨天作废将发起科长确认）', `作废领用 ${row.receiptNo}`, {
    inputPlaceholder: '作废原因',
    inputValidator: (v: string) => (v && v.trim() ? true : '原因必填')
  })
  await voidReceipt(row.id, value.trim())
  ElMessage.success('已提交作废（跨天记录待科长确认后生效）')
  await loadReceipts()
}

// ---------- 3. 发放登记 ----------
const issues = ref<MaterialIssue[]>([])
async function loadIssues(): Promise<void> {
  issues.value = await getIssues(month.value)
}

const issueForm = reactive({
  itemId: null as number | null,
  userId: null as number | null,
  qty: 0,
  issueDate: '',
  handler: ''
})
const issueDialogVisible = ref<boolean>(false)

const pendingByItem = computed<Map<number, number>>(() => {
  const m = new Map<number, number>()
  stockRows.value.forEach((r) => m.set(r.itemId, r.pendingIssueQty))
  return m
})
const pendingForSelected = computed<number>(() =>
  issueForm.itemId ? pendingByItem.value.get(issueForm.itemId) ?? 0 : 0
)

function openIssueDialog(): void {
  issueForm.issueDate = new Date().toISOString().slice(0, 10)
  issueDialogVisible.value = true
}

async function submitIssue(): Promise<void> {
  if (!issueForm.itemId || !issueForm.userId) {
    ElMessage.warning('请选择物品和领用人')
    return
  }
  if (issueForm.qty > pendingForSelected.value) {
    ElMessage.error(`发放数量超过待发放量（${pendingForSelected.value}），无法提交（C25）`)
    return
  }
  await createIssue({
    month: month.value,
    itemId: issueForm.itemId,
    userId: issueForm.userId,
    qty: issueForm.qty,
    issueDate: issueForm.issueDate,
    handler: issueForm.handler
  })
  ElMessage.success('发放已登记，领用人"我的物品"同步生成记录')
  issueDialogVisible.value = false
  await loadIssues()
  await loadStockData()
}

async function onVoidIssue(row: MaterialIssue): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写作废原因（跨天作废将发起科长确认）', `作废发放 ${row.issueNo}`, {
    inputPlaceholder: '作废原因',
    inputValidator: (v: string) => (v && v.trim() ? true : '原因必填')
  })
  await voidIssue(row.id, value.trim())
  ElMessage.success('已提交作废（跨天记录待科长确认后生效）')
  await loadIssues()
}

// ---------- 4. 结存视图 ----------
const stockRows = ref<StockRow[]>([])
async function loadStockData(): Promise<void> {
  stockRows.value = await getStock(month.value)
}

const lowStockRows = computed<StockRow[]>(() => stockRows.value.filter((r) => r.lowStock))

async function onSetMinStock(row: StockRow): Promise<void> {
  const { value } = await ElMessageBox.prompt(`设置「${row.itemName}」库存下限（当前结存 ${row.closingQty}）`, '库存下限', {
    inputValue: String(row.minStock),
    inputValidator: (v: string) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? true : '请填非负数字')
  })
  await updateItemMinStock(row.itemId, Number(value))
  ElMessage.success('库存下限已更新')
  await loadStockData()
}

// ---------- 5. 盘点（C30） ----------
const takings = ref<Stocktaking[]>([])
async function loadTakings(): Promise<void> {
  try {
    takings.value = await getStocktakingList(month.value)
  } catch {
    takings.value = []
  }
}

const takingForm = reactive<Record<number, { actualQty: number; reason: string }>>({})
const takingDialogVisible = ref<boolean>(false)
const activeTaking = ref<Stocktaking | null>(null)

function initTakingForm(row: Stocktaking): void {
  row.items.forEach((it) => {
    takingForm[it.itemId] = {
      actualQty: it.actualQty ?? it.bookQty,
      reason: it.reason ?? ''
    }
  })
}

async function onStartTaking(): Promise<void> {
  activeTaking.value = await createStocktaking(month.value)
  initTakingForm(activeTaking.value)
  takingDialogVisible.value = true
  await loadTakings()
}

function openTaking(row: Stocktaking): void {
  activeTaking.value = row
  initTakingForm(row)
  takingDialogVisible.value = true
}

async function onSubmitTakingItems(): Promise<void> {
  if (!activeTaking.value) return
  const itemsPayload = (activeTaking.value.items || [])
    .filter((it) => it.actualQty !== null && it.actualQty !== undefined)
    .map((it) => {
      const f = takingForm[it.itemId]
      return { itemId: it.itemId, actualQty: f.actualQty, reason: f.reason }
    })
  if (!itemsPayload.length) {
    ElMessage.warning('请至少录入一行实盘数量')
    return
  }
  // 盘盈盘亏原因必填
  for (const p of itemsPayload) {
    if (!p.reason || !p.reason.trim()) {
      ElMessage.warning(`物品 #${p.itemId} 盘盈盘亏原因必填`)
      return
    }
  }
  const updated = await submitStocktakingItems(activeTaking.value.id, itemsPayload)
  activeTaking.value = updated
  ElMessage.success('实盘已录入，等待科长确认后调整账面')
  await loadTakings()
}

async function onConfirmTaking(row: Stocktaking): Promise<void> {
  await confirmStocktaking(row.id)
  ElMessage.success('盘点已确认，账面已按盘盈盘亏调整')
  await loadTakings()
  await loadStockData()
}

async function onVoidTaking(row: Stocktaking): Promise<void> {
  const { value } = await ElMessageBox.prompt('盘点单不可删除，只能作废重盘。请填写原因', '作废盘点单', {
    inputValidator: (v: string) => (v && v.trim() ? true : '原因必填')
  })
  await voidStocktaking(row.id, value.trim())
  ElMessage.success('盘点单已作废，可重新发起')
  await loadTakings()
}

// ---------- 6. 资金计划与支出 ----------
const fundPlans = ref<FundPlan[]>([])
const expenses = ref<FundExpense[]>([])
async function loadFund(): Promise<void> {
  fundPlans.value = await getFundPlans(month.value)
  expenses.value = await getExpenses(month.value)
}

const fundPlanForm = reactive({ item: '', plannedAmount: 0, isAppend: false, appendNote: '' })
const fundPlanDialogVisible = ref<boolean>(false)
async function submitFundPlan(): Promise<void> {
  if (!fundPlanForm.item) {
    ElMessage.warning('请填写计划事项')
    return
  }
  await createFundPlan({
    month: month.value,
    item: fundPlanForm.item,
    plannedAmount: fundPlanForm.plannedAmount,
    isAppend: fundPlanForm.isAppend ? 1 : 0,
    appendNote: fundPlanForm.isAppend ? fundPlanForm.appendNote : undefined
  })
  ElMessage.success('资金计划已登记')
  fundPlanDialogVisible.value = false
  await loadFund()
}

const expenseForm = reactive({
  item: '',
  amount: 0,
  payee: '',
  expenseDate: '',
  handler: '',
  voucher: '',
  planId: null as number | null
})
const expenseDialogVisible = ref<boolean>(false)
function openExpenseDialog(): void {
  expenseForm.expenseDate = new Date().toISOString().slice(0, 10)
  expenseDialogVisible.value = true
}
async function submitExpense(): Promise<void> {
  if (!expenseForm.item) {
    ElMessage.warning('请填写支出事项')
    return
  }
  await createExpense({
    month: month.value,
    item: expenseForm.item,
    amount: expenseForm.amount,
    payee: expenseForm.payee,
    expenseDate: expenseForm.expenseDate,
    handler: expenseForm.handler,
    voucher: expenseForm.voucher || undefined,
    planId: expenseForm.planId
  })
  ElMessage.success(expenseForm.planId ? '支出已登记（计划内）' : '支出已登记（无计划→挂账）')
  expenseDialogVisible.value = false
  await loadFund()
}

const fundTotalPlan = computed<number>(() =>
  fundPlans.value.reduce((s, p) => s + p.plannedAmount, 0)
)
const fundTotalSpent = computed<number>(() =>
  expenses.value.filter((e) => e.status === 'normal').reduce((s, e) => s + e.amount, 0)
)
const fundBalance = computed<number>(() => fundTotalPlan.value - fundTotalSpent.value)

// 销账对话框（C21：部分销账+差额说明必填）
const settleForm = reactive({ expenseId: 0, planId: null as number | null, settleAmount: 0, diffReason: '' })
const settleDialogVisible = ref<boolean>(false)
function openSettleDialog(row: FundExpense): void {
  settleForm.expenseId = row.id
  settleForm.planId = null
  settleForm.settleAmount = row.remainAmount ?? row.amount
  settleForm.diffReason = ''
  settleDialogVisible.value = true
}
async function submitSettle(): Promise<void> {
  if (!settleForm.planId) {
    ElMessage.warning('销账需选择对应补录的资金计划')
    return
  }
  const remain = settleForm.settleAmount
  const row = expenses.value.find((e) => e.id === settleForm.expenseId)
  const expected = row?.remainAmount ?? row?.amount ?? 0
  if (Math.abs(remain - expected) > 0.001 && !settleForm.diffReason.trim()) {
    ElMessage.warning('销账金额与挂账剩余不一致时，差额说明必填')
    return
  }
  await settleExpense(settleForm.expenseId, {
    planId: settleForm.planId,
    settleAmount: remain,
    diffReason: settleForm.diffReason || undefined
  })
  ElMessage.success('销账完成（剩余继续挂账或已结清）')
  settleDialogVisible.value = false
  await loadFund()
}

async function onVoidExpense(row: FundExpense): Promise<void> {
  const { value } = await ElMessageBox.prompt('请填写作废原因（跨天作废将发起科长确认）', `作废支出 ${row.expenseNo}`, {
    inputValidator: (v: string) => (v && v.trim() ? true : '原因必填')
  })
  await voidExpense(row.id, value.trim())
  ElMessage.success('已提交作废')
  await loadFund()
}

// ---------- 7. 挂账清单 ----------
const ledger = ref<LedgerRow[]>([])
async function loadLedger(): Promise<void> {
  ledger.value = await getLedger()
}
const overdueLedger = computed<LedgerRow[]>(() => ledger.value.filter((r) => isLedgerOverdue(r.days)))

// ---------- 8. 待确认（跨天修改/作废 C23） ----------
const approvals = ref<AccountingApproval[]>([])
async function loadApprovals(): Promise<void> {
  approvals.value = await getApprovals()
}
const approvalTargetLabel: Record<string, string> = { receipt: '领用', issue: '发放', expense: '支出' }
const approvalActionLabel: Record<string, string> = { edit: '修改', void: '作废' }

async function onApprove(row: AccountingApproval): Promise<void> {
  await approveApproval(row.id)
  ElMessage.success('已确认，变更生效并留痕')
  await loadApprovals()
}
async function onReject(row: AccountingApproval): Promise<void> {
  const { value } = await ElMessageBox.prompt('驳回原因（留痕）', `驳回 #${row.id}`, {
    inputValidator: (v: string) => (v && v.trim() ? true : '原因必填')
  })
  await rejectApproval(row.id, value.trim())
  ElMessage.success('已驳回')
  await loadApprovals()
}

// ---------- 数据装配 ----------
async function loadAll(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([
      loadPlans(),
      loadReceipts(),
      loadIssues(),
      loadStockData(),
      loadTakings(),
      loadFund(),
      loadLedger(),
      loadApprovals()
    ])
  } finally {
    loading.value = false
  }
}

async function onMonthChange(): Promise<void> {
  await loadLock()
  await loadAll()
}

// 表格行样式（模板内联箭头函数不支持 TS 注解，抽到 script）
function receiptRowClass({ row }: { row: MaterialReceipt }): string {
  return row.overPlan ? 'over-plan-row' : ''
}
function ledgerRowClass({ row }: { row: LedgerRow }): string {
  return isLedgerOverdue(row.days) ? 'over-plan-row' : ''
}

onMounted(async () => {
  // 首页待办/账目概览跳转（F40）：?tab=approvals 待确认tab；?month=YYYY-MM 当月视图
  if (typeof route.query.tab === 'string') activeTab.value = route.query.tab
  if (typeof route.query.month === 'string' && monthList.value.includes(route.query.month)) {
    month.value = route.query.month
  }
  await loadItems()
  await loadLock()
  await loadAll()
})
</script>

<template>
  <div class="p-3 md:p-6" v-loading="loading">
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-xl font-bold">科室记账</h1>
      <div class="flex items-center gap-3">
        <span>月份</span>
        <el-select v-model="month" style="width: 130px" @change="onMonthChange">
          <el-option v-for="m in monthList" :key="m" :label="m" :value="m" />
        </el-select>
        <el-tag v-if="readOnly" type="warning">只读（{{ canConfirm ? '科长/副科长' : '上级' }}视角）</el-tag>
      </div>
    </div>

    <!-- 权限/锁状态提示 -->
    <el-alert
      v-if="canOperate && monthLocked"
      type="error"
      :closable="false"
      class="mb-4"
      title="{{ month }} 已生成月度报表，当月账目默认只读。如需修改请科长在「月度报表」页解锁（留痕）。"
    />
    <el-alert
      v-if="userStore.permissions?.accounting?.isDelegate"
      type="info"
      :closable="false"
      class="mb-4"
      title="当前为代录授权期间，操作视同记账员留痕。"
    />
    <el-alert
      v-if="lowStockRows.length"
      type="warning"
      :closable="false"
      class="mb-4"
      :title="`库存预警：${lowStockRows.map((r) => r.itemName).join('、')} 结存低于下限（C29）`"
    />
    <el-alert
      v-if="overdueLedger.length"
      type="warning"
      :closable="false"
      class="mb-4"
      :title="`挂账提醒：${overdueLedger.length} 笔挂账超过 ${LEDGER_REMIND_DAYS} 天，请及时销账（C22）`"
    />

    <el-tabs v-model="activeTab">
      <!-- 1 物料计划 -->
      <el-tab-pane label="物料计划" name="plans">
        <div class="mb-3" v-if="canOperate && !monthLocked">
          <el-button type="primary" @click="openPlanDialog('plan')">编制月度计划</el-button>
          <el-button @click="openPlanDialog('append')">追加计划</el-button>
        </div>
        <el-table :data="plans" border size="small">
          <el-table-column prop="itemName" label="物品" min-width="140" />
          <el-table-column prop="plannedQty" label="计划数量" width="100" />
          <el-table-column label="参考单价" width="100">
            <template #default="{ row }: { row: MaterialPlan }">{{ fmtAmount(row.referencePrice) }}</template>
          </el-table-column>
          <el-table-column label="计划金额" width="110">
            <template #default="{ row }: { row: MaterialPlan }">{{ fmtAmount(row.plannedAmount) }}</template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }: { row: MaterialPlan }">
              <el-tag :type="row.isAppend ? 'warning' : 'success'">{{ row.isAppend ? '追加' : '编制' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="appendNote" label="追加说明" min-width="140" />
          <el-table-column label="时间" width="150">
            <template #default="{ row }: { row: MaterialPlan }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 2 领用登记 -->
      <el-tab-pane label="领用登记" name="receipts">
        <div class="mb-3" v-if="canOperate && !monthLocked">
          <el-button type="primary" @click="openReceiptDialog">登记领用</el-button>
        </div>
        <el-table :data="receipts" border size="small" :row-class-name="receiptRowClass">
          <el-table-column prop="receiptNo" label="单号" width="150" />
          <el-table-column label="物品" min-width="120">
            <template #default="{ row }: { row: MaterialReceipt }">{{ row.itemName || itemName(row.itemId) }}</template>
          </el-table-column>
          <el-table-column prop="qty" label="数量" width="80" />
          <el-table-column label="单价" width="90">
            <template #default="{ row }: { row: MaterialReceipt }">{{ fmtAmount(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="100">
            <template #default="{ row }: { row: MaterialReceipt }">{{ fmtAmount(row.amount) }}</template>
          </el-table-column>
          <el-table-column prop="receiptDate" label="日期" width="110" />
          <el-table-column prop="handler" label="经办人" width="90" />
          <el-table-column label="超计划" width="90">
            <template #default="{ row }: { row: MaterialReceipt }">
              <el-tag v-if="row.overPlan" type="danger">超计划·待科长确认</el-tag>
              <span v-else class="text-gray-400">-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }: { row: MaterialReceipt }">
              <el-tag v-if="row.status === 'void'" type="info">已作废</el-tag>
              <span v-else>正常</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" v-if="canOperate && !monthLocked">
            <template #default="{ row }: { row: MaterialReceipt }">
              <el-button v-if="row.status !== 'void'" link type="danger" @click="onVoidReceipt(row)">作废</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 3 发放登记 -->
      <el-tab-pane label="发放登记" name="issues">
        <div class="mb-3" v-if="canOperate && !monthLocked">
          <el-button type="primary" @click="openIssueDialog">登记发放</el-button>
        </div>
        <el-table :data="issues" border size="small">
          <el-table-column prop="issueNo" label="单号" width="150" />
          <el-table-column label="物品" min-width="120">
            <template #default="{ row }: { row: MaterialIssue }">{{ row.itemName || itemName(row.itemId) }}</template>
          </el-table-column>
          <el-table-column prop="userName" label="领用人" width="100" />
          <el-table-column prop="qty" label="数量" width="80" />
          <el-table-column prop="issueDate" label="日期" width="110" />
          <el-table-column prop="handler" label="经办人" width="90" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }: { row: MaterialIssue }">
              <el-tag v-if="row.status === 'void'" type="info">已作废</el-tag>
              <span v-else>正常</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" v-if="canOperate && !monthLocked">
            <template #default="{ row }: { row: MaterialIssue }">
              <el-button v-if="row.status !== 'void'" link type="danger" @click="onVoidIssue(row)">作废</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 4 结存视图 -->
      <el-tab-pane label="结存视图" name="stock">
        <el-table :data="stockRows" border size="small">
          <el-table-column prop="itemName" label="物品" min-width="130" />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column prop="openingQty" label="期初" width="80" />
          <el-table-column prop="receiptQty" label="本期领用" width="90" />
          <el-table-column prop="issueQty" label="本期发放" width="90" />
          <el-table-column prop="closingQty" label="期末结存" width="90" />
          <el-table-column label="结存金额" width="110">
            <template #default="{ row }: { row: StockRow }">{{ fmtAmount(row.closingAmount) }}</template>
          </el-table-column>
          <el-table-column prop="pendingIssueQty" label="待发放" width="80" />
          <el-table-column prop="minStock" label="库存下限" width="90" />
          <el-table-column label="预警" width="100">
            <template #default="{ row }: { row: StockRow }">
              <el-tag v-if="row.lowStock" type="danger">低于下限</el-tag>
              <span v-else class="text-gray-400">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" v-if="canOperate">
            <template #default="{ row }: { row: StockRow }">
              <el-button link @click="onSetMinStock(row)">设下限</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 5 盘点 -->
      <el-tab-pane label="盘点" name="taking">
        <div class="mb-3" v-if="canOperate || canConfirm">
          <el-button v-if="canOperate" type="primary" :disabled="monthLocked" @click="onStartTaking">发起盘点</el-button>
        </div>
        <el-table :data="takings" border size="small">
          <el-table-column prop="id" label="盘点单号" width="100" />
          <el-table-column prop="month" label="月份" width="100" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }: { row: Stocktaking }">
              <el-tag :type="row.status === 'confirmed' ? 'success' : row.status === 'void' ? 'info' : 'warning'">
                {{ row.status === 'open' ? '待确认' : row.status === 'confirmed' ? '已确认' : '已作废' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdByName" label="发起人" width="110" />
          <el-table-column label="发起时间" width="160">
            <template #default="{ row }: { row: Stocktaking }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{ row }: { row: Stocktaking }">
              <el-button link @click="openTaking(row)">明细</el-button>
              <el-button v-if="canConfirm && row.status === 'open'" link type="success" @click="onConfirmTaking(row)">科长确认</el-button>
              <el-button v-if="row.status !== 'void'" link type="danger" @click="onVoidTaking(row)">作废重盘</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 6 资金计划与支出 -->
      <el-tab-pane label="资金计划与支出" name="fund">
        <div class="mb-3 flex gap-4 items-center flex-wrap">
          <span>本月计划额：<b>{{ fmtAmount(fundTotalPlan) }}</b></span>
          <span>实际支出：<b>{{ fmtAmount(fundTotalSpent) }}</b></span>
          <span>余额/超支：
            <b :class="isOverPlan(fundTotalPlan, fundTotalSpent) ? 'text-red-500' : ''">
              {{ fmtAmount(fundBalance) }}
            </b>
          </span>
          <el-button v-if="canOperate && !monthLocked" @click="fundPlanDialogVisible = true">编制/追加资金计划</el-button>
          <el-button v-if="canOperate && !monthLocked" type="primary" @click="openExpenseDialog">登记支出</el-button>
        </div>
        <el-divider content-position="left">资金计划</el-divider>
        <el-table :data="fundPlans" border size="small">
          <el-table-column prop="item" label="事项" min-width="160" />
          <el-table-column label="计划金额" width="120">
            <template #default="{ row }: { row: FundPlan }">{{ fmtAmount(row.plannedAmount) }}</template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }: { row: FundPlan }">
              <el-tag :type="row.isAppend ? 'warning' : 'success'">{{ row.isAppend ? '追加' : '编制' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="appendNote" label="追加说明" min-width="140" />
        </el-table>
        <el-divider content-position="left">支出明细（超计划标红仍可登记，C20）</el-divider>
        <el-table :data="expenses" border size="small">
          <el-table-column prop="expenseNo" label="单号" width="140" />
          <el-table-column prop="item" label="事项" min-width="140" />
          <el-table-column label="金额" width="100">
            <template #default="{ row }: { row: FundExpense }">{{ fmtAmount(row.amount) }}</template>
          </el-table-column>
          <el-table-column prop="payee" label="收款方" width="110" />
          <el-table-column prop="expenseDate" label="日期" width="110" />
          <el-table-column prop="handler" label="经办人" width="90" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }: { row: FundExpense }">
              <el-tag :type="row.settleStatus === '已结清' ? 'success' : row.settleStatus === '挂账' ? 'danger' : row.settleStatus === '部分销账' ? 'warning' : ''">
                {{ row.settleStatus }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" v-if="canOperate && !monthLocked">
            <template #default="{ row }: { row: FundExpense }">
              <el-button v-if="row.settleStatus === '挂账' || row.settleStatus === '部分销账'" link type="primary" @click="openSettleDialog(row)">销账</el-button>
              <el-button v-if="row.status !== 'void'" link type="danger" @click="onVoidExpense(row)">作废</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 7 挂账清单 -->
      <el-tab-pane label="挂账清单" name="ledger">
        <el-table :data="ledger" border size="small" :row-class-name="ledgerRowClass">
          <el-table-column prop="expenseNo" label="单号" width="140" />
          <el-table-column prop="item" label="事项" min-width="160" />
          <el-table-column label="金额" width="100">
            <template #default="{ row }: { row: LedgerRow }">{{ fmtAmount(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="剩余挂账" width="100">
            <template #default="{ row }: { row: LedgerRow }">{{ fmtAmount(row.remainAmount) }}</template>
          </el-table-column>
          <el-table-column prop="expenseDate" label="发生日期" width="110" />
          <el-table-column label="挂账天数" width="100">
            <template #default="{ row }: { row: LedgerRow }">
              <span :class="isLedgerOverdue(row.days) ? 'text-red-500 font-bold' : ''">{{ row.days }}天</span>
            </template>
          </el-table-column>
          <el-table-column label="已补计划" width="100">
            <template #default="{ row }: { row: LedgerRow }">
              <el-tag :type="row.hasPlan ? 'success' : 'info'">{{ row.hasPlan ? '是' : '否' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="settleStatus" label="状态" width="100" />
        </el-table>
      </el-tab-pane>

      <!-- 8 待确认 -->
      <el-tab-pane label="待确认" name="approvals">
        <el-alert v-if="!approvals.length" type="info" :closable="false" title="暂无待确认事项" class="mb-3" />
        <el-table :data="approvals" border size="small">
          <el-table-column prop="id" label="#" width="70" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }: { row: AccountingApproval }">{{ approvalTargetLabel[row.targetType] ?? row.targetType }}</template>
          </el-table-column>
          <el-table-column label="动作" width="80">
            <template #default="{ row }: { row: AccountingApproval }">{{ approvalActionLabel[row.action] ?? row.action }}</template>
          </el-table-column>
          <el-table-column prop="targetId" label="对象单号" width="100" />
          <el-table-column prop="reason" label="发起原因" min-width="180" show-overflow-tooltip />
          <el-table-column label="状态" width="100">
            <template #default="{ row }: { row: AccountingApproval }">
              <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'danger'">
                {{ row.status === 'pending' ? '待确认' : row.status === 'approved' ? '已确认' : '已驳回' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="requestedByName" label="发起人" width="100" />
          <el-table-column label="发起时间" width="160">
            <template #default="{ row }: { row: AccountingApproval }">{{ formatDateTime(row.requestedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" v-if="canConfirm">
            <template #default="{ row }: { row: AccountingApproval }">
              <template v-if="row.status === 'pending'">
                <el-button link type="success" @click="onApprove(row)">确认</el-button>
                <el-button link type="danger" @click="onReject(row)">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 物料计划对话框 -->
    <el-dialog v-model="planDialogVisible" :title="planForm.isAppend ? '追加物料计划' : '编制月度物料计划'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="选择物品" v-if="items.length">
          <el-select v-model="planForm.itemId" placeholder="选择历史物品" clearable style="width: 100%">
            <el-option v-for="i in items" :key="i.id" :label="`${i.name}（${i.unit}）`" :value="i.id" />
          </el-select>
        </el-form-item>
        <template v-if="!planForm.itemId">
          <el-form-item label="新物品名称">
            <el-input v-model="planForm.newName" placeholder="历史物品之外的新物品名称" />
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="planForm.newUnit" placeholder="如：支/件/个" />
          </el-form-item>
        </template>
        <el-form-item label="计划数量">
          <el-input-number v-model="planForm.plannedQty" :min="0" />
        </el-form-item>
        <el-form-item label="参考单价">
          <el-input-number v-model="planForm.referencePrice" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="计划金额">
          <span>{{ fmtAmount(planAmountPreview) }}（=数量×单价）</span>
        </el-form-item>
        <template v-if="planForm.isAppend">
          <el-form-item label="追加说明">
            <el-input v-model="planForm.appendNote" placeholder="追加原因（留痕）" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="planDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPlan">提交</el-button>
      </template>
    </el-dialog>

    <!-- 领用对话框 -->
    <el-dialog v-model="receiptDialogVisible" title="登记领用" width="520px">
      <el-form label-width="100px">
        <el-form-item label="物品">
          <el-select v-model="receiptForm.itemId" placeholder="选择物品" style="width: 100%">
            <el-option v-for="i in items" :key="i.id" :label="`${i.name}（${i.unit}）`" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联计划" v-if="receiptItemPlans.length">
          <el-select v-model="receiptForm.planId" placeholder="可关联本月计划" clearable style="width: 100%">
            <el-option v-for="p in receiptItemPlans" :key="p.id" :label="`${p.plannedQty}（${p.isAppend ? '追加' : '编制'}）`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="receiptForm.qty" :min="0" />
        </el-form-item>
        <el-form-item label="单价">
          <el-input-number v-model="receiptForm.unitPrice" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="金额">
          <span>{{ fmtAmount(receiptAmountPreview) }}</span>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="receiptForm.receiptDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="经办人">
          <el-input v-model="receiptForm.handler" />
        </el-form-item>
        <el-form-item label="凭证">
          <el-input v-model="receiptForm.voucher" placeholder="凭证号/附件（可空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="receiptDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReceipt">提交</el-button>
      </template>
    </el-dialog>

    <!-- 发放对话框 -->
    <el-dialog v-model="issueDialogVisible" title="登记发放" width="520px">
      <el-form label-width="100px">
        <el-form-item label="物品">
          <el-select v-model="issueForm.itemId" placeholder="选择物品" style="width: 100%">
            <el-option v-for="i in items" :key="i.id" :label="`${i.name}（${i.unit}）`" :value="i.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="待发放量">
          <span>{{ pendingForSelected }}（FIFO 按批次扣减）</span>
        </el-form-item>
        <el-form-item label="领用人">
          <el-select v-model="issueForm.userId" placeholder="选择科员" style="width: 100%">
            <el-option v-for="u in assignableUsers" :key="u.id" :label="`${u.name}（${u.userNo}）`" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="issueForm.qty" :min="0" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="issueForm.issueDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="经办人">
          <el-input v-model="issueForm.handler" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="issueDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitIssue">提交</el-button>
      </template>
    </el-dialog>

    <!-- 盘点明细对话框 -->
    <el-dialog v-model="takingDialogVisible" title="盘点明细（盘盈盘亏原因必填）" width="640px">
      <el-table :data="activeTaking?.items ?? []" border size="small">
        <el-table-column label="物品" min-width="120">
          <template #default="{ row }: { row: { itemId: number; itemName?: string } }">{{ row.itemName || itemName(row.itemId) }}</template>
        </el-table-column>
        <el-table-column prop="bookQty" label="账面数" width="90" />
        <el-table-column label="实盘数" width="130">
          <template #default="{ row }: { row: { itemId: number } }">
            <el-input-number v-model="takingForm[row.itemId].actualQty" :min="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="差额" width="80">
          <template #default="{ row }: { row: { itemId: number; bookQty: number } }">
            {{ (takingForm[row.itemId]?.actualQty ?? row.bookQty) - row.bookQty }}
          </template>
        </el-table-column>
        <el-table-column label="原因（必填）" min-width="160">
          <template #default="{ row }: { row: { itemId: number } }">
            <el-input v-model="takingForm[row.itemId].reason" size="small" placeholder="盘盈/盘亏原因" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="takingDialogVisible = false">关闭</el-button>
        <el-button v-if="canOperate" type="primary" @click="onSubmitTakingItems">提交实盘</el-button>
      </template>
    </el-dialog>

    <!-- 资金计划对话框 -->
    <el-dialog v-model="fundPlanDialogVisible" title="编制/追加资金计划" width="480px">
      <el-form label-width="100px">
        <el-form-item label="计划事项">
          <el-input v-model="fundPlanForm.item" placeholder="如：维修费/服务费/差旅费" />
        </el-form-item>
        <el-form-item label="计划金额">
          <el-input-number v-model="fundPlanForm.plannedAmount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="是否追加">
          <el-switch v-model="fundPlanForm.isAppend" />
        </el-form-item>
        <el-form-item label="追加说明" v-if="fundPlanForm.isAppend">
          <el-input v-model="fundPlanForm.appendNote" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fundPlanDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitFundPlan">提交</el-button>
      </template>
    </el-dialog>

    <!-- 支出对话框 -->
    <el-dialog v-model="expenseDialogVisible" title="登记资金支出（无计划先支出→挂账）" width="520px">
      <el-form label-width="100px">
        <el-form-item label="支出事项">
          <el-input v-model="expenseForm.item" />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="expenseForm.amount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="收款方">
          <el-input v-model="expenseForm.payee" />
        </el-form-item>
        <el-form-item label="支出日期">
          <el-date-picker v-model="expenseForm.expenseDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="经办人">
          <el-input v-model="expenseForm.handler" />
        </el-form-item>
        <el-form-item label="关联计划">
          <el-select v-model="expenseForm.planId" placeholder="不选=计划外挂账" clearable style="width: 100%">
            <el-option v-for="p in fundPlans" :key="p.id" :label="p.item" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="凭证">
          <el-input v-model="expenseForm.voucher" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="expenseDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitExpense">提交</el-button>
      </template>
    </el-dialog>

    <!-- 销账对话框 -->
    <el-dialog v-model="settleDialogVisible" title="销账（部分销账剩余继续挂账）" width="480px">
      <el-form label-width="100px">
        <el-form-item label="选择计划">
          <el-select v-model="settleForm.planId" placeholder="补录的资金计划" style="width: 100%">
            <el-option v-for="p in fundPlans" :key="p.id" :label="p.item" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="销账金额">
          <el-input-number v-model="settleForm.settleAmount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="差额说明">
          <el-input v-model="settleForm.diffReason" placeholder="销账金额≠挂账剩余时必填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitSettle">确认销账</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.over-plan-row) td {
  background-color: #fef0f0 !important;
}
</style>
