'use strict';

/**
 * LocalMiniDrama 开放平台 API —— 错误类型定义（Sprint 15: S15-T04）
 *
 * 网关统一错误响应：{ code, message }
 *   - MISSING_API_KEY    缺少 API Key
 *   - INVALID_API_KEY    无效的 API Key
 *   - API_KEY_EXPIRED    密钥已过期
 *   - API_KEY_REVOKED    密钥已吊销
 *   - API_KEY_INACTIVE   密钥未启用
 *   - IP_DENIED          IP 不在白名单
 *   - SCOPE_NOT_ALLOWED  无对应权限范围
 *   - RATE_LIMITED       超过分钟限流
 *   - DAILY_QUOTA_EXCEEDED  超过当日配额
 */

class OpenApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code   业务错误码
   * @param {string} message 错误说明
   */
  constructor(status, code, message) {
    super(`[${status}] ${code}: ${message}`);
    this.name = 'OpenApiError';
    this.status = status;
    this.code = code;
    this.isOpenApiError = true;
  }
}

function isOpenApiError(err) {
  return err instanceof OpenApiError || (err && err.isOpenApiError === true);
}

module.exports = { OpenApiError, isOpenApiError };
