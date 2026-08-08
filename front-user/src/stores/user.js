import { createUserStore } from '@localmini/shared'

export const useUserStore = createUserStore({
  tokenKey: 'user_token',
  userKey: 'user_info',
  storeId: 'user'
})
