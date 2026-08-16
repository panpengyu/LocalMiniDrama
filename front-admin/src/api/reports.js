import request from '@/utils/request'

// S18-T02 报表订阅 / 模板 / 发送日志 / 导出
export const reportsAPI = {
  listSubscriptions() {
    return request.get('/admin/reports/subscriptions')
  },
  createSubscription(data) {
    return request.post('/admin/reports/subscriptions', data)
  },
  updateSubscription(id, data) {
    return request.put(`/admin/reports/subscriptions/${id}`, data)
  },
  deleteSubscription(id) {
    return request.delete(`/admin/reports/subscriptions/${id}`)
  },
  runSubscription(id) {
    return request.post(`/admin/reports/subscriptions/${id}/run`)
  },
  listTemplates() {
    return request.get('/admin/reports/templates')
  },
  createTemplate(data) {
    return request.post('/admin/reports/templates', data)
  },
  updateTemplate(id, data) {
    return request.put(`/admin/reports/templates/${id}`, data)
  },
  deleteTemplate(id) {
    return request.delete(`/admin/reports/templates/${id}`)
  },
  listSendLogs(params = {}) {
    return request.get('/admin/reports/send-logs', { params })
  },
  retrySendLog(id) {
    return request.post(`/admin/reports/send-logs/${id}/retry`)
  },
  retryFailed(limit = 10) {
    return request.post('/admin/reports/retry-failed', { limit })
  },
  // 下载导出文件（带鉴权头，blob 方式触发浏览器下载）
  async exportFile(type = 'csv', data = 'events', days = 30) {
    const blob = await request.get('/admin/reports/export', {
      params: { type, data, days },
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${data}_${days}d.${type}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
    return true
  }
}
