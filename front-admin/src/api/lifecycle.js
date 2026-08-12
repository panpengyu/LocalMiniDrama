import request from '@/utils/request'

/**
 * Sprint 12 - S12-T04 用户生命周期管理 API
 * 接口走 /api/v1/admin/lifecycle/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const lifecycleAPI = {
  overview() {
    return request.get('/admin/lifecycle/overview')
  },
  profiles(params = {}) {
    return request.get('/admin/lifecycle/profiles', { params })
  },
  churnWarnings(limit = 50) {
    return request.get('/admin/lifecycle/churn-warnings', { params: { limit } })
  },
  recompute() {
    return request.post('/admin/lifecycle/recompute')
  }
}

export default lifecycleAPI
