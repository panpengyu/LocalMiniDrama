import { createUserStore } from '@localmini/shared'

export const useAdminUserStore = createUserStore({
  tokenKey: 'admin_token',
  userKey: 'admin_info',
  storeId: 'admin-user'
})
