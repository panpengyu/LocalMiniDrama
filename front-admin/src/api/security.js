import request from '@/utils/request'

/**
 * Sprint 12 - S12-T07 权限与安全增强 API
 * 接口走 /api/v1/admin/security/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const securityAPI = {
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
  }
}

export default securityAPI
