import request from '@/utils/request'

/**
 * Sprint 14 - S14-T04 模板市场审核工作台 管理端 API
 *
 * 对接后端 /api/v1/admin/marketplace/*（见 backend-node/src/routes/marketplace.js）。
 * 需 super_admin 权限。响应经全局拦截器已解包为 res.data。
 *
 * 覆盖：
 *   审核队列 / 模板全文 / 审核轨迹 / 人工复审 / 上下架
 *   创作者认证 / 提现审核 / 平台参数（分成比例、提现门槛）
 *   市场概览统计
 */
export const marketplaceAdminAPI = {
  // ---------- 概览 ----------
  stats() {
    return request.get('/marketplace/stats')
  },

  // ---------- 审核队列 ----------
  /** 待审核队列，params: { status?, page?, page_size? } */
  reviewQueue(params = {}) {
    return request.get('/admin/marketplace/review-queue', { params })
  },
  /** 审核视角查看模板全文（含 review_state） */
  getTemplate(id) {
    return request.get(`/admin/marketplace/templates/${id}`)
  },
  /** 模板审核轨迹 */
  reviewLogs(id) {
    return request.get(`/admin/marketplace/templates/${id}/review-logs`)
  },
  /** 人工复审，payload: { approve, remark? } */
  review(id, payload) {
    return request.post(`/admin/marketplace/templates/${id}/review`, payload)
  },
  /** 上/下架，payload: { listed, remark? } */
  setListing(id, payload) {
    return request.post(`/admin/marketplace/templates/${id}/listing`, payload)
  },

  // ---------- 创作者认证 ----------
  /** 创作者列表，params: { verify_status?, keyword?, page?, page_size? } */
  listCreators(params = {}) {
    return request.get('/admin/marketplace/creators', { params })
  },
  /** 创作者认证审核，payload: { approve, remark?, commission_rate? } */
  verifyCreator(id, payload) {
    return request.post(`/admin/marketplace/creators/${id}/verify`, payload)
  },

  // ---------- 提现审核 ----------
  /** 提现列表，params: { status?, page?, page_size? } */
  listWithdrawals(params = {}) {
    return request.get('/admin/marketplace/withdrawals', { params })
  },
  /** 提现审核，payload: { approve, remark? } */
  reviewWithdrawal(id, payload) {
    return request.post(`/admin/marketplace/withdrawals/${id}/review`, payload)
  },

  // ---------- 平台参数 ----------
  /** 更新分成比例 / 提现门槛，payload: { platform_rate?, min_withdrawal? } */
  updateSettings(payload) {
    return request.put('/admin/marketplace/settings', payload)
  }
}

export default marketplaceAdminAPI
