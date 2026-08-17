import request from '@/utils/request'

/**
 * 安全与权限 API
 * S12-T07：审计/登录日志（/admin/security/*，super_admin）
 * S19-T03/T04：安全策略（密码/锁定/IP 白名单/2FA）、在线会话管理与强制下线
 */
export const securityAPI = {
  // ---------- S12 审计与登录日志 ----------
  auditLogs(params = {}) {
    return request.get('/admin/security/audit-logs', { params })
  },
  auditStats() {
    return request.get('/admin/security/audit-stats')
  },
  loginLogs(params = {}) {
    return request.get('/admin/security/login-logs', { params })
  },
  loginStats(days = 7) {
    return request.get('/admin/security/login-stats', { params: { days } })
  },

  // ---------- S19 安全策略 ----------
  getPolicy() {
    return request.get('/admin/security/policy')
  },
  updatePolicy(patch) {
    return request.put('/admin/security/policy', patch)
  },
  resetPolicy() {
    return request.post('/admin/security/policy/reset')
  },

  // ---------- S19 在线会话 ----------
  sessions(params = {}) {
    return request.get('/admin/security/sessions', { params })
  },
  revokeSession(id, userId) {
    return request.post(`/admin/security/sessions/${id}/revoke`, { userId })
  },
  revokeAllForUser(payload) {
    return request.post('/admin/security/sessions/revoke-all', payload)
  },
  pruneSessions() {
    return request.post('/admin/security/sessions/prune')
  }
}

export default securityAPI
