/**
 * Sprint 13 - S13-T01~T05 会员体系 REST 路由
 *
 * 用户端：
 *   GET    /membership/plans                套餐列表（等级/价格/配额/权益）——公开
 *   GET    /membership/me                    我的会员状态 + 配额用量总览
 *   POST   /membership/orders                创建购买订单 {level_code, cycle, pay_method, auto_renew}
 *   POST   /membership/orders/:orderNo/pay   确认支付（现金渠道回调前的主动确认 / 积分抵扣即时支付）
 *   GET    /membership/orders                我的订单/账单记录 ?limit=&offset=
 *   POST   /membership/auto-renew            开/关自动续费 {enabled}
 *   POST   /membership/cancel                取消会员（关闭续费，保留至到期）
 *   GET    /membership/quota                 我的配额用量总览 ?drama_id=
 *
 * 支付回调（第三方异步通知，无需登录，靠验签 + order_no 幂等）：
 *   POST   /membership/pay/notify/:method    method=wechat/alipay
 *
 * 管理端（super_admin）：
 *   GET    /admin/membership/plans           全部套餐（含下架）
 *   PUT    /admin/membership/plans/:id        更新套餐价格/配额/上下架
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

function membershipRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // 统一错误码 → HTTP 映射
  function fail(res, err) {
    const badCodes = ['INVALID_CYCLE', 'INVALID_PAY_METHOD', 'FREE_PLAN', 'EMPTY_CONTENT', 'NO_TARGETS'];
    const notFoundCodes = ['PLAN_NOT_FOUND', 'ORDER_NOT_FOUND', 'PARENT_NOT_FOUND'];
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

      // —— 支付宝：读取凭据 + RSA2 验签（占位，未接入 SDK 时始终拒绝，避免伪造放行） ——
      const b = req.body || {};
      const orderNo = b.order_no || b.out_trade_no;
      if (!orderNo) return response.badRequest(res, '缺少订单号');
      const settingsService = require('../services/settingsService');
      const cred = settingsService.getGlobalSetting(db, 'pay_alipay', null);
      if (!cred || !cred.merchant_id || !cred.api_key) {
        return response.badRequest(res, '支付宝未在系统管理中开通，拒绝处理回调');
      }
      const verified = verifyAlipaySignature(cred, req);
      if (!verified) return response.error(res, 400, 'SIGN_INVALID', '支付宝回调验签失败');
      const result = paymentService.handlePaymentSuccess(db, log, {
        orderNo, tradeNo: b.trade_no || null, autoRenew: false,
      });
      response.success(res, { received: true, already_paid: result.alreadyPaid });
    } catch (err) { fail(res, err); }
  });

  // 支付宝验签占位：仅在具备真实商户 SDK 时实现；无 SDK 时始终返回 false，避免伪造放行。
  function verifyAlipaySignature(_cred, _req) {
    return false;
  }

  // ===================== 管理端 =====================

  router.get('/admin/membership/plans', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: membershipService.listPlans(db, true) });
    } catch (err) { fail(res, err); }
  });

  router.put('/admin/membership/plans/:id', ...superAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const exist = membershipService.getPlanById(db, id);
      if (!exist) return response.notFound(res, '套餐不存在');
      const b = req.body || {};
      const updates = [];
      const params = [];
      const numFields = ['level_rank', 'price_monthly', 'price_yearly', 'price_lifetime', 'sort_order'];
      const strFields = ['name', 'subtitle', 'badge_color'];
      for (const f of numFields) if (b[f] !== undefined) { updates.push(`${f} = ?`); params.push(b[f] === null ? null : Number(b[f])); }
      for (const f of strFields) if (b[f] !== undefined) { updates.push(`${f} = ?`); params.push(b[f]); }
      if (b.quota_config !== undefined) { updates.push('quota_config = ?'); params.push(typeof b.quota_config === 'string' ? b.quota_config : JSON.stringify(b.quota_config)); }
      if (b.benefits !== undefined) { updates.push('benefits = ?'); params.push(typeof b.benefits === 'string' ? b.benefits : JSON.stringify(b.benefits)); }
      if (b.enabled !== undefined) { updates.push('enabled = ?'); params.push(b.enabled ? 1 : 0); }
      if (!updates.length) return response.success(res, membershipService.getPlanById(db, id));
      params.push(id);
      db.prepare(`UPDATE membership_plans SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      if (log) log.info('[S13-T01] 套餐更新', { id });
      response.success(res, membershipService.getPlanById(db, id));
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

  return router;
}

module.exports = membershipRoutes;
