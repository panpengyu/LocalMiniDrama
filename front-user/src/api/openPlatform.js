import request from '@/utils/request'

/**
 * Sprint 15 - S15-T05 开发者控制台 前端 API
 *
 * 覆盖：
 *   - 开发者应用：创建 / 列表 / 详情
 *   - API 密钥：创建（明文仅返回一次）/ 列表（脱敏）/ 吊销 / 续期
 *   - 调用统计：概览（总调用/今日/配额使用率）/ 趋势 / 错误日志
 *
 * 说明：全局拦截器已解包 res.data（见 @localmini/shared request.js），
 * 故下方方法直接返回业务数据对象。
 */
export const openPlatformAPI = {
  // ---------- 开发者应用 ----------
  createApp(payload) {
    // payload: { name, description? }
    return request.post('/open-platform/apps', payload)
  },
  listApps() {
    return request.get('/open-platform/apps')
  },
  getApp(appId) {
    return request.get(`/open-platform/apps/${appId}`)
  },

  // ---------- API 密钥 ----------
  createKey(appId, payload) {
    // payload: { name?, scopes[], rate_limit_per_min?, daily_quota?, expires_in_days?, ip_whitelist[]? }
    return request.post(`/open-platform/apps/${appId}/keys`, payload)
  },
  listKeys(params) {
    return request.get('/open-platform/keys', { params: params || {} })
  },
  revokeKey(keyId) {
    return request.post(`/open-platform/keys/${keyId}/revoke`)
  },
  renewKey(keyId, days) {
    return request.post(`/open-platform/keys/${keyId}/renew`, { days })
  },

  // ---------- 调用统计 ----------
  getStatsOverview() {
    return request.get('/open-platform/stats/overview')
  },
  getStatsTrend(days = 7) {
    return request.get('/open-platform/stats/trend', { params: { days } })
  },
  getErrorLogs(params) {
    return request.get('/open-platform/stats/errors', { params: params || {} })
  }
}

export default openPlatformAPI
