/**
 * 认证路由模块
 * 
 * 处理用户注册、登录、登出和用户信息获取等认证相关的API请求。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 认证路由处理函数集合
 */
const response = require('../response');
const authService = require('../services/authService');

function authRoutes(db, log) {
  /**
   * 用户注册接口
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.phone - 用户手机号（11位）
   * @param {string} req.body.password - 用户密码（至少6位）
   * @param {string} [req.body.nickname] - 用户昵称
   * @returns {object} 注册成功返回用户信息和token
   */
  async function register(req, res) {
    try {
      const { phone, password, nickname } = req.body || {};
      const result = await authService.register(db, { phone, password, nickname });
      response.success(res, {
        user: result.user,
        token: result.token,
        message: '注册成功'
      });
    } catch (err) {
      log.error('auth/register', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 用户登录接口
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.username - 用户名或手机号
   * @param {string} req.body.password - 用户密码
   * @returns {object} 登录成功返回用户信息和token
   */
  async function login(req, res) {
    const clientIp = req.ip || (req.headers || {})['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = (req.headers || {})['user-agent'];
    let securityService;
    try { securityService = require('../services/securityService'); } catch (_) { securityService = null; }
    try {
      const { username, password } = req.body || {};
      const result = await authService.login(db, { username, password });
      // S12-T07: 记录登录成功日志 + 更新最近登录时间
      if (securityService) {
        securityService.recordLogin(db, log, {
          userId: result.user.id, username: result.user.username, success: true, ip: clientIp, userAgent,
        });
      }
      try {
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), result.user.id);
      } catch (_) { /* last_login_at 列缺失时忽略 */ }
      response.success(res, {
        user: result.user,
        token: result.token,
        message: '登录成功'
      });
    } catch (err) {
      // S12-T07: 记录登录失败日志（含失败原因，用于安全审计）
      if (securityService) {
        securityService.recordLogin(db, log, {
          username: (req.body || {}).username, success: false, ip: clientIp, userAgent, reason: err.message,
        });
      }
      log.error('auth/login', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 用户登出接口
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @returns {object} 返回登出成功消息
   */
  async function logout(req, res) {
    try {
      response.success(res, { message: '退出成功' });
    } catch (err) {
      log.error('auth/logout', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 获取用户信息接口
   * 
   * 通过解析请求头中的Bearer Token获取当前登录用户信息。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.headers.authorization - Bearer Token
   * @returns {object} 返回用户详细信息
   */
  async function profile(req, res) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return response.unauthorized(res, '请先登录');
      }
      
      const decoded = authService.verifyToken(token);
      if (!decoded) {
        return response.unauthorized(res, '登录已过期');
      }
      
      const user = await authService.getUserById(db, decoded.id);
      if (!user) {
        return response.unauthorized(res, '用户不存在');
      }
      
      response.success(res, user);
    } catch (err) {
      log.error('auth/profile', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  return { register, login, logout, profile };
}

module.exports = authRoutes;