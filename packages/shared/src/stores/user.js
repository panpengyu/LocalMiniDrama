import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 创建用户 Store（按端隔离 token/user 存储 key）
 * @param {object} options
 * @param {string} options.tokenKey - localStorage token key
 * @param {string} options.userKey  - localStorage user info key
 * @param {string} options.storeId  - pinia store id（需唯一）
 */
export function createUserStore(options = {}) {
  const {
    tokenKey = 'token',
    userKey = 'user',
    storeId = 'user'
  } = options

  return defineStore(storeId, () => {
    const user = ref(null)
    const token = ref(localStorage.getItem(tokenKey) || null)

    const isLoggedIn = computed(() => !!token.value)
    const isAdmin = computed(() => user.value?.role === 'super_admin')

    function login(userData, tokenData) {
      user.value = userData
      token.value = tokenData
      localStorage.setItem(tokenKey, tokenData)
      localStorage.setItem(userKey, JSON.stringify(userData))
    }

    function logout() {
      user.value = null
      token.value = null
      localStorage.removeItem(tokenKey)
      localStorage.removeItem(userKey)
    }

    function loadUser() {
      const savedUser = localStorage.getItem(userKey)
      if (savedUser) {
        user.value = JSON.parse(savedUser)
      }
    }

    return {
      user,
      token,
      isLoggedIn,
      isAdmin,
      login,
      logout,
      loadUser
    }
  })
}
