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
  },
  // ============ Sprint 17 - T17-01 充值套餐（会员套餐）管理 ============
  listRechargePlans() {
    return request.get('/admin/membership/plans')
  },
  createRechargePlan(data) {
    return request.post('/admin/membership/plans', data)
  },
  updateRechargePlan(id, data) {
    return request.put(`/admin/membership/plans/${id}`, data)
  },
  deleteRechargePlan(id) {
    return request.delete(`/admin/membership/plans/${id}`)
  },
  // ============ Sprint 17 - T17-02 优惠券管理 ============
  listCoupons(params) {
    return request.get('/admin/membership/coupons', { params })
  },
  createCoupon(data) {
    return request.post('/admin/membership/coupons', data)
  },
  updateCoupon(id, data) {
    return request.put(`/admin/membership/coupons/${id}`, data)
  },
  disableCoupon(id) {
    return request.delete(`/admin/membership/coupons/${id}`)
  },
  couponRedemptions(id, params) {
    return request.get(`/admin/membership/coupons/${id}/redemptions`, { params })
  },
  // ============ Sprint 17 - T17-03 支付配置 ============
  getPaymentSettings() {
    return request.get('/settings/payment')
  },
  updatePaymentSettings(data) {
    return request.put('/settings/payment', data)
  },
  testPayment(channel = 'all') {
    return request.post('/admin/finance/payment/test', null, { params: { channel } })
  },
  // ============ Sprint 17 - T17-04 支付订单管理 ============
  listOrders(params = {}) {
    return request.get('/admin/membership/orders', { params })
  },
  orderStats(params = {}) {
    return request.get('/admin/membership/orders/stats', { params })
  },
  closeOrder(orderNo, data = {}) {
    return request.post(`/admin/membership/orders/${orderNo}/close`, data)
  },
  refundOrder(orderNo, data = {}) {
    return request.post(`/admin/membership/orders/${orderNo}/refund`, data)
  }
}

export default financeAPI
