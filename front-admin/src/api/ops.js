import request from '@/utils/request'

/**
 * Sprint 16 - S16-T05 全链路监控 + 前端错误监控 API（super_admin）
 * Sprint 21 - S21-T01/T02 版权检测 + 运维自动化 + 扩缩容建议（admin）
 *   - /ops/copyright/*、/ops/scripts/:action、/ops/scaling-advice
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
  },

  // ============ S21 版权检测 ============
  /** 对指定素材（asset_id）或全部未检素材（all=true）执行版权指纹比对 */
  detectCopyright(payload = {}) {
    return request.post('/ops/copyright/detect', payload)
  },
  /** 版权状态分页列表，params: { page, page_size, status } */
  copyrightList(params = {}) {
    return request.get('/ops/copyright/list', { params })
  },

  // ============ S21 运维脚本 ============
  /** 触发备份/恢复/回滚脚本（白名单），restore 需传 backup_dir */
  runScript(action, payload = {}) {
    return request.post(`/ops/scripts/${action}`, payload)
  },

  // ============ S21 扩缩容建议 ============
  /** 扩缩容建议（真实 CPU/内存/队列/DB 指标） */
  scalingAdvice() {
    return request.get('/ops/scaling-advice')
  }
}

export default opsAPI
