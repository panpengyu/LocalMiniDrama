import request from '@/utils/request'

/**
 * S20-T02 音效智能匹配 API
 * 后端 services/sfxService.js（routes/sfx.js 挂载于 /）：
 *   GET  /sfx/match  按场景/情绪标签匹配素材库音效
 *   GET  /sfx/tags   素材库全部可用音效标签
 */
export const sfxAPI = {
  /** 标签列表 */
  tags() {
    return request.get('/sfx/tags')
  },

  /** 按描述/标签匹配音效（limit 条、强度 mode: light/normal/intense） */
  match({ query = '', tags = [], limit = 8, mode = 'normal' } = {}) {
    return request.get('/sfx/match', {
      params: { query, tags: tags.join(','), limit, mode },
    })
  },
}

export default sfxAPI
