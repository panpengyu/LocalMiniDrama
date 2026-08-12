import request from '@/utils/request'

/**
 * Sprint 11 - 团队协作 + 版本管理 前端 API
 *
 * 覆盖：
 *   版本管理 (S11-T06/T07)：列表 / 详情 / 对比 / 手动快照 / 回退
 *   协作成员 (S11-T02)：列表 / 添加 / 移除 / 角色字典
 *   节点锁   (S11-T04)：活跃锁列表
 *   通知     (S11-T05)：列表 / 标记已读
 *   审计     (S11-T08)：操作历史查询
 */
export const collaborationAPI = {
  // ---------- 版本管理 ----------
  listVersions(dramaId, params) {
    return request.get(`/dramas/${dramaId}/versions`, { params: params || {} })
  },
  getVersion(dramaId, versionNo) {
    return request.get(`/dramas/${dramaId}/versions/${versionNo}`)
  },
  diffVersions(dramaId, from, to) {
    return request.get(`/dramas/${dramaId}/versions/diff`, { params: { from, to } })
  },
  createSnapshot(dramaId, summary) {
    return request.post(`/dramas/${dramaId}/versions/snapshot`, { summary })
  },
  rollback(dramaId, versionNo) {
    return request.post(`/dramas/${dramaId}/versions/${versionNo}/rollback`)
  },

  // ---------- 协作成员 ----------
  listCollaborators(dramaId, includeRemoved) {
    return request.get(`/dramas/${dramaId}/collaborators`, {
      params: includeRemoved ? { includeRemoved: 1 } : {}
    })
  },
  addCollaborator(dramaId, userId, roleTag) {
    return request.post(`/dramas/${dramaId}/collaborators`, { userId, roleTag })
  },
  removeCollaborator(dramaId, userId) {
    return request.delete(`/dramas/${dramaId}/collaborators/${userId}`)
  },
  getRoleDict(dramaId) {
    return request.get(`/dramas/${dramaId}/collaborators/roles`)
  },

  // ---------- 节点锁 ----------
  listLocks(dramaId) {
    return request.get(`/dramas/${dramaId}/locks`)
  },

  // ---------- 通知 ----------
  listNotifications(params) {
    return request.get('/collab/notifications', { params: params || {} })
  },
  markNotificationRead(id) {
    return request.post('/collab/notifications/read', id != null ? { id } : {})
  },

  // ---------- 审计 ----------
  listActivities(dramaId, params) {
    return request.get(`/dramas/${dramaId}/activities`, { params: params || {} })
  }
}

export default collaborationAPI
