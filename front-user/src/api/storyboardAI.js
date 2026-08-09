import request from '@/utils/request'

/**
 * 智能分镜生成 API（Sprint 4 - S4-T01/T02）
 * 所有接口走 /api/v1/ai/storyboard/*
 */
export const storyboardAIAPI = {
  /**
   * 智能分镜生成（剧本段落→专业分镜列表）
   * @param {object} body - { scriptText, dramaId, episodeId, style, count, characters, scenes }
   * @returns {generationId, count, frames: [{frame_number, shot_type, camera_movement, composition, emotion, duration, transition, visual_description, prompt, characters}]}
   */
  generate(body) {
    return request.post('/ai/storyboard/generate', body)
  },

  /**
   * 单帧提示词润色
   * @param {object} body - { frame, style }
   */
  polishPrompt(body) {
    return request.post('/ai/storyboard/polish-prompt', body)
  },

  /**
   * 生成批次列表
   */
  listGenerations(params) {
    return request.get('/ai/storyboard/generations', { params })
  },

  /**
   * 生成批次详情
   */
  getGeneration(id) {
    return request.get(`/ai/storyboard/generations/${id}`)
  },

  /**
   * 分镜字典（镜头类型/运镜/构图/情绪/转场）
   */
  getDictionaries() {
    return request.get('/ai/storyboard/dictionaries')
  },
}
