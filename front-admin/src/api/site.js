import request from '@/utils/request'

/** S21 批B · 站点配置（品牌/短信/TOS/协议/版本日志/公告） */
export const siteAPI = {
  getBrand() { return request.get('/admin/site/brand') },
  saveBrand(payload) { return request.put('/admin/site/brand', payload) },
  getSms() { return request.get('/admin/site/sms') },
  saveSms(payload) { return request.put('/admin/site/sms', payload) },
  getTos() { return request.get('/admin/site/tos') },
  saveTos(payload) { return request.put('/admin/site/tos', payload) },
  getAgreements() { return request.get('/admin/site/agreements') },
  saveAgreements(payload) { return request.put('/admin/site/agreements', payload) },
  getChangelog() { return request.get('/admin/site/changelog') },
  notices: {
    list(params = {}) { return request.get('/admin/notices', { params }) },
    create(payload) { return request.post('/admin/notices', payload) },
    update(id, payload) { return request.put(`/admin/notices/${id}`, payload) },
    remove(id) { return request.delete(`/admin/notices/${id}`) }
  }
}

export default siteAPI
