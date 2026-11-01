import request from './request'
import type {
  MaterialsMeResult,
  MaterialCategory,
  FinanceCategory,
  CreateMaterialCategoryParams,
  UpdateMaterialCategoryParams,
  CreateFinanceCategoryParams,
  UpdateFinanceCategoryParams
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
