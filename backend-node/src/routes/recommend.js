/**
 * Sprint 16 - S16-T01 素材推荐引擎 REST 路由（登录用户）
 *
 * 端点：
 *   GET  /recommend/home             首页个性化推荐组合（素材三维度 + 模板）
 *   GET  /recommend/materials        素材推荐 ?dimension=character|scene|prop&limit=&excludeIds=
 *   GET  /recommend/templates        模板推荐 ?limit=
 *   GET  /recommend/trending         全站热门 ?dimension=&limit=
 *   POST /recommend/feedback         推荐反馈留痕（impression/click/collect/apply）
 *
 * 数据全部来自真实 MySQL（dramas / user_activity_logs / recommend_logs /
 * 素材库三表 / marketplace_templates / user_preference_profiles），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const recommendService = require('../services/materialRecommendService');

function recommendRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const auth = requireAuth;

  // 首页个性化推荐
  router.get('/recommend/home', auth, (req, res) => {
    try {
      const data = recommendService.homeRecommend(db, log, {
        userId: req.user.id,
        materialLimit: Math.min(Math.max(Number(req.query.materialLimit) || 6, 1), 20),
        templateLimit: Math.min(Math.max(Number(req.query.templateLimit) || 8, 1), 20)
      });
      // 曝光留痕（真实数据入 MySQL）
      try {
        for (const [dim, items] of Object.entries(data.materials)) {
          (items || []).forEach((it, idx) => {
            recommendService.logFeedback(db, log, {
              userId: req.user.id, itemType: 'material', dimension: dim,
              itemId: it.id, action: 'impression', source: it.source,
              score: it.score, rank: idx + 1
            });
          });
        }
        (data.templates || []).forEach((it, idx) => {
          recommendService.logFeedback(db, log, {
            userId: req.user.id, itemType: 'template', dimension: 'template',
            itemId: it.id, action: 'impression', source: it.source,
            score: it.score, rank: idx + 1
          });
        });
      } catch (e) { log.warn?.('[S16-T01] 推荐曝光留痕失败:', e.message); }
      response.success(res, data);
    } catch (err) {
      log.error('[S16-T01] 首页推荐失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 素材推荐
  router.get('/recommend/materials', auth, (req, res) => {
    try {
      const data = recommendService.recommendMaterials(db, log, {
        userId: req.user.id,
        dimension: String(req.query.dimension || 'character'),
        limit: Number(req.query.limit) || 20,
        excludeIds: req.query.excludeIds || []
      });
      response.success(res, data);
    } catch (err) {
      log.error('[S16-T01] 素材推荐失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 模板推荐
  router.get('/recommend/templates', auth, (req, res) => {
    try {
      const data = recommendService.recommendTemplates(db, log, {
        userId: req.user.id,
        limit: Number(req.query.limit) || 20
      });
      response.success(res, data);
    } catch (err) {
      log.error('[S16-T01] 模板推荐失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 全站热门（S16-T02：热门榜读接口挂 30s 缓存，降低 sync-mysql 串行压力）
  router.get('/recommend/trending', auth, require('../services/cacheService').cacheMiddleware('rec:trending', 30), (req, res) => {
    try {
      const data = recommendService.getTrending(db, log, {
        dimension: req.query.dimension || null,
        limit: Number(req.query.limit) || 20
      });
      response.success(res, data);
    } catch (err) {
      log.error('[S16-T01] 热门榜获取失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 推荐反馈留痕
  router.post('/recommend/feedback', auth, (req, res) => {
    try {
      const { itemType, dimension, itemId, action = 'click', source = 'personalized', score, rank, meta } = req.body || {};
      const result = recommendService.logFeedback(db, log, {
        userId: req.user.id, itemType, dimension, itemId, action, source, score, rank, meta
      });
      if (!result.ok) return response.badRequest(res, result.error || '参数缺失');
      response.success(res, result);
    } catch (err) {
      log.error('[S16-T01] 推荐反馈失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = { recommendRoutes };
