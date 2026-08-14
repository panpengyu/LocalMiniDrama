'use strict';

/**
 * Sprint 15 - S15-T01 API Key 管理系统测试
 *
 * 覆盖任务：
 *   - 权限范围白名单校验（API_SCOPES）
 *   - IP 白名单校验与匹配（精确 / 通配 * / CIDR）
 *   - 应用申请与归属校验
 *   - 应用审批流程（驳回 / 通过 / 重复审批拦截 / 未审批不可建 Key）
 *   - 密钥生成（明文仅一次返回 / 落库只存 SHA-256 哈希 / 前缀展示 / 参数落库）
 *   - 密钥鉴权辅助（verifyKeySecret 全状态：正确 / 错误 / 非法格式 / 吊销）
 *   - 密钥吊销与续期（状态机与守卫）
 *   - 管理端分页查询（状态 / 关键词过滤）
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位用户ID（999001/999002），before 清理残留、after 彻底清理 api_keys/api_apps
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const apiKeyService = require(path.resolve(__dirname, '..', 'src', 'services', 'apiKeyService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };

// 测试用独立数据（避免污染真实用户）
const TEST_USER_ID = 999001;
const TEST_ADMIN_ID = 999002;

function cleanup() {
  db.prepare('DELETE FROM api_keys WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_ADMIN_ID);
  db.prepare('DELETE FROM api_apps WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_ADMIN_ID);
}

before(() => {
  db = getDb(loadConfig().database);
  cleanup();
});

after(() => {
  cleanup();
  closeDb();
});

describe('S15-T01 API Key 管理系统', () => {
  it('权限范围白名单校验', () => {
    assert.equal(apiKeyService.validateScopes(['drama:read', 'screenplay:generate']).ok, true);
    assert.equal(apiKeyService.validateScopes(['bad:scope']).ok, false);
    assert.equal(apiKeyService.validateScopes([]).ok, false);
    assert.equal(apiKeyService.validateScopes(['drama:read', 'drama:read']).ok, false);
    // 重复项也拒绝（不静默去重）
    assert.equal(apiKeyService.validateScopes(['image:generate', 'image:generate', 'asset:read']).ok, false);
    // 合法去重输入
    assert.deepEqual(
      apiKeyService.validateScopes(['image:generate', 'asset:read']).scopes,
      ['image:generate', 'asset:read']
    );
  });

  it('IP 白名单校验与匹配', () => {
    assert.equal(apiKeyService.validateIpWhitelist([]).ok, true);
    assert.equal(apiKeyService.validateIpWhitelist(['192.168.1.1']).ok, true);
    assert.equal(apiKeyService.validateIpWhitelist(['not-an-ip']).ok, false);

    const whitelist = ['127.0.0.1', '192.168.1.*', '10.0.0.0/8'];
    assert.equal(apiKeyService.ipMatches('127.0.0.1', whitelist), true);
    assert.equal(apiKeyService.ipMatches('192.168.1.99', whitelist), true);
    assert.equal(apiKeyService.ipMatches('10.20.30.40', whitelist), true);
    assert.equal(apiKeyService.ipMatches('8.8.8.8', whitelist), false);
    // 空白名单 = 不限制
    assert.equal(apiKeyService.ipMatches('8.8.8.8', []), true);
  });

  it('应用申请与归属校验', () => {
    const app = apiKeyService.createApp(db, log, {
      userId: TEST_USER_ID, name: 'S15测试应用', description: 'API Key 管理测试',
    });
    assert.ok(app.app_id.startsWith('lmd_app_'));
    assert.equal(app.status, 'pending');

    // 缺名称
    assert.throws(() => apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '  ' }),
      (e) => e.code === 'EMPTY_APP_NAME');

    // 无权访问他人应用
    assert.throws(() => apiKeyService.getApp(db, log, { appId: app.app_id, userId: TEST_ADMIN_ID }),
      (e) => e.code === 'APP_FORBIDDEN');
  });

  it('应用审批流程（重复审批拦截）', () => {
    const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '审批测试' });

    // 待审批应用不可直接创建密钥
    assert.throws(() => apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: app.app_id, scopes: ['drama:read'],
    }), (e) => e.code === 'APP_NOT_APPROVED');

    // 驳回
    const rejected = apiKeyService.reviewApp(db, log, {
      appId: app.app_id, approve: false, reason: '资质材料不全', adminId: TEST_ADMIN_ID,
    });
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.reject_reason.includes('资质材料不全'));

    // 已审批不可重复审批
    assert.throws(() => apiKeyService.reviewApp(db, log, {
      appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID,
    }), (e) => e.code === 'APP_NOT_PENDING');

    // 重新申请：创建一个新应用并通过
    const app2 = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '审批通过测试' });
    const approved = apiKeyService.reviewApp(db, log, { appId: app2.app_id, approve: true, adminId: TEST_ADMIN_ID });
    assert.equal(approved.status, 'approved');
  });

  it('密钥生成（明文仅一次返回 / 落库只存哈希）', () => {
    const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '密钥测试应用' });
    apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });

    const { key, secret } = apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID,
      appId: app.app_id,
      name: '生产密钥',
      scopes: ['drama:read', 'screenplay:generate'],
      rateLimitPerMin: 30,
      dailyQuota: 500,
      expiresInDays: 30,
    });

    assert.ok(key.key_id.startsWith('lmd_key_'));
    assert.ok(secret.startsWith('lmd_'));
    assert.equal(secret.length > 32, true);
    assert.equal(key.key_prefix, secret.slice(0, 8));
    assert.equal(key.scopes.includes('drama:read'), true);
    assert.equal(key.rate_limit_per_min, 30);
    assert.equal(key.daily_quota, 500);

    // 落库行不包含明文/哈希泄露到脱敏视图
    assert.equal(key.key_hash, undefined);

    // 哈希与明文 SHA-256 一致（验证落库正确）
    const row = db.prepare('SELECT * FROM api_keys WHERE key_id = ?').get(key.key_id);
    assert.equal(row.key_hash, apiKeyService.sha256(secret));

    // 非法 scopes 拒绝
    assert.throws(() => apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: app.app_id, scopes: ['hack:all'],
    }), (e) => e.code === 'INVALID_SCOPES');
  });

  it('密钥鉴权辅助（verifyKeySecret 全状态）', () => {
    const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '鉴权测试应用' });
    apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });

    const { key, secret } = apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: app.app_id, scopes: ['asset:read'], expiresInDays: 30,
    });

    // 正确密钥通过
    const ok = apiKeyService.verifyKeySecret(db, log, secret);
    assert.equal(ok.ok, true);
    assert.equal(ok.key.key_id, key.key_id);

    // 错误密钥
    const bad = apiKeyService.verifyKeySecret(db, log, 'lmd_ffffffffffffffffffffffffffffffff');
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'INVALID_KEY');

    // 非法格式
    const fmt = apiKeyService.verifyKeySecret(db, log, 'not-a-key');
    assert.equal(fmt.ok, false);
    assert.equal(fmt.code, 'INVALID_KEY');

    // scope / IP 校验
    assert.equal(apiKeyService.keyHasScope(ok.key, 'asset:read'), true);
    assert.equal(apiKeyService.keyHasScope(ok.key, 'drama:read'), false);
    assert.equal(apiKeyService.keyAllowsIp(ok.key, '127.0.0.1'), true);

    // 吊销后校验失败
    apiKeyService.revokeKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID, reason: '测试吊销' });
    const revoked = apiKeyService.verifyKeySecret(db, log, secret);
    assert.equal(revoked.ok, false);
    assert.equal(revoked.code, 'KEY_REVOKED');
  });

  it('密钥吊销与续期', () => {
    const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '吊销续期测试' });
    apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });

    const { key } = apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: app.app_id, scopes: ['drama:read'], expiresInDays: 1,
    });

    // 续期
    const renewed = apiKeyService.renewKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID, days: 60 });
    assert.equal(renewed.status, 'active');
    const renewRow = db.prepare('SELECT expires_at FROM api_keys WHERE key_id = ?').get(key.key_id);
    const renewTime = new Date(renewRow.expires_at.replace(' ', 'T')).getTime();
    assert.ok(renewTime > Date.now() + 50 * 24 * 3600 * 1000);

    // 吊销
    const revoked = apiKeyService.revokeKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID, reason: '泄漏' });
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revoked_reason, '泄漏');

    // 已吊销不可再吊销/续期
    assert.throws(() => apiKeyService.revokeKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID }),
      (e) => e.code === 'KEY_NOT_ACTIVE');
    assert.throws(() => apiKeyService.renewKey(db, log, { keyId: key.key_id, userId: TEST_USER_ID }),
      (e) => e.code === 'KEY_REVOKED');
  });

  it('管理端分页查询', () => {
    const r = apiKeyService.listAppsAdmin(db, log, { status: 'pending', page: 1, pageSize: 10 });
    assert.equal(r.total >= 1, true);
    assert.equal(r.items.length >= 1, true);

    const all = apiKeyService.listAppsAdmin(db, log, {});
    assert.equal(all.total >= 1, true);

    const keyword = apiKeyService.listAppsAdmin(db, log, { keyword: 'S15测试应用' });
    assert.equal(keyword.total >= 1, true);
  });

  // ---- S15-T05 开发者控制台统计（基于 MySQL 实时聚合，无 mock） ----
  it('调用概览：总调用 / 今日调用 / 今日错误 / 配额使用率', () => {
    const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: '统计概览应用' });
    apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });
    const { key } = apiKeyService.createKey(db, log, {
      userId: TEST_USER_ID, appId: app.app_id, scopes: ['drama:read'], dailyQuota: 100,
    });
    const today = new Date().toISOString().slice(0, 10);

    // 造 3 条成功 + 2 条失败调用日志
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO api_call_logs (app_id, key_id, user_id, endpoint, method, status_code, created_at)
         VALUES (?, ?, ?, '/open/dramas', 'GET', 200, NOW())`
      ).run(app.app_id, key.key_id, TEST_USER_ID);
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(
        `INSERT INTO api_call_logs (app_id, key_id, user_id, endpoint, method, status_code, error_code, created_at)
         VALUES (?, ?, ?, '/open/dramas', 'GET', 429, 'RATE_LIMITED', NOW())`
      ).run(app.app_id, key.key_id, TEST_USER_ID);
    }
    // 造当日配额用量
    db.prepare(
      `INSERT INTO api_daily_usage (key_id, app_id, usage_date, call_count, error_count, quota_limit)
       VALUES (?, ?, ?, 5, 2, 100)`
    ).run(key.key_id, app.app_id, today);

    const o = apiKeyService.getCallOverview(db, log, { userId: TEST_USER_ID });
    assert.ok(o.total_calls >= 5, `总调用应>=5，实际 ${o.total_calls}`);
    assert.ok(o.today_calls >= 5, `今日调用应>=5，实际 ${o.today_calls}`);
    assert.ok(o.today_errors >= 2, `今日错误应>=2，实际 ${o.today_errors}`);
    const q = o.quota_usage.find((x) => x.key_id === key.key_id);
    assert.ok(q, '配额使用率应包含该密钥');
    assert.equal(q.call_count, 5);
    assert.equal(q.quota_limit, 100);
    assert.equal(q.usage_rate, 5); // 5/100=5%
  });

  it('调用趋势：返回按天聚合的调用/失败点', () => {
    const trend = apiKeyService.getCallTrend(db, log, { userId: TEST_USER_ID, days: 7 });
    assert.equal(trend.days, 7);
    assert.ok(Array.isArray(trend.points));
    // 至少包含今天（前面造过数据）
    const todayStr = trend.points.find((p) => p.calls >= 5);
    assert.ok(todayStr, '趋势中应包含今天的调用记录');
    assert.ok(todayStr.errors >= 2, '趋势中今天错误数应>=2');
  });

  it('错误日志：仅返回失败调用且分页正确', () => {
    const result = apiKeyService.getErrorLogs(db, log, { userId: TEST_USER_ID, page: 1, pageSize: 20 });
    assert.ok(result.total >= 2, `错误总数应>=2，实际 ${result.total}`);
    assert.ok(result.items.length >= 2);
    // 全部是失败(status>=400)
    for (const item of result.items) {
      assert.ok(item.status_code >= 400);
      if (item.status_code === 429) assert.equal(item.error_code, 'RATE_LIMITED');
    }
    // 按时间倒序
    for (let i = 1; i < result.items.length; i++) {
      assert.ok(result.items[i - 1].id >= result.items[i].id);
    }
  });
});
