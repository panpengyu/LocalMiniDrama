import request from '@/utils/request'

/**
 * Sprint 2/3 角色一致性 API 封装
 * 对应后端 routes/consistency.js
 */
export const consistencyAPI = {
  // ===== S2-T08: 一致性校验 =====
  /**
   * 比对生成图与角色参考图，返回相似度
   */
  check(body) {
    return request.post('/ai/consistency/check', body)
  },

  // ===== S2-T07: 角色指纹（embedding） =====
  /**
   * 为角色生成面部 embedding 向量
   */
  generateEmbedding(body) {
    return request.post('/ai/consistency/embeddings', body)
  },
  /**
   * 为剧中所有角色批量生成 embedding
   */
  batchGenerateEmbeddings(body) {
    return request.post('/ai/consistency/embeddings/batch', body)
  },
  /**
   * 获取角色 embedding 元数据（维度/模型/阈值，不含原始向量）
   */
  getEmbeddingMeta(characterId, characterType = 'project') {
    return request.get(`/ai/consistency/embeddings/${characterId}`, {
      params: { characterType },
    })
  },

  // ===== S3-T01: 前端一致性面板 =====
  /**
   * 查询一致性校验历史（可按 drama/character/storyboard 过滤）
   */
  listLogs(params = {}) {
    return request.get('/ai/consistency/logs', { params })
  },
  /**
   * 获取角色一致性统计（平均分/通过率/最近一次分数）
   */
  getCharacterStats(characterId) {
    return request.get(`/ai/consistency/stats/${characterId}`)
  },
}

export default consistencyAPI
