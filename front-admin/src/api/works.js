import request from '@/utils/request'

/** S21 批A · 作品管理（/admin/works，admin/super_admin） */
export const worksAPI = {
  list(params = {}) {
    return request.get('/admin/works', { params })
  },
  update(id, payload) {
    return request.put(`/admin/works/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/admin/works/${id}`)
  }
}

export default worksAPI
