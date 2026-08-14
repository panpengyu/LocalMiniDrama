import request from '@/utils/request'

/**
 * Sprint 16 - S16-T05 全链路监控 + 前端错误监控 API（super_admin）
 * 接口走 /api/v1/admin/monitor/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const opsAPI = {
  /** 全链路运维快照（DB / 队列 / API / 前端错误汇总） */
  ops() {
    return request.get('/admin/monitor/ops')
  },
  /** 前端错误分页查询，params: { page, page_size, category, level } */
  frontendErrors(params = {}) {
    return request.get('/admin/monitor/frontend-errors', { params })
  },
  /** 主动触发一次全链路扫描 + 告警 */
  scan() {
    return request.post('/admin/monitor/ops-scan')
  }
}

export default opsAPI
