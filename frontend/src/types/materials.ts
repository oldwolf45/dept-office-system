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
