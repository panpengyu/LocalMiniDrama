import request from '@/utils/request'

/**
 * 工作流引擎 API（Sprint 7 S7-T03/T04）
 * 对接后端 /api/v1/workflows
 */
export const workflowAPI = {
  // ========== 工作流定义 ==========
  listDefinitions(params = {}) {
    return request.get('/workflows/definitions', { params })
  },
  getDefinition(id) {
    return request.get(`/workflows/definitions/${id}`)
  },
  createDefinition(data) {
    return request.post('/workflows/definitions', data)
  },
  updateDefinition(id, data) {
    return request.put(`/workflows/definitions/${id}`, data)
  },
  deleteDefinition(id) {
    return request.delete(`/workflows/definitions/${id}`)
  },

  // ========== 工作流实例 ==========
  listInstances(params = {}) {
    return request.get('/workflows/instances', { params })
  },
  getInstance(id) {
    return request.get(`/workflows/instances/${id}`)
  },
  createInstance(data) {
    return request.post('/workflows/instances', data)
  },
  runInstance(id) {
    return request.post(`/workflows/instances/${id}/run`)
  },
  pauseInstance(id) {
    return request.post(`/workflows/instances/${id}/pause`)
  },
  cancelInstance(id) {
    return request.post(`/workflows/instances/${id}/cancel`)
  },
  skipStep(instanceId, stepIndex) {
    return request.post(`/workflows/instances/${instanceId}/steps/${stepIndex}/skip`)
  },
  retryStep(instanceId, stepIndex) {
    return request.post(`/workflows/instances/${instanceId}/steps/${stepIndex}/retry`)
  },
  reviewStep(instanceId, stepIndex, data) {
    return request.post(`/workflows/instances/${instanceId}/steps/${stepIndex}/review`, data)
  },
}
