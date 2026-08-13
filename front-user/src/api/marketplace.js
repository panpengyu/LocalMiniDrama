import request from '@/utils/request'

/**
 * Sprint 14 - S14-T02 模板市场 前端 API（用户端 / 创作者端）
 *
 * 对接后端 /api/v1/marketplace/*（见 backend-node/src/routes/marketplace.js）。
 * 响应经全局拦截器已解包为 res.data（见 utils/request.js）。
 *
 * 覆盖：
 *   模板画廊 (S14-T01/T02)：列表/分类/统计/详情/评论/评分/获取/应用/我的库
 *   创作者中心 (S14-T03)：入驻/资料/收益/流水/模板管理/提交审核/审核轨迹/提现
 */
export const marketplaceAPI = {
  // ---------- 模板画廊（公开 / 登录可选） ----------
  /** 模板列表，params: { category?, genre_type?, pricing_type?, keyword?, sort?, page?, page_size? } */
  listTemplates(params = {}) {
    return request.get('/marketplace/templates', { params })
  },
  /** 分类聚合（导航） */
  listCategories() {
    return request.get('/marketplace/categories')
  },
  /** 市场概览统计 */
  stats() {
    return request.get('/marketplace/stats')
  },
  /** 模板详情（含评分聚合/最近评论/是否已获取） */
  getTemplate(id) {
    return request.get(`/marketplace/templates/${id}`)
  },
  /** 评论列表，params: { limit?, offset? } */
  listRatings(id, params = {}) {
    return request.get(`/marketplace/templates/${id}/ratings`, { params })
  },

  // ---------- 交易 / 互动（需登录） ----------
  /** 获取模板：免费下载 / 付费购买（积分抵扣），payload: { pay_method } */
  acquire(id, payload = {}) {
    return request.post(`/marketplace/templates/${id}/acquire`, payload)
  },
  /** 应用模板创建新项目，payload: { title? } */
  apply(id, payload = {}) {
    return request.post(`/marketplace/templates/${id}/apply`, payload)
  },
  /** 提交/更新评分，payload: { rating, comment? } */
  rate(id, payload) {
    return request.post(`/marketplace/templates/${id}/ratings`, payload)
  },
  /** 我获取过的模板，params: { limit?, offset? } */
  myLibrary(params = {}) {
    return request.get('/marketplace/my/library', { params })
  },

  // ---------- 创作者中心（S14-T03） ----------
  /** 申请入驻 / 更新资料 */
  applyCreator(payload) {
    return request.post('/marketplace/creator/apply', payload)
  },
  /** 我的创作者档案（未入驻返回 null） */
  getCreator() {
    return request.get('/marketplace/creator/me')
  },
  /** 收益概览 */
  earnings() {
    return request.get('/marketplace/creator/earnings')
  },
  /** 收益流水，params: { limit?, offset? } */
  ledger(params = {}) {
    return request.get('/marketplace/creator/ledger', { params })
  },
  /** 我的模板列表，params: { status?, page?, page_size? } */
  myTemplates(params = {}) {
    return request.get('/marketplace/creator/templates', { params })
  },
  /** 创建模板草稿 */
  createTemplate(payload) {
    return request.post('/marketplace/creator/templates', payload)
  },
  /** 编辑模板 */
  updateTemplate(id, payload) {
    return request.put(`/marketplace/creator/templates/${id}`, payload)
  },
  /** 删除模板 */
  deleteTemplate(id) {
    return request.delete(`/marketplace/creator/templates/${id}`)
  },
  /** 提交审核（串联 AI 预审） */
  submitReview(id) {
    return request.post(`/marketplace/creator/templates/${id}/submit`)
  },
  /** 模板审核轨迹 */
  reviewLogs(id) {
    return request.get(`/marketplace/creator/templates/${id}/review-logs`)
  },
  /** 申请提现，payload: { amount } */
  requestWithdrawal(payload) {
    return request.post('/marketplace/creator/withdrawals', payload)
  },
  /** 我的提现记录，params: { limit?, offset? } */
  myWithdrawals(params = {}) {
    return request.get('/marketplace/creator/withdrawals', { params })
  }
}

export default marketplaceAPI
