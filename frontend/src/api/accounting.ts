import request from './request'
import type {
  AccountingApproval,
  Bookkeeper,
  CreateExpenseParams,
  CreateFundPlanParams,
  CreateMaterialItemParams,
  CreateMaterialPlanParams,
  CreateModifyRequestParams,
  CreateReceiptParams,
  CreateDelegationParams,
  CreateIssueParams,
  Delegation,
  FundExpense,
  FundPlan,
  LedgerRow,
  MaterialItem,
  MaterialPlan,
  MaterialReceipt,
  MaterialIssue,
  MyItem,
  SettleExpenseParams,
  StockRow,
  Stocktaking
} from '@/types'

// ---------- S2 已有：记账员与代录 ----------

export function getBookkeeper(): Promise<Bookkeeper | null> {
  return request.get<unknown, Bookkeeper | null>('/accounting/bookkeeper')
}

export function assignBookkeeper(userId: number): Promise<null> {
  return request.post<unknown, null>('/accounting/bookkeeper', { userId })
}

export function getDelegations(): Promise<Delegation[]> {
  return request.get<unknown, Delegation[]>('/accounting/delegations')
}

export function createDelegation(data: CreateDelegationParams): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>('/accounting/delegation', data)
}

export function revokeDelegation(id: number): Promise<null> {
  return request.post<unknown, null>(`/accounting/delegation/${id}/revoke`)
}

// ---------- S8：物料账 ----------

/** 物品列表（可从历史选择或新增） */
export function getItems(): Promise<MaterialItem[]> {
  return request.get<unknown, MaterialItem[]>('/accounting/items')
}

export function createItem(data: CreateMaterialItemParams): Promise<MaterialItem> {
  return request.post<unknown, MaterialItem>('/accounting/items', data)
}

export function updateItemMinStock(id: number, minStock: number): Promise<MaterialItem> {
  return request.put<unknown, MaterialItem>(`/accounting/items/${id}/min-stock`, { minStock })
}

/** 物料月度计划（编制/追加） */
export function getPlans(month: string): Promise<MaterialPlan[]> {
  return request.get<unknown, MaterialPlan[]>('/accounting/plans', { params: { month } })
}

export function createPlan(data: CreateMaterialPlanParams): Promise<MaterialPlan> {
  return request.post<unknown, MaterialPlan>('/accounting/plans', data)
}

/** 领用登记 */
export function getReceipts(month: string): Promise<MaterialReceipt[]> {
  return request.get<unknown, MaterialReceipt[]>('/accounting/receipts', { params: { month } })
}

export function createReceipt(data: CreateReceiptParams): Promise<MaterialReceipt> {
  return request.post<unknown, MaterialReceipt>('/accounting/receipts', data)
}

/** 作废领用（跨天由后端按规则转待确认，C23） */
export function voidReceipt(id: number, voidReason: string): Promise<null> {
  return request.post<unknown, null>(`/accounting/receipts/${id}/void`, { voidReason })
}

/** 发放登记（超待发放后端拒绝 4000，C25） */
export function getIssues(month: string): Promise<MaterialIssue[]> {
  return request.get<unknown, MaterialIssue[]>('/accounting/issues', { params: { month } })
}

export function createIssue(data: CreateIssueParams): Promise<MaterialIssue> {
  return request.post<unknown, MaterialIssue>('/accounting/issues', data)
}

export function voidIssue(id: number, voidReason: string): Promise<null> {
  return request.post<unknown, null>(`/accounting/issues/${id}/void`, { voidReason })
}

/** 结存视图（含库存预警，C29） */
export function getStock(month: string): Promise<StockRow[]> {
  return request.get<unknown, StockRow[]>('/accounting/stock', { params: { month } })
}

/** 我的物品（C26：仅本人视角，科员可访问） */
export function getMyItems(): Promise<MyItem[]> {
  return request.get<unknown, MyItem[]>('/accounting/my-items')
}

// ---------- 盘点（C30） ----------

/** 盘点单列表（按月份；契约 §7 未列 GET，按后端惯例扩展，失败兜底为空） */
export function getStocktakingList(month: string): Promise<Stocktaking[]> {
  return request.get<unknown, Stocktaking[]>('/accounting/stocktaking', { params: { month } })
}

export function createStocktaking(month: string): Promise<Stocktaking> {
  return request.post<unknown, Stocktaking>('/accounting/stocktaking', { month })
}

export function submitStocktakingItems(
  id: number,
  items: Array<{ itemId: number; actualQty: number; reason: string }>
): Promise<Stocktaking> {
  return request.post<unknown, Stocktaking>(`/accounting/stocktaking/${id}/items`, { items })
}

export function confirmStocktaking(id: number): Promise<Stocktaking> {
  return request.post<unknown, Stocktaking>(`/accounting/stocktaking/${id}/confirm`)
}

export function voidStocktaking(id: number, voidReason: string): Promise<Stocktaking> {
  return request.post<unknown, Stocktaking>(`/accounting/stocktaking/${id}/void`, { voidReason })
}

// ---------- 跨天修改/作废确认（C23） ----------

/** 记账员发起跨天修改/作废（确认前不生效） */
export function createModifyRequest(data: CreateModifyRequestParams): Promise<AccountingApproval> {
  return request.post<unknown, AccountingApproval>('/accounting/modify-request', data)
}

/** 待确认列表（记账员看发起记录；科长/副科长可见待办） */
export function getApprovals(): Promise<AccountingApproval[]> {
  return request.get<unknown, AccountingApproval[]>('/accounting/approvals')
}

export function approveApproval(id: number, confirmNote?: string): Promise<AccountingApproval> {
  return request.post<unknown, AccountingApproval>(`/accounting/approvals/${id}/approve`, {
    confirmNote
  })
}

export function rejectApproval(id: number, confirmNote?: string): Promise<AccountingApproval> {
  return request.post<unknown, AccountingApproval>(`/accounting/approvals/${id}/reject`, {
    confirmNote
  })
}

// ---------- S9：资金账与挂账 ----------

export function getFundPlans(month: string): Promise<FundPlan[]> {
  return request.get<unknown, FundPlan[]>('/accounting/fund-plans', { params: { month } })
}

export function createFundPlan(data: CreateFundPlanParams): Promise<FundPlan> {
  return request.post<unknown, FundPlan>('/accounting/fund-plans', data)
}

export function getExpenses(month: string): Promise<FundExpense[]> {
  return request.get<unknown, FundExpense[]>('/accounting/expenses', { params: { month } })
}

export function createExpense(data: CreateExpenseParams): Promise<FundExpense> {
  return request.post<unknown, FundExpense>('/accounting/expenses', data)
}

/** 销账（部分销账+差额说明必填，C21） */
export function settleExpense(id: number, data: SettleExpenseParams): Promise<FundExpense> {
  return request.post<unknown, FundExpense>(`/accounting/expenses/${id}/settle`, data)
}

export function voidExpense(id: number, voidReason: string): Promise<null> {
  return request.post<unknown, null>(`/accounting/expenses/${id}/void`, { voidReason })
}

/** 挂账清单（含挂账天数与超30天标记，C22） */
export function getLedger(): Promise<LedgerRow[]> {
  return request.get<unknown, LedgerRow[]>('/accounting/ledger')
}
