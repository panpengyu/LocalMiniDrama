import { createRequest } from '@localmini/shared'

const request = createRequest({
  baseURL: '/api/v1',
  tokenKey: 'admin_token',
  userKey: 'admin_info',
  loginPath: '/login'
})

export default request
