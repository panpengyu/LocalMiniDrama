'use strict';

/**
 * Sprint 12 - S12-T01 素材智能标签 + S12-T02 三级素材库 REST 路由
 *
 * 素材标签 (S12-T01):
 *   POST   /materials/:kind/:id/tags/generate   为素材生成标签(AI优先+规则降级) ?replace=1
 *   GET    /materials/:kind/:id/tags            素材现有标签
 *   POST   /materials/:kind/:id/tags            手动新增标签 {dimension, name}
 *   DELETE /materials/:kind/:id/tags/:tagId     移除标签关联
 *   GET    /materials/tags/dictionary           标签词典(维度/使用次数) ?kind=&dimension=
 *   POST   /materials/:kind/tags/batch          批量为未打标签素材补标签 {limit}
 *
 * 三级素材库 (S12-T02):
 *   POST   /materials/:kind/:id/collect         收藏到个人库
 *   POST   /materials/:kind/:id/publish-team    发布到团队库
 *   POST   /materials/:kind/:id/publish-public  发布到公共库
 *   POST   /materials/:kind/:id/reuse           跨项目复用 {targetDramaId}
 *   GET    /materials/scope/summary             各作用域素材数量概览
 *
 * kind ∈ character / scene / prop
 */

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const materialTagService = require('../services/materialTagService');
const libraryScopeService = require('../services/libraryScopeService');

function materialRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  function resolveTable(kind) {
    try {
      return libraryScopeService.resolveTable(kind);
    } catch (_) {
      return null;
    }
  }

  // ===================== 素材标签 (S12-T01) =====================

  router.get('/materials/tags/dictionary', requireAuth, (req, res) => {
    try {
      const table = req.query.kind ? resolveTable(req.query.kind) : null;
      if (req.query.kind && !table) return response.badRequest(res, 'kind 应为 character/scene/prop');
      const dict = materialTagService.listTagDictionary(db, { table, dimension: req.query.dimension || null });
      response.success(res, { dimensions: materialTagService.DIMENSIONS, tags: dict });
    } catch (err) {
      log.error('[S12-T01] 标签词典失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/tags/batch', requireAuth, async (req, res) => {
    const table = resolveTable(req.params.kind);
    if (!table) return response.badRequest(res, 'kind 应为 character/scene/prop');
    try {
      const result = await materialTagService.batchTagUntagged(db, log, {
        table,
        limit: Number(req.body?.limit) || 20,
      });
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T01] 批量打标签失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/tags/generate', requireAuth, async (req, res) => {
    const table = resolveTable(req.params.kind);
    if (!table) return response.badRequest(res, 'kind 应为 character/scene/prop');
    try {
      const result = await materialTagService.tagMaterial(db, log, {
        table,
        materialId: Number(req.params.id),
        replace: req.query.replace === '1' || req.body?.replace === true,
      });
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T01] 标签生成失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/materials/:kind/:id/tags', requireAuth, (req, res) => {
    const table = resolveTable(req.params.kind);
    if (!table) return response.badRequest(res, 'kind 应为 character/scene/prop');
    try {
      response.success(res, materialTagService.listMaterialTags(db, table, Number(req.params.id)));
    } catch (err) {
      log.error('[S12-T01] 标签查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/tags', requireAuth, (req, res) => {
    const table = resolveTable(req.params.kind);
    if (!table) return response.badRequest(res, 'kind 应为 character/scene/prop');
    const { dimension, name } = req.body || {};
    if (!dimension || !name) return response.badRequest(res, '需提供 dimension 与 name');
    try {
      const result = materialTagService.addManualTag(db, table, Number(req.params.id), dimension, name);
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T01] 手动标签失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/materials/:kind/:id/tags/:tagId', requireAuth, (req, res) => {
    const table = resolveTable(req.params.kind);
    if (!table) return response.badRequest(res, 'kind 应为 character/scene/prop');
    try {
      response.success(res, materialTagService.removeMaterialTag(db, table, Number(req.params.id), Number(req.params.tagId)));
    } catch (err) {
      log.error('[S12-T01] 移除标签失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ===================== 三级素材库 (S12-T02) =====================

  router.get('/materials/scope/summary', requireAuth, (req, res) => {
    try {
      response.success(res, libraryScopeService.scopeSummary(db, {
        userId: req.user.id,
        teamId: req.user.team_id || null,
      }));
    } catch (err) {
      log.error('[S12-T02] 作用域概览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/collect', requireAuth, (req, res) => {
    try {
      const result = libraryScopeService.collectToPersonal(db, log, {
        kind: req.params.kind, id: Number(req.params.id), userId: req.user.id,
      });
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T02] 收藏到个人库失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/publish-team', requireAuth, (req, res) => {
    try {
      const result = libraryScopeService.publishToTeam(db, log, {
        kind: req.params.kind, id: Number(req.params.id),
        teamId: req.user.team_id || Number(req.body?.teamId),
        enterpriseId: req.user.enterprise_id || null,
      });
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T02] 发布到团队库失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/publish-public', requireAuth, (req, res) => {
    try {
      const result = libraryScopeService.publishToPublic(db, log, {
        kind: req.params.kind, id: Number(req.params.id),
      });
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T02] 发布到公共库失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/materials/:kind/:id/reuse', requireAuth, (req, res) => {
    const targetDramaId = Number(req.body?.targetDramaId || req.body?.target_drama_id);
    if (!targetDramaId) return response.badRequest(res, '需提供 targetDramaId');
    try {
      const result = libraryScopeService.reuseToProject(db, log, {
        kind: req.params.kind, id: Number(req.params.id), targetDramaId,
      });
      if (!result.ok) return response.badRequest(res, result.error);
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T02] 跨项目复用失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = materialRoutes;
