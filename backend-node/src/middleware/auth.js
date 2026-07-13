const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { loadConfig } = require('../config');
const response = require('../response');

const JWT_SECRET = process.env.JWT_SECRET || 'localminidrama_jwt_secret_key_2026';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const config = loadConfig();
    const db = getDb(config.database);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = 1 AND deleted_at IS NULL').get(decoded.id);
    
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