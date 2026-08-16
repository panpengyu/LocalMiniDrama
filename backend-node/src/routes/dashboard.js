'use strict';

/**
 * Sprint 18 - S18-T02 自定义仪表盘布局 REST 路由
 *
 *   GET  /admin/dashboard/layout        读取当前管理员的布局
 *   POST /admin/dashboard/layout        保存布局（vuedraggable 拖拽后）
 *   POST /admin/dashboard/layout/reset  重置为默认布局
 *
 * 布局按管理员维度持久化到 dashboard_layout（真实 MySQL）。
 */

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const dashboardLayoutService = require('../services/dashboardLayoutService');

function dashboardRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  router.get('/admin/dashboard/layout', requireAuth, (req, res) => {
    try {
      response.success(res, dashboardLayoutService.getLayout(db, req.user.id));
    } catch (err) {
      log.error('[S18-T02] 读取仪表盘布局失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/dashboard/layout', requireAuth, (req, res) => {
    try {
      const out = dashboardLayoutService.saveLayout(db, req.user.id, req.body && req.body.layout);
      response.success(res, out);
    } catch (err) {
      log.error('[S18-T02] 保存仪表盘布局失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/dashboard/layout/reset', requireAuth, (req, res) => {
    try {
      response.success(res, dashboardLayoutService.resetLayout(db, req.user.id));
    } catch (err) {
      log.error('[S18-T02] 重置仪表盘布局失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = dashboardRoutes;
