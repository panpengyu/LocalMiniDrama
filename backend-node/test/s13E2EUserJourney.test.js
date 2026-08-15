'use strict';

/**
 * Sprint 13 端到端集成测试 — 用户全生命周期
 *
 * 场景：模拟一个真实用户从「注册 → 开通会员 → 生成内容 → 触发配额限制」的完整旅程，
 *      每一步都产生结构化日志，最终汇总为一份详细报告（同时输出到控制台与
 *      logs/s13_e2e_report_*.log 文件）。
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），全程无 mock、无 SQLite in-memory。
 *   - 数据真实落库：users / user_memberships / membership_orders / point_logs /
 *     recharges / membership_quota_usage。
 *   - 测试用户为「新注册的临时手机号账号」，after 阶段彻底清理，不污染业务数据。
 *
 * 流程编号：
 *   [1] 注册          authService.register → users 落库
 *   [2] 充值积分       point_logs 落库（模拟用户已购积分）
 *   [3] 下单会员       paymentService.createOrder（积分渠道 basic 月付）
 *   [4] 支付开通       paymentService.handlePaymentSuccess（扣积分 + 开通）
 *   [5] 生成内容       quotaService.checkAndConsumeGeneration × N（basic=300/月）
 *   [6] 触发配额       占满配额后再次生成 → QUOTA_EXCEEDED
 *   [7] 降级复核       降级到 free 后配额上限变为 30，验证即时反映
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const authService = require(path.resolve(__dirname, '..', 'src', 'services', 'authService.js'));
const membership = require(path.resolve(__dirname, '..', 'src', 'services', 'membershipService.js'));
const payment = require(path.resolve(__dirname, '..', 'src', 'services', 'paymentService.js'));
const quota = require(path.resolve(__dirname, '..', 'src', 'services', 'quotaService.js'));
const finance = require(path.resolve(__dirname, '..', 'src', 'services', 'financeService.js'));
const { snowflakeId } = require(path.resolve(__dirname, '..', 'src', 'utils', 'snowflake.js'));

// ---- 报告收集器 ----
const report = [];
const t0 = Date.now();
function step(no, title, detail) {
  const line = `[${String(no).padStart(2, '0')}] +${String(Date.now() - t0).padStart(5)}ms  ${title}`;
  report.push(line);
  if (detail) {
    for (const [k, v] of Object.entries(detail)) {
      report.push(`        · ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
}

let db;
let userId;
const TEST_PHONE = '199' + String(Date.now()).slice(-8); // 唯一临时手机号
const log = { info() {}, warn() {}, error() {} };

function purgeUser(uid) {
  if (!uid) return;
  db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(uid);
  db.prepare("DELETE FROM membership_orders WHERE user_id = ?").run(uid);
  db.prepare('DELETE FROM membership_quota_usage WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(uid);
  db.prepare("DELETE FROM recharges WHERE user_id = ?").run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
});

test.after(() => {
  // 输出报告
  const header = [
    '================================================================',
    ' Sprint 13 端到端集成测试报告 — 用户全生命周期',
    ` 生成时间: ${new Date().toISOString()}`,
    ` 测试账号: ${TEST_PHONE} (user_id=${userId})`,
    ` 数据库  : 本地 MySQL（真实落库，无 mock）`,
    '================================================================',
  ];
  const full = [...header, ...report, '================================================================'].join('\n');
  // 控制台
  console.log('\n' + full + '\n');
  // 文件
  try {
    const dir = path.resolve(__dirname, '..', 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `s13_e2e_report_${Date.now()}.log`);
    fs.writeFileSync(file, full, 'utf8');
    console.log(`报告已写入: ${file}\n`);
  } catch (e) { console.warn('写报告文件失败:', e.message); }

  try { purgeUser(userId); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

test('S13-E2E 用户全生命周期：注册→开通会员→生成内容→触发配额', () => {
  // ---- [1] 注册 ----
  const reg = authService.register(db, { phone: TEST_PHONE, password: 'test1234', nickname: 'S13集成测试' });
  userId = reg.user.id;
  assert.ok(userId, '注册应返回用户ID');
  assert.ok(reg.token, '注册应返回 token');
  const dbUser = db.prepare('SELECT id, phone, role, status FROM users WHERE id = ?').get(userId);
  assert.equal(dbUser.phone, TEST_PHONE, '用户应真实落库');
  step(1, '注册成功', { user_id: userId, phone: TEST_PHONE, role: dbUser.role, status: dbUser.status });

  // 新用户默认 free 会员
  const init = membership.getUserMembership(db, userId);
  assert.equal(init.levelCode, 'free', '新用户默认免费版');
  const freeLimit = quota.check(db, userId, 'generation').limit;
  step(1, '初始会员状态', { level: init.levelCode, 月生成上限: freeLimit });

  // ---- [2] 充值积分（真实写入 point_logs）----
  const grantPoints = 5000;
  const balBefore = finance.getUserBalance(db, userId);
  db.prepare(
    `INSERT INTO point_logs (id, user_id, change_type, business_type, amount, balance_after, remark, created_at)
     VALUES (?, ?, 'recharge', 'test', ?, ?, 'S13集成测试充值', NOW())`
  ).run(snowflakeId(), userId, grantPoints, balBefore + grantPoints);
  const balAfterGrant = finance.getUserBalance(db, userId);
  assert.equal(balAfterGrant, balBefore + grantPoints, '积分应真实入账');
  step(2, '充值积分', { 充值: grantPoints, 余额: balAfterGrant });

  // ---- [3] 下单会员（积分渠道 basic 月付）----
  const basic = membership.getPlanByLevel(db, 'basic');
  assert.ok(basic, '存在 basic 套餐');
  const { order, gateway, breakdown } = payment.createOrder(db, log, {
    userId, levelCode: 'basic', cycle: 'monthly', payMethod: 'points', autoRenew: false,
  });
  assert.equal(order.pay_status, 'pending', '下单后为待支付');
  assert.equal(order.pay_method, 'points');
  const dbOrder = db.prepare('SELECT * FROM membership_orders WHERE order_no = ?').get(order.order_no);
  assert.ok(dbOrder, '订单应真实落库');
  step(3, '创建会员订单(basic/月付/积分)', {
    order_no: order.order_no, order_type: order.order_type,
    应付金额元: order.amount, 需积分: gateway.need_points, breakdown,
  });

  // ---- [4] 支付开通（扣积分 + 开通会员，事务内）----
  const paid = payment.handlePaymentSuccess(db, log, { orderNo: order.order_no, autoRenew: false });
  assert.equal(paid.alreadyPaid, false);
  const balAfterPay = finance.getUserBalance(db, userId);
  const spent = Math.round(order.amount * finance.POINTS_PER_YUAN);
  assert.equal(balAfterPay, balAfterGrant - spent, '积分应按金额扣减');
  const memNow = membership.getUserMembership(db, userId);
  assert.equal(memNow.levelCode, 'basic', '支付后应为 basic 会员');
  assert.equal(memNow.isActive, true);
  const basicLimit = quota.check(db, userId, 'generation').limit;
  step(4, '支付成功并开通会员', {
    会员等级: memNow.levelCode, 扣减积分: spent, 剩余积分: balAfterPay,
    到期时间: memNow.membership.expires_at, 月生成上限: basicLimit,
  });

  // 幂等校验：重复回调不二次扣费
  const again = payment.handlePaymentSuccess(db, log, { orderNo: order.order_no });
  assert.equal(again.alreadyPaid, true, '重复支付应幂等');
  assert.equal(finance.getUserBalance(db, userId), balAfterPay, '重复回调不得二次扣费');
  step(4, '回调幂等校验通过', { 重复支付: '不二次扣费', 余额不变: balAfterPay });

  // ---- [5] 生成内容（消耗配额）----
  // 为使测试可控且真实触发上限，将 basic 月生成额度临时视为其配额值；
  // 直接消耗到接近上限（用真实 UPSERT 计数，落 membership_quota_usage）。
  const limit = basicLimit; // basic = 300
  // 先消耗 limit-2 次（批量自增，等效多次生成成功后的计数）
  quota.consumeGeneration(db, userId, limit - 2);
  let usage = quota.check(db, userId, 'generation');
  step(5, '已生成内容(批量计数至上限-2)', { used: usage.used, limit: usage.limit, remaining: usage.remaining });

  // 再正常走 2 次「校验并占用」
  const g1 = quota.checkAndConsumeGeneration(db, userId);
  const g2 = quota.checkAndConsumeGeneration(db, userId);
  step(5, '再生成2次(校验+原子占用)', { g1_used: g1.used, g2_used: g2.used, remaining: g2.remaining });
  assert.equal(g2.used, limit, '应恰好用满配额');
  assert.equal(g2.remaining, 0, '剩余额度归零');

  // ---- [6] 触发配额限制 ----
  let blocked = false;
  let errMsg = '';
  try {
    quota.checkAndConsumeGeneration(db, userId);
  } catch (e) {
    blocked = true;
    errMsg = e.message;
    assert.equal(e.code, 'QUOTA_EXCEEDED', '超限应抛 QUOTA_EXCEEDED');
  }
  assert.equal(blocked, true, '超过配额应被拦截');
  // 确认计数未被越界自增
  usage = quota.check(db, userId, 'generation');
  assert.equal(usage.used, limit, '超限拦截后计数不应越界');
  step(6, '触发配额限制(第301次被拒绝)', { blocked, code: 'QUOTA_EXCEEDED', message: errMsg, used: usage.used, limit: usage.limit });

  // ---- [7] 降级复核：降级 free 后上限即时反映 ----
  // 直接落库为 free（模拟到期降级），验证 quotaService 依当前套餐重新判定
  db.prepare("UPDATE user_memberships SET level_code='free', plan_id=(SELECT id FROM membership_plans WHERE level_code='free'), billing_cycle='monthly', status='active' WHERE user_id=?").run(userId);
  const freeCheck = quota.check(db, userId, 'generation');
  step(7, '降级 free 后配额复核', { level: 'free', 新上限: freeCheck.limit, 已用: freeCheck.used, allowed: freeCheck.allowed });
  assert.equal(freeCheck.limit, freeLimit, '降级后上限应回到 free 配额');
  // free 上限(30) < 已用(300)，应判定不允许继续
  assert.equal(freeCheck.allowed, false, '已用超过 free 上限应不允许再生成');

  step(99, '端到端流程全部通过', { 总耗时ms: Date.now() - t0 });
});
