import request from '@/utils/request'

/**
 * Sprint 12 - S12-T06 系统监控大屏 API
 * 接口走 /api/v1/admin/monitor/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const monitorAPI = {
  snapshot() {
    return request.get('/admin/monitor/snapshot')
  },
  history(limit = 60) {
    return request.get('/admin/monitor/history', { params: { limit } })
  },
  sample() {
    return request.post('/admin/monitor/sample')
  }
}

export default monitorAPI
