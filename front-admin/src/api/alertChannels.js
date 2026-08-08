import request from '@/utils/request'

/**
 * 异常告警：渠道管理 + 事件历史 + 手动触发
 * 对接后端 /api/v1/admin/alert-channels / alert-events / data-anomalies/alert*
 */
export const alertAPI = {
  // ---------- 渠道 CRUD ----------
  /** 列表（webhook_url 已脱敏返回 webhook_url_masked） */
  listChannels() {
    return request.get('/admin/alert-channels')
  },
  /** 新建渠道。body: { name, channel_type, webhook_url, secret?, mention_mobiles?, mention_all?, severity_mask, type_mask?, rate_limit_minutes?, enabled?, remark? } */
  createChannel(body) {
    return request.post('/admin/alert-channels', body)
  },
  /** 部分更新 */
  updateChannel(id, body) {
    return request.put(`/admin/alert-channels/${id}`, body)
  },
  deleteChannel(id) {
    return request.delete(`/admin/alert-channels/${id}`)
  },

  // ---------- 告警事件历史 ----------
  /**
   * @param {object} params { limit?, channel_id?, status?, severity? }
   *   status: pending / sent / failed / suppressed
   *   severity: critical / warning / info
   */
  listEvents(params = {}) {
    return request.get('/admin/alert-events', { params })
  },

  // ---------- 手动触发 ----------
  /**
   * 对单条异常 ID 立即推送测试通知（调试用）。
   * body 可选：{ webhookOverride?, channelType?, secret?, mentionAll?, mentionMobiles? }
   * @param {string} anomalyId  如 neg_bal_42 / bigamt_162 / mismatch_7
   */
  dispatchForAnomaly(anomalyId, body = {}) {
    return request.post(`/admin/data-anomalies/alert/${encodeURIComponent(anomalyId)}`, body)
  },

  /**
   * 全量扫描 + 批量发通知（后台定时任务同款）。
   * @param {object} overrides { amount_threshold?, balance_threshold?, limit?, maxItems? }
   */
  runScan(overrides = {}) {
    return request.post('/admin/data-anomalies/alert-scan', overrides)
  }
}
