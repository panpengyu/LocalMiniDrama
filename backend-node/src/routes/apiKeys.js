/**
 * Sprint 15 - API 开放平台 REST 路由（S15-T01 开发者控制台 + 管理端）
 *
 * 用户端（需登录）—— 开发者控制台：
 *   POST   /open-platform/apps                申请创建开发者应用
 *   GET    /open-platform/apps                我的应用列表
 *   GET    /open-platform/apps/:appId         应用详情
 *   POST   /open-platform/apps/:appId/keys    为应用创建 API 密钥（返回明文一次）
 *   GET    /open-platform/keys                我的密钥列表（脱敏）
 *   POST   /open-platform/keys/:keyId/revoke  吊销密钥
 *   POST   /open-platform/keys/:keyId/renew   续期密钥
 *
 * 管理端（super_admin）：
 *   GET    /admin/open-platform/apps          应用分页列表（状态/关键词过滤）
 *   POST   /admin/open-platform/apps/:appId/review  审批应用 {approve, reason}
 *   GET    /admin/open-platform/keys          密钥列表（脱敏，可按用户/应用过滤）
 *
 * 全部数据落地本地 MySQL（api_apps / api_keys），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const apiKeyService = require('../services/apiKeyService');

function apiKeysRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // 统一错误码 → HTTP 映射
  function fail(res, err) {
    const badCodes = [
      'EMPTY_APP_NAME', 'APP_NAME_TOO_LONG', 'INVALID_SCOPES', 'INVALID_IP_WHITELIST',
      'APP_NOT_PENDING', 'KEY_NOT_ACTIVE', 'KEY_REVOKED', 'NOT_REVIEWABLE',
    ];
    const notFoundCodes = ['APP_NOT_FOUND', 'KEY_NOT_FOUND'];
    const forbiddenCodes = ['APP_FORBIDDEN', 'KEY_FORBIDDEN', 'APP_NOT_APPROVED'];
    if (forbiddenCodes.includes(err.code)) return response.forbidden(res, err.message);
    if (badCodes.includes(err.code)) return response.badRequest(res, err.message);
    if (notFoundCodes.includes(err.code)) return response.notFound(res, err.message);
    log.error('[S15] API开放平台接口异常', { code: err.code, error: err.message });
    return response.internalError(res, err.message);
  }

  // ===================== 用户端：开发者控制台 =====================

  // 申请创建开发者应用
  router.post('/open-platform/apps', requireAuth, (req, res) => {
    try {
      const { name, description } = req.body || {};
      const app = apiKeyService.createApp(db, log, { userId: req.user.id, name, description });
      response.success(res, app);
    } catch (err) { fail(res, err); }
  });

  // 我的应用列表
  router.get('/open-platform/apps', requireAuth, (req, res) => {
    try {
      const apps = apiKeyService.listApps(db, log, { userId: req.user.id });
      response.success(res, apps);
    } catch (err) { fail(res, err); }
  });

  // 应用详情
  router.get('/open-platform/apps/:appId', requireAuth, (req, res) => {
    try {
      const app = apiKeyService.getApp(db, log, { appId: req.params.appId, userId: req.user.id });
      response.success(res, app);
    } catch (err) { fail(res, err); }
  });

  // 为应用创建 API 密钥（明文仅此一次返回）
  router.post('/open-platform/apps/:appId/keys', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const result = apiKeyService.createKey(db, log, {
        userId: req.user.id,
        appId: req.params.appId,
        name: body.name,
        scopes: body.scopes,
        rateLimitPerMin: body.rate_limit_per_min,
        dailyQuota: body.daily_quota,
        ipWhitelist: body.ip_whitelist,
        expiresInDays: body.expires_in_days,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 我的密钥列表（脱敏）
  router.get('/open-platform/keys', requireAuth, (req, res) => {
    try {
      const keys = apiKeyService.listKeys(db, log, { userId: req.user.id });
      response.success(res, keys);
    } catch (err) { fail(res, err); }
  });

  // 吊销密钥
  router.post('/open-platform/keys/:keyId/revoke', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const key = apiKeyService.revokeKey(db, log, {
        keyId: req.params.keyId, userId: req.user.id, reason: body.reason,
      });
      response.success(res, apiKeyService.maskKey(key));
    } catch (err) { fail(res, err); }
  });

  // 续期密钥
  router.post('/open-platform/keys/:keyId/renew', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const key = apiKeyService.renewKey(db, log, {
        keyId: req.params.keyId, userId: req.user.id, days: body.days,
      });
      response.success(res, apiKeyService.maskKey(key));
    } catch (err) { fail(res, err); }
  });

  // ===================== 管理端：应用/密钥审批与查询 =====================

  // 应用分页列表
  router.get('/admin/open-platform/apps', superAdmin, (req, res) => {
    try {
      const q = req.query || {};
      const result = apiKeyService.listAppsAdmin(db, log, {
        status: q.status, keyword: q.keyword, page: q.page, pageSize: q.page_size,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 审批应用
  router.post('/admin/open-platform/apps/:appId/review', superAdmin, (req, res) => {
    try {
      const body = req.body || {};
      if (body.approve === undefined) return response.badRequest(res, '缺少 approve 字段');
      const app = apiKeyService.reviewApp(db, log, {
        appId: req.params.appId, approve: body.approve,
        reason: body.reason, adminId: req.user.id,
      });
      response.success(res, app);
    } catch (err) { fail(res, err); }
  });

  // 密钥列表（脱敏，可按用户/应用过滤）
  router.get('/admin/open-platform/keys', superAdmin, (req, res) => {
    try {
      const q = req.query || {};
      const keys = apiKeyService.listKeys(db, log, {
        userId: q.user_id, appId: q.app_id,
      });
      response.success(res, keys);
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = apiKeysRoutes;
