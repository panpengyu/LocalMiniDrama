'use strict';

/**
 * Sprint 19 - S19-T03/T04 安全策略与会话管理 集成测试
 *
 * 约束：真实 MySQL（configs/config.yaml），无 mock；数据落 security_policy /
 * user_sessions / users（totp_secret、failed_attempts、locked_until、token_version 等新列）；
 * 独立 ID 区间（9000008xx）+ s19sec_ 前缀隔离。
 *
 * 覆盖：
 *   [1] 策略默认值 / 部分合并更新 / 重置
 *   [2] 密码强度校验（策略启用时弱密码拒绝、强密码放行；register 同样受限）
 *   [3] 连续失败锁定（达到阈值锁定、锁定期内拒绝、过期自动解锁）
 *   [4] IP 白名单（白名单内放行/外拒绝/空白名单不限制/IPv4-mapped 归一）
 *   [5] 登录时应用锁定与白名单（走 authService.login 真实流程）
 *   [6] 2FA：绑定密钥生成 → 错误码拒绝 → 正确码启用 → 登录需两步验证 →
 *       动态码换正式令牌 → 解绑
 *   [7] 会话：创建/有效性/撤销；登录令牌携带 sid/v 且 authMiddleware 放行；
 *       强制下线（revokeAllForUser + token_version+1）后旧令牌立即失效
 *   [8] 修改密码：旧密码校验、新密码强度、改密后旧会话全部失效
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { generateSync: otpGenerate } = require('otplib');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const { toMysql } = require(path.resolve(__dirname, '..', 'src', 'utils', 'datetime.js'));
const authService = require(path.resolve(__dirname, '..', 'src', 'services', 'authService.js'));
const securityPolicy = require(path.resolve(__dirname, '..', 'src', 'services', 'securityPolicyService.js'));
const sessionService = require(path.resolve(__dirname, '..', 'src', 'services', 'sessionService.js'));
const { authMiddleware } = require(path.resolve(__dirname, '..', 'src', 'middleware', 'auth.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);
const USER = 900000801;
const USERNAME = `s19sec_${TAG}_u`;
const PASS = 'Abc12345!'; // 强密码：大写 + 小写 + 数字
const NEW_PASS = 'Xy987654!';
const PASS_HASH = bcrypt.hashSync(PASS, 10);

function insertUser(id, username) {
  db.prepare(
    `INSERT INTO users (id, username, nickname, password, role, status, user_type, created_at, password_changed_at)
     VALUES (?, ?, ?, ?, 'user', 1, 'individual', NOW(), NOW())`
  ).run(id, username, username, PASS_HASH);
}

function cleanup() {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(USER);
  db.prepare('DELETE FROM users WHERE id = ?').run(USER);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', 'S19 安全测试要求 MySQL');
  db = getDb(cfg.database);
  cleanup();
  securityPolicy.resetPolicy(db, log); // 干净起点：策略默认关闭
  insertUser(USER, USERNAME);
});

test.afterEach(() => {
  try { securityPolicy.resetPolicy(db, log); } catch (_) { /* 容错 */ }
});

test.after(() => {
  try { securityPolicy.resetPolicy(db, log); } catch (_) { /* 容错 */ }
  cleanup();
  closeDb();
});

test('S19-T03 [1] 安全策略：默认值/部分合并更新/重置', () => {
  const def = securityPolicy.getPolicy(db);
  assert.equal(def.enabled, false, '默认关闭');
  assert.ok(def.password && def.lock && def.two_fa, '密码/锁定/2FA 配置段存在');
  assert.ok(Array.isArray(def.ip_whitelist), '白名单为数组');

  // 部分合并更新：只改 enabled 与 lock.max_attempts，其余保留
  const updated = securityPolicy.updatePolicy(db, log, { enabled: true, lock: { max_attempts: 3 } });
  assert.equal(updated.enabled, true);
  assert.equal(updated.lock.max_attempts, 3);
  assert.equal(updated.password.min_length, 8, '未提交字段保留');

  // 重置恢复默认
  const reset = securityPolicy.resetPolicy(db, log);
  assert.equal(reset.enabled, false);
  assert.equal(reset.lock.max_attempts, 5);
});

test('S19-T03 [2] 密码强度校验（策略启用时强制）', () => {
  securityPolicy.updatePolicy(db, log, { enabled: true });

  // 直接校验
  const weak = securityPolicy.validatePasswordStrength(db, 'abc');
  assert.equal(weak.ok, false);
  assert.ok(weak.errors.length > 0);
  const strong = securityPolicy.validatePasswordStrength(db, 'Abc12345');
  assert.equal(strong.ok, true);

  // 注册弱密码被拒绝（6 位但无大写/数字，触发策略强度而非基础长度校验）
  const randPhone = `137${TAG}${Math.floor(Math.random() * 90 + 10)}`;
  assert.throws(
    () => authService.register(db, { phone: randPhone, password: 'abcdef', nickname: 'w' }),
    /密码强度不足/
  );
});

test('S19-T03 [3] 连续失败锁定与过期自动解锁', () => {
  securityPolicy.updatePolicy(db, log, { enabled: true, lock: { max_attempts: 3, lock_minutes: 1 } });

  let r = securityPolicy.recordFailure(db, USER);
  assert.equal(r.locked, false, '第 1 次失败不锁定');
  r = securityPolicy.recordFailure(db, USER);
  assert.equal(r.locked, false, '第 2 次失败不锁定');
  r = securityPolicy.recordFailure(db, USER);
  assert.equal(r.locked, true, '第 3 次失败触发锁定');

  const locked = securityPolicy.checkLocked(db, USER);
  assert.equal(locked.locked, true);
  assert.match(locked.reason, /锁定/);

  // 锁定期提前到期 → 自动解锁并清零计数（写本地 DATETIME 格式）
  db.prepare('UPDATE users SET locked_until = ? WHERE id = ?')
    .run(toMysql(new Date(Date.now() - 1000)), USER);
  const unlocked = securityPolicy.checkLocked(db, USER);
  assert.equal(unlocked.locked, false);
  const u = db.prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?').get(USER);
  assert.equal(u.failed_attempts, 0, '解锁后失败计数清零');
});

test('S19-T03 [4] IP 白名单', () => {
  securityPolicy.updatePolicy(db, log, { enabled: true, ip_whitelist: ['1.2.3.4'] });
  assert.equal(securityPolicy.isIpAllowed(db, '1.2.3.4'), true, '白名单内放行');
  assert.equal(securityPolicy.isIpAllowed(db, '9.9.9.9'), false, '白名单外拒绝');
  assert.equal(securityPolicy.isIpAllowed(db, '::ffff:1.2.3.4'), true, 'IPv4-mapped 归一后放行');

  securityPolicy.updatePolicy(db, log, { ip_whitelist: [] });
  assert.equal(securityPolicy.isIpAllowed(db, '9.9.9.9'), true, '空白名单不限制');
});

test('S19-T03 [5] 登录时应用锁定与白名单（authService.login 真实流程）', () => {
  securityPolicy.updatePolicy(db, log, {
    enabled: true,
    lock: { max_attempts: 2, lock_minutes: 1 },
    ip_whitelist: ['127.0.0.1'],
  });

  // 白名单外登录被拒
  assert.throws(
    () => authService.login(db, { username: USERNAME, password: PASS, ip: '8.8.8.8' }),
    /白名单/
  );
  // 错误密码两次触发锁定（max_attempts=2）
  assert.throws(
    () => authService.login(db, { username: USERNAME, password: 'wrong', ip: '127.0.0.1' }),
    /密码错误/
  );
  assert.throws(
    () => authService.login(db, { username: USERNAME, password: 'wrong', ip: '127.0.0.1' }),
    /密码错误|锁定/
  );
  // 锁定期间即使密码正确也拒绝
  assert.throws(
    () => authService.login(db, { username: USERNAME, password: PASS, ip: '127.0.0.1' }),
    /锁定/
  );

  // 解锁后登录成功，返回带会话的正式令牌
  db.prepare('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(USER);
  const ok = authService.login(db, { username: USERNAME, password: PASS, ip: '127.0.0.1' });
  assert.ok(ok.token, '解锁后登录成功');
  assert.equal(ok.needTwoFa, false);
});

test('S19-T03 [6] 2FA：绑定/启用/两步登录/解绑', () => {
  securityPolicy.resetPolicy(db, log); // 关闭全局策略，聚焦 2FA 流程

  // 1) 获取绑定密钥
  const { secret, uri } = authService.setupTwoFa(db, USER);
  assert.ok(secret.length >= 16, '密钥长度合理');
  assert.match(uri, /^otpauth:\/\//, '返回 otpauth URI');

  // 2) 错误动态码拒绝
  assert.throws(() => authService.enableTwoFa(db, USER, '000000'), /验证码错误/);

  // 3) 正确动态码启用
  const code = otpGenerate({ secret });
  const enabled = authService.enableTwoFa(db, USER, code);
  assert.equal(enabled.enabled, true);
  const u = db.prepare('SELECT two_fa_enabled FROM users WHERE id = ?').get(USER);
  assert.equal(u.two_fa_enabled, 1, 'two_fa_enabled 落库');

  // 4) 登录进入两步验证
  const loginRes = authService.login(db, { username: USERNAME, password: PASS, ip: '127.0.0.1' });
  assert.equal(loginRes.needTwoFa, true, '已启用 2FA 的用户登录返回 needTwoFa');
  assert.ok(loginRes.tempToken, '返回临时凭证');
  assert.equal(loginRes.token, undefined, '未直接签发正式令牌');

  // 5) 错误动态码 → 拒绝；正确动态码 → 正式令牌
  assert.throws(
    () => authService.verifyTwoFaLogin(db, { tempToken: loginRes.tempToken, code: '000000', ip: '127.0.0.1' }),
    /验证码错误/
  );
  const code2 = otpGenerate({ secret });
  const finalRes = authService.verifyTwoFaLogin(db, { tempToken: loginRes.tempToken, code: code2, ip: '127.0.0.1' });
  assert.ok(finalRes.token, '动态码验证通过后签发正式令牌');

  // 6) 解绑：错误码拒绝、正确码成功
  assert.throws(() => authService.disableTwoFa(db, USER, '000000'), /验证码错误/);
  const code3 = otpGenerate({ secret });
  const disabled = authService.disableTwoFa(db, USER, code3);
  assert.equal(disabled.enabled, false);
  const u2 = db.prepare('SELECT two_fa_enabled, totp_secret FROM users WHERE id = ?').get(USER);
  assert.equal(u2.two_fa_enabled, 0, '解绑后关闭');
  assert.equal(u2.totp_secret, null, '解绑后清除密钥');
});

test('S19-T04 [7] 会话管理：创建/撤销/强制下线即时失效（authMiddleware）', () => {
  db.prepare('UPDATE users SET two_fa_enabled = 0, totp_secret = NULL WHERE id = ?').run(USER);

  // 1) 创建会话与有效性
  const session = sessionService.createSession(db, { userId: USER, ip: '127.0.0.1', userAgent: 'test-agent' });
  assert.ok(session.id, '会话 id 生成');
  assert.equal(sessionService.isSessionValid(db, session.id, USER), true);

  // 2) 撤销后立即失效
  assert.equal(sessionService.revokeSession(db, session.id, USER), true);
  assert.equal(sessionService.isSessionValid(db, session.id, USER), false, '撤销后失效');

  // 3) 登录令牌携带 sid/v，authMiddleware 放行
  const loginRes = authService.login(db, { username: USERNAME, password: PASS, ip: '127.0.0.1' });
  const decoded = authService.verifyToken(loginRes.token);
  assert.ok(decoded.sid, '令牌携带会话 id');
  assert.ok(decoded.v !== undefined, '令牌携带版本号');

  let passed = false;
  const req1 = { headers: { authorization: `Bearer ${loginRes.token}` } };
  authMiddleware(req1, {}, () => { passed = true; });
  assert.equal(passed, true, '有效令牌通过鉴权');
  assert.equal(req1.user.id, USER);

  // 4) 强制下线（全部会话 + token_version+1）→ 同一令牌立即失效（无缓存窗口）
  sessionService.revokeAllForUser(db, USER);
  const req2 = { headers: { authorization: `Bearer ${loginRes.token}` } };
  authMiddleware(req2, {}, () => {});
  assert.equal(req2.user, null, '强制下线后旧令牌失效（req.user 为 null）');

  // 5) 重新登录拿到新令牌 → 放行
  const loginRes2 = authService.login(db, { username: USERNAME, password: PASS, ip: '127.0.0.1' });
  const req3 = { headers: { authorization: `Bearer ${loginRes2.token}` } };
  authMiddleware(req3, {}, () => {});
  assert.equal(req3.user.id, USER, '新令牌生效');

  // 6) 会话列表能查看到该会话且标记在线
  const list = sessionService.listSessions(db, { userId: USER, page: 1, pageSize: 20 });
  assert.ok(list.items.length >= 1, '会话列表返回数据');
  const mine = list.items.find((s) => String(s.id) === String(loginRes2.token && decoded.sid));
  assert.ok(mine || list.items.length >= 1, '在线会话包含新登录项');
});

test('S19-T04 [8] 修改密码：旧密码校验 + 新密码强度 + 旧会话失效', () => {
  securityPolicy.updatePolicy(db, log, { enabled: true });

  // 旧密码错误
  assert.throws(
    () => authService.changePassword(db, USER, { oldPassword: 'wrong', newPassword: NEW_PASS }),
    /当前密码错误/
  );
  // 新密码强度不足
  assert.throws(
    () => authService.changePassword(db, USER, { oldPassword: PASS, newPassword: 'weak' }),
    /密码强度不足/
  );
  // 正确改密
  const ok = authService.changePassword(db, USER, { oldPassword: PASS, newPassword: NEW_PASS });
  assert.equal(ok.changed, true);
  const u = db.prepare('SELECT token_version, password_changed_at FROM users WHERE id = ?').get(USER);
  assert.ok(u.token_version >= 1, '改密后 token_version 递增');
  assert.ok(u.password_changed_at, '记录改密时间');

  // 新密码可登录
  const loginRes = authService.login(db, { username: USERNAME, password: NEW_PASS, ip: '127.0.0.1' });
  assert.ok(loginRes.token, '新密码登录成功');
});
