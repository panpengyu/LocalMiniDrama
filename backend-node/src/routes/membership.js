/**
 * Sprint 13 - S13-T01~T05 会员体系 REST 路由
 *
 * 用户端：
 *   GET    /membership/plans                套餐列表（等级/价格/配额/权益）——公开
 *   GET    /membership/me                    我的会员状态 + 配额用量总览
 *   POST   /membership/orders                创建购买订单 {level_code, cycle, pay_method, auto_renew, coupon_code}
 *   POST   /membership/orders/:orderNo/pay   确认支付（现金渠道回调前的主动确认 / 积分抵扣即时支付）
 *   GET    /membership/orders                我的订单/账单记录 ?limit=&offset=
 *   POST   /membership/auto-renew            开/关自动续费 {enabled}
 *   POST   /membership/cancel                取消会员（关闭续费，保留至到期）
 *   GET    /membership/quota                 我的配额用量总览 ?drama_id=
 *   POST   /membership/coupons/redeem        兑换优惠券 {code}（S17-T02）
 *   GET    /membership/coupons               我的优惠券（S17-T02）
 *
 * 支付回调（第三方异步通知，无需登录，靠验签 + order_no 幂等）：
 *   POST   /membership/pay/notify/:method    method=wechat/alipay
 *
 * 管理端（super_admin）：
 *   GET    /admin/membership/plans           全部套餐（含下架）
 *   POST   /admin/membership/plans           新增套餐（S17-T01 充值套餐管理）
 *   PUT    /admin/membership/plans/:id        更新套餐价格/配额/上下架
 *   DELETE /admin/membership/plans/:id        删除套餐（有引用则下架软删，S17-T01）
 *   GET    /admin/membership/coupons         优惠券列表（S17-T02）
 *   POST   /admin/membership/coupons         发放优惠券（S17-T02）
 *   PUT    /admin/membership/coupons/:id     编辑优惠券（S17-T02）
 *   DELETE /admin/membership/coupons/:id     失效优惠券（S17-T02）
 *   GET    /admin/membership/coupons/:id/redemptions  领取/核销记录（S17-T02）
 *   POST   /admin/membership/expire-scan      手动触发到期扫描（落 expired）
 *   POST   /admin/membership/close-orders     关闭超时未支付订单
 *
 * 全部数据落地本地 MySQL，无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const membershipService = require('../services/membershipService');
const paymentService = require('../services/paymentService');
const quotaService = require('../services/quotaService');
const couponService = require('../services/couponService');

function membershipRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // 统一错误码 → HTTP 映射
  function fail(res, err) {
    const badCodes = [
      'INVALID_CYCLE', 'INVALID_PAY_METHOD', 'FREE_PLAN', 'EMPTY_CONTENT', 'NO_TARGETS',
      'INVALID_ARGS', 'DUPLICATE_LEVEL',
      // S17-T02 优惠券
      'DUPLICATE_COUPON', 'COUPON_DISABLED', 'COUPON_NOT_STARTED', 'COUPON_EXPIRED',
      'COUPON_SOLD_OUT', 'COUPON_ALREADY_CLAIMED', 'COUPON_ALREADY_USED', 'COUPON_NOT_CLAIMED',
      'COUPON_MIN_SPEND', 'COUPON_SCOPE', 'COUPON_NO_AMOUNT',
    ];
    const notFoundCodes = ['PLAN_NOT_FOUND', 'ORDER_NOT_FOUND', 'PARENT_NOT_FOUND', 'COUPON_NOT_FOUND'];
    if (err.code === 'INSUFFICIENT_POINTS') return response.error(res, 402, 'INSUFFICIENT_POINTS', err.message);
    if (err.code === 'QUOTA_EXCEEDED') return response.forbidden(res, err.message);
    if (err.code === 'ORDER_NOT_PAYABLE') return response.conflict(res, err.message);
    if (badCodes.includes(err.code)) return response.badRequest(res, err.message);
    if (notFoundCodes.includes(err.code)) return response.notFound(res, err.message);
    log.error('[S13] 会员接口异常', { code: err.code, error: err.message });
    return response.internalError(res, err.message);
  }

  // ===================== 用户端 =====================

  // 套餐列表（公开）
  router.get('/membership/plans', (req, res) => {
    try {
      response.success(res, { items: membershipService.listPlans(db) });
    } catch (err) { fail(res, err); }
  });

  // 我的会员状态 + 配额总览
  router.get('/membership/me', requireAuth, (req, res) => {
    try {
      const info = membershipService.getUserMembership(db, req.user.id);
      const quota = quotaService.summary(db, req.user.id);
      response.success(res, {
        level_code: info.levelCode,
        is_active: info.isActive,
        plan: info.plan,
        membership: info.membership,
        quota,
      });
    } catch (err) { fail(res, err); }
  });

  // 创建购买订单
  router.post('/membership/orders', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      if (!b.level_code) return response.badRequest(res, '缺少 level_code');
      const result = paymentService.createOrder(db, log, {
        userId: req.user.id,
        levelCode: b.level_code,
        cycle: b.cycle || 'monthly',
        payMethod: b.pay_method || 'wechat',
        autoRenew: !!b.auto_renew,
        remark: b.remark || null,
        couponCode: b.coupon_code || null, // S17-T02 优惠券抵扣
      });
      response.created(res, result);
    } catch (err) { fail(res, err); }
  });

  // 确认支付（积分抵扣即时支付 / 现金渠道在收银台完成后主动确认）
  router.post('/membership/orders/:orderNo/pay', requireAuth, (req, res) => {
    try {
      const order = paymentService.getOrder(db,
        (db.prepare('SELECT id FROM membership_orders WHERE order_no = ?').get(req.params.orderNo) || {}).id);
      if (!order) return response.notFound(res, '订单不存在');
      if (Number(order.user_id) !== Number(req.user.id)) return response.forbidden(res, '无权操作该订单');
      const result = paymentService.handlePaymentSuccess(db, log, {
        orderNo: req.params.orderNo,
        tradeNo: (req.body && req.body.trade_no) || null,
        autoRenew: !!(req.body && req.body.auto_renew),
        actorId: req.user.id,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 我的订单/账单
  router.get('/membership/orders', requireAuth, (req, res) => {
    try {
      const { items, total } = paymentService.listUserOrders(db, req.user.id, {
        limit: Number(req.query.limit) || 20,
        offset: Number(req.query.offset) || 0,
      });
      response.success(res, { items, total });
    } catch (err) { fail(res, err); }
  });

  // 开/关自动续费
  router.post('/membership/auto-renew', requireAuth, (req, res) => {
    try {
      const enabled = !!(req.body && req.body.enabled);
      const ok = membershipService.setAutoRenew(db, req.user.id, enabled);
      if (!ok) return response.badRequest(res, '当前无有效会员，无法设置自动续费');
      response.success(res, { auto_renew: enabled });
    } catch (err) { fail(res, err); }
  });

  // 取消会员
  router.post('/membership/cancel', requireAuth, (req, res) => {
    try {
      const ok = membershipService.cancelMembership(db, req.user.id);
      if (!ok) return response.badRequest(res, '当前无生效会员可取消');
      response.success(res, { cancelled: true });
    } catch (err) { fail(res, err); }
  });

  // 配额用量总览
  router.get('/membership/quota', requireAuth, (req, res) => {
    try {
      response.success(res, quotaService.summary(db, req.user.id, {
        dramaId: req.query.drama_id ? Number(req.query.drama_id) : undefined,
      }));
    } catch (err) { fail(res, err); }
  });

  // ===================== S17-T02 优惠券（用户端） =====================

  // 兑换优惠券 { code }
  router.post('/membership/coupons/redeem', requireAuth, (req, res) => {
    try {
      const code = String((req.body || {}).code || '').trim();
      if (!code) return response.badRequest(res, '请输入兑换码');
      const coupon = couponService.redeemCoupon(db, req.user.id, code);
      response.success(res, { coupon });
    } catch (err) { fail(res, err); }
  });

  // 我的优惠券
  router.get('/membership/coupons', requireAuth, (req, res) => {
    try {
      response.success(res, { items: couponService.listUserCoupons(db, req.user.id) });
    } catch (err) { fail(res, err); }
  });

  // ===================== 支付异步回调（第三方通知） =====================
  // 说明：微信 v3 已按官方规范接入验签 + AES-256-GCM 资源解密（见 services/wechatPayV3.js）；
  // 支付宝 RSA2 验签留统一接入点。未配置商户凭据（系统管理中未开通）时直接拒绝，杜绝伪造回调。
  const wechatPayV3 = require('../services/wechatPayV3');

  router.post('/membership/pay/notify/:method', (req, res) => {
    const method = req.params.method;
    if (!['wechat', 'alipay'].includes(method)) return response.badRequest(res, '非法回调渠道');
    try {
      // —— 微信支付 v3：验签 + 解密密文，从解密报文取订单号 ——
      if (method === 'wechat') {
        const r = wechatPayV3.handleCallback(db, req);
        if (!r.ok) {
          if (r.reason === 'NOT_CONFIGURED') return response.badRequest(res, '微信支付未在系统管理中开通，拒绝处理回调');
          if (r.reason === 'SIGN_INVALID') return response.error(res, 400, 'SIGN_INVALID', '微信支付回调验签失败');
          if (r.reason === 'DECRYPT_FAILED') return response.error(res, 400, 'DECRYPT_FAILED', '微信支付回调解密失败');
          // 非成功交易态：按微信规范应答已接收，但不开通
          return response.success(res, { received: true, ignored: true, reason: r.reason });
        }
        const result = paymentService.handlePaymentSuccess(db, log, {
          orderNo: r.orderNo, tradeNo: r.transactionId, autoRenew: false,
        });
        return response.success(res, { received: true, already_paid: result.alreadyPaid });
      }

      // —— 支付宝：读取凭据 + RSA2 验签（S17-T06：真实 SDK checkNotifySignV2） ——
      const alipayService = require('../services/alipayService');
      // 支付宝签名基于「未解码」原始参数；Express urlencoded 已解码 body，
      // 因此必须用 verify 钩子保存的 rawBody 重新解析（与微信 v3 rawBody 一致）。
      const postData = parseRawNotify(req.rawBody, req.body);
      const orderNo = postData.out_trade_no || postData.order_no;
      if (!orderNo) return response.badRequest(res, '缺少订单号');
      const cred = alipayService.loadCredential(db);
      if (!cred || !cred.merchant_id || !cred.api_key) {
        return response.badRequest(res, '支付宝未在系统管理中开通，拒绝处理回调');
      }
      const verified = alipayService.verifyNotify(db, postData);
      if (!verified) return response.error(res, 400, 'SIGN_INVALID', '支付宝回调验签失败');
      // 交易状态校验：仅 TRADE_SUCCESS / TRADE_FINISHED 视为支付成功
      const tradeStatus = postData.trade_status;
      if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(tradeStatus)) {
        return response.success(res, { received: true, ignored: true, trade_status: tradeStatus });
      }
      // 金额一致性校验（防止篡改）：支付宝返回金额须与订单金额一致
      const order = db.prepare('SELECT * FROM membership_orders WHERE order_no = ?').get(orderNo);
      if (order && String(Number(order.amount).toFixed(2)) !== String(Number(postData.total_amount).toFixed(2))) {
        return response.error(res, 400, 'AMOUNT_MISMATCH', '支付宝回调金额与订单金额不一致');
      }
      const result = paymentService.handlePaymentSuccess(db, log, {
        orderNo, tradeNo: postData.trade_no || null, autoRenew: false,
      });
      response.success(res, { received: true, already_paid: result.alreadyPaid });
    } catch (err) { fail(res, err); }
  });

  /**
   * 解析支付宝回调：优先用原始 body（未解码），缺失时回退 express 解码后的 body。
   * 返回值为「键值均保持原始编码」的对象，供 checkNotifySignV2 验签。
   */
  function parseRawNotify(rawBody, decodedBody) {
    if (rawBody && typeof rawBody === 'string' && rawBody.includes('=')) {
      const out = {};
      for (const kv of rawBody.split('&')) {
        const idx = kv.indexOf('=');
        if (idx > 0) out[kv.slice(0, idx)] = kv.slice(idx + 1);
      }
      if (Object.keys(out).length) return out;
    }
    return decodedBody || {};
  }

  // ===================== 管理端 =====================

  router.get('/admin/membership/plans', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: membershipService.listPlans(db, true) });
    } catch (err) { fail(res, err); }
  });

  // ===================== S17-T02 优惠券（管理端） =====================

  // 优惠券列表 ?keyword=&enabled=
  router.get('/admin/membership/coupons', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: couponService.listCoupons(db, req.query || {}) });
    } catch (err) { fail(res, err); }
  });

  // 发放优惠券
  router.post('/admin/membership/coupons', ...superAdmin, (req, res) => {
    try {
      const coupon = couponService.createCoupon(db, req.body || {});
      if (log) log.info('[S17-T02] 优惠券发放', { id: coupon.id, code: coupon.code });
      response.created(res, coupon);
    } catch (err) { fail(res, err); }
  });

  // 编辑优惠券
  router.put('/admin/membership/coupons/:id', ...superAdmin, (req, res) => {
    try {
      const coupon = couponService.updateCoupon(db, req.params.id, req.body || {});
      if (log) log.info('[S17-T02] 优惠券编辑', { id: coupon.id, code: coupon.code });
      response.success(res, coupon);
    } catch (err) { fail(res, err); }
  });

  // 失效优惠券
  router.delete('/admin/membership/coupons/:id', ...superAdmin, (req, res) => {
    try {
      const coupon = couponService.disableCoupon(db, req.params.id);
      if (log) log.info('[S17-T02] 优惠券失效', { id: coupon.id, code: coupon.code });
      response.success(res, coupon);
    } catch (err) { fail(res, err); }
  });

  // 领取/核销记录
  router.get('/admin/membership/coupons/:id/redemptions', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: couponService.listRedemptions(db, req.params.id, req.query || {}) });
    } catch (err) { fail(res, err); }
  });

  // S17-T01 充值套餐管理：新增套餐
  router.post('/admin/membership/plans', ...superAdmin, (req, res) => {
    try {
      const plan = membershipService.createPlan(db, req.body || {});
      if (log) log.info('[S17-T01] 套餐新增', { id: plan.id, level_code: plan.level_code });
      response.created(res, plan);
    } catch (err) { fail(res, err); }
  });

  // S17-T01 充值套餐管理：删除套餐（有引用则软删除为下架）
  router.delete('/admin/membership/plans/:id', ...superAdmin, (req, res) => {
    try {
      const r = membershipService.deletePlan(db, req.params.id);
      if (log) log.info('[S17-T01] 套餐删除/下架', r);
      response.success(res, r);
    } catch (err) { fail(res, err); }
  });

  router.put('/admin/membership/plans/:id', ...superAdmin, (req, res) => {
    try {
      const plan = membershipService.updatePlan(db, req.params.id, req.body || {});
      if (log) log.info('[S13-T01] 套餐更新', { id: plan.id });
      response.success(res, plan);
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/membership/expire-scan', ...superAdmin, (req, res) => {
    try {
      response.success(res, { expired: membershipService.processExpirations(db, log) });
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/membership/close-orders', ...superAdmin, (req, res) => {
    try {
      const minutes = Number((req.body && req.body.minutes)) || 30;
      response.success(res, { closed: paymentService.closeExpiredOrders(db, log, minutes) });
    } catch (err) { fail(res, err); }
  });

  // ===================== S17-T04 支付订单管理（管理端） =====================

  // 订单查询：?keyword=&payStatus=&payMethod=&userId=&dateFrom=&dateTo=&limit=&offset=
  router.get('/admin/membership/orders', ...superAdmin, (req, res) => {
    try {
      const result = paymentService.listAdminOrders(db, req.query || {});
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 订单状态/渠道分布汇总（看板用）
  router.get('/admin/membership/orders/stats', ...superAdmin, (req, res) => {
    try {
      response.success(res, paymentService.adminOrderStats(db, req.query || {}));
    } catch (err) { fail(res, err); }
  });

  // 单笔关单（仅 pending）
  router.post('/admin/membership/orders/:orderNo/close', ...superAdmin, (req, res) => {
    try {
      const result = paymentService.closeOrder(db, log, req.params.orderNo, req.user && req.user.id, (req.body && req.body.reason) || '');
      if (log) log.info('[S17-T04] 订单关单', { order_no: req.params.orderNo, operator: req.user && req.user.id });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 单笔退款（仅 paid，支付宝走真实 SDK 退款）
  router.post('/admin/membership/orders/:orderNo/refund', ...superAdmin, async (req, res) => {
    try {
      const result = await paymentService.refundOrder(db, log, req.params.orderNo, req.user && req.user.id, (req.body && req.body.reason) || '');
      if (log) log.info('[S17-T04] 订单退款', { order_no: req.params.orderNo, operator: req.user && req.user.id });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = membershipRoutes;
