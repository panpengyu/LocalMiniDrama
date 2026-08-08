import request from '@/utils/request'

/**
 * 数据异常检测 API
 */
export const dataAnomaliesAPI = {
  /**
   * 获取后端默认扫描配置（来自环境变量 ANOMALY_DEFAULT_* 与 ANOMALY_LOG_LEVEL）。
   * 页面初始加载时调用，把输入框的默认值填上。
   * @returns {Promise<{amountThreshold:number,balanceThreshold:number,defaultLimit:number,logLevel:string}>}
   */
  getConfig() {
    return request.get('/admin/data-anomalies/config')
  },

  /**
   * 扫描全库异常记录
   * @param {object} params
   * @param {number} [params.amount_threshold]  单笔积分绝对值阈值，默认取后端配置 amountThreshold
   * @param {number} [params.balance_threshold] 余额跳变/差值阈值，默认取后端配置 balanceThreshold
   * @param {number} [params.limit]             每类扫描最多返回多少条，默认 200
   * @param {AbortSignal} [signal]              取消令牌（连点扫描时取消上一个还在飞的请求）
   * @returns {Promise<{summary:{total:number,bySeverity,byType,thresholds,defaults}, items:Array}>}
   */
  scan(params = {}, signal) {
    return request.get('/admin/data-anomalies', { params, signal })
  },

  /**
   * 一键"托底修复"。
   * 支持：neg_bal_<id>、userbalneg_<user_id>、mismatch_<user_id>。
   * 不支持：huge_amount / balance_jump（需人工处理）。
   * @param {string} id
   */
  fix(id) {
    return request.post(`/admin/data-anomalies/fix/${encodeURIComponent(id)}`)
  }
}
