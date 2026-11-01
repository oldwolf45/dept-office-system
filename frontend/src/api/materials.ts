import request from './request'
import type {
  MaterialsMeResult,
  MaterialCategory,
  FinanceCategory,
  CreateMaterialCategoryParams,
  UpdateMaterialCategoryParams,
  CreateFinanceCategoryParams,
  UpdateFinanceCategoryParams,
  Plan,
  CreatePlanParams,
  PlanSummaryResult,
  Purchase,
  CreatePurchaseParams,
  Material,
  MaterialDetail,
  CreateArrivalParams,
  IssueRecord,
  CreateIssueParams,
  RecycleRecord,
  CreateRecycleParams,
  DisposalBatch,
  CreateDisposalParams,
  MonthlySummary,
  DashboardOverview,
  ModuleRoleMapResult,
  GrantRoleParams
} from '@/types/materials'

// 材料模块接口统一走本文件（开发计划 §2.3-3：组件只调 api 函数，不直接写 axios）

/** GET /api/materials/me —— 当前用户材料模块访问态与角色 */
export function getMaterialsMe(): Promise<MaterialsMeResult> {
  return request.get<unknown, MaterialsMeResult>('/materials/me')
}

// ---------- 材料类别（T1）----------
export function getMaterialCategories(): Promise<MaterialCategory[]> {
  return request.get<unknown, MaterialCategory[]>('/materials/categories')
}
export function getMaterialCategoriesManage(): Promise<MaterialCategory[]> {
  return request.get<unknown, MaterialCategory[]>('/materials/categories/manage')
}
export function createMaterialCategory(data: CreateMaterialCategoryParams): Promise<MaterialCategory> {
  return request.post<unknown, MaterialCategory>('/materials/categories', data)
}
export function updateMaterialCategory(id: number, data: UpdateMaterialCategoryParams): Promise<MaterialCategory> {
  return request.put<unknown, MaterialCategory>(`/materials/categories/${id}`, data)
}
export function disableMaterialCategory(id: number): Promise<MaterialCategory> {
  return request.post<unknown, MaterialCategory>(`/materials/categories/${id}/disable`)
}
export function enableMaterialCategory(id: number): Promise<MaterialCategory> {
  return request.post<unknown, MaterialCategory>(`/materials/categories/${id}/enable`)
}

// ---------- 收支分类（T1）----------
export function getFinanceCategories(): Promise<FinanceCategory[]> {
  return request.get<unknown, FinanceCategory[]>('/materials/finance-categories')
}
export function getFinanceCategoriesManage(): Promise<FinanceCategory[]> {
  return request.get<unknown, FinanceCategory[]>('/materials/finance-categories/manage')
}
export function createFinanceCategory(data: CreateFinanceCategoryParams): Promise<FinanceCategory> {
  return request.post<unknown, FinanceCategory>('/materials/finance-categories', data)
}
export function updateFinanceCategory(id: number, data: UpdateFinanceCategoryParams): Promise<FinanceCategory> {
  return request.put<unknown, FinanceCategory>(`/materials/finance-categories/${id}`, data)
}
export function disableFinanceCategory(id: number): Promise<FinanceCategory> {
  return request.post<unknown, FinanceCategory>(`/materials/finance-categories/${id}/disable`)
}
export function enableFinanceCategory(id: number): Promise<FinanceCategory> {
  return request.post<unknown, FinanceCategory>(`/materials/finance-categories/${id}/enable`)
}

// ---------- 计划管理（T2）----------
export function listPlans(params: { month?: string; planType?: string; status?: string } = {}): Promise<Plan[]> {
  return request.get<unknown, Plan[]>('/materials/plans', { params })
}
export function getPlan(id: number): Promise<Plan> {
  return request.get<unknown, Plan>(`/materials/plans/${id}`)
}
export function createPlan(data: CreatePlanParams): Promise<Plan> {
  return request.post<unknown, Plan>('/materials/plans', data)
}
export function submitPlan(id: number): Promise<Plan> {
  return request.post<unknown, Plan>(`/materials/plans/${id}/submit`)
}
export function approvePlan(id: number): Promise<Plan> {
  return request.post<unknown, Plan>(`/materials/plans/${id}/approve`)
}
export function rejectPlan(id: number, reason: string): Promise<Plan> {
  return request.post<unknown, Plan>(`/materials/plans/${id}/reject`, { reason })
}
export function summaryPlans(month: string): Promise<PlanSummaryResult> {
  return request.get<unknown, PlanSummaryResult>('/materials/plans/summary', { params: { month } })
}

// ---------- 采购管理（T3）----------
export function listPurchases(params: { month?: string; categoryId?: number; fundCategoryId?: number; status?: string } = {}): Promise<Purchase[]> {
  return request.get<unknown, Purchase[]>('/materials/purchases', { params })
}
export function getPurchase(id: number): Promise<Purchase> {
  return request.get<unknown, Purchase>(`/materials/purchases/${id}`)
}
export function createPurchase(data: CreatePurchaseParams): Promise<Purchase> {
  return request.post<unknown, Purchase>('/materials/purchases', data)
}
export function voidPurchase(id: number, reason: string): Promise<Purchase> {
  return request.post<unknown, Purchase>(`/materials/purchases/${id}/void`, { reason })
}

// ---------- 到货与材料（T4/T6）----------
export function createArrival(data: CreateArrivalParams): Promise<{ count: number; list: Material[] }> {
  return request.post<unknown, { count: number; list: Material[] }>('/materials/arrivals', data)
}
export function listMaterials(params: { code?: string; name?: string; categoryId?: number; status?: string } = {}): Promise<Material[]> {
  return request.get<unknown, Material[]>('/materials/materials', { params })
}
export function getMaterial(id: number): Promise<MaterialDetail> {
  return request.get<unknown, MaterialDetail>(`/materials/materials/${id}`)
}

// ---------- 领用/回收/处置（T5）----------
export function listIssues(params: { receiveUnitType?: string; status?: string } = {}): Promise<IssueRecord[]> {
  return request.get<unknown, IssueRecord[]>('/materials/issues', { params })
}
export function createIssue(data: CreateIssueParams): Promise<IssueRecord> {
  return request.post<unknown, IssueRecord>('/materials/issues', data)
}
export function createRecycle(data: CreateRecycleParams): Promise<RecycleRecord> {
  return request.post<unknown, RecycleRecord>('/materials/recycles', data)
}
export function listDisposals(params: { status?: string } = {}): Promise<DisposalBatch[]> {
  return request.get<unknown, DisposalBatch[]>('/materials/disposals', { params })
}
export function getDisposalBatch(id: number): Promise<DisposalBatch> {
  return request.get<unknown, DisposalBatch>(`/materials/disposals/${id}`)
}
export function createDisposal(data: CreateDisposalParams): Promise<DisposalBatch> {
  return request.post<unknown, DisposalBatch>('/materials/disposals', data)
}

// ---------- 汇总/概览（T7/T9）----------
export function getMonthlySummary(): Promise<MonthlySummary> {
  return request.get<unknown, MonthlySummary>('/materials/stats/monthly')
}
export function getDashboardOverview(): Promise<DashboardOverview> {
  return request.get<unknown, DashboardOverview>('/materials/dashboard/overview')
}

// ---------- 角色配置（T10 补口）----------
export function getMaterialsRoleMap(): Promise<ModuleRoleMapResult> {
  return request.get<unknown, ModuleRoleMapResult>('/materials/roles')
}
export function grantMaterialsRole(data: GrantRoleParams): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>('/materials/roles', data)
}
export function revokeMaterialsRole(id: number): Promise<{ id: number }> {
  return request.post<unknown, { id: number }>(`/materials/roles/${id}/revoke`)
}
