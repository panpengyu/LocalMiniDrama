import request from '@/utils/request'

/**
 * Sprint 13 - S13-T01~T05 会员体系 前端 API
 *
 * 覆盖：
 *   套餐 (S13-T01)：公开套餐列表
 *   会员 (S13-T02)：我的会员状态 + 配额总览 / 开关自动续费 / 取消会员
 *   支付 (S13-T04)：创建订单 / 确认支付 / 订单账单
 *   配额 (S13-T05)：配额用量总览
 *
 * 响应经全局拦截器已解包为 res.data（见 utils/request.js）。
 */
export const membershipAPI = {
  // ---------- 套餐 ----------
  listPlans() {
    return request.get('/membership/plans')
  },

  // ---------- 我的会员 ----------
  getMine() {
    return request.get('/membership/me')
  },
  getQuota(dramaId) {
    return request.get('/membership/quota', {
      params: dramaId ? { drama_id: dramaId } : {}
    })
  },
  setAutoRenew(enabled) {
    return request.post('/membership/auto-renew', { enabled })
  },
  cancel() {
    return request.post('/membership/cancel')
  },

  // ---------- 订单 / 支付 ----------
  createOrder(payload) {
    // payload: { level_code, cycle, pay_method, auto_renew, remark? }
    return request.post('/membership/orders', payload)
  },
  payOrder(orderNo, payload) {
    // payload: { trade_no?, auto_renew? }
    return request.post(`/membership/orders/${orderNo}/pay`, payload || {})
  },
  listOrders(params) {
    return request.get('/membership/orders', { params: params || {} })
  },

  // ---------- S17-T02 优惠券 ----------
  redeemCoupon(code) {
    return request.post('/membership/coupons/redeem', { code })
  },
  listMyCoupons() {
    return request.get('/membership/coupons')
  }
}

export default membershipAPI
