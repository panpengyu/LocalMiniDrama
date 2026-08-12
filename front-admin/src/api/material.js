import request from '@/utils/request'

/**
 * Sprint 12 - S12-T01 素材标签 + S12-T02 三级素材库 API 封装
 * 接口走 /api/v1/materials/*（后端 requireAuth）
 */
export const materialAPI = {
  // 标签词典（维度/使用次数）
  tagDictionary(params = {}) {
    return request.get('/materials/tags/dictionary', { params })
  },
  // 批量为未打标签素材补标签
  batchTag(kind, limit = 20) {
    return request.post(`/materials/${kind}/tags/batch`, { limit })
  },
  // 为单个素材生成标签
  generateTags(kind, id, replace = false) {
    return request.post(`/materials/${kind}/${id}/tags/generate`, { replace })
  },
  // 单素材标签
  materialTags(kind, id) {
    return request.get(`/materials/${kind}/${id}/tags`)
  },
  // 手动新增标签
  addTag(kind, id, dimension, name) {
    return request.post(`/materials/${kind}/${id}/tags`, { dimension, name })
  },
  // 移除标签
  removeTag(kind, id, tagId) {
    return request.delete(`/materials/${kind}/${id}/tags/${tagId}`)
  },
  // 作用域概览
  scopeSummary() {
    return request.get('/materials/scope/summary')
  }
}

export default materialAPI
