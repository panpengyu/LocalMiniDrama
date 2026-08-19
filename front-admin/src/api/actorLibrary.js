import request from '@/utils/request'

/** S21 批A · 演员库管理（复用 /character-library） */
export const actorLibraryAPI = {
  list(params = {}) {
    return request.get('/character-library', { params: { ...params, _t: Date.now() } })
  },
  create(payload) {
    return request.post('/character-library', payload)
  },
  get(id) {
    return request.get(`/character-library/${id}`)
  },
  update(id, payload) {
    return request.put(`/character-library/${id}`, payload)
  },
  remove(id) {
    return request.delete(`/character-library/${id}`)
  }
}

export default actorLibraryAPI
