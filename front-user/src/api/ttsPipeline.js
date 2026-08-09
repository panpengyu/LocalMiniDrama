import request from '@/utils/request'

/**
 * 智能配音流水线 API（Sprint 4 - S4-T03/T04）
 * 所有接口走 /api/v1/ai/tts/*
 */
export const ttsPipelineAPI = {
  /** 音色列表 */
  listVoices() {
    return request.get('/ai/tts/voices')
  },

  /** 情感语调列表 */
  listEmotions() {
    return request.get('/ai/tts/emotions')
  },

  /** 角色音色绑定列表 */
  listVoiceBindings(params) {
    return request.get('/ai/tts/voice-bindings', { params })
  },

  /** 绑定角色音色 */
  bindVoice(body) {
    return request.post('/ai/tts/voice-bindings', body)
  },

  /** 删除音色绑定 */
  deleteVoiceBinding(id) {
    return request.delete(`/ai/tts/voice-bindings/${id}`)
  },

  /** 从分镜提取台词 */
  extractDialogues(body) {
    return request.post('/ai/tts/extract-dialogues', body)
  },

  /** 批量TTS合成 */
  batchSynthesize(body) {
    return request.post('/ai/tts/batch-synthesize', body)
  },

  /** 分集配音记录 */
  listDubbingByEpisode(episodeId) {
    return request.get(`/ai/tts/dubbing/episode/${episodeId}`)
  },
}
