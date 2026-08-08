/**
 * consistency.js — Sprint 2 角色一致性路由
 *
 * S2-T08: 一致性校验接口
 *   POST /api/v1/ai/consistency/check          — 比对生成图与参考图
 *   POST /api/v1/ai/consistency/embeddings     — 为角色生成面部 embedding
 *   POST /api/v1/ai/consistency/embeddings/batch — 批量为剧中角色生成 embedding
 *   GET  /api/v1/ai/consistency/logs            — 查询校验历史
 *   GET  /api/v1/ai/consistency/stats/:characterId — 获取角色一致性统计
 *   GET  /api/v1/ai/consistency/embeddings/:characterId — 获取角色 embedding
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
    try {
      const body = req.body || {};
      if (!body.generatedImageUrl) return _fail(res, '缺少 generatedImageUrl');

      const result = await consistencyService.checkConsistency(db, log, {
        dramaId: body.dramaId,
        storyboardId: body.storyboardId,
        characterId: body.characterId,
        generatedImageUrl: body.generatedImageUrl,
        referenceImageUrl: body.referenceImageUrl,
        characterType: body.characterType || 'project',
        threshold: body.threshold,
      });
      _ok(res, result);
    } catch (e) {
      log.error('POST /consistency/check', e.message);
      _fail(res, e.message);
    }
  });

  // ========== S2-T07: 角色指纹系统 ==========
  // POST /api/v1/ai/consistency/embeddings — 为角色生成面部 embedding
  router.post('/embeddings', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.characterId) return _fail(res, '缺少 characterId');

      const result = await consistencyService.generateCharacterEmbedding(db, log, body.characterId, {
        characterType: body.characterType || 'project',
        imageUrl: body.imageUrl,
        viewAngle: body.viewAngle || 'front',
        model: body.model,
      });
      _ok(res, result);
    } catch (e) {
      log.error('POST /consistency/embeddings', e.message);
      _fail(res, e.message);
    }
  });

  // POST /api/v1/ai/consistency/embeddings/batch — 批量为剧中角色生成 embedding
  router.post('/embeddings/batch', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.dramaId) return _fail(res, '缺少 dramaId');

      const result = await consistencyService.generateEmbeddingsForDrama(db, log, body.dramaId, {
        model: body.model,
      });
      _ok(res, result);
    } catch (e) {
      log.error('POST /consistency/embeddings/batch', e.message);
      _fail(res, e.message);
    }
  });

  // GET /api/v1/ai/consistency/embeddings/:characterId — 获取角色 embedding
  router.get('/embeddings/:characterId', (req, res) => {
    try {
      const characterId = Number(req.params.characterId);
      const characterType = req.query.characterType || 'project';
      const emb = consistencyService.getCharacterEmbedding(db, characterId, characterType);
      if (!emb) return _fail(res, '角色尚未生成 embedding', 404, 404);
      _ok(res, {
        characterId,
        embeddingDim: emb.embedding.length,
        embeddingModel: emb.embeddingModel,
        embeddingGeneratedAt: emb.embeddingGeneratedAt,
        threshold: emb.threshold,
      });
    } catch (e) {
      log.error('GET /consistency/embeddings/:id', e.message);
      _fail(res, e.message);
    }
  });

  // ========== 一致性校验历史 ==========
  // GET /api/v1/ai/consistency/logs
  router.get('/logs', (req, res) => {
    try {
      const logs = consistencyService.listConsistencyLogs(db, {
        dramaId: req.query.dramaId ? Number(req.query.dramaId) : null,
        storyboardId: req.query.storyboardId ? Number(req.query.storyboardId) : null,
        characterId: req.query.characterId ? Number(req.query.characterId) : null,
        passed: req.query.passed != null ? req.query.passed === 'true' || req.query.passed === '1' : null,
        limit: req.query.limit ? Number(req.query.limit) : 20,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      _ok(res, { items: logs, total: logs.length });
    } catch (e) {
      log.error('GET /consistency/logs', e.message);
      _fail(res, e.message);
    }
  });

  // GET /api/v1/ai/consistency/stats/:characterId — 角色一致性统计
  router.get('/stats/:characterId', (req, res) => {
    try {
      const characterId = Number(req.params.characterId);
      const stats = consistencyService.getCharacterConsistencyStats(db, characterId);
      _ok(res, stats);
    } catch (e) {
      log.error('GET /consistency/stats/:id', e.message);
      _fail(res, e.message);
    }
  });

  return router;
}

module.exports = createRouter;
