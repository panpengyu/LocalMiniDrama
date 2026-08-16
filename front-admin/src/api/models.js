// 模型 A/B 测试与用量配额 API（Sprint 19）
import request from '@/utils/request'

export const modelsAPI = {
  // ===== A/B 测试 =====
  listAbTests(params) {
    return request.get('/admin/models/ab-tests', { params })
  },
  createAbTest(data) {
    return request.post('/admin/models/ab-tests', data)
  },
  updateAbTest(id, data) {
    return request.put(`/admin/models/ab-tests/${id}`, data)
  },
  deleteAbTest(id) {
    return request.delete(`/admin/models/ab-tests/${id}`)
  },
  runAbTest(id, data) {
    return request.post(`/admin/models/ab-tests/${id}/run`, data)
  },
  abReport(id, days = 30) {
    return request.get(`/admin/models/ab-tests/${id}/report`, { params: { days } })
  },
  setAbDefault(id, group) {
    return request.post(`/admin/models/ab-tests/${id}/set-default`, { group })
  },

  // ===== 用量配额 =====
  listQuotas(params) {
    return request.get('/admin/models/quotas', { params })
  },
  createQuota(data) {
    return request.post('/admin/models/quotas', data)
  },
  updateQuota(id, data) {
    return request.put(`/admin/models/quotas/${id}`, data)
  },
  deleteQuota(id) {
    return request.delete(`/admin/models/quotas/${id}`)
  },
  quotaUsage(params) {
    return request.get('/admin/models/quotas/usage', { params })
  },
  quotaCheck(params) {
    return request.get('/admin/models/quotas/check', { params })
  },
  quotaConsume(data) {
    return request.post('/admin/models/quotas/consume', data)
  },
}
