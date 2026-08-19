'use strict';

/**
 * Sprint 21 - T21-05 管理页补齐（批 B 站点配置 + 批 C 系统管理）集成测试
 *
 * 约束：
 *   - 真实 MySQL（config.yaml type=mysql），全部写入 localminidrama 库
 *   - 独立 ID 区间 9000022xx + s21_ 前缀隔离，after 精确清理
 *   - 临时 Express 挂载 adminSiteRoutes，注入 req.user(super_admin) 通过 requireRole
 *
 * 覆盖：
 *   [1] 站点品牌 PUT/GET（落库 global_settings）
 *   [2] 短信配置 PUT/GET（密钥脱敏 **** 不回显明文）
 *   [3] TOS 配置 PUT/GET
 *   [4] 协议管理 PUT/GET（数组持久化）
 *   [5] 版本日志 GET（读仓库 CHANGELOG.md 真实内容）
 *   [6] 通知公告 CRUD（创建/列表/更新/下架/删除）
 *   [7] 管理员 CRUD（创建→列表→改密→删除，bcrypt 落库）
 *   [8] 角色 CRUD（含 enterprise 兜底）
 *   [9] 菜单 CRUD
 *   [10] 字典 CRUD（types 分组）
 *   [11] 参数 CRUD（唯一键校验）
 *   [12] 日志检索（登录日志 + 操作审计）
 *   [13] 问题排查 diagnose（聚合用户/订单/作品/会话）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const fs = require('node:fs');
const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const adminSiteRoutes = require(path.resolve(__dirname, '..', 'src', 'routes', 'adminSite.js'));

/** 逐条执行迁移 SQL 文件（去 -- 注释，按分号切分），保证测试所需表存在且幂等 */
function runMigration(db, name) {
  const file = path.resolve(__dirname, '..', 'migrations', name);
  const raw = fs.readFileSync(file, 'utf8');
  const stmts = raw
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
  for (const st of stmts) db.exec(st);
}

let db;
let server;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);
let reqUser = { id: 900002211, role: 'super_admin', nickname: 's21_admin', username: 's21_admin' };

const U1 = 900002201; // 被诊断用户
const A1 = 900002202; // 新建管理员
const R1 = 900002203; // 角色
const O1 = 900002208; // 订单（诊断用）
// POST 由后端 snowflakeId 生成，运行时记录实际 id 供后续操作与清理
let M1 = null; // 菜单
let D1 = null; // 字典项
let P1 = null; // 参数
let N1 = null; // 公告

// 站点配置固定 key（site_brand/sms_config/tos_config/agreements），
// 测试前备份、after 恢复，避免污染真实配置。
const SITE_KEYS = ['site_brand', 'sms_config', 'tos_config', 'agreements'];
const siteBackup = {};

function backupSiteSettings() {
  SITE_KEYS.forEach((k) => {
    const row = db.prepare('SELECT `value` FROM global_settings WHERE `key` = ?').get(k);
    siteBackup[k] = row ? row.value : null;
  });
}

function restoreSiteSettings() {
  SITE_KEYS.forEach((k) => {
    if (siteBackup[k] == null) {
      db.prepare('DELETE FROM global_settings WHERE `key` = ?').run(k);
    } else {
      db.prepare('UPDATE global_settings SET `value` = ? WHERE `key` = ?').run(siteBackup[k], k);
    }
  });
}

function cleanup() {
  if (N1) db.prepare('DELETE FROM notices WHERE id = ?').run(N1);
  if (P1) db.prepare('DELETE FROM system_params WHERE id = ?').run(P1);
  if (D1) db.prepare('DELETE FROM dict_items WHERE id = ?').run(D1);
  if (M1) db.prepare('DELETE FROM menus WHERE id = ?').run(M1);
  if (R1) db.prepare('DELETE FROM roles WHERE id = ?').run(R1);
  if (A1) db.prepare('DELETE FROM users WHERE id = ?').run(A1);
  db.prepare('DELETE FROM users WHERE id = ?').run(U1);
  db.prepare('DELETE FROM membership_orders WHERE id = ?').run(O1);
  db.prepare('DELETE FROM login_logs WHERE user_id = ?').run(U1);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(U1);
}

function request(method, urlPath, { body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      host: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload ? Buffer.byteLength(payload) : 0 }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  runMigration(db, '65_s21_site_manage.sql');
  runMigration(db, '66_s21_notices.sql');
  cleanup();
  backupSiteSettings();

  // 被诊断用户 + 其订单/登录日志/会话
  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, phone, status, user_type)
     VALUES (?, ?, 'x', 'user', ?, ?, 1, 'user')`
  ).run(U1, `s21_diag_${TAG}`, `s21_diag_nick_${TAG}`, `138${String(TAG).slice(0, 8)}`);
  db.prepare(
    `INSERT INTO membership_orders (id, user_id, plan_id, order_no, level_code, billing_cycle, amount, pay_status, pay_method, created_at, updated_at)
     VALUES (?, ?, 0, ?, 'basic', 'month', 19.90, 'paid', 'alipay', NOW(), NOW())`
  ).run(O1, U1, `s21_diag_ord_${TAG}`);
  db.prepare(
    `INSERT INTO login_logs (id, user_id, username, success, ip, reason, created_at)
     VALUES (?, ?, ?, 1, '127.0.0.1', 's21 diag login', NOW())`
  ).run(900002209, U1, `s21_diag_${TAG}`);
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, user_agent, ip, created_at, expires_at)
     VALUES (?, ?, 's21-test-device', '127.0.0.1', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`
  ).run(900002210, U1);

  const express = require(path.resolve(__dirname, '..', 'node_modules', 'express'));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = reqUser;
    next();
  });
  app.use('/admin', adminSiteRoutes(db, log));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  restoreSiteSettings();
  cleanup();
  if (server) await new Promise((r) => server.close(r));
  try {
    const qs = require(path.resolve(__dirname, '..', 'src', 'services', 'queueService.js'));
    await Promise.race([qs.closeQueue(), new Promise((r) => setTimeout(r, 3000))]);
  } catch (_) { /* noop */ }
  closeDb();
});

test('[1] 站点品牌 PUT/GET', async () => {
  const payload = { name: `S21品牌${TAG}`, slogan: '本地短剧智能创作助手', icp: '粤ICP备xxx号', copyright: '©2026' };
  let r = await request('PUT', '/admin/site/brand', { body: payload });
  assert.equal(r.status, 200);
  r = await request('GET', '/admin/site/brand');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.name, payload.name);
  assert.equal(r.body.data.slogan, payload.slogan);
});

test('[2] 短信配置 PUT/GET（密钥脱敏）', async () => {
  let r = await request('PUT', '/admin/site/sms', {
    body: { provider: 'aliyun', enabled: true, access_key: 'AK_TEST_123456', access_secret: 'SK_SECRET_abcdef', sign: '【测试】', template_id: 'SMS_1' }
  });
  assert.equal(r.status, 200);
  r = await request('GET', '/admin/site/sms');
  assert.equal(r.status, 200);
  assert.match(r.body.data.access_key, /^\*\*\*\*/);
  assert.match(r.body.data.access_secret, /^\*\*\*\*/);
  assert.ok(!r.body.data.access_secret.includes('abcdef'), '不应回显明文密钥');
});

test('[3] TOS 配置 PUT/GET', async () => {
  let r = await request('PUT', '/admin/site/tos', { body: { title: '服务条款', version: 'v1.2', content: '条款正文', force_accept: true } });
  assert.equal(r.status, 200);
  r = await request('GET', '/admin/site/tos');
  assert.equal(r.body.data.version, 'v1.2');
  assert.equal(r.body.data.force_accept, true);
});

test('[4] 协议管理 PUT/GET', async () => {
  const agreements = [{ key: 'privacy', title: '隐私政策', version: 'v1.0', content: '隐私正文', enabled: true }];
  let r = await request('PUT', '/admin/site/agreements', { body: agreements });
  assert.equal(r.status, 200);
  r = await request('GET', '/admin/site/agreements');
  assert.equal(Array.isArray(r.body.data), true);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].title, '隐私政策');
});

test('[5] 版本日志 GET（真实 CHANGELOG.md）', async () => {
  const r = await request('GET', '/admin/site/changelog');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.content.length > 100, 'CHANGELOG.md 内容应非空');
  assert.match(r.body.data.content, /1\.6|Unreleased|##/);
});

test('[6] 通知公告 CRUD', async () => {
  let r = await request('POST', '/admin/notices', { body: { title: `S21公告${TAG}`, content: '公告正文', type: 'announcement', level: 'warning', is_top: 1, status: 1 } });
  assert.equal(r.status, 201);
  N1 = r.body.data.id;
  r = await request('GET', '/admin/notices?keyword=' + encodeURIComponent(`S21公告${TAG}`));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.pagination.total, 1);
  assert.equal(r.body.data.items[0].is_top, 1);
  r = await request('PUT', `/admin/notices/${N1}`, { body: { status: 0 } });
  assert.equal(r.status, 200);
  r = await request('GET', '/admin/notices?status=0&keyword=' + encodeURIComponent(`S21公告${TAG}`));
  assert.equal(r.body.data.items[0].status, 0, '下架后按 status=0 可查到');
  r = await request('DELETE', `/admin/notices/${N1}`);
  assert.equal(r.status, 200);
  N1 = null;
  r = await request('GET', '/admin/notices?keyword=' + encodeURIComponent(`S21公告${TAG}`));
  assert.equal(r.body.data.pagination.total, 0, '删除后检索不到');
});

test('[7] 管理员 CRUD', async () => {
  const username = `s21_admin_${TAG}`;
  let r = await request('POST', '/admin/admins', { body: { username, password: 'Abcdef123', nickname: 'S21管理员', role: 'admin' } });
  assert.equal(r.status, 201);
  const id = r.body.data.id;
  r = await request('GET', `/admin/admins?keyword=${username}`);
  assert.equal(r.body.data.pagination.total, 1);
  assert.equal(r.body.data.items[0].role, 'admin');
  r = await request('PUT', `/admin/admins/${id}`, { body: { password: 'Newpass456' } });
  assert.equal(r.status, 200);
  const stored = db.prepare('SELECT password FROM users WHERE id = ?').get(id);
  assert.ok(stored.password.startsWith('$2'), '密码应以 bcrypt 哈希落库');
  r = await request('DELETE', `/admin/admins/${id}`);
  assert.equal(r.status, 200);
});

test('[8] 角色 CRUD', async () => {
  const code = `s21_role_${TAG}`;
  let r = await request('POST', '/admin/roles', { body: { name: 'S21运营角色', code, description: '测试角色', permissions: ['user:manage', 'operation:view'] } });
  assert.equal(r.status, 201);
  r = await request('GET', '/admin/roles?keyword=' + code);
  assert.equal(r.body.data.pagination.total, 1);
  const id = r.body.data.items[0].id;
  r = await request('PUT', `/admin/roles/${id}`, { body: { status: 0 } });
  assert.equal(r.status, 200);
  r = await request('DELETE', `/admin/roles/${id}`);
  assert.equal(r.status, 200);
});

test('[9] 菜单 CRUD', async () => {
  const name = `S21菜单${TAG}`;
  let r = await request('POST', '/admin/menus', { body: { name, path: '/system/s21', icon: 'Setting', sort_order: 9 } });
  assert.equal(r.status, 201);
  M1 = r.body.data.id;
  r = await request('GET', '/admin/menus');
  const found = (r.body.data || []).find((it) => it.id === M1);
  assert.ok(found, '菜单列表应包含新建项');
  assert.equal(found.name, name);
  r = await request('PUT', `/admin/menus/${M1}`, { body: { visible: 0 } });
  assert.equal(r.status, 200);
  r = await request('DELETE', `/admin/menus/${M1}`);
  assert.equal(r.status, 200);
  M1 = null;
});

test('[10] 字典 CRUD', async () => {
  const type = `s21_dict_${TAG}`;
  let r = await request('POST', '/admin/dict', { body: { dict_type: type, label: '启用', value: '1', sort_order: 1 } });
  assert.equal(r.status, 201);
  D1 = r.body.data.id;
  r = await request('GET', `/admin/dict?dict_type=${type}`);
  assert.equal(r.body.data.items.length, 1);
  assert.ok(r.body.data.types.includes(type), 'types 应含新建字典类型');
  r = await request('PUT', `/admin/dict/${D1}`, { body: { label: '启用（改）' } });
  assert.equal(r.status, 200);
  r = await request('DELETE', `/admin/dict/${D1}`);
  assert.equal(r.status, 200);
  D1 = null;
});

test('[11] 参数 CRUD（唯一键校验）', async () => {
  const key = `s21_param_${TAG}`;
  let r = await request('POST', '/admin/params', { body: { param_key: key, param_value: '1', description: '测试参数' } });
  assert.equal(r.status, 201);
  P1 = r.body.data.id;
  r = await request('POST', '/admin/params', { body: { param_key: key, param_value: '2' } });
  assert.equal(r.status, 409, '重复参数键应返回 409');
  r = await request('PUT', `/admin/params/${P1}`, { body: { param_value: '2' } });
  assert.equal(r.status, 200);
  r = await request('DELETE', `/admin/params/${P1}`);
  assert.equal(r.status, 200);
  P1 = null;
});

test('[12] 日志检索（登录日志 + 操作审计）', async () => {
  const uname = `s21_diag_${TAG}`;
  let r = await request('GET', `/admin/logs/search?type=login&keyword=${uname}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.data.pagination.total >= 1, '应能检索到诊断用户的登录日志');
  r = await request('GET', '/admin/logs/search?type=audit&page_size=5');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data.items), '审计日志返回数组');
});

test('[13] 问题排查 diagnose 聚合', async () => {
  const r = await request('GET', '/admin/troubleshoot/diagnose?keyword=' + `s21_diag_${TAG}`);
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.user.id, U1);
  assert.equal(typeof d.user.point_balance, 'number', '应返回积分余额');
  assert.equal(d.orders.length, 1);
  assert.equal(d.orders[0].order_no, `s21_diag_ord_${TAG}`);
  assert.ok(d.login_logs.length >= 1);
  assert.ok(d.sessions.length >= 1);
  assert.ok(Array.isArray(d.dramas));
  assert.ok(Array.isArray(d.recharges));
});

test('[14] 无权限角色访问被拒（requireRole 拦截）', async () => {
  // 临时将 req.user 置为普通 user，验证 403
  const prev = reqUser;
  reqUser = { id: 900002212, role: 'user', nickname: 's21_user' };
  const r = await request('GET', '/admin/site/brand');
  assert.equal(r.status, 403, 'user 角色应被 requireRole 拒绝（403 权限不足）');
  reqUser = prev;
});
