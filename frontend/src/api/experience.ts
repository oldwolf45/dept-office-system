import request from './request'
import type { ExperienceSample, SummaryContentType } from '@/types'

/** GET /api/experience/samples：本科室样例列表（level≥2 或记账员，科员 4030） */
export interface ExperienceSampleQuery {
  type?: SummaryContentType | string
  periodStart?: string
  periodEnd?: string
}

export async function getExperienceSamples(
  params: ExperienceSampleQuery = {}
): Promise<ExperienceSample[]> {
  const res = await request.get<unknown, ExperienceSample[] | { list: ExperienceSample[] }>(
    '/experience/samples',
    { params }
  )
  return Array.isArray(res) ? res : res.list
}
