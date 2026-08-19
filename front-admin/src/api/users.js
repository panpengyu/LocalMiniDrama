import request from '@/utils/request'

/** S21 批A · 用户管理（复用 /admin/users，super_admin） */
export const usersAPI = {
  list(params = {}) {
    return request.get('/admin/users', { params })
  },
  create(payload) {
    return request.post('/admin/users', payload)
  },
  update(id, payload) {
    return request.put(`/admin/users/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/admin/users/${id}`)
  }
}

export default usersAPI
