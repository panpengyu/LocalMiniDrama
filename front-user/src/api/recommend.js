import request from '@/utils/request'

/**
 * Sprint 16 - S16-T01 素材推荐引擎 前端 API（登录用户）
 *
 * 对接后端 /api/v1/recommend/*（见 backend-node/src/routes/recommend.js）。
 * 数据全部来自真实 MySQL（画像/行为/素材库/模板），无 mock。
 *
 * 覆盖：
 *   首页个性化推荐组合 / 素材推荐 / 模板推荐 / 全站热门 / 推荐反馈留痕
 */
export const recommendAPI = {
  /** 首页个性化推荐组合，params: { materialLimit?, templateLimit? } */
  home(params = {}) {
    return request.get('/recommend/home', { params })
  },
  /** 素材推荐，params: { dimension: 'character'|'scene'|'prop', limit?, excludeIds? } */
  materials(params = {}) {
    return request.get('/recommend/materials', { params })
  },
  /** 模板推荐，params: { limit? } */
  templates(params = {}) {
    return request.get('/recommend/templates', { params })
  },
  /** 全站热门，params: { dimension?, limit? } */
  trending(params = {}) {
    return request.get('/recommend/trending', { params })
  },
  /** 推荐反馈留痕，payload: { itemType, dimension, itemId, action, source?, score?, rank?, meta? } */
  feedback(payload) {
    return request.post('/recommend/feedback', payload)
  }
}

export default recommendAPI
