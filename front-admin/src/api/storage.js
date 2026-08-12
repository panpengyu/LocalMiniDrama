import request from '@/utils/request'

/**
 * Sprint 12 - S12-T03 存储管理 API 封装
 * 所有接口走 /api/v1/admin/storage/*（后端 requireAuth + requireRole(['super_admin'])）
 */
export const storageAPI = {
  // 分页列出存储对象
  listObjects(params = {}) {
    return request.get('/admin/storage/objects', { params })
  },
  // 存储统计（按后端 / 生命周期 / 总计）
  getStats() {
    return request.get('/admin/storage/stats')
  },
  // 当前存储后端健康检查
  health() {
    return request.get('/admin/storage/health')
  },
  // 生命周期扫描（超期未访问 → 归档）
  lifecycleScan(archiveDays = 90) {
    return request.post('/admin/storage/lifecycle-scan', { archive_days: archiveDays })
  },
  // 逻辑删除对象记录
  deleteObject(id) {
    return request.delete(`/admin/storage/objects/${id}`)
  }
}

export default storageAPI
