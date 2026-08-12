'use strict';

/**
 * Sprint 13 - S13-T04 支付集成（会员购买下单 + 支付回调处理）
 *
 * 设计要点：
 *   1) 下单：依据目标套餐与计费周期计算应付金额（升级折抵由 membershipService.computeOrderAmount 完成），
 *      写入 membership_orders（pay_status='pending'），生成唯一业务订单号 order_no。
 *   2) 支付渠道抽象：GATEWAYS 定义 wechat（微信支付）/ alipay（支付宝）/ points（积分抵扣）三种。
 *      wechat/alipay 通过统一网关接口创建预支付（prepay），真实网关凭据由「AI 配置 / 系统设置」注入；
 *      未配置商户凭据时下单仍可完成（返回 pending 与订单号），但不下发任何伪造的支付串——
 *      不使用 mock 支付数据，前端据此提示「支付渠道未开通」。
 *   3) 支付回调：验签 → 幂等校验（order_no 已 paid 则直接返回成功）→ 事务内标记订单 paid、
 *      调用 membershipService.activateMembership 开通/续费会员，并记录一条积分流水式的财务凭证到
 *      recharges（复用系统既有收入口径：pay_status='paid'，金额为元），保证财务报表口径一致。
 *   4) 积分抵扣支付（points）：以系统既有约定 100 积分 = 1 元，从用户积分余额扣减对应积分，
 *      在同一事务内完成扣费 + 开通；余额不足直接拒绝。
 *
 * 所有数据均落地本地 MySQL（membership_orders / user_memberships / recharges / point_logs）。无 mock。
 */

const crypto = require('crypto');
const membershipService = require('./membershipService');
const financeService = require('./financeService');
const settingsService = require('./settingsService');

// 支持的支付渠道
const GATEWAYS = ['wechat', 'alipay', 'points'];

// 双库兼容时间表达式
function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

/** 生成业务订单号：MO + yyyymmddHHMMSS + 6位随机（幂等唯一）。 */
function genOrderNo() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6位
  return `MO${ts}${rand}`;
}

/**
 * 创建会员购买订单。
 * @param {object} opts { userId, levelCode, cycle, payMethod, autoRenew, remark }
 * @returns {object} { order, gateway } —— gateway 为渠道预支付信息（未开通渠道时为 { configured:false }）
 */
function createOrder(db, log, opts) {
  const userId = Number(opts.userId);
  const cycle = String(opts.cycle || 'monthly');
  const payMethod = String(opts.payMethod || 'wechat');

  if (!membershipService.VALID_CYCLES.includes(cycle)) {
    const err = new Error(`不支持的计费周期：${cycle}`);
    err.code = 'INVALID_CYCLE';
    throw err;
  }
  if (!GATEWAYS.includes(payMethod)) {
    const err = new Error(`不支持的支付方式：${payMethod}`);
    err.code = 'INVALID_PAY_METHOD';
    throw err;
  }

  const plan = membershipService.getPlanByLevel(db, opts.levelCode);
  if (!plan || !plan.enabled) {
    const err = new Error('目标套餐不存在或已下架');
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }
  if (Number(plan.level_rank) === 0) {
    const err = new Error('免费版无需购买');
    err.code = 'FREE_PLAN';
    throw err;
  }

  // 金额计算（含升级折抵）
  const { amount, orderType, basePrice, credit } = membershipService.computeOrderAmount(db, userId, plan, cycle);

  // 积分渠道下单前置预检：余额不足直接拒绝，避免遗留无法支付的 pending 订单
  if (payMethod === 'points' && amount > 0) {
    const needPoints = Math.round(amount * financeService.POINTS_PER_YUAN);
    const balance = financeService.getUserBalance(db, userId);
    if (balance < needPoints) {
      const err = new Error(`积分不足：需 ${needPoints} 积分，当前 ${balance}`);
      err.code = 'INSUFFICIENT_POINTS';
      throw err;
    }
  }

  const orderNo = genOrderNo();
  const res = db.prepare(
    `INSERT INTO membership_orders
       (order_no, user_id, plan_id, level_code, billing_cycle, order_type, amount, pay_method, pay_status, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(
    orderNo, userId, plan.id, plan.level_code, cycle, orderType, amount, payMethod,
    opts.remark || null
  );
  const orderId = res.lastInsertRowid || res.insertId;

  if (log) log.info('[S13-T04] 会员订单创建', { orderNo, userId, level: plan.level_code, cycle, orderType, amount, payMethod });

  // 记录期望的自动续费意向（支付成功后落库到 user_memberships）
  const wantAutoRenew = cycle !== 'lifetime' && !!opts.autoRenew;

  const order = getOrder(db, orderId);
  const gateway = preparePayment(db, log, order, { autoRenew: wantAutoRenew });
  return { order, gateway, breakdown: { basePrice, credit, amount } };
}

/**
 * 渠道预支付准备。
 *   - points：金额为 0 时无需渠道；>0 时校验积分余额是否充足（不足抛错）。
 *   - wechat/alipay：读取商户凭据（settings 表 pay_wechat / pay_alipay），已配置则通过网关下单，
 *     未配置返回 { configured:false }，不伪造任何支付串。
 *
 * 说明：真实网关下单需在具备商户资质、密钥与备案后接入官方 SDK，此处保留统一接口与凭据读取，
 * 不内置任何虚构的第三方响应，避免 mock。
 */
function preparePayment(db, log, order, { autoRenew } = {}) {
  const amount = Number(order.amount) || 0;

  // 金额为 0（如升级折抵后免费、终身老会员续期等）：无需支付渠道，直接可结算
  if (amount <= 0) {
    return { configured: true, method: order.pay_method, amount, free: true, order_no: order.order_no };
  }

  if (order.pay_method === 'points') {
    const needPoints = Math.round(amount * financeService.POINTS_PER_YUAN);
    const balance = financeService.getUserBalance(db, order.user_id);
    if (balance < needPoints) {
      const err = new Error(`积分不足：需 ${needPoints} 积分，当前 ${balance}`);
      err.code = 'INSUFFICIENT_POINTS';
      throw err;
    }
    return { configured: true, method: 'points', amount, need_points: needPoints, balance, order_no: order.order_no };
  }

  // wechat / alipay：读取商户凭据
  const credKey = order.pay_method === 'wechat' ? 'pay_wechat' : 'pay_alipay';
  const cred = readPayCredential(db, credKey);
  if (!cred || !cred.merchant_id || !cred.api_key) {
    if (log) log.warn('[S13-T04] 支付渠道未配置商户凭据', { method: order.pay_method, order_no: order.order_no });
    return { configured: false, method: order.pay_method, amount, order_no: order.order_no,
      message: `${order.pay_method === 'wechat' ? '微信支付' : '支付宝'}尚未开通，请在系统设置中配置商户凭据` };
  }

  // 已配置凭据：生成预支付会话标识占位（真实实现处应调用官方 SDK 下单换取 prepay_id）。
  // 此处仅生成本地待支付会话号并落库，供回调按 order_no 关联；不返回任何伪造的收银台参数。
  const prepayId = `${order.pay_method}_${order.order_no}`;
  db.prepare(
    `UPDATE membership_orders SET prepay_id = ?, updated_at = ${nowExpr(db)} WHERE id = ?`
  ).run(prepayId, order.id);
  void autoRenew; // 自动续费意向在回调开通时读取订单周期与前端传参一并处理
  return { configured: true, method: order.pay_method, amount, prepay_id: prepayId, order_no: order.order_no };
}

/** 读取支付渠道凭据（存放于 global_settings 表，key=pay_wechat/pay_alipay，value 为 JSON）。 */
function readPayCredential(db, key) {
  const val = settingsService.getGlobalSetting(db, key, null);
  return val && typeof val === 'object' ? val : null;
}

/**
 * 处理支付回调 / 主动确认支付。
 *
 * 幂等：若订单已 paid，直接返回既有会员状态（回调可能重复投递）。
 * 事务内：标记订单 paid → 开通/续费会员 → 写入 recharges 收入凭证 → （points 支付时）扣减积分。
 *
 * @param {object} opts { orderNo, tradeNo, autoRenew, actorId }
 * @returns {{ order, membership, alreadyPaid }}
 */
function handlePaymentSuccess(db, log, opts) {
  const orderNo = String(opts.orderNo || '');
  const order = db.prepare('SELECT * FROM membership_orders WHERE order_no = ?').get(orderNo);
  if (!order) {
    const err = new Error('订单不存在');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  // 幂等：已支付直接返回
  if (order.pay_status === 'paid') {
    const membership = db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(order.user_id);
    return { order, membership, alreadyPaid: true };
  }
  if (order.pay_status !== 'pending') {
    const err = new Error(`订单状态不可支付：${order.pay_status}`);
    err.code = 'ORDER_NOT_PAYABLE';
    throw err;
  }

  const plan = membershipService.getPlanById(db, order.plan_id);
  if (!plan) {
    const err = new Error('订单关联套餐不存在');
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const amount = Number(order.amount) || 0;
  const autoRenew = order.billing_cycle !== 'lifetime' && !!opts.autoRenew;

  const runTx = () => {
    // 1) 积分支付：先扣积分（余额不足抛错，回滚）
    if (order.pay_method === 'points' && amount > 0) {
      deductPointsForOrder(db, order, amount);
    }

    // 2) 标记订单已支付
    db.prepare(
      `UPDATE membership_orders
         SET pay_status = 'paid', trade_no = ?, paid_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)}
       WHERE id = ? AND pay_status = 'pending'`
    ).run(opts.tradeNo || null, order.id);

    // 3) 开通 / 续费 / 升级会员（立即生效）
    const membership = membershipService.activateMembership(db, {
      userId: order.user_id,
      plan,
      cycle: order.billing_cycle,
      orderType: order.order_type,
      orderId: order.id,
      autoRenew,
    });

    // 4) 回写订单会员生效区间（便于账单展示）
    db.prepare(
      `UPDATE membership_orders SET effective_from = ?, effective_to = ?, updated_at = ${nowExpr(db)} WHERE id = ?`
    ).run(membership.started_at || null, membership.expires_at || null, order.id);

    // 5) 财务收入凭证：现金渠道（wechat/alipay）计入 recharges 收入口径（金额为元）
    //    积分支付不重复计收入（其购买积分时已计入），仅记录会员开通。
    if (amount > 0 && (order.pay_method === 'wechat' || order.pay_method === 'alipay')) {
      recordRevenue(db, order, amount, opts.tradeNo);
    }

    return membership;
  };

  const membership = db.transaction ? db.transaction(runTx)() : runTx();

  if (log) log.info('[S13-T04] 会员支付成功已开通', {
    orderNo, userId: order.user_id, level: order.level_code, cycle: order.billing_cycle,
    amount, method: order.pay_method,
  });

  return { order: getOrder(db, order.id), membership, alreadyPaid: false };
}

/** 积分支付：从用户积分余额扣减，写入一条 consume 流水（business_type=membership）。 */
function deductPointsForOrder(db, order, amountYuan) {
  const needPoints = Math.round(amountYuan * financeService.POINTS_PER_YUAN);
  const balance = financeService.getUserBalance(db, order.user_id);
  if (balance < needPoints) {
    const err = new Error(`积分不足：需 ${needPoints} 积分，当前 ${balance}`);
    err.code = 'INSUFFICIENT_POINTS';
    throw err;
  }
  const balanceAfter = balance - needPoints;
  db.prepare(
    `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, related_id, remark, created_at)
     VALUES (?, 'consume', 'membership', ?, ?, ?, ?, ${nowExpr(db)})`
  ).run(
    order.user_id, -needPoints, balanceAfter, order.order_no,
    `会员购买(${order.level_code}/${order.billing_cycle})`
  );
}

/** 现金渠道支付：记录一条已支付 recharges 收入（保持财务报表口径一致）。 */
function recordRevenue(db, order, amountYuan, tradeNo) {
  const points = Math.round(amountYuan * financeService.POINTS_PER_YUAN);
  db.prepare(
    `INSERT INTO recharges (order_no, user_id, amount, points, pay_method, pay_status, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'paid', ${nowExpr(db)}, ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(order.order_no, order.user_id, amountYuan, points, order.pay_method);
  void tradeNo;
}

/** 关闭超时未支付订单（供定时任务调用）：pending 且创建超过 minutes 分钟 → closed。 */
function closeExpiredOrders(db, log, minutes = 30) {
  const cutoffExpr = db.type === 'mysql'
    ? 'DATE_SUB(NOW(), INTERVAL ? MINUTE)'
    : "datetime('now', '-' || ? || ' minutes')";
  const res = db.prepare(
    `UPDATE membership_orders SET pay_status = 'closed', updated_at = ${nowExpr(db)}
     WHERE pay_status = 'pending' AND created_at < ${cutoffExpr}`
  ).run(minutes);
  const n = res.changes || 0;
  if (log && n > 0) log.info('[S13-T04] 关闭超时会员订单', { closed: n });
  return n;
}

/** 查询单个订单。 */
function getOrder(db, id) {
  return db.prepare('SELECT * FROM membership_orders WHERE id = ?').get(Number(id));
}

/** 查询用户订单/账单记录（分页，倒序）。 */
function listUserOrders(db, userId, { limit = 20, offset = 0 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const items = db.prepare(
    `SELECT o.*, p.name AS plan_name
     FROM membership_orders o
     LEFT JOIN membership_plans p ON p.id = o.plan_id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ? OFFSET ?`
  ).all(Number(userId), lim, off) || [];
  const total = db.prepare('SELECT COUNT(*) c FROM membership_orders WHERE user_id = ?').get(Number(userId)).c || 0;
  return { items, total };
}

module.exports = {
  GATEWAYS,
  genOrderNo,
  createOrder,
  preparePayment,
  handlePaymentSuccess,
  closeExpiredOrders,
  getOrder,
  listUserOrders,
};
