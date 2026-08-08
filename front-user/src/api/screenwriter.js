import request from '@/utils/request'

export const screenwriterAPI = {
  // 同步生成
  generateOutlineSync(body) {
    return request.post('/ai/screenwriter/outline/sync', body)
  },
  generateCharactersSync(body) {
    return request.post('/ai/screenwriter/characters/sync', body)
  },
  generateEpisodesSync(body) {
    return request.post('/ai/screenwriter/episodes/sync', body)
  },
  generateStoryboardSync(body) {
    return request.post('/ai/screenwriter/storyboard/sync', body)
  },
  generateDialogueSync(body) {
    return request.post('/ai/screenwriter/dialogue/sync', body)
  },
  // 异步生成
  generateOutline(body) {
    return request.post('/ai/screenwriter/outline', body)
  },
  generateCharacters(body) {
    return request.post('/ai/screenwriter/characters', body)
  },
  generateEpisodes(body) {
    return request.post('/ai/screenwriter/episodes', body)
  },
  generateStoryboard(body) {
    return request.post('/ai/screenwriter/storyboard', body)
  },
  generateDialogue(body) {
    return request.post('/ai/screenwriter/dialogue', body)
  },
  // 查询
  getJob(jobId) {
    return request.get(`/ai/screenwriter/jobs/${jobId}`)
  },
  listJobs(params) {
    return request.get('/ai/screenwriter/jobs', { params })
  },
  listOutlines(params) {
    return request.get('/ai/screenwriter/outlines', { params })
  },
  getOutline(outlineId) {
    return request.get(`/ai/screenwriter/outlines/${outlineId}`)
  },
  listCharacters(outlineId) {
    return request.get(`/ai/screenwriter/outlines/${outlineId}/characters`)
  },
  listEpisodes(outlineId) {
    return request.get(`/ai/screenwriter/outlines/${outlineId}/episodes`)
  },
  listFrames(episodeId) {
    return request.get(`/ai/screenwriter/episodes/${episodeId}/frames`)
  },
  listDialogues(episodeId) {
    return request.get(`/ai/screenwriter/episodes/${episodeId}/dialogues`)
  },
  // 字典
  listTemplates() {
    return request.get('/ai/screenwriter/templates')
  },
  listGenres() {
    return request.get('/ai/screenwriter/genres')
  },
  listStyles() {
    return request.get('/ai/screenwriter/styles')
  },
  listShotTypes() {
    return request.get('/ai/screenwriter/shot-types')
  },
  listEmotions() {
    return request.get('/ai/screenwriter/emotions')
  },
  // 修改/重生成
  updateOutline(outlineId, patch) {
    return request.patch(`/ai/screenwriter/outlines/${outlineId}`, patch)
  },
  regenerateEpisode(episodeId, body) {
    return request.post(`/ai/screenwriter/episodes/${episodeId}/regenerate`, body)
  },
  generateSceneDescription(body) {
    return request.post('/ai/screenwriter/scene-description', body)
  },
  // 多轮对话
  chat(body) {
    return request.post('/ai/screenwriter/chat', body)
  },
  getChatHistory(sessionId) {
    return request.get(`/ai/screenwriter/chat/${sessionId}`)
  },
  listChatSessions(params) {
    return request.get('/ai/screenwriter/chat/sessions', { params })
  },
  // 一键创建项目
  createProject(body) {
    return request.post('/ai/screenwriter/create-project', body)
  },
  // 一致性校验
  checkConsistency(body) {
    return request.post('/ai/consistency/check', body)
  },
  generateEmbedding(body) {
    return request.post('/ai/consistency/embeddings', body)
  },
  getConsistencyStats(characterId) {
    return request.get(`/ai/consistency/stats/${characterId}`)
  },
}
