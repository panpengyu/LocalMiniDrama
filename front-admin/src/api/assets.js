import request from '@/utils/request'

/** S21 批A · 素材库管理（复用 /assets） */
export const assetsAPI = {
  list(params = {}) {
    return request.get('/assets', { params })
  },
  create(payload) {
    return request.post('/assets', payload)
  },
  get(id) {
    return request.get(`/assets/${id}`)
  },
  update(id, payload) {
    return request.put(`/assets/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/assets/${id}`)
  }
}

export default assetsAPI
