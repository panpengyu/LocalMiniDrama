import request from '@/utils/request'

/**
 * Sprint 12 - S12-T08 数据分析平台 API
 * 接口走 /api/v1/admin/analytics/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const analyticsAPI = {
  overview(days = 30) {
    return request.get('/admin/analytics/overview', { params: { days } })
  },
  behavior(days = 30) {
    return request.get('/admin/analytics/behavior', { params: { days } })
  },
  funnel() {
    return request.get('/admin/analytics/funnel')
  },
  modelEffect(days = 30) {
    return request.get('/admin/analytics/model-effect', { params: { days } })
  },
  retention(days = 14) {
    return request.get('/admin/analytics/retention', { params: { days } })
  }
}

export default analyticsAPI
