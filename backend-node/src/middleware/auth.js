const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { loadConfig } = require('../config');
const response = require('../response');

const JWT_SECRET = process.env.JWT_SECRET || 'localminidrama_jwt_secret_key_2026';

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
    
    if (user) {
      req.user = user;
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