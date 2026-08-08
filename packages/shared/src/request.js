import axios from 'axios'
import { ElMessage } from 'element-plus'

/**
 * 创建 axios 实例（按端隔离 token）
 * @param {object} options
 * @param {string} options.baseURL       - API 基础路径，如 '/api/v1'
 * @param {string} options.tokenKey      - localStorage 中存储 token 的 key
 * @param {string} options.userKey       - localStorage 中存储用户信息的 key
 * @param {string} options.loginPath     - 401 跳转的登录页路径
 * @param {number} options.timeout      - 超时时间（ms）
 * @returns {import('axios').AxiosInstance}
 */
export function createRequest(options = {}) {
  const {
    baseURL = '/api/v1',
    tokenKey = 'token',
    userKey = 'user',
    loginPath = '/login',
    timeout = 600000
  } = options

  const instance = axios.create({
    baseURL,
    timeout,
    headers: { 'Content-Type': 'application/json' }
  })

  instance.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem(tokenKey)
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => Promise.reject(error)
  )

  instance.interceptors.response.use(
    (response) => {
      if (response.config?.responseType === 'blob') {
        return response.data
      }
      const res = response.data
      if (res.success !== false) {
        return res.data !== undefined ? res.data : res
      }
      return Promise.reject(new Error(res.error?.message || '请求失败'))
    },
    (error) => {
      const backendMsg = error.response?.data?.error?.message
      const status = error.response?.status

      if (status === 401) {
        localStorage.removeItem(tokenKey)
        localStorage.removeItem(userKey)
        ElMessage.error('登录已过期，请重新登录')
        setTimeout(() => {
          window.location.href = loginPath
        }, 1500)
        return Promise.reject(new Error('登录已过期'))
      }

      const msg = backendMsg || error.message || '网络错误'
      ElMessage.error(msg)
      if (backendMsg) error.message = backendMsg
      return Promise.reject(error)
    }
  )

  return instance
}
