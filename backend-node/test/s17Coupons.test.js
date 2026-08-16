'use strict';

/**
 * Sprint 17 - T17-02 优惠券管理集成测试（全链路：创建→兑换→下单抵扣→核销→关单回退）
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock。
 *   - 数据真实落库 coupons / coupon_redemptions / membership_orders / membership_plans。
 *   - 券码使用 S17T2_ 前缀、套餐等级 s17t2_ 前缀隔离，after 精确清理。
 *
 * 覆盖：
 *   [1] 管理端发放 amount 优惠券（真实落库）
 *   [2] 重复券码 → DUPLICATE_COUPON / 缺券码 → INVALID_ARGS
 *   [3] percent 折扣超 100 → INVALID_ARGS
 *   [4] 用户兑换 → 领取记录 + 库存 +1；重复兑换 → COUPON_ALREADY_CLAIMED
 *   [5] 未兑换直接下单抵扣 → COUPON_NOT_CLAIMED
 *   [6] 门槛不足 → COUPON_MIN_SPEND
 *   [7] 下单抵扣 amount 券：实付 = 原价 - 面额，订单记录优惠明细（含支付服务端到端）
 *   [8] 券已核销再次使用 → COUPON_ALREADY_USED
 *   [9] 库存耗尽 → COUPON_SOLD_OUT
 *   [10] 过期券兑换 → COUPON_EXPIRED
 *   [11] percent 券抵扣：9 折（value=10）
 *   [12] 关单回退 releaseCoupon：核销记录恢复 claimed
 *   [13] 管理端列表 / 领取记录 / 失效
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const membership = require(path.resolve(__dirname, '..', 'src', 'services', 'membershipService.js'));
const coupon = require(path.resolve(__dirname, '..', 'src', 'services', 'couponService.js'));
const payment = require(path.resolve(__dirname, '..', 'src', 'services', 'paymentService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);

// 隔离前缀（券码大写 + 等级小写）
const CODE_AMOUNT = `S17T2_AMT_${TAG}`;
const CODE_PERCENT = `S17T2_PCT_${TAG}`;
const CODE_STOCK = `S17T2_STK_${TAG}`;
const CODE_EXPIRED = `S17T2_EXP_${TAG}`;
const LEVEL = `s17t2_plan_${TAG}`;
const USER_ID = 900000002;

let couponAmountId;
let couponPercentId;
let couponStockId;
let couponExpiredId;
let planId;
let redeemId;

function cleanup() {
  const ids = db.prepare("SELECT id FROM coupons WHERE code LIKE 'S17T2\\_%'").all().map(r => r.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM coupon_redemptions WHERE coupon_id IN (${ph})`).run(...ids);
  }
  db.prepare("DELETE FROM membership_orders WHERE order_no LIKE 'S17T2%'").run();
  db.prepare("DELETE FROM coupons WHERE code LIKE 'S17T2\\_%'").run();
  db.prepare("DELETE FROM membership_plans WHERE level_code LIKE 's17t2\\_%'").run();
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();
});

test.after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

test('S17-T02 [1] 管理端发放 amount 优惠券', () => {
  const c = coupon.createCoupon(db, {
    code: CODE_AMOUNT,
    name: 'S17测试满减券',
    type: 'amount',
    value: 10,
    min_spend: 0,
    scope: 'membership',
    total_stock: 10,
    remark: 's17 测试',
  });
  couponAmountId = c.id;
  assert.ok(c.id > 0);
  assert.equal(c.code, CODE_AMOUNT);
  assert.equal(c.type, 'amount');
  assert.equal(Number(c.value), 10);
  assert.equal(c.total_stock, 10);
  assert.equal(c.used_count, 0);
  assert.equal(c.enabled, 1);
  // 直查库复核
  const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(c.id);
  assert.equal(row.code, CODE_AMOUNT);
});

test('S17-T02 [2] 券码校验：重复/缺失', () => {
  assert.throws(
    () => coupon.createCoupon(db, { code: CODE_AMOUNT, name: 'x' }),
    (e) => e.code === 'DUPLICATE_COUPON'
  );
  assert.throws(
    () => coupon.createCoupon(db, { name: '无券码' }),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('S17-T02 [3] percent 折扣率超 100 → INVALID_ARGS', () => {
  assert.throws(
    () => coupon.createCoupon(db, { code: `${CODE_AMOUNT}X`, name: 'x', type: 'percent', value: 101 }),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('S17-T02 [4] 用户兑换优惠券 + 防重复领取', () => {
  const r = coupon.redeemCoupon(db, USER_ID, CODE_AMOUNT);
  assert.equal(r.code, CODE_AMOUNT);
  // 库存 +1
  const c = coupon.getCouponByCode(db, CODE_AMOUNT);
  assert.equal(c.used_count, 1);
  const list = coupon.listUserCoupons(db, USER_ID);
  assert.ok(list.some(x => x.code === CODE_AMOUNT && x.status === 'claimed'));
  // 重复领取
  assert.throws(
    () => coupon.redeemCoupon(db, USER_ID, CODE_AMOUNT),
    (e) => e.code === 'COUPON_ALREADY_CLAIMED'
  );
});

test('S17-T02 [5] 未兑换直接下单 → COUPON_NOT_CLAIMED', () => {
  // 先创建 percent 券（[11] 复用），但不兑换
  const c = coupon.createCoupon(db, {
    code: CODE_PERCENT, name: 'S17九折券', type: 'percent', value: 10, total_stock: 10,
  });
  couponPercentId = c.id;
  assert.throws(
    () => coupon.consumeCoupon(db, USER_ID, CODE_PERCENT, 'S17T2_ORDER_NO_1', 50),
    (e) => e.code === 'COUPON_NOT_CLAIMED'
  );
});

test('S17-T02 [6] 使用门槛不足 → COUPON_MIN_SPEND', () => {
  const c = coupon.createCoupon(db, {
    code: `${CODE_AMOUNT}MS`, name: 'S17门槛券', type: 'amount', value: 5, min_spend: 30,
  });
  coupon.redeemCoupon(db, USER_ID, c.code);
  assert.throws(
    () => coupon.consumeCoupon(db, USER_ID, c.code, 'S17T2_ORDER_NO_2', 20),
    (e) => e.code === 'COUPON_MIN_SPEND'
  );
  // 清理门槛券
  db.prepare('DELETE FROM coupon_redemptions WHERE coupon_id = ?').run(c.id);
  db.prepare('DELETE FROM coupons WHERE id = ?').run(c.id);
});

test('S17-T02 [7] 下单抵扣（支付服务端到端）：订单记录优惠明细', () => {
  // 创建测试套餐（真实落库）
  const plan = membership.createPlan(db, {
    level_code: LEVEL, level_rank: 7, name: 'S17优惠联调套餐',
    price_monthly: 19.9, price_yearly: 199, quota_config: {}, benefits: [],
  });
  planId = plan.id;

  const created = payment.createOrder(db, log, {
    userId: USER_ID,
    levelCode: LEVEL,
    cycle: 'monthly',
    payMethod: 'wechat',
    couponCode: CODE_AMOUNT,
  });
  assert.equal(created.order.coupon_code, CODE_AMOUNT);
  assert.equal(Number(created.order.original_amount), 19.9, '优惠前应付 = 19.9');
  assert.equal(Number(created.order.discount_amount), 10, '抵扣 10');
  assert.equal(Number(created.order.amount), 9.9, '实付 = 9.9');

  // redemption 已核销并绑定订单
  const red = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?').get(couponAmountId, USER_ID);
  assert.equal(red.status, 'used');
  assert.equal(red.order_no, created.order.order_no);
  assert.equal(Number(red.amount), 10);
  // 库存不变（领取时已 +1）
  assert.equal(coupon.getCouponByCode(db, CODE_AMOUNT).used_count, 1);
});

test('S17-T02 [8] 券已核销再次使用 → COUPON_ALREADY_USED', () => {
  assert.throws(
    () => coupon.consumeCoupon(db, USER_ID, CODE_AMOUNT, 'S17T2_ORDER_NO_3', 30),
    (e) => e.code === 'COUPON_ALREADY_USED'
  );
});

test('S17-T02 [9] 库存耗尽 → COUPON_SOLD_OUT', () => {
  const c = coupon.createCoupon(db, {
    code: CODE_STOCK, name: 'S17限量券', type: 'amount', value: 5, total_stock: 1,
  });
  couponStockId = c.id;
  coupon.redeemCoupon(db, USER_ID, CODE_STOCK);
  assert.throws(
    () => coupon.redeemCoupon(db, 900000003, CODE_STOCK),
    (e) => e.code === 'COUPON_SOLD_OUT'
  );
});

test('S17-T02 [10] 过期券 → COUPON_EXPIRED', () => {
  const c = coupon.createCoupon(db, {
    code: CODE_EXPIRED, name: 'S17过期券', type: 'amount', value: 5,
    start_at: '2020-01-01 00:00:00', end_at: '2020-12-31 23:59:59',
  });
  couponExpiredId = c.id;
  assert.throws(
    () => coupon.redeemCoupon(db, USER_ID, CODE_EXPIRED),
    (e) => e.code === 'COUPON_EXPIRED'
  );
});

test('S17-T02 [11] percent 券抵扣：9 折（value=10）', () => {
  coupon.redeemCoupon(db, USER_ID, CODE_PERCENT);
  const r = coupon.consumeCoupon(db, USER_ID, CODE_PERCENT, 'S17T2_ORDER_NO_4', 100);
  assert.equal(r.discount, 10, '9 折：100 × 10% = 10');
});

test('S17-T02 [12] 关单回退：核销记录恢复 claimed', () => {
  // 先回退 [11] 的券，再核销一次验证 releaseCoupon
  const before = coupon.releaseCoupon(db, 'S17T2_ORDER_NO_4');
  assert.equal(before, 1);
  const red = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?').get(couponPercentId, USER_ID);
  assert.equal(red.status, 'claimed');
  assert.equal(red.order_no, null);
  // 回退后用户可再次核销
  coupon.consumeCoupon(db, USER_ID, CODE_PERCENT, 'S17T2_ORDER_NO_5', 50);
  const used = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?').get(couponPercentId, USER_ID);
  assert.equal(used.status, 'used');
  assert.equal(used.order_no, 'S17T2_ORDER_NO_5');
});

test('S17-T02 [13] 管理端列表 / 领取记录 / 失效', () => {
  const items = coupon.listCoupons(db, {});
  assert.ok(items.some(x => x.code === CODE_AMOUNT));

  const reds = coupon.listRedemptions(db, couponAmountId);
  assert.ok(reds.some(x => x.user_id === USER_ID && x.status === 'used'));

  const disabled = coupon.disableCoupon(db, couponStockId);
  assert.equal(disabled.enabled, 0);
  // 失效后不可再兑换
  assert.throws(
    () => coupon.redeemCoupon(db, 900000004, CODE_STOCK),
    (e) => e.code === 'COUPON_DISABLED'
  );
});
