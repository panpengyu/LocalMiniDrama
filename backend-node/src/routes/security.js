/**
 * Sprint 12 - S12-T07 权限与安全增强 REST 路由（超级管理员）
 *
 * 端点：
 *   GET /admin/security/audit-logs    操作审计日志分页 ?actor_id&action&keyword&page&page_size
 *   GET /admin/security/audit-stats   操作审计统计（总量/失败量/Top动作）
 *   GET /admin/security/login-logs    登录日志分页 ?username&success&page&page_size
 *   GET /admin/security/login-stats   登录统计 ?days=（总数/失败/成功/去重用户）
 *
 * 数据全部来自 MySQL（operation_audit_logs / login_logs），返回时对敏感字段脱敏（非 super_admin）。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const securityService = require('../services/securityService');

function securityRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  router.get('/admin/security/audit-logs', ...superAdmin, (req, res) => {
    try {
      const result = securityService.listAuditLogs(db, {
        actorId: req.query.actor_id || null,
        action: req.query.action || null,
        keyword: req.query.keyword || null,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      });
      response.successWithPagination(res, result.items, result.total, result.page, result.pageSize);
    } catch (err) {
      log.error('[S12-T07] 审计日志查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/security/audit-stats', ...superAdmin, (req, res) => {
    try {
      response.success(res, securityService.auditStats(db));
    } catch (err) {
      log.error('[S12-T07] 审计统计失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/security/login-logs', ...superAdmin, (req, res) => {
    try {
      const successParam = req.query.success;
      const result = securityService.listLoginLogs(db, {
        username: req.query.username || null,
        success: successParam === '1' ? 1 : successParam === '0' ? 0 : undefined,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      });
      // 登录日志对非 super_admin 脱敏（此处均为 super_admin，保留原样；字段级权限工具已就绪）
      const role = (req.user || {}).role;
      const items = result.items.map((row) => securityService.applyFieldPermission(row, role));
      response.successWithPagination(res, items, result.total, result.page, result.pageSize);
    } catch (err) {
      log.error('[S12-T07] 登录日志查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/admin/security/login-stats', ...superAdmin, (req, res) => {
    try {
      response.success(res, securityService.loginStats(db, { days: Number(req.query.days) || 7 }));
    } catch (err) {
      log.error('[S12-T07] 登录统计失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = securityRoutes;
