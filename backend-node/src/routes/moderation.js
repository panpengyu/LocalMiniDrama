'use strict';
/**
 * routes/moderation.js
 * Sprint 4 - S4-T08 内容审核 REST API
 *
 * 接口清单：
 *   POST   /moderation/check          内容审核（单条）
 *   POST   /moderation/check-batch    批量审核
 *   GET    /moderation/logs           审核记录列表
 *   GET    /moderation/logs/:id       审核记录详情
 *   PATCH  /moderation/logs/:id/review 人工复审
 *   GET    /moderation/rules          审核规则配置
 */

const express = require('express');
const response = require('../response');
const moderationService = require('../services/contentModerationService');

module.exports = function routes(db, log) {
  log = log || { info: console.log, warn: console.warn, error: console.error };
  const router = express.Router();
  const { requireAuth } = require('../middleware/auth') || { requireAuth: (req, res, next) => next() };

  function currentUserId(req) {
    return (req.user && (req.user.id || req.user.userId)) || (req.session && req.session.userId) || null;
  }

  function ok(res, data, msg) {
    res.json({ success: true, code: 0, message: msg || 'ok', data });
  }
  function fail(res, msg, status) {
    res.status(status || 400).json({ success: false, code: status || 400, message: msg || 'bad request', data: null });
  }

  // ========== 内容审核 ==========
  router.post('/check', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.resourceType) return fail(res, 'resourceType 必填（text/image/video）');
      const result = await moderationService.moderate(db, log, {
        resourceType: body.resourceType,
        resourceId: body.resourceId || null,
        resourceUrl: body.resourceUrl || null,
        contentSnapshot: body.contentSnapshot || body.content || '',
        mode: body.mode || 'standard',
        userId: currentUserId(req),
        dramaId: body.dramaId || null,
      });
      ok(res, result, result.isBlocked ? '内容违规，已拦截' : '审核通过');
    } catch (err) {
      log.error('[MODERATION-ROUTE] check error', { error: err.message });
      fail(res, err.message, 500);
    }
  });

  // ========== 批量审核 ==========
  router.post('/check-batch', requireAuth, async (req, res) => {
    try {
      const items = req.body?.items || [];
      if (!Array.isArray(items) || items.length === 0) return fail(res, 'items 不能为空');
      const mode = req.body?.mode || 'standard';
      const result = await moderationService.moderateBatch(db, log, items, mode);
      ok(res, result, `批量审核完成：${result.total}条`);
    } catch (err) {
      fail(res, err.message, 500);
    }
  });

  // ========== 审核记录列表 ==========
  router.get('/logs', requireAuth, (req, res) => {
    try {
      const list = moderationService.listLogs(db, {
        userId: req.query.userId || null,
        dramaId: req.query.dramaId || null,
        verdict: req.query.verdict || null,
        resourceType: req.query.resourceType || null,
        limit: req.query.limit || 50,
        offset: req.query.offset || 0,
      });
      ok(res, { items: list, total: list.length });
    } catch (err) {
      fail(res, err.message, 500);
    }
  });

  // ========== 审核记录详情 ==========
  router.get('/logs/:id', requireAuth, (req, res) => {
    try {
      const detail = moderationService.getLog(db, req.params.id);
      if (!detail) return fail(res, '审核记录不存在', 404);
      ok(res, detail);
    } catch (err) {
      fail(res, err.message, 500);
    }
  });

  // ========== 人工复审 ==========
  router.patch('/logs/:id/review', requireAuth, (req, res) => {
    try {
      const result = moderationService.review(db, log, req.params.id, {
        verdict: req.body?.verdict,
        reviewNote: req.body?.reviewNote || null,
        reviewedBy: currentUserId(req),
      });
      ok(res, result, '复审完成');
    } catch (err) {
      fail(res, err.message);
    }
  });

  // ========== 审核规则 ==========
  router.get('/rules', (req, res) => {
    try {
      const mode = req.query.mode || 'standard';
      const rules = moderationService.getRules(db, mode);
      ok(res, { mode, rules });
    } catch (err) {
      fail(res, err.message, 500);
    }
  });

  return router;
};
