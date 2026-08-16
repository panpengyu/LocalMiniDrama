/**
 * Sprint 12 - S12-T08 数据分析平台 REST 路由（超级管理员）
 *
 * 端点：
 *   GET /admin/analytics/overview     四大分析汇总（一次拉取）?days=
 *   GET /admin/analytics/behavior     用户行为分析（行为分布 + DAU 趋势）?days=
 *   GET /admin/analytics/funnel       创作漏斗分析（各环节转化率）
 *   GET /admin/analytics/model-effect 模型效果分析（调用量/成功率/成本/质量）?days=
 *   GET /admin/analytics/retention    留存分析（cohort 次日/7日/30日留存）?days=
 *
 * 数据全部来自 MySQL（users / user_activity_logs / dramas / storyboards /
 * image_generations / video_generations / ai_model_call_logs），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

function analyticsRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  router.get('/admin/analytics/overview', ...superAdmin, (req, res) => {
    try {
      response.success(res, analyticsService.overview(db, { days: Number(req.query.days) || 30 }));
    } catch (err) {
      log.error('[S12-T08] 数据分析总览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/analytics/behavior', ...superAdmin, (req, res) => {
    try {
      response.success(res, analyticsService.behaviorAnalysis(db, { days: Number(req.query.days) || 30 }));
    } catch (err) {
      log.error('[S12-T08] 用户行为分析失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/analytics/funnel', ...superAdmin, (req, res) => {
    try {
      response.success(res, analyticsService.creationFunnel(db));
    } catch (err) {
      log.error('[S12-T08] 创作漏斗分析失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/analytics/model-effect', ...superAdmin, (req, res) => {
    try {
      response.success(res, analyticsService.modelEffect(db, { days: Number(req.query.days) || 30 }));
    } catch (err) {
      log.error('[S12-T08] 模型效果分析失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/analytics/retention', ...superAdmin, (req, res) => {
    try {
      response.success(res, analyticsService.retentionAnalysis(db, { cohortDays: Number(req.query.days) || 14 }));
    } catch (err) {
      log.error('[S12-T08] 留存分析失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // S18-T01 事件转化漏斗（基于 tracking_events）：?days=30&steps=page_view,login,create_drama
  router.get('/admin/analytics/event-funnel', ...superAdmin, (req, res) => {
    try {
      const steps = String(req.query.steps || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((event) => ({ event, label: event }));
      response.success(res, analyticsService.eventFunnel(db, {
        steps,
        days: Number(req.query.days) || 30,
      }));
    } catch (err) {
      log.error('[S18-T01] 事件漏斗分析失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // S18-T01 事件总览（聚合统计 + 漏斗一次拉取）
  router.get('/admin/analytics/event-overview', ...superAdmin, (req, res) => {
    try {
      const steps = String(req.query.steps || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((event) => ({ event, label: event }));
      response.success(res, analyticsService.eventOverview(db, {
        steps,
        days: Number(req.query.days) || 30,
      }));
    } catch (err) {
      log.error('[S18-T01] 事件总览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = analyticsRoutes;
