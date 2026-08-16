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
  },
  // S18-T01 事件埋点分析（基于 tracking_events）
  eventFunnel(steps = [], days = 30) {
    return request.get('/admin/analytics/event-funnel', {
      params: { days, steps: steps.map((s) => (typeof s === 'string' ? s : s.event)).join(',') }
    })
  },
  eventOverview(steps = [], days = 30) {
    return request.get('/admin/analytics/event-overview', {
      params: { days, steps: steps.map((s) => (typeof s === 'string' ? s : s.event)).join(',') }
    })
  },
  trackingEvents(params = {}) {
    return request.get('/admin/tracking/events', { params })
  },
  trackingStats(days = 30, event = '') {
    return request.get('/admin/tracking/stats', { params: { days, event: event || undefined } })
  }
}

export default analyticsAPI
