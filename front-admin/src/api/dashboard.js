import request from '@/utils/request'

// S18-T02 自定义仪表盘布局
export const dashboardAPI = {
  getLayout() {
    return request.get('/admin/dashboard/layout')
  },
  saveLayout(layout) {
    return request.post('/admin/dashboard/layout', { layout })
  },
  resetLayout() {
    return request.post('/admin/dashboard/layout/reset')
  }
}
