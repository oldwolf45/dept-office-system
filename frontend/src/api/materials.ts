import request from './request'
import type { MaterialsMeResult } from '@/types/materials'

// 材料模块接口统一走本文件（开发计划 §2.3-3：组件只调 api 函数，不直接写 axios）

/** GET /api/materials/me —— 当前用户材料模块访问态与角色 */
export function getMaterialsMe(): Promise<MaterialsMeResult> {
  return request.get<unknown, MaterialsMeResult>('/materials/me')
}
