import request from '@/utils/request'

/**
 * 剧本模板 API（S6-T06）
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
  /**
   * 应用模板创建项目
   * @param {number|string} id 模板 ID
   * @param {object} data { title?, description?, aspect_ratio?, ... }
   */
  apply(id, data = {}) {
    return request.post(`/templates/${id}/apply`, data)
  }
}
