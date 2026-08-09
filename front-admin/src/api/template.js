import request from '@/utils/request'

/**
 * 剧本模板管理 API（S6-T07）
 * 对接后端 /api/v1/templates
 */
export const templateAPI = {
  /** 模板列表，params: { category?, genre_type?, is_active?, keyword?, page?, page_size? } */
  list(params = {}) {
    return request.get('/templates', { params })
  },
  /** 模板详情 */
  get(id) {
    return request.get(`/templates/${id}`)
  },
  /** 新建模板 */
  create(data) {
    return request.post('/templates', data)
  },
  /** 更新模板 */
  update(id, data) {
    return request.put(`/templates/${id}`, data)
  },
  /** 删除模板 */
  delete(id) {
    return request.delete(`/templates/${id}`)
  }
}
