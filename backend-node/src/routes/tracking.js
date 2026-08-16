'use strict';

/**
 * Sprint 18 - S18-T01 事件埋点 REST 路由
 *
 *   POST /tracking/collect       公开：前端 SDK 批量上报（authMiddleware 解析可选登录态 + 防刷限流）
 *   GET  /admin/tracking/events  超级管理员：事件明细查询（分页 / 关键字 / 事件 / 用户 / 时间筛选）
 *   GET  /admin/tracking/stats   超级管理员：事件聚合统计（总量 / 分布 / 每日趋势）
 *
 * 数据全部真实写入 tracking_events（MySQL），无 mock。
 */

const response = require('../response');
const { authMiddleware, requireAuth, requireRole } = require('../middleware/auth');
const trackingService = require('../services/trackingService');

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 600; // 同一维度（IP/用户 + 事件）60s 内最多 600 条，SDK 单次批量 ≤ 20 条，正常远低于此

function trackingRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  router.post('/tracking/collect', authMiddleware, (req, res) => {
    try {
      const body = req.body || {};
      const events = Array.isArray(body.events) ? body.events : (body.event ? [body] : []);
      if (!events.length) return response.error(res, 'EVENTS_REQUIRED', '缺少事件数据', 400);

      const anonymousId = body.anonymous_id || req.headers['x-anonymous-id'];
      const userId = req.user ? req.user.id : null;
      const ip = req.ip || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '';

      // 防刷：窗口内同 IP + 首事件名超阈值则静默丢弃（不阻断主流程）
      const firstEvent = events[0].event;
      if (
        firstEvent &&
        trackingService.rateLimited(db, { ip, event: firstEvent, windowMs: RATE_WINDOW_MS, max: RATE_MAX })
      ) {
        return response.success(res, { accepted: false, reason: 'rate_limited', received: events.length, inserted: 0 });
      }

      const out = trackingService.batchTrack(db, log, events, { userId, anonymousId, ip });
      response.success(res, { accepted: true, received: out.received, inserted: out.inserted });
    } catch (err) {
      log.error('[S18-T01] 埋点上报失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/tracking/events', ...superAdmin, (req, res) => {
    try {
      response.success(res, trackingService.listEvents(db, {
        keyword: req.query.keyword || null,
        event: req.query.event || null,
        userId: req.query.user_id || null,
        dateFrom: req.query.date_from || null,
        dateTo: req.query.date_to || null,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      }));
    } catch (err) {
      log.error('[S18-T01] 事件明细查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/tracking/stats', ...superAdmin, (req, res) => {
    try {
      response.success(res, trackingService.stats(db, {
        days: Number(req.query.days) || 30,
        event: req.query.event || null,
      }));
    } catch (err) {
      log.error('[S18-T01] 事件聚合统计失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = trackingRoutes;
