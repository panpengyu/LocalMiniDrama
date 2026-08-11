import request from '@/utils/request'

/** 项目级风格配置 API 客户端 */
export const styleAPI = {
  /** 获取可用风格预设列表 */
  getStylePresets() {
    return request.get('/styles/presets')
  },
  /** 获取项目的风格配置 */
  getStyleConfig(dramaId) {
    return request.get(`/dramas/${dramaId}/style`)
  },
  /** 创建项目的风格配置 */
  createStyleConfig(dramaId, data) {
    return request.post(`/dramas/${dramaId}/style`, data)
  },
  /** 更新项目的风格配置 */
  updateStyleConfig(dramaId, data) {
    return request.put(`/dramas/${dramaId}/style`, data)
  },
  /** 删除项目的风格配置 */
  deleteStyleConfig(dramaId) {
    return request.delete(`/dramas/${dramaId}/style`)
  },
  /** 获取风格配置摘要（含注入后提示词预览等） */
  getStyleSummary(dramaId) {
    return request.get(`/dramas/${dramaId}/style/summary`)
  },
  /** 预览风格注入：将原始提示词注入当前风格配置后返回结果 */
  previewStyleInjection(dramaId, data) {
    return request.post(`/dramas/${dramaId}/style/preview`, data)
  }
}
