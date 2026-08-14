'use strict';

/**
 * Sprint 15 - S15-T03 开放 API 接口测试
 *
 * 覆盖任务：
 *   - 网关认证（无 Key → 401 / 错误 Key → 401）
 *   - 权限范围校验（scope 不足 → 403）
 *   - 项目管理：创建 / 列表 / 详情（复用 dramaService，数据归属 API Key 用户）
 *   - 素材查询：素材库列表（复用 assetService）
 *   - 数据隔离：项目归 API Key 所属用户
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位用户ID 999003，before 清理残留、after 彻底清理
 *   - 测试数据必须落 MySQL
 *   - 不触发真实 AI 调用（剧本/图片生成类接口不在此覆盖 AI 链路）
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const apiKeyService = require(path.resolve(__dirname, '..', 'src', 'services', 'apiKeyService.js'));

let db;
let server;
let baseUrl;
const log = { info() {}, warn() {}, error() {}, errorw() {} };

const TEST_USER_ID = 999003;
const TEST_ADMIN_ID = 999004;

let fullKeySecret = '';   // 全 scope 密钥
let limitedKeySecret = ''; // 仅 asset:read 密钥
let createdDramaId = null;

function cleanup() {
  db.prepare('DELETE FROM api_call_logs WHERE user_id = ?').run(TEST_USER_ID);
  db.prepare('DELETE FROM api_rate_windows WHERE key_id IN (SELECT key_id FROM api_keys WHERE user_id = ?)').run(TEST_USER_ID);
  db.prepare('DELETE FROM api_daily_usage WHERE key_id IN (SELECT key_id FROM api_keys WHERE user_id = ?)').run(TEST_USER_ID);
  db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(TEST_USER_ID);
  db.prepare('DELETE FROM api_apps WHERE user_id = ?').run(TEST_USER_ID);
  db.prepare('DELETE FROM dramas WHERE created_by = ?').run(TEST_USER_ID);
  createdDramaId = null;
  db.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER_ID);
}

/** 发起一次真实 HTTP 请求 */
function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      host: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* ignore */ }
        resolve({ statusCode: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  db = getDb(loadConfig().database);
  cleanup();

  // 测试用户（开放 API 数据归属主体）
  db.prepare(
    "INSERT INTO users (id, username, password, role, status, created_at, updated_at) VALUES (?, ?, 'test-placeholder-hash', 'user', 1, NOW(), NOW())"
  ).run(TEST_USER_ID, `s15_user_${TEST_USER_ID}`);

  // 全 scope 应用 + 密钥
  const app = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: 'S15开放API全权限应用' });
  apiKeyService.reviewApp(db, log, { appId: app.app_id, approve: true, adminId: TEST_ADMIN_ID });
  const full = apiKeyService.createKey(db, log, {
    userId: TEST_USER_ID,
    appId: app.app_id,
    scopes: ['drama:read', 'drama:write', 'asset:read'],
    rateLimitPerMin: 60,
    dailyQuota: 1000,
    expiresInDays: 30,
  });
  fullKeySecret = full.secret;

  // 仅 asset:read 应用 + 密钥（用于 scope 校验）
  const app2 = apiKeyService.createApp(db, log, { userId: TEST_USER_ID, name: 'S15开放API只读素材应用' });
  apiKeyService.reviewApp(db, log, { appId: app2.app_id, approve: true, adminId: TEST_ADMIN_ID });
  const limited = apiKeyService.createKey(db, log, {
    userId: TEST_USER_ID,
    appId: app2.app_id,
    scopes: ['asset:read'],
    rateLimitPerMin: 60,
    dailyQuota: 1000,
    expiresInDays: 30,
  });
  limitedKeySecret = limited.secret;

  // 启动临时 Express 服务
  const express = require(path.resolve(__dirname, '..', 'node_modules', 'express'));
  const openApiRouter = require(path.resolve(__dirname, '..', 'src', 'routes', 'openApi.js'));
  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use('/open', openApiRouter(db, {}, log));
  await new Promise((resolve) => { server = expressApp.listen(0, '127.0.0.1', resolve); });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  cleanup();
  closeDb();
});

describe('S15-T03 开放 API 接口', () => {
  it('网关认证：无 Key → 401', async () => {
    const r = await request('GET', '/open/dramas');
    assert.equal(r.statusCode, 401);
    assert.equal(r.body.code, 'MISSING_API_KEY');
  });

  it('网关认证：错误 Key → 401', async () => {
    const r = await request('GET', '/open/dramas', {
      headers: { 'X-API-Key': 'lmd_badbadbadbadbadbadbadbadbadbad' },
    });
    assert.equal(r.statusCode, 401);
    assert.equal(r.body.code, 'INVALID_API_KEY');
  });

  it('项目管理：创建项目（POST /open/dramas）', async () => {
    const r = await request('POST', '/open/dramas', {
      headers: { 'X-API-Key': fullKeySecret },
      body: { title: '开放API测试短剧', genre: '都市', style: 'realistic', description: 'S15-T03 集成测试' },
    });
    assert.equal(r.statusCode, 201);
    // 从库中确认数据已落库并归属 API Key 用户
    const row = db.prepare(
      'SELECT id, title, created_by FROM dramas WHERE title = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'
    ).get('开放API测试短剧');
    assert.ok(row, '项目应已写入 dramas 表');
    createdDramaId = row.id;
    assert.equal(row.created_by, TEST_USER_ID);
    // 接口响应应包含可用的项目 id（返回完整记录）
    assert.equal(r.body.data.id, row.id);
  });

  it('项目管理：项目列表（GET /open/dramas）', async () => {
    const r = await request('GET', '/open/dramas', {
      headers: { 'Authorization': `Bearer ${fullKeySecret}` },
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data.items));
    const found = r.body.data.items.find((d) => d.id === createdDramaId);
    assert.ok(found, '列表应包含刚创建的项目');
    assert.equal(found.creator && found.creator.id, TEST_USER_ID);
  });

  it('项目管理：项目详情（GET /open/dramas/:id）', async () => {
    const r = await request('GET', `/open/dramas/${createdDramaId}`, {
      headers: { 'X-API-Key': fullKeySecret },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.data.id, createdDramaId);
    assert.equal(r.body.data.title, '开放API测试短剧');
  });

  it('素材查询：素材列表（GET /open/assets）', async () => {
    const r = await request('GET', '/open/assets?page=1&page_size=10', {
      headers: { 'X-API-Key': fullKeySecret },
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data.items));
  });

  it('权限范围校验：无 drama:write 的 Key 调创建 → 403', async () => {
    const r = await request('POST', '/open/dramas', {
      headers: { 'X-API-Key': limitedKeySecret },
      body: { title: '无权限项目' },
    });
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.code, 'SCOPE_NOT_ALLOWED');
  });

  it('素材查询：asset:read 权限可访问', async () => {
    const r = await request('GET', '/open/assets', {
      headers: { 'X-API-Key': limitedKeySecret },
    });
    assert.equal(r.statusCode, 200);
  });

  it('参数校验：创建项目缺 title → 400', async () => {
    const r = await request('POST', '/open/dramas', {
      headers: { 'X-API-Key': fullKeySecret },
      body: { genre: '都市' },
    });
    assert.equal(r.statusCode, 400);
  });
});
