import request from '@/utils/request'

/**
 * Sprint 16 - S16-T06 用户文档与帮助中心 前端 API（登录用户）
 *
 * 对接后端 /api/v1/help/*（见 backend-node/src/routes/help.js）。
 * 文档内容全部来自真实 MySQL help_docs 表（含种子数据），无 mock。
 */
export const helpAPI = {
  /** 帮助文档列表，params: { category?: 'manual'|'faq'|'video'|'best_practice' } */
  docs(params = {}) {
    return request.get('/help/docs', { params })
  },
  /** 帮助文档详情 */
  doc(id) {
    return request.get(`/help/docs/${id}`)
  },
  /** 帮助中心总览（分类统计 + 精选文章） */
  overview() {
    return request.get('/help/overview')
  }
}

export default helpAPI
