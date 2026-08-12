/**
 * Sprint 12 - S12-T04 用户生命周期管理 REST 路由（超级管理员）
 *
 * 端点：
 *   GET  /admin/lifecycle/overview          生命周期总览（各阶段 / 风险 / 健康分分布）
 *   GET  /admin/lifecycle/profiles          分页用户画像 ?stage=&churn_risk=&keyword=&page=&page_size=
 *   GET  /admin/lifecycle/churn-warnings    流失预警列表 ?limit=
 *   POST /admin/lifecycle/recompute         全量重算生命周期画像（真实数据）
 *   POST /admin/lifecycle/track             记录一条行为埋点 {userId, action, targetType, targetId, meta}
 *
 * 数据全部来自 MySQL（users / point_logs / user_activity_logs / user_lifecycle），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const userLifecycleService = require('../services/userLifecycleService');

function lifecycleRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  router.get('/admin/lifecycle/overview', ...superAdmin, (req, res) => {
    try {
      response.success(res, userLifecycleService.overview(db));
    } catch (err) {
      log.error('[S12-T04] 生命周期总览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/lifecycle/profiles', ...superAdmin, (req, res) => {
    try {
      const result = userLifecycleService.listProfiles(db, {
        stage: req.query.stage || null,
        churnRisk: req.query.churn_risk || null,
        keyword: req.query.keyword || null,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      });
      response.successWithPagination(res, result.items, result.total, result.page, result.pageSize);
    } catch (err) {
      log.error('[S12-T04] 用户画像列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/lifecycle/churn-warnings', ...superAdmin, (req, res) => {
    try {
      response.success(res, userLifecycleService.churnWarnings(db, Number(req.query.limit) || 50));
    } catch (err) {
      log.error('[S12-T04] 流失预警失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/lifecycle/recompute', ...superAdmin, (req, res) => {
    try {
      response.success(res, userLifecycleService.recomputeAll(db, log));
    } catch (err) {
      log.error('[S12-T04] 生命周期重算失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 行为埋点：任意已登录用户都可上报自身行为
  router.post('/admin/lifecycle/track', requireAuth, (req, res) => {
    try {
      const { userId, action, targetType, targetId, meta } = req.body || {};
      const id = userLifecycleService.trackActivity(db, log, {
        userId: userId || req.user.id, action, targetType, targetId, meta,
      });
      if (!id) return response.badRequest(res, '缺少 action 或埋点失败');
      response.success(res, { id });
    } catch (err) {
      log.error('[S12-T04] 行为埋点失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = lifecycleRoutes;
