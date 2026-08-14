import request from '@/utils/request'

/**
 * Sprint 16 - S16-T06 帮助文档管理 API（super_admin）
 * 接口走 /api/v1/admin/help-docs/*（后端 requireAuth + requireRole(['super_admin'])）
 * 文档内容全部来自真实 MySQL help_docs 表，无 mock。
 */
export const helpAdminAPI = {
  list(params = {}) {
    return request.get('/admin/help-docs', { params })
  },
  create(payload) {
    return request.post('/admin/help-docs', payload)
  },
  update(id, payload) {
    return request.put(`/admin/help-docs/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/admin/help-docs/${id}`)
  }
}

export default helpAdminAPI
