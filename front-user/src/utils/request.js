import { createRequest } from '@localmini/shared'

const request = createRequest({
  baseURL: '/api/v1',
  tokenKey: 'user_token',
  userKey: 'user_info',
  loginPath: '/login'
})

export default request
