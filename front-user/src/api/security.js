import request from '@/utils/request'

/**
 * S19-T03 账户安全 API
 *
 * 覆盖：
 *   2FA 绑定（TOTP）：获取密钥 / 校验启用 / 关闭
 *   修改密码（改后全部会话立即失效，需重新登录）
 *
 * 响应经全局拦截器已解包为 res.data（见 utils/request.js）。
 */
export const securityAPI = {
  // ---------- 2FA ----------
  setupTwoFa() {
    return request.get('/auth/2fa/setup')
  },
  verifyTwoFa(code) {
    return request.post('/auth/2fa/verify', { code })
  },
  disableTwoFa(code) {
    return request.post('/auth/2fa/disable', { code })
  },

  // ---------- 修改密码 ----------
  changePassword(oldPassword, newPassword) {
    return request.post('/auth/change-password', { oldPassword, newPassword })
  }
}

export default securityAPI
