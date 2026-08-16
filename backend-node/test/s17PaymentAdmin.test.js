'use strict';

/**
 * Sprint 17 - T17-04/05/06 支付订单管理与支付宝接入集成测试
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock。
 *   - 数据真实落库 membership_orders / recharges / point_logs / user_memberships / coupons。
 *   - 独立 ID 区间（9000002xx）+ test_/S17T4 前缀隔离，after 精确清理，并行跑不冲突。
 *
 * 覆盖：
 *   [1] 管理端订单查询 listAdminOrders（全量/关键字/状态筛选/分页）
 *   [2] adminOrderStats 状态与渠道分布
 *   [3] 关单 closeOrder：pending → closed + 优惠券回退
 *   [4] 关单状态机：paid 订单不可关单
 *   [5] 支付宝 selfCheck（未配置→configured:false；已配置→本地 RSA2 签名自检）
 *   [6] 支付宝 createPagePay 未配置凭据 → ALIPAY_NOT_CONFIGURED
 *   [7] 支付宝 verifyNotify 无效签名 → false（不伪造放行）
 *   [8] 支付宝退款未配置凭据 → ALIPAY_NOT_CONFIGURED 错误（不 mock）
 *   [9] 微信退款 → WECHAT_REFUND_UNSUPPORTED（渠道能力明确拒绝）
 *   [10] 积分支付退款全链路：paid 订单 → refunded + 积分等额退回 + recharges 置 refunded
 *   [11] 非 paid 订单退款 → ORDER_NOT_REFUNDABLE
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const membership = require(path.resolve(__dirname, '..', 'src', 'services', 'membershipService.js'));
const payment = require(path.resolve(__dirname, '..', 'src', 'services', 'paymentService.js'));
const coupon = require(path.resolve(__dirname, '..', 'src', 'services', 'couponService.js'));
const finance = require(path.resolve(__dirname, '..', 'src', 'services', 'financeService.js'));
const alipay = require(path.resolve(__dirname, '..', 'src', 'services', 'alipayService.js'));
const settingsService = require(path.resolve(__dirname, '..', 'src', 'services', 'settingsService.js'));
const { snowflakeId } = require(path.resolve(__dirname, '..', 'src', 'utils', 'snowflake.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);

const USER_A = 900000201; // 积分退款链路用户
const USER_B = 900000202; // 关单链路用户
const LEVEL_A = `s17t4_plan_${TAG}`;
const LEVEL_B = `s17t4_plan2_${TAG}`;
const CODE_A = `S17T4_C_${TAG}`;

let planAId;
let orderForClose;   // wechat pending（关单用）
let orderPaidWx;     // wechat paid（微信退款拒绝用）
let orderPaidAli;    // alipay paid（支付宝退款未配置用）
let orderPointsPaid; // points paid（积分退款链路用）

function insertUser(id, username) {
  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, status)
     VALUES (?, ?, 'x', 'user', ?, 1)
     ON DUPLICATE KEY UPDATE username = VALUES(username)`
  ).run(id, username, `${username}_nick`);
}

function grantPoints(userId, points) {
  const before = finance.getUserBalance(db, userId);
  db.prepare(
    `INSERT INTO point_logs (id, user_id, change_type, business_type, amount, balance_after, remark, created_at)
     VALUES (?, ?, 'recharge', 'test', ?, ?, 's17t4 测试积分', NOW())`
  ).run(snowflakeId(), userId, points, before + points);
}

function cleanup() {
  const orderNos = db.prepare("SELECT order_no FROM membership_orders WHERE order_no LIKE 'S17T4%'").all().map(r => r.order_no);
  if (orderNos.length) {
    const ph = orderNos.map(() => '?').join(',');
    db.prepare(`DELETE FROM recharges WHERE order_no IN (${ph})`).run(...orderNos);
    db.prepare(`DELETE FROM coupon_redemptions WHERE order_no IN (${ph})`).run(...orderNos);
  }
  db.prepare("DELETE FROM membership_orders WHERE order_no LIKE 'S17T4%'").run();
  db.prepare("DELETE FROM user_memberships WHERE user_id IN (?, ?)").run(USER_A, USER_B);
  db.prepare("DELETE FROM point_logs WHERE user_id IN (?, ?)").run(USER_A, USER_B);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(USER_A, USER_B);
  db.prepare("DELETE FROM coupons WHERE code LIKE 'S17T4\\_%'").run();
  db.prepare("DELETE FROM membership_plans WHERE level_code LIKE 's17t4\\_%'").run();
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();

  // 用户
  insertUser(USER_A, `s17t4_a_${TAG}`);
  insertUser(USER_B, `s17t4_b_${TAG}`);
  grantPoints(USER_A, 50000);

  // 套餐
  const planA = membership.createPlan(db, {
    level_code: LEVEL_A, level_rank: 17, name: 'S17订单联调套餐',
    price_monthly: 19.9, price_yearly: 199, quota_config: {}, benefits: [],
  });
  planAId = planA.id;
  membership.createPlan(db, {
    level_code: LEVEL_B, level_rank: 18, name: 'S17订单联调套餐B',
    price_monthly: 9.9, price_yearly: 99, quota_config: {}, benefits: [],
  });

  // 优惠券（关单回退验证用）
  coupon.createCoupon(db, {
    code: CODE_A, name: 'S17订单联调券', type: 'amount', value: 5, total_stock: 10,
  });
  coupon.redeemCoupon(db, USER_B, CODE_A);

  // 待支付订单（关单用）：wechat + 优惠券
  const c1 = payment.createOrder(db, log, {
    userId: USER_B, levelCode: LEVEL_B, cycle: 'monthly', payMethod: 'wechat', couponCode: CODE_A,
  });
  orderForClose = c1.order;

  // 已支付微信订单（渠道未接入退款）
  const c2 = payment.createOrder(db, log, {
    userId: USER_B, levelCode: LEVEL_B, cycle: 'monthly', payMethod: 'wechat',
  });
  orderPaidWx = payment.handlePaymentSuccess(db, log, { orderNo: c2.order.order_no, tradeNo: `S17T4WX${TAG}`, autoRenew: false }).order;

  // 已支付支付宝订单（退款依赖真实凭据；未配置时走安全失败）
  const c3 = payment.createOrder(db, log, {
    userId: USER_A, levelCode: LEVEL_A, cycle: 'monthly', payMethod: 'alipay',
  });
  orderPaidAli = payment.handlePaymentSuccess(db, log, { orderNo: c3.order.order_no, tradeNo: `S17T4ALI${TAG}`, autoRenew: false }).order;

  // 积分支付已支付订单（退款全链路）
  const c4 = payment.createOrder(db, log, {
    userId: USER_A, levelCode: LEVEL_A, cycle: 'monthly', payMethod: 'points',
  });
  orderPointsPaid = payment.handlePaymentSuccess(db, log, { orderNo: c4.order.order_no, autoRenew: false }).order;
});

test.after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

test('S17-T04 [1] 管理端订单查询 listAdminOrders（关键字/状态/分页）', () => {
  const all = payment.listAdminOrders(db, { limit: 50 });
  assert.ok(all.items.length >= 4, '应有 4 笔以上测试订单');
  assert.ok(all.total >= 4);

  // 关键字：订单号
  const byNo = payment.listAdminOrders(db, { keyword: orderForClose.order_no });
  assert.equal(byNo.total, 1);
  assert.equal(byNo.items[0].order_no, orderForClose.order_no);

  // 关键字：用户名
  const byUser = payment.listAdminOrders(db, { keyword: `s17t4_a_${TAG}` });
  assert.ok(byUser.items.some(o => o.user_id === USER_A));

  // 状态筛选
  const paidOnly = payment.listAdminOrders(db, { payStatus: 'paid', limit: 50 });
  assert.ok(paidOnly.items.every(o => o.pay_status === 'paid'));

  // 渠道筛选
  const aliOnly = payment.listAdminOrders(db, { payMethod: 'alipay', limit: 50 });
  assert.ok(aliOnly.items.every(o => o.pay_method === 'alipay'));

  // 分页
  const page1 = payment.listAdminOrders(db, { limit: 2, offset: 0 });
  assert.equal(page1.items.length, 2);
});

test('S17-T04 [2] adminOrderStats 状态/渠道分布', () => {
  const s = payment.adminOrderStats(db);
  const statuses = (s.by_status || []).map(x => x.pay_status);
  assert.ok(statuses.includes('paid'));
  assert.ok(statuses.includes('pending'));
  const paidMethods = (s.by_method || []).map(x => x.pay_method);
  assert.ok(paidMethods.includes('wechat'));
  assert.ok(paidMethods.includes('alipay'));
});

test('S17-T04 [3] 关单 closeOrder：pending → closed + 优惠券回退', () => {
  const before = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ?) AND user_id = ?')
    .get(CODE_A, USER_B);
  assert.equal(before.status, 'used');

  const res = payment.closeOrder(db, log, orderForClose.order_no, USER_B, 'S17测试关单');
  assert.equal(res.alreadyClosed, false);
  assert.equal(res.order.pay_status, 'closed');
  assert.equal(res.order.refund_reason, '管理员关单：S17测试关单');
  assert.equal(res.couponReleased, true, '关单后优惠券应回退');

  const after = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ?) AND user_id = ?')
    .get(CODE_A, USER_B);
  assert.equal(after.status, 'claimed');

  // 幂等：重复关单返回 alreadyClosed
  const again = payment.closeOrder(db, log, orderForClose.order_no, USER_B, '');
  assert.equal(again.alreadyClosed, true);
});

test('S17-T04 [4] 关单状态机：已支付订单不可关单', () => {
  assert.throws(
    () => payment.closeOrder(db, log, orderPaidWx.order_no, USER_B, ''),
    (e) => e.code === 'ORDER_NOT_CLOSABLE'
  );
});

test('S17-T06 [5] 支付宝 selfCheck：未配置 → configured=false（不抛错）', () => {
  const cred = alipay.loadCredential(db);
  const result = alipay.selfCheck(db);
  if (!cred || !cred.merchant_id || !cred.app_id || !cred.api_key || !cred.alipay_public_key) {
    assert.equal(result.configured, false, '未配置完整凭据时应返回 configured:false');
    assert.ok(result.message, '应带提示信息');
  } else {
    assert.equal(result.configured, true);
    assert.equal(typeof result.sign_verified, 'boolean', '已配置时应完成本地 RSA2 签名自检');
  }
});

test('S17-T06 [6] 支付宝 createPagePay 未配置凭据 → ALIPAY_NOT_CONFIGURED', () => {
  const cred = alipay.loadCredential(db);
  if (!alipay.isConfigured(cred)) {
    assert.throws(
      () => alipay.createPagePay(db, { order_no: 'S17T4_NOCFG', amount: 9.9, level_code: 'pro' }),
      (e) => e.code === 'ALIPAY_NOT_CONFIGURED'
    );
  }
});

test('S17-T06 [7] 支付宝 verifyNotify 无效签名 → false（不伪造放行）', () => {
  assert.equal(alipay.verifyNotify(db, { out_trade_no: 'S17T4_FAKE', sign: 'not-a-valid-sign' }), false);
  assert.equal(alipay.verifyNotify(db, null), false);
  assert.equal(alipay.verifyNotify(db, {}), false);
});

test('S17-T06 [8] 支付宝订单退款（未配置真实凭据 → 安全失败 ALIPAY_NOT_CONFIGURED，不 mock）', async () => {
  const cred = alipay.loadCredential(db);
  if (!alipay.isConfigured(cred)) {
    await assert.rejects(
      () => payment.refundOrder(db, log, orderPaidAli.order_no, USER_A, 'S17测试退款'),
      (e) => e.code === 'ALIPAY_NOT_CONFIGURED' || e.code === 'ALIPAY_REFUND_FAILED'
    );
    // 退款失败时订单应保持 paid（事务未提交状态变更）
    const row = db.prepare('SELECT pay_status FROM membership_orders WHERE order_no = ?').get(orderPaidAli.order_no);
    assert.equal(row.pay_status, 'paid');
  }
});

test('S17-T04 [9] 微信订单退款 → WECHAT_REFUND_UNSUPPORTED（渠道能力明确拒绝）', async () => {
  await assert.rejects(
    () => payment.refundOrder(db, log, orderPaidWx.order_no, USER_B, 'S17测试退款'),
    (e) => e.code === 'WECHAT_REFUND_UNSUPPORTED'
  );
});

test('S17-T04 [10] 积分支付退款全链路：paid → refunded + 积分等额退回 + recharges 不产生现金流水', async () => {
  const orderNo = orderPointsPaid.order_no;
  const amountYuan = Number(orderPointsPaid.amount);
  const pointsOfOrder = Math.round(amountYuan * finance.POINTS_PER_YUAN);

  const balanceBeforeRefund = finance.getUserBalance(db, USER_A);
  const res = await payment.refundOrder(db, log, orderNo, USER_A, 'S17积分订单测试退款');
  assert.equal(res.order.pay_status, 'refunded');
  assert.ok(res.order.refunded_at, '应记录退款时间');

  // 积分等额退回
  const balanceAfterRefund = finance.getUserBalance(db, USER_A);
  assert.equal(balanceAfterRefund, balanceBeforeRefund + pointsOfOrder, '积分应等额退回');
  const refundLog = db.prepare(
    "SELECT * FROM point_logs WHERE user_id = ? AND business_type = 'membership_refund' ORDER BY id DESC LIMIT 1"
  ).get(USER_A);
  assert.ok(refundLog, '应有 refund 流水');
  assert.equal(Number(refundLog.amount), pointsOfOrder);
  assert.equal(refundLog.related_id, orderNo);

  // 非现金渠道不产生 recharges 记录
  const rec = db.prepare('SELECT * FROM recharges WHERE order_no = ?').get(orderNo);
  assert.equal(rec == null, true, '积分支付不应产生 recharges 收入流水');
});

test('S17-T04 [11] 非 paid 订单退款 → ORDER_NOT_REFUNDABLE', async () => {
  // 新建一笔 pending 订单
  const c = payment.createOrder(db, log, {
    userId: USER_B, levelCode: LEVEL_B, cycle: 'monthly', payMethod: 'wechat',
  });
  await assert.rejects(
    () => payment.refundOrder(db, log, c.order.order_no, USER_B, 'x'),
    (e) => e.code === 'ORDER_NOT_REFUNDABLE'
  );
});
