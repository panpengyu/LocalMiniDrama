/**
 * consistency.js — Sprint 2/3 角色一致性路由
 *
 * S2-T08: 一致性校验接口
 *   POST /api/v1/ai/consistency/check          — 比对生成图与参考图
 *   POST /api/v1/ai/consistency/embeddings     — 为角色生成面部 embedding
 *   POST /api/v1/ai/consistency/embeddings/batch — 批量为剧中角色生成 embedding
 *   GET  /api/v1/ai/consistency/logs            — 查询校验历史
 *   GET  /api/v1/ai/consistency/stats/:characterId — 获取角色一致性统计
 *   GET  /api/v1/ai/consistency/embeddings/:characterId — 获取角色 embedding
 *
 * S3-T01: 前端调用 — 每条路由入口/参数校验/耗时 均打 logger.info
 */
'use strict';

const express = require('express');
const consistencyService = require('../services/consistencyService');

function _ok(res, data, code = 200) {
  res.status(code).json({ success: true, data, error: null });
}
function _fail(res, error, code = 400, statusCode) {
  res.status(statusCode || code).json({ success: false, data: null, error });
}

/**
 * @param {object} db - 数据库连接
 * @param {object} log - 日志模块
 * @returns Express Router
 */
function createRouter(db, log) {
  const router = express.Router();

  // ========== S2-T08: 一致性校验接口 ==========
  // POST /api/v1/ai/consistency/check
  router.post('/check', async (req, res) => {
    const t0 = Date.now();
    try {
      const body = req.body || {};
      log.info('[router] POST /consistency/check 进入', {
        dramaId: body.dramaId || body.drama_id || null,
        storyboardId: body.storyboardId || body.storyboard_id || null,
        characterId: body.characterId || body.character_id || null,
        hasGenUrl: !!body.generatedImageUrl,
        hasRefUrl: !!body.referenceImageUrl,
        threshold: body.threshold || null,
        ua: (req.get('user-agent') || '').slice(0, 80),
      });
      if (!body.generatedImageUrl) {
        log.warn('[router] POST /consistency/check 参数非法：缺少 generatedImageUrl', { elapsedMs: Date.now() - t0 });
        return _fail(res, '缺少 generatedImageUrl');
      }

      const result = await consistencyService.checkConsistency(db, log, {
        dramaId: body.dramaId,
        storyboardId: body.storyboardId,
        characterId: body.characterId,
        generatedImageUrl: body.generatedImageUrl,
        referenceImageUrl: body.referenceImageUrl,
        characterType: body.characterType || 'project',
        threshold: body.threshold,
      });
      log.info('[router] POST /consistency/check 完成', {
        checkId: result.checkId,
        similarityScore: result.similarityScore,
        threshold: result.threshold,
        passed: result.passed,
        method: result.method,
        elapsedMs: Date.now() - t0,
      });
      _ok(res, result);
    } catch (e) {
      log.error('[router] POST /consistency/check 异常', { errMsg: e.message, stack: (e.stack || '').slice(0, 400), elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  // ========== S2-T07: 角色指纹系统 ==========
  // POST /api/v1/ai/consistency/embeddings — 为角色生成面部 embedding
  router.post('/embeddings', async (req, res) => {
    const t0 = Date.now();
    try {
      const body = req.body || {};
      log.info('[router] POST /consistency/embeddings 进入', {
        characterId: body.characterId || null,
        characterType: body.characterType || 'project',
        viewAngle: body.viewAngle || 'front',
        hasImageUrl: !!body.imageUrl,
      });
      if (!body.characterId) {
        log.warn('[router] POST /consistency/embeddings 参数非法：缺少 characterId', { elapsedMs: Date.now() - t0 });
        return _fail(res, '缺少 characterId');
      }

      const result = await consistencyService.generateCharacterEmbedding(db, log, body.characterId, {
        characterType: body.characterType || 'project',
        imageUrl: body.imageUrl,
        viewAngle: body.viewAngle || 'front',
        model: body.model,
      });
      log.info('[router] POST /consistency/embeddings 完成', {
        characterId: body.characterId,
        embeddingDim: result.embeddingDim,
        embeddingModel: result.embeddingModel,
        success: result.success,
        elapsedMs: Date.now() - t0,
      });
      _ok(res, result);
    } catch (e) {
      log.error('[router] POST /consistency/embeddings 异常', { errMsg: e.message, stack: (e.stack || '').slice(0, 400), elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  // POST /api/v1/ai/consistency/embeddings/batch — 批量为剧中角色生成 embedding
  router.post('/embeddings/batch', async (req, res) => {
    const t0 = Date.now();
    try {
      const body = req.body || {};
      log.info('[router] POST /consistency/embeddings/batch 进入', {
        dramaId: body.dramaId || null,
        model: body.model || null,
      });
      if (!body.dramaId) {
        log.warn('[router] POST /consistency/embeddings/batch 参数非法：缺少 dramaId', { elapsedMs: Date.now() - t0 });
        return _fail(res, '缺少 dramaId');
      }

      const result = await consistencyService.generateEmbeddingsForDrama(db, log, body.dramaId, {
        model: body.model,
      });
      log.info('[router] POST /consistency/embeddings/batch 完成', {
        dramaId: body.dramaId,
        total: result.total,
        okCount: result.results.filter(r => r.success).length,
        elapsedMs: Date.now() - t0,
      });
      _ok(res, result);
    } catch (e) {
      log.error('[router] POST /consistency/embeddings/batch 异常', { errMsg: e.message, stack: (e.stack || '').slice(0, 400), elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  // GET /api/v1/ai/consistency/embeddings/:characterId — 获取角色 embedding
  router.get('/embeddings/:characterId', (req, res) => {
    const t0 = Date.now();
    try {
      const characterId = Number(req.params.characterId);
      const characterType = req.query.characterType || 'project';
      log.info('[router] GET /consistency/embeddings/:id 进入', { characterId, characterType });
      const emb = consistencyService.getCharacterEmbedding(db, characterId, characterType);
      if (!emb) {
        log.warn('[router] GET /consistency/embeddings/:id 未找到', { characterId, elapsedMs: Date.now() - t0 });
        return _fail(res, '角色尚未生成 embedding', 404, 404);
      }
      log.info('[router] GET /consistency/embeddings/:id 完成', {
        characterId,
        embeddingDim: emb.embeddingDim,
        embeddingModel: emb.embeddingModel,
        threshold: emb.threshold,
        elapsedMs: Date.now() - t0,
      });
      _ok(res, {
        characterId,
        embeddingDim: emb.embeddingDim,
        embeddingModel: emb.embeddingModel,
        embeddingGeneratedAt: emb.embeddingGeneratedAt,
        threshold: emb.threshold,
      });
    } catch (e) {
      log.error('[router] GET /consistency/embeddings/:id 异常', { errMsg: e.message, elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  // ========== 一致性校验历史 ==========
  // GET /api/v1/ai/consistency/logs
  router.get('/logs', (req, res) => {
    const t0 = Date.now();
    try {
      const logs = consistencyService.listConsistencyLogs(db, {
        dramaId: req.query.dramaId ? Number(req.query.dramaId) : null,
        storyboardId: req.query.storyboardId ? Number(req.query.storyboardId) : null,
        characterId: req.query.characterId ? Number(req.query.characterId) : null,
        passed: req.query.passed != null ? req.query.passed === 'true' || req.query.passed === '1' : null,
        limit: req.query.limit ? Number(req.query.limit) : 20,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      log.info('[router] GET /consistency/logs 完成', {
        count: logs.length,
        dramaId: req.query.dramaId || null,
        characterId: req.query.characterId || null,
        passed: req.query.passed != null ? (req.query.passed === 'true' || req.query.passed === '1') : 'ALL',
        elapsedMs: Date.now() - t0,
      });
      _ok(res, { items: logs, total: logs.length });
    } catch (e) {
      log.error('[router] GET /consistency/logs 异常', { errMsg: e.message, elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  // GET /api/v1/ai/consistency/stats/:characterId — 角色一致性统计
  router.get('/stats/:characterId', (req, res) => {
    const t0 = Date.now();
    try {
      const characterId = Number(req.params.characterId);
      log.info('[router] GET /consistency/stats/:id 进入', { characterId });
      const stats = consistencyService.getCharacterConsistencyStats(db, characterId);
      log.info('[router] GET /consistency/stats/:id 完成', {
        characterId,
        totalChecks: stats.totalChecks,
        avgScore: stats.avgScore,
        passRate: stats.passRate,
        recentScore: stats.recentScore,
        elapsedMs: Date.now() - t0,
      });
      _ok(res, stats);
    } catch (e) {
      log.error('[router] GET /consistency/stats/:id 异常', { errMsg: e.message, elapsedMs: Date.now() - t0 });
      _fail(res, e.message);
    }
  });

  return router;
}

module.exports = createRouter;
