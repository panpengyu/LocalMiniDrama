/**
 * 统一响应模块
 * 
 * 与 Go 端 pkg/response 保持一致，方便前端复用。
 * 提供统一的响应格式，包含 success 状态、数据/错误信息和时间戳。
 * 
 * 响应格式：
 * {
 *   success: boolean,
 *   data?: any,           // 成功时返回的数据
 *   error?: {             // 失败时返回的错误信息
 *     code: string,
 *     message: string,
 *     details?: any
 *   },
 *   timestamp: string     // ISO 格式时间戳
 * }
 */

/**
 * 基础响应函数
 * 
 * @param {object} res - Express Response 对象
 * @param {number} statusCode - HTTP 状态码
 * @param {object} body - 响应体内容
 */
function send(res, statusCode, body) {
  const payload = {
    ...body,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(payload);
}

/**
 * 成功响应（HTTP 200）
 * 
 * @param {object} res - Express Response 对象
 * @param {any} data - 响应数据
 */
function success(res, data) {
  send(res, 200, { success: true, data });
}

/**
 * 创建成功响应（HTTP 201）
 * 
 * @param {object} res - Express Response 对象
 * @param {any} data - 响应数据
 */
function created(res, data) {
  send(res, 201, { success: true, data });
}

/**
 * 分页成功响应（HTTP 200）
 * 
 * @param {object} res - Express Response 对象
 * @param {Array} items - 数据列表
 * @param {number} total - 总记录数
 * @param {number} page - 当前页码（从 1 开始）
 * @param {number} pageSize - 每页大小
 */
function successWithPagination(res, items, total, page, pageSize) {
  const totalPages = Math.ceil(total / pageSize) || 0;
  send(res, 200, {
    success: true,
    data: {
      items,
      pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    },
  });
}

/**
 * 错误响应
 * 
 * @param {object} res - Express Response 对象
 * @param {number} statusCode - HTTP 状态码
 * @param {string} code - 错误代码
 * @param {string} message - 错误消息
 * @param {any} details - 错误详情（可选）
 */
function error(res, statusCode, code, message, details) {
  send(res, statusCode, {
    success: false,
    error: { code, message, ...(details && { details }) },
  });
}

/**
 * 客户端错误响应（HTTP 400）
 * 
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息
 */
function badRequest(res, message) {
  error(res, 400, 'BAD_REQUEST', message);
}

/**
 * 资源未找到响应（HTTP 404）
 * 
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息
 */
function notFound(res, message) {
  error(res, 404, 'NOT_FOUND', message);
}

/**
 * 权限不足响应（HTTP 403）
 * 
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息
 */
function forbidden(res, message) {
  error(res, 403, 'FORBIDDEN', message);
}

/**
 * 资源冲突响应（HTTP 409）
 *
 * 用于并发写冲突（如乐观锁 CAS 失败），提示客户端刷新后重试。
 *
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息（默认：资源冲突）
 */
function conflict(res, message) {
  error(res, 409, 'CONFLICT', message || '资源冲突，请刷新后重试');
}

/**
 * 未授权响应（HTTP 401）
 * 
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息（默认：未授权）
 */
function unauthorized(res, message) {
  error(res, 401, 'UNAUTHORIZED', message || '未授权');
}

/**
 * 服务器错误响应（HTTP 500）
 * 
 * @param {object} res - Express Response 对象
 * @param {string} message - 错误消息（默认：服务器错误）
 */
function internalError(res, message) {
  error(res, 500, 'INTERNAL_ERROR', message || '服务器错误');
}

// 导出所有响应函数
module.exports = {
  success,
  created,
  successWithPagination,
  error,
  badRequest,
  notFound,
  forbidden,
  conflict,
  unauthorized,
  internalError,
};