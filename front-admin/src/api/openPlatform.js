import request from '@/utils/request'

/**
 * Sprint 15 - S15-T01 API 开放平台 管理端 API
 *
 * 对接后端 /api/v1/admin/open-platform/*（见 backend-node/src/routes/apiKeys.js）。
 * 需 super_admin 权限。响应经全局拦截器已解包为 res.data。
 *
 * 覆盖：
 *   开发者应用分页查询（含申请人信息）/ 应用审批（通过/驳回）
 *   全量密钥脱敏列表（可按用户/应用过滤）
 */
export const openPlatformAdminAPI = {
  /** 应用分页列表，params: { status?: pending|approved|rejected, keyword?, page?, page_size? } */
  apps(params = {}) {
    return request.get('/admin/open-platform/apps', { params })
  },

  /** 审批应用，payload: { approve: boolean, reason?: string } */
  review(appId, payload) {
    return request.post(`/admin/open-platform/apps/${appId}/review`, payload)
  },

  /** 密钥脱敏列表，params: { user_id?, app_id? } */
  keys(params = {}) {
    return request.get('/admin/open-platform/keys', { params })
  }
}
