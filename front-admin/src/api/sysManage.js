import request from '@/utils/request'

/** S21 批C · 系统管理（管理员/角色/菜单/字典/参数/日志检索/问题排查） */
export const sysManageAPI = {
  admins: {
    list(params = {}) { return request.get('/admin/admins', { params }) },
    create(payload) { return request.post('/admin/admins', payload) },
    update(id, payload) { return request.put(`/admin/admins/${id}`, payload) },
    remove(id) { return request.delete(`/admin/admins/${id}`) }
  },
  roles: {
    list(params = {}) { return request.get('/admin/roles', { params }) },
    create(payload) { return request.post('/admin/roles', payload) },
    update(id, payload) { return request.put(`/admin/roles/${id}`, payload) },
    remove(id) { return request.delete(`/admin/roles/${id}`) }
  },
  menus: {
    list() { return request.get('/admin/menus') },
    create(payload) { return request.post('/admin/menus', payload) },
    update(id, payload) { return request.put(`/admin/menus/${id}`, payload) },
    remove(id) { return request.delete(`/admin/menus/${id}`) }
  },
  dict: {
    list(params = {}) { return request.get('/admin/dict', { params }) },
    create(payload) { return request.post('/admin/dict', payload) },
    update(id, payload) { return request.put(`/admin/dict/${id}`, payload) },
    remove(id) { return request.delete(`/admin/dict/${id}`) }
  },
  params: {
    list(params = {}) { return request.get('/admin/params', { params }) },
    create(payload) { return request.post('/admin/params', payload) },
    update(id, payload) { return request.put(`/admin/params/${id}`, payload) },
    remove(id) { return request.delete(`/admin/params/${id}`) }
  },
  logs: {
    search(params = {}) { return request.get('/admin/logs/search', { params }) }
  },
  troubleshoot: {
    diagnose(params = {}) { return request.get('/admin/troubleshoot/diagnose', { params }) }
  }
}

export default sysManageAPI
