import request from '@/utils/request'

/** 背景音乐 (BGM) API 客户端 */
export const bgmAPI = {
  /** 创建 BGM 任务 */
  createBgm(data) {
    return request.post('/ai/bgm', data)
  },
  /** 获取 BGM 列表 */
  listBgm(params) {
    return request.get('/ai/bgm', { params: params || {} })
  },
  /** 获取单个 BGM 详情 */
  getBgm(id) {
    return request.get(`/ai/bgm/${id}`)
  },
  /** 删除 BGM */
  deleteBgm(id) {
    return request.delete(`/ai/bgm/${id}`)
  },
  /** 智能匹配 BGM（根据剧情/场景内容推荐配乐） */
  matchBgm(data) {
    return request.post('/ai/bgm/match', data)
  },
  /** 获取 BGM 情绪/氛围标签列表 */
  getBgmMoods() {
    return request.get('/ai/bgm/moods')
  }
}
