'use strict';

/**
 * Sprint 15 - S15-T01 API Key 管理系统
 *
 * 职责：
 *   - 开发者应用（api_apps）：申请创建 / 列表查询 / 管理端审批（通过/驳回）
 *   - API 密钥（api_keys）：生成（明文仅返回一次，落库只存 SHA-256 哈希）/ 列表
 *     / 吊销 / 续期；权限范围（scopes）校验与 IP 白名单管理
 *   - 网关鉴权辅助：按明文密钥哈希查找密钥、校验有效期/状态/权限范围
 *
 * 设计原则：
 *   - 密钥明文绝不落库：api_keys.key_hash = SHA-256(secret)，key_prefix = 明文前 8 位
 *     用于控制台展示识别；明文仅在同一事务内返回一次
 *   - 权限范围（API_SCOPES）为白名单常量：申请时校验，网关调用时校验
 *   - 应用与密钥均支持软删除，全部状态流转留痕（updated_at / revoked_at / deleted_at）
 *   - 数据存储：全部落地本地 MySQL（api_apps / api_keys），无 mock
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 常量：权限范围白名单（S15-T01 权限范围控制 + S15-T03 端点按 scope 鉴权）
// ---------------------------------------------------------------------------
const API_SCOPES = {
  // 项目管理（S15-T03 开放 API：项目列表/详情）
  DRAMA_READ: 'drama:read',
  // 项目创建/更新
  DRAMA_WRITE: 'drama:write',
  // 剧本生成（大纲/角色/分镜/对白）
  SCREENPLAY_GENERATE: 'screenplay:generate',
  // 图片生成
  IMAGE_GENERATE: 'image:generate',
  // 素材查询
  ASSET_READ: 'asset:read',
};

const ALL_SCOPES = Object.values(API_SCOPES);

/** 密钥状态 */
const KEY_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

/** 应用状态 */
const APP_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/** 默认值 */
const DEFAULTS = {
  RATE_LIMIT_PER_MIN: 60,
  DAILY_QUOTA: 1000,
  EXPIRES_IN_DAYS: 365,
  MAX_SCOPES: 20,
  KEY_LENGTH: 32, // 明文密钥随机字节数（hex 后 64 字符）
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 生成业务 ID：前缀 + 时间戳 + 随机。 */
function genId(prefix) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${ts}${rand}`;
}

/** 生成明文 API 密钥：lmd_ + 64 位十六进制（256 bit 熵）。 */
function generateKeySecret() {
  return `lmd_${crypto.randomBytes(DEFAULTS.KEY_LENGTH).toString('hex')}`;
}

/** SHA-256 哈希（用于密钥落库与比对）。 */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 解析 JSON 列（兼容 MySQL JSON / TEXT / 已是对象）。 */
function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

/** 序列化 JSON 列。 */
function stringifyJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (_) { return null; }
}

/** 是否合法 IP（IPv4 / IPv6 均可，含带 * 通配的网段前缀，如 192.168.1.*）。 */
function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  return /^[0-9a-fA-F:.\[\]*]+$/.test(ip);
}

/** 校验权限范围数组：全部为白名单内、无重复。返回 {ok, reason}。 */
function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { ok: false, reason: 'scopes 不能为空' };
  }
  if (scopes.length > DEFAULTS.MAX_SCOPES) {
    return { ok: false, reason: `scopes 数量不能超过 ${DEFAULTS.MAX_SCOPES}` };
  }
  const unique = new Set();
  for (const s of scopes) {
    if (typeof s !== 'string' || !ALL_SCOPES.includes(s)) {
      return { ok: false, reason: `非法的权限范围: ${s}` };
    }
    unique.add(s);
  }
  if (unique.size !== scopes.length) {
    return { ok: false, reason: 'scopes 存在重复项' };
  }
  return { ok: true, scopes: Array.from(unique) };
}

/** 校验 IP 白名单数组。 */
function validateIpWhitelist(ips) {
  if (ips == null || (Array.isArray(ips) && ips.length === 0)) {
    return { ok: true, list: [] };
  }
  if (!Array.isArray(ips)) return { ok: false, reason: 'ipWhitelist 必须是数组' };
  for (const ip of ips) {
    if (!isValidIp(ip)) return { ok: false, reason: `非法 IP: ${ip}` };
  }
  return { ok: true, list: Array.from(new Set(ips)) };
}

/** 校验客户端 IP 是否命中白名单（支持精确、通配 *、CIDR）。 */
function ipMatches(ip, whitelist) {
  if (!ip || !Array.isArray(whitelist) || whitelist.length === 0) return true;
  const normalize = (s) => String(s).replace(/^::ffff:/, '');
  const client = normalize(ip);
  for (const rule of whitelist) {
    const r = normalize(rule);
    // 精确匹配
    if (r === client) return true;
    // 通配 *（如 192.168.1.*）
    if (r.includes('*')) {
      const re = new RegExp(`^${r.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[0-9a-fA-F:.]*')}$`);
      if (re.test(client)) return true;
    }
    // CIDR（IPv4）
    if (r.includes('/')) {
      const [net, bitsRaw] = r.split('/');
      const bits = parseInt(bitsRaw, 10);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      if (client.includes(':') || net.includes(':')) continue; // IPv6 CIDR 暂不展开
      const toInt = (addr) => addr.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if (((toInt(client) & mask) >>> 0) === ((toInt(net) & mask) >>> 0)) return true;
    }
  }
  return false;
}

/** 将密钥行脱敏：只暴露前缀与元数据。 */
function maskKey(row) {
  if (!row) return null;
  const { key_hash, ...safe } = row; // 永不外泄哈希
  return safe;
}

// ---------------------------------------------------------------------------
// S15-T01-1 开发者应用（api_apps）
// ---------------------------------------------------------------------------

/**
 * 申请创建开发者应用。
 * @returns {object} 应用行（含 app_id）
 */
function createApp(db, log, { userId, name, description } = {}) {
  const uid = Number(userId);
  if (!uid) { const e = new Error('缺少用户ID'); e.code = 'UNAUTHORIZED'; throw e; }
  if (!name || !String(name).trim()) { const e = new Error('应用名称必填'); e.code = 'EMPTY_APP_NAME'; throw e; }
  const appName = String(name).trim();
  if (appName.length > 128) { const e = new Error('应用名称过长'); e.code = 'APP_NAME_TOO_LONG'; throw e; }

  const appId = genId('lmd_app');
  db.prepare(
    `INSERT INTO api_apps (app_id, user_id, name, description, status)
     VALUES (?, ?, ?, ?, ?)`
  ).run(appId, uid, appName, description ? String(description) : null, APP_STATUS.PENDING);

  const row = db.prepare('SELECT * FROM api_apps WHERE app_id = ?').get(appId);
  if (log?.info) log.info(`[API] 开发者应用已创建 app=${appId} user=${uid}`);
  return row;
}

/** 查询某个用户的开发者应用列表（不含已软删除）。 */
function listApps(db, log, { userId } = {}) {
  const uid = Number(userId);
  if (!uid) return [];
  return db.prepare(
    `SELECT * FROM api_apps
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`
  ).all(uid);
}

/** 查询单个应用（校验归属）。 */
function getApp(db, log, { appId, userId } = {}) {
  const row = db.prepare('SELECT * FROM api_apps WHERE app_id = ? AND deleted_at IS NULL').get(String(appId));
  if (!row) { const e = new Error('应用不存在'); e.code = 'APP_NOT_FOUND'; throw e; }
  if (userId && Number(row.user_id) !== Number(userId)) {
    const e = new Error('无权访问该应用'); e.code = 'APP_FORBIDDEN'; throw e;
  }
  return row;
}

/**
 * 管理端审批应用。
 * @param {object} opts { appId, approve:boolean, reason?:string, adminId }
 */
function reviewApp(db, log, { appId, approve, reason, adminId } = {}) {
  const app = db.prepare('SELECT * FROM api_apps WHERE app_id = ? AND deleted_at IS NULL').get(String(appId));
  if (!app) { const e = new Error('应用不存在'); e.code = 'APP_NOT_FOUND'; throw e; }
  if (app.status !== APP_STATUS.PENDING) {
    const e = new Error(`应用当前状态为 ${app.status}，不可重复审批`);
    e.code = 'APP_NOT_PENDING'; throw e;
  }
  const approveFlag = Boolean(approve);
  const status = approveFlag ? APP_STATUS.APPROVED : APP_STATUS.REJECTED;
  db.prepare(
    `UPDATE api_apps SET status = ?, reject_reason = ? WHERE app_id = ?`
  ).run(status, approveFlag ? null : (reason ? String(reason) : '未通过审核'), app.app_id);
  if (log?.info) log.info(`[API] 应用审批 app=${app.app_id} -> ${status} admin=${adminId || '-'}`);
  return db.prepare('SELECT * FROM api_apps WHERE app_id = ?').get(app.app_id);
}

/** 管理端分页查询应用（支持状态过滤）。 */
function listAppsAdmin(db, log, { status, keyword, page = 1, pageSize = 20 } = {}) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  if (status && Object.values(APP_STATUS).includes(status)) {
    where.push('status = ?'); params.push(status);
  }
  if (keyword && String(keyword).trim()) {
    where.push('(name LIKE ? OR app_id LIKE ?)');
    const kw = `%${String(keyword).trim()}%`;
    params.push(kw, kw);
  }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM api_apps WHERE ${whereSql}`).get(...params).c;
  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const offset = Math.max((Number(page) || 1) - 1, 0) * limit;
  const rows = db.prepare(
    `SELECT * FROM api_apps WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { total, page: Number(page) || 1, pageSize: limit, items: rows };
}

// ---------------------------------------------------------------------------
// S15-T01-2 API 密钥（api_keys）
// ---------------------------------------------------------------------------

/**
 * 生成 API 密钥。
 * @param {object} opts { userId, appId, name?, scopes[], rateLimitPerMin?, dailyQuota?,
 *                        ipWhitelist?:string[], expiresInDays? }
 * @returns {{key: {id,key_id,key_prefix,scopes,...}, secret: string}} secret 仅此一次返回
 */
function createKey(db, log, opts = {}) {
  const { userId, appId, name } = opts;
  const uid = Number(userId);
  if (!uid) { const e = new Error('缺少用户ID'); e.code = 'UNAUTHORIZED'; throw e; }

  // 应用必须存在且属于该用户
  const app = getApp(db, log, { appId, userId: uid });
  if (app.status !== APP_STATUS.APPROVED) {
    const e = new Error(`应用需审批通过后才能创建密钥（当前 ${app.status}）`);
    e.code = 'APP_NOT_APPROVED'; throw e;
  }

  // 权限范围校验
  const scopeCheck = validateScopes(opts.scopes);
  if (!scopeCheck.ok) { const e = new Error(scopeCheck.reason); e.code = 'INVALID_SCOPES'; throw e; }

  // IP 白名单校验
  const ipCheck = validateIpWhitelist(opts.ipWhitelist);
  if (!ipCheck.ok) { const e = new Error(ipCheck.reason); e.code = 'INVALID_IP_WHITELIST'; throw e; }

  // 数值参数
  const rateLimitPerMin = Number(opts.rateLimitPerMin);
  const finalRate = Number.isInteger(rateLimitPerMin) && rateLimitPerMin > 0
    ? rateLimitPerMin : DEFAULTS.RATE_LIMIT_PER_MIN;
  const dailyQuota = Number(opts.dailyQuota);
  const finalQuota = Number.isInteger(dailyQuota) && dailyQuota > 0
    ? dailyQuota : DEFAULTS.DAILY_QUOTA;
  const expiresInDays = Number(opts.expiresInDays);
  const finalDays = Number.isInteger(expiresInDays) && expiresInDays > 0
    ? expiresInDays : DEFAULTS.EXPIRES_IN_DAYS;

  // 生成密钥与过期时间
  const secret = generateKeySecret();
  const keyHash = sha256(secret);
  const keyPrefix = secret.slice(0, 8);
  const keyId = genId('lmd_key');
  const expiresAt = new Date(Date.now() + finalDays * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  db.prepare(
    `INSERT INTO api_keys
       (key_id, app_id, user_id, name, key_hash, key_prefix, scopes, status,
        ip_whitelist, rate_limit_per_min, daily_quota, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    keyId, app.app_id, uid,
    name ? String(name).trim() : null,
    keyHash, keyPrefix,
    stringifyJson(scopeCheck.scopes),
    KEY_STATUS.ACTIVE,
    stringifyJson(ipCheck.list),
    finalRate, finalQuota, expiresAt
  );

  const row = db.prepare('SELECT * FROM api_keys WHERE key_id = ?').get(keyId);
  if (log?.info) log.info(`[API] 密钥已生成 key=${keyId} app=${app.app_id} user=${uid} scopes=${JSON.stringify(scopeCheck.scopes)}`);
  return { key: maskKey(row), secret };
}

/** 查询某用户（或某应用下）的密钥列表，脱敏返回。 */
function listKeys(db, log, { userId, appId } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  if (appId) { where.push('app_id = ?'); params.push(String(appId)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM api_keys ${whereSql} ORDER BY created_at DESC`
  ).all(...params);
  return rows.map(maskKey);
}

/** 查询单个密钥（校验归属），脱敏返回。 */
function getKey(db, log, { keyId, userId } = {}) {
  const row = db.prepare('SELECT * FROM api_keys WHERE key_id = ?').get(String(keyId));
  if (!row) { const e = new Error('密钥不存在'); e.code = 'KEY_NOT_FOUND'; throw e; }
  if (userId && Number(row.user_id) !== Number(userId)) {
    const e = new Error('无权访问该密钥'); e.code = 'KEY_FORBIDDEN'; throw e;
  }
  return row;
}

/**
 * 吊销密钥（仅 active 可吊销）。
 */
function revokeKey(db, log, { keyId, userId, reason } = {}) {
  const row = getKey(db, log, { keyId, userId });
  if (row.status !== KEY_STATUS.ACTIVE) {
    const e = new Error(`密钥当前状态为 ${row.status}，不可吊销`);
    e.code = 'KEY_NOT_ACTIVE'; throw e;
  }
  db.prepare(
    `UPDATE api_keys SET status = ?, revoked_at = NOW(), revoked_reason = ? WHERE key_id = ?`
  ).run(KEY_STATUS.REVOKED, reason ? String(reason) : '手动吊销', row.key_id);
  if (log?.info) log.info(`[API] 密钥已吊销 key=${row.key_id} user=${userId || '-'}`);
  return getKey(db, log, { keyId });
}

/**
 * 续期密钥（延长过期时间，active 或 expired 均可续期；吊销不可）。
 * @param {object} opts { keyId, userId, days }
 */
function renewKey(db, log, { keyId, userId, days } = {}) {
  const row = getKey(db, log, { keyId, userId });
  if (row.status === KEY_STATUS.REVOKED) {
    const e = new Error('已吊销的密钥不可续期'); e.code = 'KEY_REVOKED'; throw e;
  }
  const extraDays = Number(days);
  const addDays = Number.isInteger(extraDays) && extraDays > 0 ? extraDays : DEFAULTS.EXPIRES_IN_DAYS;
  const base = row.expires_at && row.status === KEY_STATUS.EXPIRED
    ? new Date(row.expires_at.replace(' ', 'T')) : new Date();
  const newExpires = new Date(Math.max(Date.now(), base.getTime()) + addDays * 24 * 3600 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(
    `UPDATE api_keys SET status = ?, expires_at = ? WHERE key_id = ?`
  ).run(KEY_STATUS.ACTIVE, newExpires, row.key_id);
  if (log?.info) log.info(`[API] 密钥已续期 key=${row.key_id} +${addDays}d -> ${newExpires}`);
  return getKey(db, log, { keyId });
}

// ---------------------------------------------------------------------------
// S15-T01-3 网关鉴权辅助（供 S15-T02 API 网关中间件调用）
// ---------------------------------------------------------------------------

/**
 * 按明文密钥查找并校验密钥（哈希比对 + 状态 + 过期）。
 * @returns {{ ok:true, key:完整密钥行 } | { ok:false, code:string, message:string }}
 */
function verifyKeySecret(db, log, secret) {
  if (!secret || typeof secret !== 'string' || !secret.startsWith('lmd_')) {
    return { ok: false, code: 'INVALID_KEY', message: '无效的 API Key 格式' };
  }
  const hash = sha256(secret);
  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash);
  if (!row) {
    return { ok: false, code: 'INVALID_KEY', message: 'API Key 不存在或已失效' };
  }
  if (row.status === KEY_STATUS.REVOKED) {
    return { ok: false, code: 'KEY_REVOKED', message: 'API Key 已被吊销' };
  }
  if (row.status !== KEY_STATUS.ACTIVE) {
    return { ok: false, code: 'KEY_INACTIVE', message: `API Key 状态异常(${row.status})` };
  }
  if (row.expires_at && new Date(row.expires_at.replace(' ', 'T')).getTime() < Date.now()) {
    // 已过期：落库标记 expired
    db.prepare(`UPDATE api_keys SET status = ? WHERE key_id = ?`)
      .run(KEY_STATUS.EXPIRED, row.key_id);
    return { ok: false, code: 'KEY_EXPIRED', message: 'API Key 已过期，请续期后重试' };
  }
  return { ok: true, key: row };
}

/**
 * 校验密钥是否拥有指定权限范围。
 */
function keyHasScope(key, scope) {
  if (!key) return false;
  const scopes = parseJson(key.scopes, []);
  return Array.isArray(scopes) && scopes.includes(scope);
}

/**
 * 校验客户端 IP 是否被密钥白名单允许（空白名单=不限制）。
 */
function keyAllowsIp(key, ip) {
  if (!key) return false;
  const whitelist = parseJson(key.ip_whitelist, []);
  return ipMatches(ip, whitelist);
}

// ---------------------------------------------------------------------------
// S15-T05 开发者控制台统计（基于 api_call_logs / api_daily_usage 实时聚合）
// ---------------------------------------------------------------------------

/**
 * 调用概览：总调用 / 今日调用 / 今日错误 / 各密钥配额使用率。
 * @param {object} opts { userId }
 */
function getCallOverview(db, log, { userId } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const total = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs WHERE user_id = ?').get(Number(userId)).c;
  const todayCalls = db.prepare(
    'SELECT COUNT(*) AS c FROM api_call_logs WHERE user_id = ? AND DATE(created_at) = ?'
  ).get(Number(userId), today).c;
  const todayErrors = db.prepare(
    'SELECT COUNT(*) AS c FROM api_call_logs WHERE user_id = ? AND DATE(created_at) = ? AND status_code >= 400'
  ).get(Number(userId), today).c;

  const usageRows = db.prepare(
    `SELECT du.key_id, du.app_id, du.call_count, du.error_count, du.quota_limit,
            COALESCE(k.name, '') AS key_name
     FROM api_daily_usage du
     LEFT JOIN api_keys k ON k.key_id = du.key_id
     WHERE du.usage_date = ? AND du.app_id IN (
       SELECT app_id FROM api_apps WHERE user_id = ?
     )`
  ).all(today, Number(userId));

  const quota_usage = usageRows.map((u) => ({
    key_id: u.key_id,
    app_id: u.app_id,
    key_name: u.key_name,
    call_count: u.call_count,
    error_count: u.error_count,
    quota_limit: u.quota_limit,
    usage_rate: u.quota_limit > 0 ? Number(((u.call_count / u.quota_limit) * 100).toFixed(2)) : 0,
  }));

  return { total_calls: total, today_calls: todayCalls, today_errors: todayErrors, quota_usage };
}

/**
 * 调用趋势：近 N 天（默认 7，最大 30）每日调用/失败数。
 * @param {object} opts { userId, days }
 */
function getCallTrend(db, log, { userId, days = 7 } = {}) {
  const n = Math.min(Math.max(Number(days) || 7, 1), 30);
  const rows = db.prepare(
    `SELECT DATE(created_at) AS day, COUNT(*) AS calls,
            SUM(status_code >= 400) AS errors
     FROM api_call_logs
     WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day ASC`
  ).all(Number(userId), n);
  return {
    days: n,
    points: rows.map((r) => ({
      date: r.day, calls: r.calls, errors: Number(r.errors) || 0,
    })),
  };
}

/**
 * 错误日志：最近失败调用（分页）。
 * @param {object} opts { userId, keyId?, page?, pageSize? }
 */
function getErrorLogs(db, log, { userId, keyId, page = 1, pageSize = 20 } = {}) {
  const p = Math.max(Number(page) || 1, 1);
  const ps = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const offset = (p - 1) * ps;
  const where = keyId
    ? 'user_id = ? AND key_id = ? AND status_code >= 400'
    : 'user_id = ? AND status_code >= 400';
  const args = keyId ? [Number(userId), String(keyId)] : [Number(userId)];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM api_call_logs WHERE ${where}`).get(...args).c;
  const list = db.prepare(
    `SELECT id, app_id, key_id, endpoint, method, scope, status_code, error_code, ip, latency_ms, created_at
     FROM api_call_logs WHERE ${where}
     ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, ps, offset);
  return { items: list, total, page: p, pageSize: ps };
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
module.exports = {
  // 常量
  API_SCOPES,
  ALL_SCOPES,
  KEY_STATUS,
  APP_STATUS,
  // 应用
  createApp,
  listApps,
  getApp,
  reviewApp,
  listAppsAdmin,
  // 密钥
  createKey,
  listKeys,
  getKey,
  revokeKey,
  renewKey,
  // 网关辅助
  verifyKeySecret,
  keyHasScope,
  keyAllowsIp,
  maskKey,
  // 开发者控制台统计（S15-T05）
  getCallOverview,
  getCallTrend,
  getErrorLogs,
  // 工具（便于单测）
  generateKeySecret,
  sha256,
  validateScopes,
  validateIpWhitelist,
  ipMatches,
};
