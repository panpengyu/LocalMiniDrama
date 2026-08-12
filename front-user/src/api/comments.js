import request from '@/utils/request'

/**
 * Sprint 13 - S13-T06 评论批注 前端 API
 *
 * 覆盖：
 *   列表 / 发表(节点评论 + 时间戳批注 + @提及) / 编辑 / 删除
 *   批量回复 / 解决-重开 / 单条已读 / 全部已读 / 未读数
 *
 * 所有接口以项目 dramaId 为维度；响应经全局拦截器已解包为 res.data。
 */
export const commentAPI = {
  // 列出评论（含 unread 标记，可按 node_key / status 过滤）
  list(dramaId, params) {
    return request.get(`/dramas/${dramaId}/comments`, { params: params || {} })
  },
  // 发表评论 / 回复 / 时间戳批注
  create(dramaId, payload) {
    // payload: { node_key?, content, timestamp_ms?, parent_id? }
    return request.post(`/dramas/${dramaId}/comments`, payload)
  },
  // 批量回复
  batchReply(dramaId, commentIds, content) {
    return request.post(`/dramas/${dramaId}/comments/batch-reply`, {
      comment_ids: commentIds,
      content
    })
  },
  // 编辑
  update(dramaId, commentId, content) {
    return request.put(`/dramas/${dramaId}/comments/${commentId}`, { content })
  },
  // 删除
  remove(dramaId, commentId) {
    return request.delete(`/dramas/${dramaId}/comments/${commentId}`)
  },
  // 解决 / 重开
  setStatus(dramaId, commentId, status) {
    return request.post(`/dramas/${dramaId}/comments/${commentId}/status`, { status })
  },
  // 标记单条已读
  markRead(dramaId, commentId) {
    return request.post(`/dramas/${dramaId}/comments/${commentId}/read`)
  },
  // 标记全部已读
  markAllRead(dramaId, nodeKey) {
    return request.post(`/dramas/${dramaId}/comments/read-all`,
      nodeKey !== undefined ? { node_key: nodeKey } : {})
  },
  // 未读数（总数 + 按节点）
  unread(dramaId) {
    return request.get(`/dramas/${dramaId}/comments/unread`)
  }
}

export default commentAPI
