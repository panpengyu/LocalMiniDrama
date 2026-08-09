'use strict';
/**
 * routes/modelRouting.js
 * Sprint 4 - S4-T07 AI模型智能路由 REST API
 *
 * 接口清单：
 *   GET    /model-routing/rules           路由规则列表
 *   POST   /model-routing/rules           创建/更新路由规则
 *   DELETE /model-routing/rules/:id       删除路由规则
 *   POST   /model-routing/route           智能路由决策（返回推荐模型）
 *   GET    /model-routing/stats           模型调用统计与评分
 *   GET    /model-routing/circuit/:configId/:model  熔断状态
 *   POST   /model-routing/call-log        记录调用日志
 */

const express = require('express');
const response = require('../response');
const routingService = require('../services/modelRoutingService');

module.exports = function routes(db, log) {
  log = log || { info: console.log, warn: console.warn, error: console.error };
  const router = express.Router();
  const { requireAuth } = require('../middleware/auth') || { requireAuth: (req, res, next) => next() };

  function ok(res, data, msg) {
    res.json({ success: true, code: 0, message: msg || 'ok', data });
  }
  function fail(res, msg, status) {
    res.status(status || 400).json({ success: false, code: status || 400, message: msg || 'bad request', data: null });
  }

  // ========== 路由规则 CRUD ==========
  router.get('/rules', (req, res) => {
    try {
      const list = routingService.listRules(db, {
        taskType: req.query.taskType || null,
        isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      });
      ok(res, { items: list, total: list.length });
    } catch (err) { fail(res, err.message, 500); }
  });

  router.post('/rules', (req, res) => {
    try {
      const result = routingService.upsertRule(db, log, req.body || {});
      ok(res, result, '路由规则保存成功');
    } catch (err) { fail(res, err.message); }
  });

  router.delete('/rules/:id', (req, res) => {
    try {
      const result = routingService.deleteRule(db, log, req.params.id);
      ok(res, result);
    } catch (err) { fail(res, err.message); }
  });

  // ========== 智能路由决策 ==========
  router.post('/route', (req, res) => {
    try {
      const body = req.body || {};
      const result = routingService.routeModel(db, {
        taskType: body.taskType,
        qualityTier: body.qualityTier || 'standard',
        costBudget: body.costBudget,
        preferModel: body.preferModel,
      });
      ok(res, {
        config: result.config ? {
          id: result.config.id, provider: result.config.provider,
          serviceType: result.config.service_type, endpoint: result.config.endpoint,
        } : null,
        model: result.model,
        rule: result.rule ? { ruleKey: result.rule.ruleKey, qualityTier: result.rule.qualityTier } : null,
        isFallback: result.isFallback,
        fallbackConfig: result.fallbackConfig ? { id: result.fallbackConfig.id } : null,
        fallbackModel: result.fallbackModel,
      });
    } catch (err) { fail(res, err.message, 500); }
  });

  // ========== 模型调用统计 ==========
  router.get('/stats', (req, res) => {
    try {
      const stats = routingService.getModelStats(db, { days: Number(req.query.days) || 30 });
      ok(res, { items: stats, total: stats.length });
    } catch (err) { fail(res, err.message, 500); }
  });

  // ========== 熔断状态 ==========
  router.get('/circuit/:configId/:model', (req, res) => {
    try {
      const state = routingService.getCircuitState(db, req.params.configId, req.params.model);
      ok(res, state);
    } catch (err) { fail(res, err.message, 500); }
  });

  // ========== 记录调用日志 ==========
  router.post('/call-log', (req, res) => {
    try {
      routingService.recordCallLog(db, req.body || {});
      ok(res, { recorded: true });
    } catch (err) { fail(res, err.message); }
  });

  return router;
};
