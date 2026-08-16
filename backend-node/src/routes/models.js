'use strict';
/**
 * Sprint 19 - S19-T01/T02 模型 A/B 测试与用量配额 REST API
 *
 * 接口清单（统一走 /admin 前缀 + requireAuth，与既有管理端路由一致）：
 *   GET    /admin/models/ab-tests                  A/B 测试列表
 *   POST   /admin/models/ab-tests                  创建 A/B 测试
 *   GET    /admin/models/ab-tests/:id              详情
 *   PUT    /admin/models/ab-tests/:id              更新（启用/停用、流量比例）
 *   DELETE /admin/models/ab-tests/:id              删除
 *   POST   /admin/models/ab-tests/:id/run          路由决策演练
 *   GET    /admin/models/ab-tests/:id/report       对比报告
 *   POST   /admin/models/ab-tests/:id/set-default  一键设默认
 *   GET    /admin/models/quotas                    配额规则列表
 *   POST   /admin/models/quotas                    创建配额规则
 *   PUT    /admin/models/quotas/:id                更新配额规则
 *   DELETE /admin/models/quotas/:id                删除配额规则
 *   GET    /admin/models/quotas/usage              用量汇总
 *   GET    /admin/models/quotas/check              实时校验
 *   POST   /admin/models/quotas/consume            原子占用一次调用额度
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const response = require('../response');
const abTestService = require('../services/abTestService');
const quotaService = require('../services/modelQuotaService');

function modelsRoutes(db, log) {
  const router = express.Router();

  // ========== A/B 测试 ==========
  router.get('/admin/models/ab-tests', requireAuth, (req, res) => {
    try {
      const items = abTestService.listTests(db, {
        taskType: req.query.taskType || null,
        isActive: req.query.isActive === undefined ? undefined : req.query.isActive === 'true',
      });
      response.success(res, { items, total: items.length });
    } catch (err) {
      log.error('[S19-T01] A/B 测试列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/models/ab-tests', requireAuth, (req, res) => {
    try {
      const item = abTestService.createTest(db, log, req.body || {});
      response.success(res, item);
    } catch (err) {
      log.error('[S19-T01] 创建 A/B 测试失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/models/ab-tests/:id', requireAuth, (req, res) => {
    try {
      const item = abTestService.getTest(db, req.params.id);
      if (!item) return response.notFound(res, 'A/B 测试不存在');
      response.success(res, item);
    } catch (err) {
      log.error('[S19-T01] 读取 A/B 测试失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/models/ab-tests/:id', requireAuth, (req, res) => {
    try {
      const item = abTestService.updateTest(db, log, req.params.id, req.body || {});
      response.success(res, item);
    } catch (err) {
      log.error('[S19-T01] 更新 A/B 测试失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/admin/models/ab-tests/:id', requireAuth, (req, res) => {
    try {
      const out = abTestService.deleteTest(db, log, req.params.id);
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T01] 删除 A/B 测试失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 路由决策演练：有激活测试返回命中组与配置，否则 null
  router.post('/admin/models/ab-tests/:id/run', requireAuth, (req, res) => {
    try {
      const test = abTestService.getTest(db, req.params.id);
      if (!test) return response.notFound(res, 'A/B 测试不存在');
      const out = abTestService.routeTask(db, {
        taskType: test.taskType,
        userId: req.body.userId || req.user?.id || 'anon',
      });
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T01] A/B 路由决策失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/models/ab-tests/:id/report', requireAuth, (req, res) => {
    try {
      const report = abTestService.compareReport(db, req.params.id, {
        days: Number(req.query.days) || 30,
      });
      response.success(res, report);
    } catch (err) {
      log.error('[S19-T01] 对比报告生成失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/models/ab-tests/:id/set-default', requireAuth, (req, res) => {
    try {
      const out = abTestService.setDefault(db, log, req.params.id, req.body.group || 'A');
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T01] 设默认失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ========== 用量配额 ==========
  router.get('/admin/models/quotas', requireAuth, (req, res) => {
    try {
      const items = quotaService.listQuotas(db, {
        scopeType: req.query.scopeType || null,
        isActive: req.query.isActive === undefined ? undefined : req.query.isActive === 'true',
      });
      response.success(res, { items, total: items.length });
    } catch (err) {
      log.error('[S19-T02] 配额列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/models/quotas', requireAuth, (req, res) => {
    try {
      const item = quotaService.createQuota(db, log, req.body || {});
      response.success(res, item);
    } catch (err) {
      log.error('[S19-T02] 创建配额失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/models/quotas/:id', requireAuth, (req, res) => {
    try {
      const item = quotaService.updateQuota(db, log, req.params.id, req.body || {});
      response.success(res, item);
    } catch (err) {
      log.error('[S19-T02] 更新配额失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/admin/models/quotas/:id', requireAuth, (req, res) => {
    try {
      const out = quotaService.deleteQuota(db, log, req.params.id);
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T02] 删除配额失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/models/quotas/usage', requireAuth, (req, res) => {
    try {
      const items = quotaService.usageSummary(db, {
        scopeType: req.query.scopeType || null,
        periodType: req.query.periodType || null,
      });
      response.success(res, { items, total: items.length });
    } catch (err) {
      log.error('[S19-T02] 用量汇总失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 实时校验（路由前置检查 / 前端查看）
  router.get('/admin/models/quotas/check', requireAuth, (req, res) => {
    try {
      const out = quotaService.checkQuota(db, {
        userId: req.query.userId,
        model: req.query.model,
        periodType: req.query.periodType || 'daily',
      });
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T02] 配额校验失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 原子占用一次调用额度
  router.post('/admin/models/quotas/consume', requireAuth, (req, res) => {
    try {
      const out = quotaService.consume(db, {
        userId: req.body.userId,
        model: req.body.model,
        periodType: req.body.periodType || 'daily',
      });
      if (!out.ok) {
        return response.error(res, 429, 'QUOTA_EXCEEDED', `已达用量上限（${out.used}/${out.quota}）`);
      }
      response.success(res, out);
    } catch (err) {
      log.error('[S19-T02] 占用额度失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = modelsRoutes;
