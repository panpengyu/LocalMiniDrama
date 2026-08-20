const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { loadConfig } = require('../config');
const { mysqlNow } = require('../utils/datetime');
const response = require('../response');

// JWT 签名密钥：环境变量 > config.yaml(app.jwt_secret) > 开发默认值
const JWT_SECRET = process.env.JWT_SECRET || loadConfig().app?.jwt_secret || 'localminidrama_jwt_secret_key_2026';

// S16-T02 性能优化：用户查询内存缓存（30s TTL），避免每个请求同步查询 MySQL
// 缓存 key = `u${userId}`，value = { user, expiresAt }
const userCache = new Map();
const USER_CACHE_TTL = 30 * 1000;

function getUserCached(userId) {
  const hit = userCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.user;
  if (hit) userCache.delete(userId);
  try {
    const config = loadConfig();
    const db = getDb(config.database);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = 1 AND deleted_at IS NULL').get(userId);
    if (user) userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL });
    return user;
  } catch (_) {
    return null;
  }
}

/** S19-T04: 校验会话与令牌版本（强制下线/改密后立即失效）
 *  注意：sid 与 token_version 均走实时 DB 查询，绕过 userCache（30s TTL），
 *  保证管理员强制下线/用户改密后旧令牌立即失效，无缓存窗口期。 */
function checkSessionValidity(req, decoded, user) {
  try {
    const config = loadConfig();
    const db = getDb(config.database);
    // 1) 新令牌带 sid：核对 user_sessions 未 revoke 且未过期
    if (decoded.sid) {
      const row = db.prepare('SELECT revoked_at, expires_at FROM user_sessions WHERE id = ? AND user_id = ?')
        .get(decoded.sid, user.id);
      if (!row || row.revoked_at) return false;
      // 字符串比较（DATETIME 同格式同语义），避免驱动时区转换偏差
      if (row.expires_at && row.expires_at <= mysqlNow()) return false;
    }
    // 2) 令牌版本核对：token_version 不匹配（强制下线/改密/被踢）则失效
    if (decoded.v !== undefined) {
      const fresh = db.prepare('SELECT token_version FROM users WHERE id = ?').get(user.id);
      if (!fresh || fresh.token_version !== decoded.v) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserCached(decoded.id);

    if (user && checkSessionValidity(req, decoded, user)) {
      req.user = user;
      req.sessionId = decoded.sid || null;
    } else {
      req.user = null;
    }

    next();
  } catch (err) {
    req.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return response.unauthorized(res, '请先登录');
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return response.unauthorized(res, '请先登录');
    }

    if (!roles.includes(req.user.role)) {
      return response.forbidden(res, '权限不足');
    }

    next();
  };
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireRole
};
