/**
 * Sprint 12 - S12-T07 权限与安全增强 REST 路由（超级管理员）
 *
 * 端点：
 *   GET /admin/security/audit-logs    操作审计日志分页 ?actor_id&action&keyword&page&page_size
 *   GET /admin/security/audit-stats   操作审计统计（总量/失败量/Top动作）
 *   GET /admin/security/login-logs    登录日志分页 ?username&success&page&page_size
 *   GET /admin/security/login-stats   登录统计 ?days=（总数/失败/成功/去重用户）
 *
 * Sprint 19 - S19-T03/T04 追加端点（安全策略与会话管理）：
 *   GET  /admin/security/policy                    读取安全策略
 *   PUT  /admin/security/policy                    更新安全策略（部分合并）
 *   POST /admin/security/policy/reset              重置为默认策略
 *   GET  /admin/security/sessions                  在线会话列表（分页/关键字/仅在线）
 *   POST /admin/security/sessions/:id/revoke       踢下线单个会话
 *   POST /admin/security/sessions/revoke-all       强制下线指定用户全部会话
 *   POST /admin/security/sessions/prune            清理过期/已下线会话
 *
 * 数据全部来自 MySQL（operation_audit_logs / login_logs / security_policy / user_sessions），
 * 返回时对敏感字段脱敏（非 super_admin）。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const securityService = require('../services/securityService');
const securityPolicy = require('../services/securityPolicyService');
const sessionService = require('../services/sessionService');

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

  // ================= Sprint 19 - 安全策略 =================
  router.get('/admin/security/policy', requireAuth, (req, res) => {
    try {
      response.success(res, securityPolicy.getPolicy(db));
    } catch (err) {
      log.error('[S19-T03] 读取安全策略失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/admin/security/policy', ...superAdmin, (req, res) => {
    try {
      const policy = securityPolicy.updatePolicy(db, log, req.body || {});
      response.success(res, policy);
    } catch (err) {
      log.error('[S19-T03] 更新安全策略失败', { error: err.message });
      response.badRequest(res, err.message);
    }
  });

  router.post('/admin/security/policy/reset', ...superAdmin, (req, res) => {
    try {
      const policy = securityPolicy.resetPolicy(db, log);
      response.success(res, policy);
    } catch (err) {
      log.error('[S19-T03] 重置安全策略失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ================= Sprint 19 - 会话管理 =================
  router.get('/admin/security/sessions', requireAuth, (req, res) => {
    try {
      const result = sessionService.listSessions(db, {
        keyword: req.query.keyword || null,
        onlyActive: req.query.online === 'true' || req.query.online === '1',
        page: req.query.page || 1,
        pageSize: req.query.pageSize || 20,
      });
      response.successWithPagination(res, result.items, result.total, result.page, result.pageSize);
    } catch (err) {
      log.error('[S19-T04] 会话列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/security/sessions/:id/revoke', ...superAdmin, (req, res) => {
    try {
      const ok = sessionService.revokeSession(db, req.params.id, req.body && req.body.userId);
      if (!ok) return response.notFound(res, '会话不存在或已下线');
      log.info('[S19-T04] 强制下线会话', { sessionId: req.params.id, operator: req.user.username });
      response.success(res, { revoked: true });
    } catch (err) {
      log.error('[S19-T04] 踢下线会话失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/security/sessions/revoke-all', ...superAdmin, (req, res) => {
    try {
      const { userId, username } = req.body || {};
      if (!userId && !username) return response.badRequest(res, '请指定用户');
      let targetId = userId;
      if (!targetId) {
        const u = db.prepare('SELECT id FROM users WHERE username = ? OR phone = ?').get(username, username);
        if (!u) return response.notFound(res, '用户不存在');
        targetId = u.id;
      }
      sessionService.revokeAllForUser(db, targetId);
      log.info('[S19-T04] 强制下线用户全部会话', { userId: targetId, operator: req.user.username });
      response.success(res, { revokedAll: true });
    } catch (err) {
      log.error('[S19-T04] 强制下线失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/admin/security/sessions/prune', ...superAdmin, (req, res) => {
    try {
      const removed = sessionService.pruneExpired(db);
      response.success(res, { removed });
    } catch (err) {
      log.error('[S19-T04] 清理会话失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = securityRoutes;
