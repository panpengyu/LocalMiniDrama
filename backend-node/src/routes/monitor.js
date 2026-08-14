/**
 * Sprint 12 - S12-T06 系统监控大屏 REST 路由（超级管理员）
 *
 * 端点：
 *   GET  /admin/monitor/snapshot   实时系统快照（CPU/内存/磁盘/负载/队列/API/DB）
 *   GET  /admin/monitor/history    历史指标曲线 ?limit=（近 N 个采样点）
 *   POST /admin/monitor/sample     立即采样并落库一次
 *
 * 数据全部为真实运行时指标（os / 进程 / 队列 / DB / system_metric_snapshots），无 mock。
 */

'use strict';

const path = require('path');
const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const systemMonitorService = require('../services/systemMonitorService');
const opsMonitorService = require('../services/opsMonitorService');

function monitorRoutes(cfg, db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  function resolveStorageRoot() {
    const lp = cfg?.storage?.local_path;
    if (!lp) return path.join(process.cwd(), 'data', 'storage');
    return path.isAbsolute(lp) ? lp : path.join(process.cwd(), lp);
  }

  router.get('/admin/monitor/snapshot', ...superAdmin, async (req, res) => {
    try {
      const s = await systemMonitorService.snapshot(db, { storageRoot: resolveStorageRoot() });
      response.success(res, s);
    } catch (err) {
      log.error('[S12-T06] 系统快照失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/monitor/history', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: systemMonitorService.history(db, { limit: Number(req.query.limit) || 60 }) });
    } catch (err) {
      log.error('[S12-T06] 系统指标历史失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/monitor/sample', ...superAdmin, async (req, res) => {
    try {
      const s = await systemMonitorService.sampleAndPersist(db, log, { storageRoot: resolveStorageRoot() });
      response.success(res, s);
    } catch (err) {
      log.error('[S12-T06] 系统指标采样失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ========== Sprint 16 - S16-T05 全链路监控（扩展） ==========

  // 前端错误上报（登录可选：全局 authMiddleware 已注入 req.user）
  // 入参：{ level?, category?, message?, source?, lineno?, colno?, stack?, pageUrl? }
  router.post('/monitor/frontend-error', (req, res) => {
    try {
      const b = req.body || {};
      const result = opsMonitorService.reportFrontendError(db, log, {
        userId: req.user?.id || null,
        level: b.level, category: b.category, message: b.message,
        source: b.source, lineno: b.lineno, colno: b.colno,
        stack: b.stack, pageUrl: b.pageUrl || req.headers.referer,
        userAgent: req.headers['user-agent']
      });
      if (result.ok && Number(result.id) % 200 === 0) {
        // 前端错误突增时同步触发一次全链路扫描（节流：每 200 条）
        opsMonitorService.scanAndAlertOps(db, log).catch(() => {});
      }
      response.success(res, result);
    } catch (err) {
      log.error('[S16-T05] 前端错误上报失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 管理端：前端错误分页查询
  router.get('/admin/monitor/frontend-errors', ...superAdmin, (req, res) => {
    try {
      const data = opsMonitorService.listFrontendErrors(db, log, {
        page: req.query.page, pageSize: req.query.page_size,
        category: req.query.category, level: req.query.level
      });
      response.success(res, data);
    } catch (err) {
      log.error('[S16-T05] 前端错误查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 管理端：全链路运维快照（DB/队列/API/前端错误）
  router.get('/admin/monitor/ops', ...superAdmin, async (req, res) => {
    try {
      const s = await opsMonitorService.collectOpsSnapshot(db, log);
      response.success(res, s);
    } catch (err) {
      log.error('[S16-T05] 运维快照失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 管理端：触发一次全链路异常扫描（自动告警）
  router.post('/admin/monitor/ops-scan', ...superAdmin, async (req, res) => {
    try {
      const result = await opsMonitorService.scanAndAlertOps(db, log, (req.body || {}).overrides || {});
      response.success(res, result);
    } catch (err) {
      log.error('[S16-T05] 运维扫描失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = monitorRoutes;
