import request from '@/utils/request'

/** S21 批A · 渠道管理（/admin/channels，admin/super_admin） */
export const channelsAPI = {
  list(params = {}) {
    return request.get('/admin/channels', { params })
  },
  create(payload) {
    return request.post('/admin/channels', payload)
  },
  update(id, payload) {
    return request.put(`/admin/channels/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/admin/channels/${id}`)
  }
}

export default channelsAPI
