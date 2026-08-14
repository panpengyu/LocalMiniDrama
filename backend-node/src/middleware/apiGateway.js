'use strict';

/**
 * Sprint 15 - S15-T02 API 网关中间件
 *
 * 职责：
 *   1. 认证：从 Authorization: Bearer <key> 或 X-API-Key 提取明文 API Key，
 *      SHA-256 哈希比对 api_keys（verifyKeySecret，含状态/过期校验）
 *   2. IP 白名单：按密钥 ip_whitelist 校验来源 IP（不匹配 → 403）
 *   3. 权限范围：路由声明所需 scope，密钥不含该 scope → 403
 *   4. 速率限制：固定窗口（分钟级）计数 api_rate_windows，超限 → 429
 *   5. 配额管理：自然日计数 api_daily_usage，超过 daily_quota → 429
 *   6. 调用统计：每次调用写 api_call_logs（端点/方法/状态/错误码/IP/耗时）
 *     并原子累加 api_daily_usage；成功时刷新 api_keys.last_used_at
 *
 * 设计：
 *   - 工厂函数 createApiGateway(db, log)，返回 { gateway, requireScope } 两个中间件
 *   - requireScope(scope) 须在 gateway 之后使用（依赖 req.apiAuth）
 *   - 限流/配额计数全部基于 MySQL 行（无内存态），多实例部署天然一致
 *   - 固定窗口限流：窗口 = 当前分钟，天然防并发超卖（唯一键 upsert）
 *
 * 用法：
 *   const gw = require('../middleware/apiGateway')(db, log);
 *   r.get('/open/projects', gw.gateway, gw.requireScope('drama:read'), handler);
 */

const apiKeyService = require('../services/apiKeyService');

const RESPONSE_CODES = {
  MISSING_KEY: 'MISSING_API_KEY',
  INVALID_KEY: 'INVALID_API_KEY',
  KEY_REVOKED: 'API_KEY_REVOKED',
  KEY_EXPIRED: 'API_KEY_EXPIRED',
  KEY_INACTIVE: 'API_KEY_INACTIVE',
  IP_DENIED: 'IP_NOT_ALLOWED',
  SCOPE_DENIED: 'SCOPE_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'DAILY_QUOTA_EXCEEDED',
};

function createApiGateway(db, log) {
  // 提取明文 Key
  function extractKey(req) {
    const h = req.headers || {};
    // Authorization: Bearer <key>
    const auth = h.authorization || '';
    if (/^Bearer\s+/i.test(auth)) {
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      if (token) return token;
    }
    // X-API-Key: <key>
    const xkey = h['x-api-key'];
    if (xkey && typeof xkey === 'string' && xkey.trim()) return xkey.trim();
    return null;
  }

  function clientIp(req) {
    const h = req.headers || {};
    const forwarded = h['x-forwarded-for'];
    if (forwarded) {
      const first = String(forwarded).split(',')[0].trim();
      if (first) return first;
    }
    return (req.socket && req.socket.remoteAddress) || '';
  }

  // 固定窗口：当前分钟起止
  function windowBounds() {
    const now = new Date();
    now.setSeconds(0, 0);
    const start = now.toISOString().slice(0, 19).replace('T', ' ');
    const next = new Date(now.getTime() + 60 * 1000);
    const end = next.toISOString().slice(0, 19).replace('T', ' ');
    return { start, end };
  }

  // 限流计数：原子 upsert 返回窗口内计数
  function countRateWindow(keyId) {
    const { start } = windowBounds();
    db.prepare(
      `INSERT INTO api_rate_windows (key_id, window_start, call_count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE call_count = call_count + 1`
    ).run(keyId, start);
    const row = db.prepare(
      'SELECT call_count FROM api_rate_windows WHERE key_id = ? AND window_start = ?'
    ).get(keyId, start);
    return row ? row.call_count : 1;
  }

  // 每日用量：原子 upsert 返回当日调用数（含本次）
  function countDailyUsage(keyId, appId, userId, quotaLimit) {
    const date = new Date().toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO api_daily_usage (key_id, app_id, usage_date, call_count, error_count, quota_limit)
       VALUES (?, ?, ?, 1, 0, ?)
       ON DUPLICATE KEY UPDATE call_count = call_count + 1, quota_limit = VALUES(quota_limit)`
    ).run(keyId, appId, date, quotaLimit);
    const row = db.prepare(
      'SELECT call_count FROM api_daily_usage WHERE key_id = ? AND usage_date = ?'
    ).get(keyId, date);
    return row ? row.call_count : 1;
  }

  // 记录调用日志（endpoint/status/error/ip/latency）
  function logCall(entry) {
    db.prepare(
      `INSERT INTO api_call_logs
         (app_id, key_id, user_id, endpoint, method, scope, status_code, error_code, ip, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      // 注意：sync-mysql 会把空字符串 '' 转为 NULL，
      // 因此认证失败（无 app/key）时须传 null，而列已允许 NULL
      entry.appId || null, entry.keyId || null, entry.userId || 0,
      entry.endpoint || '', entry.method || '', entry.scope || null,
      entry.statusCode || 0, entry.errorCode || null, entry.ip || null,
      entry.latencyMs || null
    );
  }

  // 记录一次调用日志（endpoint/status/error/ip/latency）
  function writeLog(entry, startAt, ip) {
    try {
      logCall({
        appId: entry.appId || null,
        keyId: entry.keyId || null,
        userId: entry.userId || 0,
        endpoint: entry.endpoint,
        method: entry.method,
        scope: entry.scope || null,
        statusCode: entry.statusCode,
        errorCode: entry.errorCode || null,
        ip,
        latencyMs: Date.now() - startAt,
      });
    } catch (e) {
      log.error('[S15] 调用日志写入失败', { error: e.message });
    }
  }

  // 生成标准错误响应体
  function errorBody(code, message) {
    return { code, message };
  }

  // ===================== 网关主中间件 =====================
  function gateway(req, res, next) {
    const startAt = Date.now();
    const ip = clientIp(req);
    const endpoint = req.originalUrl || req.path;
    const method = req.method;
    const secret = extractKey(req);

    // 在发生错误时使用（此时还未设置 req.apiAuth）
    function reject(statusCode, errorCode, message) {
      writeLog({
        appId: '', keyId: '', userId: 0,
        endpoint, method, scope: null,
        statusCode, errorCode,
      }, startAt, ip);
      return res.status(statusCode).json(errorBody(errorCode, message));
    }

    // 1) 缺少 Key
    if (!secret) {
      return reject(401, RESPONSE_CODES.MISSING_KEY, '缺少 API Key（使用 X-API-Key 或 Authorization: Bearer）');
    }

    // 2) 密钥校验（哈希比对 + 状态 + 过期）
    const verified = apiKeyService.verifyKeySecret(db, log, secret);
    if (!verified.ok) {
      // 统一映射到对外错误码（服务层 code → 网关 RESPONSE_CODES）
      const code = RESPONSE_CODES[verified.code] || RESPONSE_CODES.INVALID_KEY;
      return reject(401, code, verified.message);
    }
    const key = verified.key;

    // 3) IP 白名单
    if (!apiKeyService.keyAllowsIp(key, ip)) {
      return reject(403, RESPONSE_CODES.IP_DENIED, `IP ${ip} 不在密钥白名单内`);
    }

    // 4) 速率限制（每分钟）
    const windowCount = countRateWindow(key.key_id);
    if (windowCount > key.rate_limit_per_min) {
      return reject(429, RESPONSE_CODES.RATE_LIMITED, `请求过于频繁：每分钟上限 ${key.rate_limit_per_min} 次`);
    }

    // 5) 配额管理（每日）
    const dailyCount = countDailyUsage(key.key_id, key.app_id, key.user_id, key.daily_quota);
    if (dailyCount > key.daily_quota) {
      return reject(429, RESPONSE_CODES.QUOTA_EXCEEDED, `今日调用已达上限 ${key.daily_quota} 次，请明日再试或联系管理员提升配额`);
    }

    // 6) 成功：挂载鉴权上下文
    req.apiAuth = {
      key,
      secret,
      appId: key.app_id,
      userId: key.user_id,
      keyId: key.key_id,
      scopes: (() => { try { return JSON.parse(key.scopes || '[]'); } catch (_) { return []; } })(),
      ip,
    };

    // 刷新 last_used_at（不阻塞主流程）
    try {
      db.prepare('UPDATE api_keys SET last_used_at = NOW() WHERE key_id = ?').run(key.key_id);
    } catch (_) { /* 非关键路径 */ }

    // 成功进入业务处理器后，由响应完成事件记录最终状态码
    res.on('finish', () => {
      writeLog({
        appId: key.app_id, keyId: key.key_id, userId: key.user_id,
        endpoint, method, scope: null,
        statusCode: res.statusCode,
        errorCode: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null,
      }, startAt, ip);
    });

    next();
  }

  // ===================== 权限范围守卫 =====================
  function requireScope(scope) {
    return function (req, res, next) {
      const auth = req.apiAuth;
      if (!auth) {
        return res.status(401).json({ code: RESPONSE_CODES.INVALID_KEY, message: '缺少有效的 API 认证上下文' });
      }
      if (!auth.scopes || !auth.scopes.includes(scope)) {
        return res.status(403).json({
          code: RESPONSE_CODES.SCOPE_DENIED,
          message: `当前密钥无权调用该接口（需要权限范围: ${scope}）`,
        });
      }
      next();
    };
  }

  return { gateway, requireScope };
}

module.exports = createApiGateway;
module.exports.RESPONSE_CODES = RESPONSE_CODES;
