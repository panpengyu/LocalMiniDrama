import request from '@/utils/request'

/**
 * Sprint 12 - S12-T05 财务与计费增强 API
 * 接口走 /api/v1/admin/finance/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const financeAPI = {
  overview(days = 30) {
    return request.get('/admin/finance/overview', { params: { days } })
  },
  costBreakdown() {
    return request.get('/admin/finance/cost-breakdown')
  },
  dailyTrend(days = 14) {
    return request.get('/admin/finance/daily-trend', { params: { days } })
  },
  arrears(params = {}) {
    return request.get('/admin/finance/arrears', { params })
  },
  // 计费规则
  listBillingRules() {
    return request.get('/admin/finance/billing-rules')
  },
  createBillingRule(data) {
    return request.post('/admin/finance/billing-rules', data)
  },
  updateBillingRule(id, data) {
    return request.put(`/admin/finance/billing-rules/${id}`, data)
  },
  deleteBillingRule(id) {
    return request.delete(`/admin/finance/billing-rules/${id}`)
  },
  computeCharge(data) {
    return request.post('/admin/finance/compute-charge', data)
  },
  // 财务日报
  generateDailyReport(date) {
    return request.post('/admin/finance/daily-report', { date })
  },
  dailyReports(days = 30) {
    return request.get('/admin/finance/daily-reports', { params: { days } })
  }
}

export default financeAPI
