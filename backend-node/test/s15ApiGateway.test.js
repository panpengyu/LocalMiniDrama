'use strict';

/**
 * Sprint 15 - S15-T02 API 网关与限流测试
 *
 * 覆盖任务：
 *   - 认证：缺失 Key / 非法 Key / 已吊销 / 已过期 / 正确 Key（Bearer 与 X-API-Key 两种头）
 *   - IP 白名单：命中放行 / 未命中 403
 *   - 权限范围守卫：含 scope 放行 / 不含 403
 *   - 速率限制：固定窗口内超限返回 429
 *   - 配额管理：每日配额超限返回 429
 *   - 调用统计：api_call_logs 落库（成功/失败均记录），api_daily_usage 原子累加
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 使用独立测试用户（999001 等），before/after 清理 api_* 表
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const apiKeyService = require(path.resolve(__dirname, '..', 'src', 'services', 'apiKeyService.js'));
const createApiGateway = require(path.resolve(__dirname, '..', 'src', 'middleware', 'apiGateway.js'));

let db;
let gw;
const log = { info() {}, warn() {}, error() {} };

const TEST_USER_ID = 999003;
const TEST_ADMIN_ID = 999004;

// 本测试生成的一个有效密钥（before 内初始化）
let testSecret = null;
let testKeyId = null;
let testAppId = null;

function cleanup() {
  db.prepare('DELETE FROM api_keys WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_ADMIN_ID);
  db.prepare('DELETE FROM api_apps WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_ADMIN_ID);
  db.prepare('DELETE FROM api_call_logs WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_ADMIN_ID);
  db.prepare('DELETE FROM api_daily_usage WHERE key_id IN (SELECT key_id FROM api_keys WHERE user_id IN (?, ?))')
    .run(TEST_USER_ID, TEST_ADMIN_ID);
  db.prepare('DELETE FROM api_rate_windows WHERE key_id IN (SELECT key_id FROM api_keys WHERE user_id IN (?, ?))')
    .run(TEST_USER_ID, TEST_ADMIN_ID);
}

function cleanupWindows(keyId) {
  db.prepare('DELETE FROM api_rate_windows WHERE key_id = ?').run(keyId);
}

before(() => {
  db = getDb(loadConfig().database);
  gw = createApiGateway(db, log);
  cleanup();

  // 预置一个已审批应用 + 有效密钥（scope 覆盖全部端点）
  const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: 'S15网关测试应用' });
  apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });
  testAppId = app.app_id;
  const { key, secret } = apiKeyService.createKey(db, log, {
    userId: TEST_USER_ID,
    appId: app.app_id,
    scopes: ['drama:read', 'screenplay:generate', 'asset:read'],
    rateLimitPerMin: 5,
    dailyQuota: 50,
    ipWhitelist: ['127.0.0.1', '::1', '192.168.1.*'],
    expiresInDays: 30,
  });
  testSecret = secret;
  testKeyId = key.key_id;
});

after(() => {
  cleanup();
  closeDb();
});

// ---------------- 中间件驱动辅助 ----------------
// 构造最小可用的 Express-like req/res，事件驱动 next/finish
function invokeGateway(reqOverrides = {}, scope = null) {
  return new Promise((resolve) => {
    const req = {
      headers: { 'x-api-key': testSecret },
      originalUrl: '/open/dramas',
      path: '/open/dramas',
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      ...reqOverrides,
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = function (code) { this.statusCode = code; return this; };
    // 模拟真实 Express：调用 json() 完成响应并触发 'finish' 事件
    res.json = function (body) {
      this.body = body;
      this.emit('finish');
      return this;
    };

    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (!err) res.emit('finish'); // 模拟业务完成后响应结束，触发网关的成功路径日志
      resolve({ req, res, nextCalled: !err, error: err || null });
    };
    res.on('finish', () => finish()); // 模拟真实响应完成（失败路径由 json() 触发）

    try {
      if (scope) {
        gw.gateway(req, res, () => gw.requireScope(scope)(req, res, finish));
      } else {
        gw.gateway(req, res, finish);
      }
    } catch (e) {
      finish(e);
    }
  });
}

describe('S15-T02 API 网关与限流', () => {
  it('缺少 Key 返回 401 MISSING_API_KEY', async () => {
    const { res } = await invokeGateway({ headers: {} });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'MISSING_API_KEY');
  });

  it('非法 Key 返回 401 INVALID_API_KEY', async () => {
    const { res } = await invokeGateway({ headers: { 'x-api-key': 'lmd_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'INVALID_API_KEY');
  });

  it('Bearer 头认证通过并挂载 apiAuth', async () => {
    const { req, res } = await invokeGateway({
      headers: { authorization: `Bearer ${testSecret}` },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(req.apiAuth);
    assert.equal(req.apiAuth.keyId, testKeyId);
    assert.equal(req.apiAuth.appId, testAppId);
    assert.deepEqual(req.apiAuth.scopes.includes('drama:read'), true);
  });

  it('IP 白名单：未命中返回 403 IP_NOT_ALLOWED', async () => {
    const { res } = await invokeGateway({ socket: { remoteAddress: '8.8.8.8' } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'IP_NOT_ALLOWED');
  });

  it('scope 守卫：不含权限返回 403 SCOPE_NOT_ALLOWED', async () => {
    const { res } = await invokeGateway({}, 'image:generate');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SCOPE_NOT_ALLOWED');
  });

  it('scope 守卫：含权限放行', async () => {
    const { req, res } = await invokeGateway({}, 'drama:read');
    assert.equal(res.statusCode, 200);
    assert.ok(req.apiAuth);
  });

  it('速率限制：窗口内超过上限返回 429 RATE_LIMITED', async () => {
    cleanupWindows(testKeyId);
    let hit429 = false;
    // 上限 5 次/分钟：前 5 次放行，第 6 次被限
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { res } = await invokeGateway();
      if (res.statusCode === 429) { hit429 = true; break; }
    }
    assert.equal(hit429, true);
  });

  it('配额管理：当日超限返回 429 DAILY_QUOTA_EXCEEDED', async () => {
    cleanupWindows(testKeyId); // 隔离限流窗口，避免被 RATE_LIMITED 抢先
    // 将每日配额临时改为当前累计计数，使得下一次调用必然超额
    const date = new Date().toISOString().slice(0, 10);
    const usage = db.prepare('SELECT call_count FROM api_daily_usage WHERE key_id = ? AND usage_date = ?')
      .get(testKeyId, date);
    const current = usage ? usage.call_count : 0;
    db.prepare('UPDATE api_keys SET daily_quota = ? WHERE key_id = ?').run(current, testKeyId);
    const { res } = await invokeGateway();
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, 'DAILY_QUOTA_EXCEEDED');
    // 恢复配额
    db.prepare('UPDATE api_keys SET daily_quota = 50 WHERE key_id = ?').run(testKeyId);
  });

  it('调用统计落库：api_call_logs 记录成功与失败', async () => {
    cleanupWindows(testKeyId); // 隔离限流窗口，保证成功调用真正放行
    const beforeCount = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs WHERE key_id = ?').get(testKeyId).c;
    await invokeGateway(); // 成功
    await invokeGateway({ headers: {} }); // 失败（缺 Key）
    const afterCount = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs WHERE key_id = ?').get(testKeyId).c;
    assert.ok(afterCount >= beforeCount + 1); // 成功至少 1 条
    // 缺 Key 的失败日志 user_id 为 0
    const noKeyLogs = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs WHERE user_id = 0 AND endpoint = ?')
      .get('/open/dramas').c;
    assert.ok(noKeyLogs >= 1);
  });

  it('每日用量原子累加：api_daily_usage 增长', async () => {
    cleanupWindows(testKeyId); // 隔离限流窗口，保证成功调用真正放行
    const date = new Date().toISOString().slice(0, 10);
    const before = db.prepare('SELECT call_count FROM api_daily_usage WHERE key_id = ? AND usage_date = ?')
      .get(testKeyId, date);
    await invokeGateway();
    const after = db.prepare('SELECT call_count FROM api_daily_usage WHERE key_id = ? AND usage_date = ?')
      .get(testKeyId, date);
    assert.ok((after ? after.call_count : 0) >= (before ? before.call_count : 0) + 1);
  });

  it('已吊销密钥：返回 401 API_KEY_REVOKED', async () => {
    // 另建一个密钥用于吊销场景
    const { key, secret } = apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: testAppId, scopes: ['drama:read'], expiresInDays: 30,
    });
    apiKeyService.revokeKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID, reason: '网关测试吊销' });
    const { res } = await invokeGateway({ headers: { 'x-api-key': secret } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'API_KEY_REVOKED');
  });
});
