'use strict';

/**
 * Sprint 18 - S18-T02 报表订阅 / 模板 / 发送日志 / 数据导出 REST 路由
 *
 *   GET    /admin/reports/subscriptions            订阅列表
 *   POST   /admin/reports/subscriptions            新建订阅
 *   PUT    /admin/reports/subscriptions/:id        更新订阅
 *   DELETE /admin/reports/subscriptions/:id        删除订阅
 *   POST   /admin/reports/subscriptions/:id/run    立即生成并分发（真实发送/未配置时降级记录失败）
 *   GET    /admin/reports/templates                模板列表
 *   POST   /admin/reports/templates                新建模板
 *   PUT    /admin/reports/templates/:id            更新模板
 *   DELETE /admin/reports/templates/:id            删除模板
 *   GET    /admin/reports/send-logs                发送日志（分页/筛选）
 *   POST   /admin/reports/send-logs/:id/retry      重试单条失败记录
 *   POST   /admin/reports/retry-failed             批量重试到期失败记录
 *   GET    /admin/reports/export?type=csv|xlsx&data=behavior|events|events_dist&days=N  数据导出
 *
 * 全部基于真实数据；SMTP/钉钉未配置时发送降级为 failed 日志（可重试）。
 */

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const reportJobService = require('../services/reportJobService');
const notifyService = require('../services/notifyService');
const exportService = require('../services/exportService');
const analyticsService = require('../services/analyticsService');
const trackingService = require('../services/trackingService');

function exportData(db, dataKey, days) {
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  if (dataKey === 'behavior') {
    const bh = analyticsService.behaviorAnalysis(db, { days: d });
    return {
      filename: `behavior_daily_${d}d`,
      columns: [
        { key: 'date', label: '日期' },
        { key: 'actions', label: '行为数' },
        { key: 'dau', label: '日活' },
      ],
      rows: bh.daily,
    };
  }
  if (dataKey === 'events_dist') {
    const st = trackingService.stats(db, { days: d });
    return {
      filename: `events_dist_${d}d`,
      columns: [
        { key: 'event', label: '事件' },
        { key: 'count', label: '次数' },
        { key: 'users', label: '独立用户' },
      ],
      rows: st.by_event,
    };
  }
  const st = trackingService.stats(db, { days: d });
  return {
    filename: `events_daily_${d}d`,
    columns: [
      { key: 'date', label: '日期' },
      { key: 'events', label: '事件量' },
      { key: 'users', label: '活跃用户' },
    ],
    rows: st.daily,
  };
}

function reportsRoutes(db, log, config) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];
  const notify = (config && config.notify) || {};

  // ---- 订阅 ----
  router.get('/admin/reports/subscriptions', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.listSubscriptions(db));
    } catch (err) {
      log.error('[S18-T02] 订阅列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/reports/subscriptions', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.createSubscription(db, req.body || {}));
    } catch (err) {
      log.error('[S18-T02] 新建订阅失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/reports/subscriptions/:id', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.updateSubscription(db, req.params.id, req.body || {}));
    } catch (err) {
      log.error('[S18-T02] 更新订阅失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/admin/reports/subscriptions/:id', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.deleteSubscription(db, req.params.id));
    } catch (err) {
      log.error('[S18-T02] 删除订阅失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/reports/subscriptions/:id/run', ...superAdmin, async (req, res) => {
    try {
      const sub = reportJobService.getSubscription(db, req.params.id);
      if (!sub) return response.error(res, 'NOT_FOUND', '订阅不存在', 404);
      const out = await reportJobService.runSubscription(db, log, notify, sub);
      response.success(res, out);
    } catch (err) {
      log.error('[S18-T02] 立即运行订阅失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---- 模板 ----
  router.get('/admin/reports/templates', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.listTemplates(db));
    } catch (err) {
      log.error('[S18-T02] 模板列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/reports/templates', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.createTemplate(db, req.body || {}));
    } catch (err) {
      log.error('[S18-T02] 新建模板失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/reports/templates/:id', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.updateTemplate(db, req.params.id, req.body || {}));
    } catch (err) {
      log.error('[S18-T02] 更新模板失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/admin/reports/templates/:id', ...superAdmin, (req, res) => {
    try {
      response.success(res, reportJobService.deleteTemplate(db, req.params.id));
    } catch (err) {
      log.error('[S18-T02] 删除模板失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---- 发送日志 ----
  router.get('/admin/reports/send-logs', ...superAdmin, (req, res) => {
    try {
      response.success(res, notifyService.listSendLogs(db, {
        subscription_id: req.query.subscription_id || null,
        status: req.query.status || null,
        channel: req.query.channel || null,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      }));
    } catch (err) {
      log.error('[S18-T02] 发送日志失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/reports/send-logs/:id/retry', ...superAdmin, async (req, res) => {
    try {
      const out = await notifyService.retryFailed(db, log, notify, {
        id: req.params.id,
        regenerate: (sub) => {
          const report = reportJobService.generateReport(db, { templateId: sub.template_id, reportType: sub.report_type });
          return reportJobService.formatReport(report);
        },
      });
      response.success(res, out);
    } catch (err) {
      log.error('[S18-T02] 重试发送失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/reports/retry-failed', ...superAdmin, async (req, res) => {
    try {
      const out = await notifyService.retryFailed(db, log, notify, {
        limit: Number(req.body.limit) || 10,
        regenerate: (sub) => {
          const report = reportJobService.generateReport(db, { templateId: sub.template_id, reportType: sub.report_type });
          return reportJobService.formatReport(report);
        },
      });
      response.success(res, out);
    } catch (err) {
      log.error('[S18-T02] 批量重试失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---- 数据导出 ----
  router.get('/admin/reports/export', ...superAdmin, (req, res) => {
    try {
      const type = req.query.type === 'xlsx' ? 'xlsx' : 'csv';
      const dataKey = String(req.query.data || 'events');
      const days = Number(req.query.days) || 30;
      const { columns, rows, filename } = exportData(db, dataKey, days);
      if (type === 'xlsx') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        res.send(exportService.toXLSX(columns, rows));
      } else {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(Buffer.from(exportService.toCSV(columns, rows), 'utf8'));
      }
    } catch (err) {
      log.error('[S18-T02] 数据导出失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = reportsRoutes;
