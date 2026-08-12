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

  return router;
}

module.exports = monitorRoutes;
