/**
 * 认证路由模块
 *
 * 处理用户注册、登录（含 2FA 两步验证）、登出、2FA 绑定与修改密码等接口。
 *
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 认证路由处理函数集合
 */
const response = require('../response');
const authService = require('../services/authService');
const sessionService = require('../services/sessionService');
const { requireAuth } = require('../middleware/auth');

function clientIp(req) {
  return (req.headers || {})['x-forwarded-for'] || req.ip || (req.socket && req.socket.remoteAddress);
}

function authRoutes(db, log) {
  /**
   * 用户注册接口
   */
  async function register(req, res) {
    try {
      const { phone, password, nickname } = req.body || {};
      const result = await authService.register(db, {
        phone, password, nickname, ip: clientIp(req), userAgent: (req.headers || {})['user-agent'],
      });
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
   * 用户登录接口（策略启用时含锁定/白名单检查；用户启用 2FA 时返回临时凭证）
   */
  async function login(req, res) {
    const ip = clientIp(req);
    const userAgent = (req.headers || {})['user-agent'];
    let securityService;
    try { securityService = require('../services/securityService'); } catch (_) { securityService = null; }
    try {
      const { username, password } = req.body || {};
      const result = await authService.login(db, { username, password, ip, userAgent });

      // 密码校验通过（含等待 2FA 二次验证）→ 记录登录成功日志
      if (securityService) {
        securityService.recordLogin(db, log, {
          userId: result.user.id, username: result.user.username, success: true, ip, userAgent,
        });
      }
      try {
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), result.user.id);
      } catch (_) { /* last_login_at 列缺失时忽略 */ }

      if (result.needTwoFa) {
        // 需要第二步动态码验证
        return response.success(res, {
          user: result.user,
          needTwoFa: true,
          tempToken: result.tempToken,
          message: '请输入验证器动态码完成登录'
        });
      }
      response.success(res, {
        user: result.user,
        token: result.token,
        needTwoFa: false,
        message: '登录成功'
      });
    } catch (err) {
      // 记录登录失败日志（含失败原因，用于安全审计）
      if (securityService) {
        securityService.recordLogin(db, log, {
          username: (req.body || {}).username, success: false, ip, userAgent, reason: err.message,
        });
      }
      log.error('auth/login', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 2FA 第二步登录：临时凭证 + 动态码换正式令牌
   */
  async function login2fa(req, res) {
    try {
      const { tempToken, code } = req.body || {};
      const result = await authService.verifyTwoFaLogin(db, {
        tempToken, code, ip: clientIp(req), userAgent: (req.headers || {})['user-agent'],
      });
      try {
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), result.user.id);
      } catch (_) { /* 容错 */ }
      response.success(res, { user: result.user, token: result.token, needTwoFa: false, message: '验证成功，登录完成' });
    } catch (err) {
      log.error('auth/login2fa', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 用户登出接口（撤销当前会话，立即失效）
   */
  async function logout(req, res) {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const decoded = token ? authService.verifyToken(token) : null;
      if (decoded && decoded.sid) {
        sessionService.revokeSession(db, decoded.sid, decoded.id);
      }
      response.success(res, { message: '退出成功' });
    } catch (err) {
      log.error('auth/logout', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 获取用户信息接口
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

  /**
   * 获取 2FA 绑定密钥（含 otpauth URI，供二维码/手动输入）
   */
  async function twoFaSetup(req, res) {
    try {
      const { secret, uri } = authService.setupTwoFa(db, req.user.id);
      response.success(res, { secret, uri });
    } catch (err) {
      log.error('auth/2fa/setup', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 校验动态码并启用 2FA
   */
  async function twoFaVerify(req, res) {
    try {
      const { code } = req.body || {};
      const result = authService.enableTwoFa(db, req.user.id, code);
      response.success(res, { ...result, message: '两步验证已启用' });
    } catch (err) {
      log.error('auth/2fa/verify', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 校验动态码并关闭 2FA
   */
  async function twoFaDisable(req, res) {
    try {
      const { code } = req.body || {};
      const result = authService.disableTwoFa(db, req.user.id, code);
      response.success(res, { ...result, message: '两步验证已关闭' });
    } catch (err) {
      log.error('auth/2fa/disable', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  /**
   * 修改密码（改后旧会话全部失效）
   */
  async function changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body || {};
      await authService.changePassword(db, req.user.id, { oldPassword, newPassword });
      response.success(res, { message: '密码修改成功，请重新登录' });
    } catch (err) {
      log.error('auth/change-password', { error: err.message });
      response.badRequest(res, err.message);
    }
  }

  return {
    register, login, login2fa, logout, profile,
    twoFaSetup, twoFaVerify, twoFaDisable, changePassword,
  };
}

module.exports = authRoutes;
