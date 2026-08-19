import request from '@/utils/request'

/** S21 批A · 团队管理（复用 /admin/teams，super_admin） */
export const teamsAPI = {
  list(params = {}) {
    return request.get('/admin/teams', { params })
  },
  create(payload) {
    return request.post('/admin/teams', payload)
  },
  update(id, payload) {
    return request.put(`/admin/teams/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/admin/teams/${id}`)
  }
}

export default teamsAPI
