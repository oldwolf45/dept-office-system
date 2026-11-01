// 材料模块类型定义（v1.1 / T0 骨架；后续任务逐步补全）
// 全部响应数据有类型，组件/store 禁 any（开发计划 §2.3-11）

/** 材料模块角色：工段长 / 车间主任 / 供应科 / 科室经办 */
export type MaterialModuleRole = 'workshop_director' | 'workshop_manager' | 'supply' | 'section_agent'

export const MATERIAL_ROLE_LABELS: Record<MaterialModuleRole, string> = {
  workshop_director: '工段长',
  workshop_manager: '车间主任',
  supply: '供应科',
  section_agent: '科室经办'
}

/** 单位类型：车间 / 科室 */
export type MaterialUnitType = 'workshop' | 'section'

/** 用户在材料模块内的角色映射行（module_role_map） */
export interface MaterialModuleRoleMap {
  role: MaterialModuleRole
  roleLabel: string
  unitType: MaterialUnitType
  unitCode: string
  unitName: string
}

/** GET /api/materials/me 返回 */
export interface MaterialsMeResult {
  hasAccess: boolean
  roles: MaterialModuleRoleMap[]
  /** 平台层级（1-5） */
  level?: number
  /** 是否为角色配置可管理身份（平台层级 >= 3） */
  canManageRoles?: boolean
}

// ---------- 占位类型（T1 起陆续完善）----------
export interface MaterialCategory {
  id: number
  code: string | null
  name: string
  status: 'active' | 'disabled'
  sortOrder: number
}

export interface FinanceCategory {
  id: number
  name: string
  type: 'income' | 'expense'
  status: 'active' | 'disabled'
  sortOrder: number
}

/** 材料状态机（开发计划 §2.3 / T5） */
export type MaterialStatus = 'in_stock' | 'issued' | 'recycled' | 'disposed'

// ---------- 基础数据（T1）----------
export interface CreateMaterialCategoryParams {
  code?: string | null
  name: string
  sortOrder?: number
}

export interface UpdateMaterialCategoryParams {
  name?: string
  sortOrder?: number
}

export interface CreateFinanceCategoryParams {
  name: string
  type: 'income' | 'expense'
  sortOrder?: number
}

export interface UpdateFinanceCategoryParams {
  name?: string
  type?: 'income' | 'expense'
  sortOrder?: number
}

// ---------- 计划管理（T2）----------
export type PlanType = 'workshop' | 'section'
export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface PlanItem {
  id: number
  planId: number
  categoryId: number | null
  materialName: string
  plannedQty: number
  referencePrice: number
  plannedAmount: number
}

export interface Plan {
  id: number
  planNo: string
  month: string
  planType: PlanType
  unitCode: string
  unitName: string
  status: PlanStatus
  rejectReason: string | null
  createdBy: number | null
  createdAt: string
  updatedAt: string
  items?: PlanItem[]
}

export interface CreatePlanItemParams {
  materialName: string
  plannedQty: number
  referencePrice: number
  categoryId?: number | null
}

export interface CreatePlanParams {
  month: string
  planType: PlanType
  unitCode: string
  unitName: string
  items: CreatePlanItemParams[]
}

export interface PlanUnitSummary {
  unitName: string
  planType: PlanType
  count: number
  approved: number
  rejected: number
}

export interface PlanSummaryResult {
  month: string
  total: number
  plans: Plan[]
  byUnit: PlanUnitSummary[]
}

// ---------- 采购管理（T3）----------
export type PurchaseStatus = 'normal' | 'void'

export interface Purchase {
  id: number
  purchaseNo: string
  planId: number | null
  categoryId: number | null
  supplier: string | null
  itemDesc: string
  amount: number
  fundCategoryId: number | null
  purchaseDate: string
  handler: string | null
  status: PurchaseStatus
  voidReason: string | null
  createdBy: number | null
  createdAt: string
  updatedAt: string
}

export interface CreatePurchaseParams {
  planId?: number | null
  categoryId?: number | null
  supplier?: string
  itemDesc: string
  amount: number
  fundCategoryId?: number | null
  purchaseDate: string
  handler?: string
}

// ---------- 到货与材料（T4/T6）----------
export interface Material {
  id: number
  materialCode: string
  purchaseId: number | null
  categoryId: number | null
  name: string
  spec: string | null
  unit: string | null
  status: MaterialStatus
  arrivedAt: string
  createdBy?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface MaterialEvent {
  id: number
  refType: string | null
  refId: number | null
  action: string
  operatorId: number | null
  operatorName: string | null
  qty: number | null
  amount: number | null
  occurAt: string | null
  createdAt: string
}

export interface MaterialDetail extends Material {
  events: MaterialEvent[]
}

export interface CreateArrivalItemParams {
  categoryId?: number | null
  name: string
  spec?: string
  unit?: string
  qty: number
}

export interface CreateArrivalParams {
  purchaseId?: number | null
  arrivedAt: string
  items: CreateArrivalItemParams[]
}

// ---------- 领用/回收/处置（T5）----------
export interface IssueRecord {
  id: number
  issueNo: string
  receiveUnitType: 'workshop' | 'section'
  receiveUnitName: string
  qty: number
  handler: string | null
  issueDate: string
  status: 'normal' | 'void'
}

export interface CreateIssueParams {
  purchaseId?: number | null
  materialIds: number[]
  receiveUnitType: 'workshop' | 'section'
  receiveUnitCode: string
  receiveUnitName: string
  handler?: string
  issueDate: string
}

export interface RecycleRecord {
  id: number
  issueRecordId: number | null
  materialId: number
  qty: number
  handler: string | null
  recycleDate: string
  status: 'normal' | 'void'
}

export interface CreateRecycleParams {
  issueRecordId?: number | null
  materialId: number
  qty?: number
  handler?: string
  recycleDate: string
}

export interface DisposalItem {
  id: number
  disposalBatchId: number
  materialId: number
  name: string
  qty: number
  income: number
}

export interface DisposalBatch {
  id: number
  disposalNo: string
  categoryId: number | null
  disposeType: string | null
  totalQty: number
  totalIncome: number
  handler: string | null
  disposeDate: string
  status: 'normal' | 'void'
  items?: DisposalItem[]
}

export interface CreateDisposalItemParams {
  materialId: number
  name?: string
  qty: number
  income: number
}

export interface CreateDisposalParams {
  categoryId?: number | null
  disposeType?: string | null
  items: CreateDisposalItemParams[]
  handler?: string
  disposeDate: string
}

// ---------- 汇总/概览（T7/T9）----------
export interface MonthlyAmountRow {
  month: string
  amt: number
}
export interface MonthlyFlowRow {
  month: string
  action: string
  n: number
}
export interface MonthlySummary {
  purchase: MonthlyAmountRow[]
  dispose: MonthlyAmountRow[]
  flow: MonthlyFlowRow[]
}
export interface DashboardOverview {
  planStatus: Record<string, number>
  purchaseAmount: number
  disposeIncome: number
  materialByStatus: Record<string, number>
  pendingApproval: number
}

// ---------- 角色配置（T10 补口）----------
export interface ModuleRoleMapRow {
  id: number
  userId: number
  userNo: string
  userName: string
  level: number
  deptName: string
  role: MaterialModuleRole
  roleLabel: string
  unitType: 'workshop' | 'section'
  unitCode: string
  unitName: string
  createdAt: string
}

export interface RoleCandidate {
  id: number
  userNo: string
  name: string
  level: number
  deptCode: string
  deptName: string
  status: string
}

export interface CodeLabel {
  code: string
  label: string
}

export interface ModuleUnitOption {
  code: string
  name: string
}

export interface ModuleRoleMapResult {
  list: ModuleRoleMapRow[]
  candidates: RoleCandidate[]
  units: ModuleUnitOption[]
  roles: CodeLabel[]
  unitTypes: CodeLabel[]
}

export interface GrantRoleParams {
  userId: number
  role: MaterialModuleRole
  unitType: 'workshop' | 'section'
  unitCode?: string
  unitName: string
}
