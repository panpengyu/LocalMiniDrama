import request from '@/utils/request'

/**
 * 智能剪辑 API（Sprint 7 S7-T05/T07/T08）
 * 对接后端 /api/v1/ai/edit
 */
export const editAPI = {
  /** 智能剪辑：自动拼接+转场+节奏匹配 */
  autoEdit(data) {
    return request.post('/ai/edit/auto', data)
  },
  /** 列出剪辑任务 */
  listTasks(params = {}) {
    return request.get('/ai/edit/tasks', { params })
  },
  /** 获取剪辑任务详情 */
  getTask(id) {
    return request.get(`/ai/edit/tasks/${id}`)
  },
  /** 列出可用转场效果 */
  listTransitions() {
    return request.get('/ai/edit/transitions')
  },
  /** 配音与视频自动对齐 */
  alignAudio(data) {
    return request.post('/ai/edit/align', data)
  },
  /** 获取对齐记录 */
  getAlignLogs(params = {}) {
    return request.get('/ai/edit/align-logs', { params })
  },
}
