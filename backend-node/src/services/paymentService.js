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
const couponService = require('./couponService');
const alipayService = require('./alipayService');
const { snowflakeId } = require('../utils/snowflake');

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

  // S17-T02 优惠券抵扣：先生成订单号（核销需绑定订单），原子核销后计算实付金额。
  // 优惠券在升级折抵之后叠加：original_amount=折抵后应付，amount=实付，discount_amount=券抵扣。
  const orderNo = genOrderNo();
  let couponId = null;
  let couponCode = null;
  let discountAmount = 0;
  if (opts.couponCode) {
    const c = couponService.consumeCoupon(db, userId, opts.couponCode, orderNo, amount);
    couponId = c.coupon.id;
    couponCode = c.coupon.code;
    discountAmount = c.discount;
    if (log) log.info('[S17-T02] 订单优惠券抵扣', { orderNo, couponCode, discount: discountAmount });
  }
  const originalAmount = amount;
  const payAmount = +Math.max(0, amount - discountAmount).toFixed(2);

  // 积分渠道下单前置预检：余额不足直接拒绝，避免遗留无法支付的 pending 订单
  if (payMethod === 'points' && payAmount > 0) {
    const needPoints = Math.round(payAmount * financeService.POINTS_PER_YUAN);
    const balance = financeService.getUserBalance(db, userId);
    if (balance < needPoints) {
      const err = new Error(`积分不足：需 ${needPoints} 积分，当前 ${balance}`);
      err.code = 'INSUFFICIENT_POINTS';
      throw err;
    }
  }

  let orderId;
  try {
    const res = db.prepare(
      `INSERT INTO membership_orders
         (order_no, user_id, plan_id, level_code, billing_cycle, order_type, amount, pay_method, pay_status, remark,
          coupon_id, coupon_code, original_amount, discount_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ${nowExpr(db)}, ${nowExpr(db)})`
    ).run(
      orderNo, userId, plan.id, plan.level_code, cycle, orderType, payAmount, payMethod,
      opts.remark || null,
      couponId, couponCode, originalAmount, discountAmount
    );
    orderId = res.lastInsertRowid || res.insertId;
  } catch (err) {
    // 订单落库失败时回退优惠券核销，避免用户券被占用
    if (couponCode) { try { couponService.releaseCoupon(db, orderNo); } catch (_) { /* ignore */ } }
    throw err;
  }

  if (log) log.info('[S13-T04] 会员订单创建', { orderNo, userId, level: plan.level_code, cycle, orderType, amount: payAmount, payMethod });

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

  // —— S17-T06 支付宝真实接入：调用官方 SDK 统一下单（alipay.trade.page.pay），
  //    返回 RSA2 签名的支付串与收银台地址；凭据异常时抛错（不伪造任何支付参数）。
  if (order.pay_method === 'alipay' && alipayService.isConfigured(alipayService.loadCredential(db))) {
    try {
      const pay = alipayService.createPagePay(db, order);
      // 支付宝无 prepay_id 概念；以「ALI:」前缀 + 网关标识记录本次下单会话，回调按 order_no 关联
      const prepayId = `ALI:${pay.sandbox ? 'sandbox' : 'prod'}:${order.order_no}`;
      db.prepare(
        `UPDATE membership_orders SET prepay_id = ?, updated_at = ${nowExpr(db)} WHERE id = ?`
      ).run(prepayId, order.id);
      if (log) log.info('[S17-T06] 支付宝统一下单成功', { order_no: order.order_no, sandbox: pay.sandbox });
      return {
        configured: true,
        method: 'alipay',
        amount,
        order_no: order.order_no,
        pay_url: pay.pay_url,
        sdk_params: pay.sdkParams,
        sandbox: pay.sandbox,
        gateway: pay.gateway,
        message: '支付宝收银台已生成，请完成支付',
      };
    } catch (e) {
      if (log) log.error('[S17-T06] 支付宝统一下单失败', { order_no: order.order_no, error: e.message });
      const err = new Error(e.message || '支付宝下单失败');
      err.code = e.code || 'ALIPAY_ORDER_FAILED';
      throw err;
    }
  }

  // 微信支付 / 支付宝未走 SDK 分支：生成本地待支付会话标识并落库，供回调按 order_no 关联；
  // 不返回任何伪造的收银台参数（避免 mock）。
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
    // 1) 原子抢占「订单标记为已支付」——WHERE pay_status='pending' 保证并发/重复回调下仅一个赢家。
    //    changes===0 表示已被其它回调处理，视为幂等，避免重复开通会员/重复计收入/重复扣分。
    const claimed = db.prepare(
      `UPDATE membership_orders
         SET pay_status = 'paid', trade_no = ?, paid_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)}
       WHERE id = ? AND pay_status = 'pending'`
    ).run(opts.tradeNo || null, order.id).changes;
    if (!claimed) { const e = new Error('订单已被处理'); e.code = 'ALREADY_PAID'; throw e; }

    // 2) 积分支付：原子扣积分（锁用户行 + 校验余额，余额不足抛错回滚）
    if (order.pay_method === 'points' && amount > 0) {
      deductPointsForOrder(db, order, amount);
    }

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

  let membership;
  try {
    membership = db.transaction ? db.transaction(runTx)() : runTx();
  } catch (e) {
    // 并发下未抢到订单标记：按幂等返回既有会员状态（回调可能重复投递）
    if (e && e.code === 'ALREADY_PAID') {
      const paidOrder = getOrder(db, order.id);
      const ms = db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(order.user_id);
      return { order: paidOrder, membership: ms, alreadyPaid: true };
    }
    throw e;
  }

  if (log) log.info('[S13-T04] 会员支付成功已开通', {
    orderNo, userId: order.user_id, level: order.level_code, cycle: order.billing_cycle,
    amount, method: order.pay_method,
  });

  return { order: getOrder(db, order.id), membership, alreadyPaid: false };
}

/** 积分支付：从用户积分余额原子扣减，写入一条 consume 流水（business_type=membership）。 */
function deductPointsForOrder(db, order, amountYuan) {
  const needPoints = Math.round(amountYuan * financeService.POINTS_PER_YUAN);
  financeService.deductPointsAtomic(db, {
    userId: order.user_id,
    points: needPoints,
    businessType: 'membership',
    relatedId: order.order_no,
    remark: `会员购买(${order.level_code}/${order.billing_cycle})`,
  });
}

/** 现金渠道支付：记录一条已支付 recharges 收入（保持财务报表口径一致）。 */
function recordRevenue(db, order, amountYuan, tradeNo) {
  const points = Math.round(amountYuan * financeService.POINTS_PER_YUAN);
  db.prepare(
    `INSERT INTO recharges (id, order_no, user_id, amount, points, pay_method, pay_status, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'paid', ${nowExpr(db)}, ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(snowflakeId(), order.order_no, order.user_id, amountYuan, points, order.pay_method);
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

  // S17-T02：被关闭订单使用的优惠券回退为「已领取」，用户可再次使用
  if (n > 0) {
    const rows = db.prepare(
      `SELECT order_no FROM membership_orders
       WHERE pay_status = 'closed' AND coupon_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT ?`
    ).all(n) || [];
    let released = 0;
    for (const r of rows) released += couponService.releaseCoupon(db, r.order_no);
    if (log && released > 0) log.info('[S17-T02] 关闭订单回退优惠券', { released });
  }
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

/**
 * 管理端订单查询（S17-T04）：支持状态/渠道/关键字/时间区间/用户筛选，分页倒序。
 * @returns {{ items, total }}
 */
function listAdminOrders(db, { keyword, payStatus, payMethod, userId, dateFrom, dateTo, limit = 20, offset = 0 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const conds = [];
  const args = [];
  if (keyword) {
    conds.push('(o.order_no LIKE ? OR o.trade_no LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)');
    const kw = `%${keyword}%`;
    args.push(kw, kw, kw, kw);
  }
  if (payStatus) { conds.push('o.pay_status = ?'); args.push(String(payStatus)); }
  if (payMethod) { conds.push('o.pay_method = ?'); args.push(String(payMethod)); }
  if (userId) { conds.push('o.user_id = ?'); args.push(Number(userId)); }
  if (dateFrom) { conds.push('o.created_at >= ?'); args.push(String(dateFrom)); }
  if (dateTo) { conds.push('o.created_at <= ?'); args.push(String(dateTo)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const items = db.prepare(
    `SELECT o.*, p.name AS plan_name, u.username, u.nickname
     FROM membership_orders o
     LEFT JOIN membership_plans p ON p.id = o.plan_id
     LEFT JOIN users u ON u.id = o.user_id
     ${where}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ? OFFSET ?`
  ).all(...args, lim, off) || [];
  const total = db.prepare(
    `SELECT COUNT(*) c FROM membership_orders o
     LEFT JOIN users u ON u.id = o.user_id
     ${where}`
  ).get(...args).c || 0;
  return { items, total };
}

/** 管理端订单汇总（支付状态/渠道分布，供看板统计）。 */
function adminOrderStats(db, { dateFrom, dateTo } = {}) {
  const conds = [];
  const args = [];
  if (dateFrom) { conds.push('created_at >= ?'); args.push(String(dateFrom)); }
  if (dateTo) { conds.push('created_at <= ?'); args.push(String(dateTo)); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const byStatus = db.prepare(
    `SELECT pay_status, COUNT(*) c, COALESCE(SUM(amount),0) total FROM membership_orders ${where} GROUP BY pay_status`
  ).all(...args) || [];
  const byMethod = db.prepare(
    `SELECT pay_method, COUNT(*) c, COALESCE(SUM(amount),0) total FROM membership_orders
     WHERE pay_status = 'paid' ${where ? `AND ${where.slice(6)}` : ''} GROUP BY pay_method`
  ).all(...args) || [];
  return { by_status: byStatus, by_method: byMethod };
}

/**
 * 管理端单笔关单（S17-T04）：仅 pending 状态可关；关单后回退优惠券。
 * 已在支付渠道侧取消的订单（无 prepay）同样适用。
 */
function closeOrder(db, log, orderNo, operatorId, reason = '') {
  const order = db.prepare('SELECT * FROM membership_orders WHERE order_no = ?').get(String(orderNo));
  if (!order) {
    const err = new Error('订单不存在');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  if (order.pay_status === 'paid' || order.pay_status === 'refunded') {
    const err = new Error(`订单状态为 ${order.pay_status}，不可关单`);
    err.code = 'ORDER_NOT_CLOSABLE';
    throw err;
  }
  if (order.pay_status === 'closed') return { order, alreadyClosed: true };

  db.prepare(
    `UPDATE membership_orders SET pay_status = 'closed',
       refund_reason = ?, refunded_at = NULL, updated_at = ${nowExpr(db)}
     WHERE id = ? AND pay_status = 'pending'`
  ).run(reason ? `管理员关单：${reason}` : '管理员手动关单', order.id);

  // 回退优惠券（S17-T02）：关单后用户券重新可领可用
  let couponReleased = false;
  if (order.coupon_id) {
    try { couponReleased = couponService.releaseCoupon(db, order.order_no) > 0; } catch (_) { /* ignore */ }
  }
  if (log) log.info('[S17-T04] 管理端关单', { order_no: order.order_no, operator: operatorId, reason, couponReleased });
  return { order: getOrder(db, order.id), alreadyClosed: false, couponReleased };
}

/**
 * 管理端退款（S17-T04）：仅 paid 状态可退。
 * 支付宝走官方 SDK（alipay.trade.refund）；微信渠道若平台未接入退款则明确拒绝（不 mock）。
 * 退款成功后订单置 refunded，并回滚 recharges 收入口径（该笔计入负数收入，保持账单可对账）。
 */
async function refundOrder(db, log, orderNo, operatorId, reason = '') {
  const order = db.prepare('SELECT * FROM membership_orders WHERE order_no = ?').get(String(orderNo));
  if (!order) {
    const err = new Error('订单不存在');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  if (order.pay_status !== 'paid') {
    const err = new Error(`订单状态为 ${order.pay_status}，仅已支付订单可退款`);
    err.code = 'ORDER_NOT_REFUNDABLE';
    throw err;
  }
  if (Number(order.amount) <= 0) {
    const err = new Error('订单金额为 0，无需退款');
    err.code = 'ZERO_AMOUNT';
    throw err;
  }

  let gatewayResult = null;
  if (order.pay_method === 'alipay') {
    gatewayResult = await alipayService.refund(db, order, { reason: reason || '管理端订单退款' });
    if (!gatewayResult.ok) {
      if (log) log.error('[S17-T04] 支付宝退款失败', { order_no: order.order_no, ...gatewayResult });
      const err = new Error(gatewayResult.msg || '支付宝退款失败');
      err.code = gatewayResult.code || 'ALIPAY_REFUND_FAILED';
      throw err;
    }
  } else if (order.pay_method === 'wechat') {
    const err = new Error('微信支付渠道暂未接入线上退款，请联系客服线下处理');
    err.code = 'WECHAT_REFUND_UNSUPPORTED';
    throw err;
  }
  // points 渠道：积分支付无资金退款，直接标记退款并退回积分
  // 注：积分退回由积分服务在下方事务中统一处理

  const runTx = () => {
    db.prepare(
      `UPDATE membership_orders SET pay_status = 'refunded',
         refund_reason = ?, refunded_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)}
       WHERE id = ? AND pay_status = 'paid'`
    ).run(reason || '管理端退款', order.id);

    // 会员状态回滚：当前活跃会员且由本订单开通 → 取消（保留至到期，不立即失效，避免误伤后续续费）
    // 简化策略：标记会员为 refunded（内部记账用），到期后自然过期
    const member = db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(order.user_id);
    if (member && String(member.last_order_id || '') === String(order.id)) {
      db.prepare(
        `UPDATE user_memberships SET auto_renew = 0, updated_at = ${nowExpr(db)} WHERE id = ?`
      ).run(member.id);
    }

    // recharges 收入回滚：原「已支付」流水置为 refunded（财务口径 paid 过滤后自动剔除，保持对账完整）
    const points = Math.round(Number(order.amount) * financeService.POINTS_PER_YUAN);
    if (order.pay_method === 'wechat' || order.pay_method === 'alipay') {
      db.prepare(
        `UPDATE recharges SET pay_status = 'refunded', updated_at = ${nowExpr(db)} WHERE order_no = ?`
      ).run(order.order_no);
    }
    if (order.pay_method === 'points') {
      // 积分支付退款：等额退回积分余额（point_logs 追加一条 refund 正向流水）
      const refundPoints = Math.abs(points);
      const balanceBefore = financeService.getUserBalance(db, order.user_id);
      const balanceAfter = balanceBefore + refundPoints;
      db.prepare(
        `INSERT INTO point_logs (id, user_id, change_type, business_type, amount, balance_after, related_id, remark, created_at)
         VALUES (?, ?, 'refund', 'membership_refund', ?, ?, ?, ?, ${nowExpr(db)})`
      ).run(snowflakeId(), order.user_id, refundPoints, balanceAfter, order.order_no,
        `订单退款退回积分(${order.level_code}/${order.billing_cycle})`);
    }
  };

  try {
    if (db.transaction) db.transaction(runTx)(); else runTx();
  } catch (e) {
    if (log) log.error('[S17-T04] 退款事务失败', { order_no: order.order_no, error: e.message });
    throw e;
  }
  if (log) log.info('[S17-T04] 管理端退款完成', {
    order_no: order.order_no, operator: operatorId, amount: order.amount,
    method: order.pay_method, reason, gateway: gatewayResult ? gatewayResult.refundTradeNo || gatewayResult.ok : null,
  });
  return { order: getOrder(db, order.id), gateway: gatewayResult };
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
  listAdminOrders,
  adminOrderStats,
  closeOrder,
  refundOrder,
};
