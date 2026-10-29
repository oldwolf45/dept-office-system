import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: '/api',
  timeout: 10000
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** 维护锁（5030）统一提示（S12 契约 §2.2：恢复期间写请求被维护锁拒绝） */
export const MAINTENANCE_CODE = 5030
export const MAINTENANCE_MESSAGE = '系统维护中，请稍后'

function isMaintenance(payload: unknown): boolean {
  return !!payload && (payload as { code?: number }).code === MAINTENANCE_CODE
}

request.interceptors.response.use(
  (response) => {
    const res = response.data
    if (res.code === 0) {
      return res.data
    }
    if (res.code === MAINTENANCE_CODE) {
      ElMessage.warning(MAINTENANCE_MESSAGE)
      return Promise.reject(new Error(MAINTENANCE_MESSAGE))
    }
    ElMessage.error(res.message || '请求失败')
    return Promise.reject(new Error(res.message || '请求失败'))
  },
  (error) => {
    if (isMaintenance(error?.response?.data)) {
      ElMessage.warning(MAINTENANCE_MESSAGE)
      return Promise.reject(new Error(MAINTENANCE_MESSAGE))
    }
    const message: string =
      error?.response?.data?.message || error?.message || '网络异常，请稍后重试'
    ElMessage.error(message)
    return Promise.reject(new Error(message))
  }
)

export default request
