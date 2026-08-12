'use strict';

/**
 * Sprint 12 - S12-T07 权限与安全增强服务
 *
 * 提供：
 *   1) 操作审计：记录管理端敏感操作（谁、何时、对什么、结果）→ operation_audit_logs
 *   2) 登录日志：记录登录成功/失败尝试（含 IP / UA / 失败原因）→ login_logs
 *   3) 数据脱敏：手机号 / 邮箱 / 身份证 / 银行卡等敏感字段掩码工具
 *   4) 字段级权限：根据角色决定是否返回/脱敏敏感字段
 *
 * 全部数据落 MySQL，无 mock。
 */

// ------------------------------------------------------------
// 数据脱敏工具
// ------------------------------------------------------------
function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s ? s.replace(/\d/g, '*') : s;
  return s.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at);
  const domain = s.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}${domain}`;
}

function maskIdCard(id) {
  const s = String(id || '');
  if (s.length < 8) return s;
  return s.replace(/^(.{4}).*(.{4})$/, '$1**********$2');
}

function maskBankCard(card) {
  const s = String(card || '').replace(/\s/g, '');
  if (s.length < 8) return s;
  return s.slice(0, 4) + ' **** **** ' + s.slice(-4);
}

/** 通用对象脱敏：按字段名规则掩码，返回浅拷贝 */
const SENSITIVE_MASKERS = {
  phone: maskPhone,
  mobile: maskPhone,
  email: maskEmail,
  id_card: maskIdCard,
  idcard: maskIdCard,
  bank_card: maskBankCard,
  bankcard: maskBankCard,
};

function maskObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const masker = SENSITIVE_MASKERS[k.toLowerCase()];
    if (masker && (typeof v === 'string' || typeof v === 'number')) out[k] = masker(v);
    else if (v && typeof v === 'object') out[k] = maskObject(v);
    else out[k] = v;
  }
  return out;
}

/**
 * 字段级权限：super_admin 可见明文，其余角色对敏感字段自动脱敏。
 * @param {object} row 数据行
 * @param {string} role 当前用户角色
 */
function applyFieldPermission(row, role) {
  if (role === 'super_admin') return row;
  return maskObject(row);
}

// ------------------------------------------------------------
// 操作审计
// ------------------------------------------------------------
function recordAudit(db, log, entry) {
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO operation_audit_logs
        (actor_id, actor_name, actor_role, action, method, path, target_type, target_id, status_code, ip, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.actorId || null,
      entry.actorName || null,
      entry.actorRole || null,
      entry.action || 'unknown',
      entry.method || null,
      entry.path ? String(entry.path).slice(0, 255) : null,
      entry.targetType || null,
      entry.targetId != null ? String(entry.targetId) : null,
      entry.statusCode || null,
      entry.ip || null,
      entry.detail ? JSON.stringify(maskObject(entry.detail)).slice(0, 4000) : null,
      now
    );
  } catch (err) {
    if (log) log.warn('[S12-T07] 操作审计写入失败', { error: err.message });
  }
}

function listAuditLogs(db, { actorId, action, keyword, page = 1, pageSize = 20 } = {}) {
  const where = [];
  const params = [];
  if (actorId) { where.push('actor_id = ?'); params.push(Number(actorId)); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (keyword) {
    where.push('(actor_name LIKE ? OR path LIKE ? OR action LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM operation_audit_logs ${whereSql}`).get(...params).c;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const items = db.prepare(
    `SELECT * FROM operation_audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  return { items, total, page: Number(page), pageSize: Number(pageSize) };
}

function auditStats(db) {
  const total = db.prepare('SELECT COUNT(*) c FROM operation_audit_logs').get().c;
  const byAction = db.prepare(
    `SELECT action, COUNT(*) c FROM operation_audit_logs GROUP BY action ORDER BY c DESC LIMIT 10`
  ).all();
  const failures = db.prepare(
    `SELECT COUNT(*) c FROM operation_audit_logs WHERE status_code >= 400`
  ).get().c;
  return { total, failures, by_action: byAction };
}

// ------------------------------------------------------------
// 登录日志
// ------------------------------------------------------------
function recordLogin(db, log, { userId, username, success, ip, userAgent, reason }) {
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO login_logs (user_id, username, success, ip, user_agent, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId || null,
      username ? String(username).slice(0, 128) : null,
      success ? 1 : 0,
      ip || null,
      userAgent ? String(userAgent).slice(0, 255) : null,
      reason ? String(reason).slice(0, 128) : null,
      now
    );
  } catch (err) {
    if (log) log.warn('[S12-T07] 登录日志写入失败', { error: err.message });
  }
}

function listLoginLogs(db, { username, success, page = 1, pageSize = 20 } = {}) {
  const where = [];
  const params = [];
  if (username) { where.push('username LIKE ?'); params.push(`%${username}%`); }
  if (success === 0 || success === 1) { where.push('success = ?'); params.push(success); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM login_logs ${whereSql}`).get(...params).c;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const items = db.prepare(
    `SELECT * FROM login_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  return { items, total, page: Number(page), pageSize: Number(pageSize) };
}

function loginStats(db, { days = 7 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const total = db.prepare('SELECT COUNT(*) c FROM login_logs WHERE created_at >= ?').get(since).c;
  const failed = db.prepare('SELECT COUNT(*) c FROM login_logs WHERE success = 0 AND created_at >= ?').get(since).c;
  const uniqueUsers = db.prepare('SELECT COUNT(DISTINCT user_id) c FROM login_logs WHERE success = 1 AND created_at >= ?').get(since).c;
  return { total, failed, success: total - failed, unique_users: uniqueUsers, days };
}

// ------------------------------------------------------------
// 审计中间件：对写操作（POST/PUT/DELETE/PATCH）在响应结束后落审计
// ------------------------------------------------------------
const AUDITED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** 从路径推断 action，如 POST /admin/finance/billing-rules → finance.billing-rules.create */
function inferAction(method, path) {
  const clean = String(path || '').replace(/^\/+/, '').split('?')[0];
  const verb = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] || 'op';
  const segs = clean.split('/').filter((s) => s && !/^\d+$/.test(s) && !s.startsWith(':'));
  const scope = segs.filter((s) => s !== 'admin' && s !== 'api' && s !== 'v1').slice(0, 3).join('.');
  return `${scope || clean}.${verb}`;
}

function auditMiddleware(db, log) {
  return function (req, res, next) {
    // 仅审计已登录用户对写接口的调用，且排除高频/无害路径
    if (!AUDITED_METHODS.has(req.method)) return next();
    const path = req.originalUrl || req.url || '';
    if (path.includes('/monitor/') || path.includes('/lifecycle/track')) return next();
    res.on('finish', () => {
      try {
        const user = req.user || {};
        // 未登录的写操作（如登录本身）不计入操作审计，由 login_logs 负责
        if (!user.id) return;
        recordAudit(db, log, {
          actorId: user.id,
          actorName: user.username,
          actorRole: user.role,
          action: inferAction(req.method, path),
          method: req.method,
          path,
          statusCode: res.statusCode,
          ip: req.ip || (req.headers || {})['x-forwarded-for'] || req.socket?.remoteAddress,
          detail: req.body && Object.keys(req.body).length ? req.body : null,
        });
      } catch (_) { /* 审计不可影响主流程 */ }
    });
    next();
  };
}

module.exports = {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskBankCard,
  maskObject,
  applyFieldPermission,
  recordAudit,
  listAuditLogs,
  auditStats,
  recordLogin,
  listLoginLogs,
  loginStats,
  auditMiddleware,
  inferAction,
};
