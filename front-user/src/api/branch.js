import request from '@/utils/request'

/**
 * S20-T01 分支叙事 API
 * 对应后端 routes/branch.js（挂载在 / 下）：
 *   GET    /dramas/:id/branches        分支列表
 *   POST   /dramas/:id/branches        创建分支
 *   PUT    /dramas/:id/branches/:bid   重命名分支
 *   DELETE /dramas/:id/branches/:bid   删除分支
 *   POST   /episodes/:eid/branch       移动剧集到分支
 *   PUT    /storyboards/:sid/branch-condition  条件连线
 *   POST   /dramas/:id/export-script   按分支导出剧本
 */
export const branchAPI = {
  /** 分支列表（主线 branch_id 为 null，type='main'） */
  list(dramaId) {
    return request.get(`/dramas/${dramaId}/branches`)
  },

  /** 创建分支：source_episode_id 源集（复制分镜），name 分支名 */
  create(dramaId, { source_episode_id, name }) {
    return request.post(`/dramas/${dramaId}/branches`, {
      source_episode_id: Number(source_episode_id),
      name,
    })
  },

  /** 重命名分支 */
  rename(dramaId, branchId, name) {
    return request.put(`/dramas/${dramaId}/branches/${branchId}`, { name })
  },

  /** 删除分支（级联删除分支下全部集与分镜） */
  remove(dramaId, branchId) {
    return request.delete(`/dramas/${dramaId}/branches/${branchId}`)
  },

  /** 移动剧集到分支（branch_id 传 null 移回主线） */
  moveEpisode(episodeId, branchId) {
    return request.post(`/episodes/${episodeId}/branch`, {
      branch_id: branchId == null ? null : String(branchId),
    })
  },

  /** 条件连线：scene_id 源分镜、condition 条件文本、target_scene_id 目标分镜 */
  setCondition(sceneId, condition, targetSceneId) {
    return request.put(`/storyboards/${sceneId}/branch-condition`, {
      condition,
      target_scene_id: targetSceneId == null ? null : Number(targetSceneId),
    })
  },

  /** 按分支导出剧本（branch_id 传 null 表示主线）；download=1 时后端直接返回文本 */
  exportScript(dramaId, branchId) {
    return request.post(`/dramas/${dramaId}/export-script`, {
      branch_id: branchId == null ? null : String(branchId),
      download: 1,
    }, { responseType: 'text' })
  },
}

export default branchAPI
