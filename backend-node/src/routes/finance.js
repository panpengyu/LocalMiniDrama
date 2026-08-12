/**
 * Sprint 12 - S12-T05 财务与计费增强 REST 路由（超级管理员）
 *
 * 端点：
 *   GET    /admin/finance/overview           财务总览（收入 / 成本 / 毛利 / ARPU / 付费用户）
 *   GET    /admin/finance/cost-breakdown     成本构成（按 service_type 汇总模型成本）
 *   GET    /admin/finance/daily-trend        收入/成本/利润按日趋势 ?days=
 *   GET    /admin/finance/arrears            欠费/低额预警 ?threshold=&limit=
 *   GET    /admin/finance/billing-rules      计费规则列表
 *   POST   /admin/finance/billing-rules      新增计费规则
 *   PUT    /admin/finance/billing-rules/:id  更新计费规则
 *   DELETE /admin/finance/billing-rules/:id  删除计费规则
 *   POST   /admin/finance/compute-charge     试算某业务应扣积分（智能计费）
 *   POST   /admin/finance/daily-report       生成/更新某日财务日报 ?date=
 *   GET    /admin/finance/daily-reports      查询财务日报（近 N 天）?days=
 *
 * 数据全部来自 MySQL（recharges / ai_model_call_logs / point_logs / billing_rules /
 * finance_daily_reports），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const financeService = require('../services/financeService');

function financeRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  router.get('/admin/finance/overview', ...superAdmin, (req, res) => {
    try {
      response.success(res, financeService.overview(db, { days: Number(req.query.days) || 30 }));
    } catch (err) {
      log.error('[S12-T05] 财务总览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/finance/cost-breakdown', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: financeService.costBreakdown(db) });
    } catch (err) {
      log.error('[S12-T05] 成本构成失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/finance/daily-trend', ...superAdmin, (req, res) => {
    try {
      response.success(res, financeService.dailyTrend(db, { days: Number(req.query.days) || 14 }));
    } catch (err) {
      log.error('[S12-T05] 收支趋势失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/finance/arrears', ...superAdmin, (req, res) => {
    try {
      const items = financeService.arrearsWarnings(db, {
        threshold: req.query.threshold !== undefined ? Number(req.query.threshold) : 0,
        limit: Number(req.query.limit) || 50,
      });
      response.success(res, { items });
    } catch (err) {
      log.error('[S12-T05] 欠费预警失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 触发欠费预警通知：对命中欠费/低额的用户写入平台站内通知（幂等，同用户同日一次）
  router.post('/admin/finance/arrears/notify', ...superAdmin, (req, res) => {
    try {
      const body = req.body || {};
      const result = financeService.notifyArrears(db, log, {
        threshold: body.threshold !== undefined ? Number(body.threshold) : 0,
        limit: Number(body.limit) || 200,
      });
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T05] 欠费预警通知失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------------- 计费规则 CRUD ----------------
  router.get('/admin/finance/billing-rules', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: financeService.listBillingRules(db) });
    } catch (err) {
      log.error('[S12-T05] 计费规则列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/finance/billing-rules', ...superAdmin, (req, res) => {
    try {
      const body = req.body || {};
      if (!body.name || !String(body.name).trim()) return response.badRequest(res, '规则名称不能为空');
      response.created(res, financeService.createBillingRule(db, log, body));
    } catch (err) {
      log.error('[S12-T05] 计费规则创建失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/finance/billing-rules/:id', ...superAdmin, (req, res) => {
    try {
      const updated = financeService.updateBillingRule(db, log, req.params.id, req.body || {});
      if (!updated) return response.notFound(res, '计费规则不存在');
      response.success(res, updated);
    } catch (err) {
      log.error('[S12-T05] 计费规则更新失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/admin/finance/billing-rules/:id', ...superAdmin, (req, res) => {
    try {
      const ok = financeService.deleteBillingRule(db, log, req.params.id);
      if (!ok) return response.notFound(res, '计费规则不存在');
      response.success(res, { deleted: true });
    } catch (err) {
      log.error('[S12-T05] 计费规则删除失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 智能计费试算
  router.post('/admin/finance/compute-charge', ...superAdmin, (req, res) => {
    try {
      const { business_type, user_level, quantity, base_unit_points } = req.body || {};
      if (!business_type) return response.badRequest(res, '缺少 business_type');
      response.success(res, financeService.computeCharge(db, {
        businessType: business_type,
        userLevel: user_level || 'all',
        quantity: Number(quantity) || 1,
        baseUnitPoints: Number(base_unit_points) || 0,
      }));
    } catch (err) {
      log.error('[S12-T05] 计费试算失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------------- 财务日报 ----------------
  router.post('/admin/finance/daily-report', ...superAdmin, (req, res) => {
    try {
      const dateStr = req.query.date || (req.body && req.body.date) || null;
      response.success(res, financeService.computeDailyReport(db, log, dateStr));
    } catch (err) {
      log.error('[S12-T05] 财务日报生成失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/finance/daily-reports', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: financeService.listDailyReports(db, { days: Number(req.query.days) || 30 }) });
    } catch (err) {
      log.error('[S12-T05] 财务日报查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = financeRoutes;
