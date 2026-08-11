'use strict';

/**
 * styles.js
 * Sprint 8 - S8-T01/T03: 风格配置路由
 *
 * 端点：
 *   GET    /dramas/:dramaId/style          获取风格配置
 *   POST   /dramas/:dramaId/style          创建风格配置
 *   PUT    /dramas/:dramaId/style          更新风格配置
 *   DELETE /dramas/:dramaId/style          删除风格配置
 *   GET    /dramas/:dramaId/style/summary  获取风格概要
 *   GET    /styles/presets                 获取可用风格预设列表
 */

const express = require('express');
const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const styleService = require('../services/styleService');

function styleRoutes(db, log) {
  const router = express.Router();

  // 获取风格预设列表
  router.get('/styles/presets', (req, res) => {
    try {
      const presets = styleService.VALID_GLOBAL_STYLES.map(s => ({
        value: s,
        label: s.replace(/_/g, ' '),
        prompt: styleService.STYLE_PROMPT_MAP[s] || '',
      }));
      const lineWeights = styleService.VALID_LINE_WEIGHTS;
      const shadingStyles = styleService.VALID_SHADING_STYLES;
      const compositionRules = styleService.VALID_COMPOSITION_RULES;
      response.success(res, { presets, lineWeights, shadingStyles, compositionRules });
    } catch (err) {
      log.error('Get style presets failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 获取风格配置
  router.get('/dramas/:dramaId/style', (req, res) => {
    try {
      const config = styleService.getStyleConfig(db, req.params.dramaId);
      if (!config) return response.notFound(res, '该项目暂无风格配置');
      response.success(res, config);
    } catch (err) {
      log.error('Get style config failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 获取风格概要
  router.get('/dramas/:dramaId/style/summary', (req, res) => {
    try {
      const summary = styleService.getStyleSummary(db, req.params.dramaId);
      if (!summary) return response.notFound(res, '该项目暂无风格配置');
      response.success(res, summary);
    } catch (err) {
      log.error('Get style summary failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 创建风格配置
  router.post('/dramas/:dramaId/style', requireAuth, (req, res) => {
    try {
      const body = { ...req.body, drama_id: Number(req.params.dramaId), created_by: req.user?.id };
      const config = styleService.createStyleConfig(db, body);
      response.created(res, config);
    } catch (err) {
      log.error('Create style config failed', { error: err.message });
      if (err.message.includes('[STYLE-')) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message);
    }
  });

  // 更新风格配置
  router.put('/dramas/:dramaId/style', requireAuth, (req, res) => {
    try {
      const config = styleService.updateStyleConfig(db, Number(req.params.dramaId), { ...req.body, created_by: req.user?.id });
      response.success(res, config);
    } catch (err) {
      log.error('Update style config failed', { error: err.message });
      if (err.message.includes('[STYLE-')) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message);
    }
  });

  // 删除风格配置
  router.delete('/dramas/:dramaId/style', requireAuth, (req, res) => {
    try {
      const deleted = styleService.deleteStyleConfig(db, Number(req.params.dramaId));
      if (!deleted) return response.notFound(res, '风格配置不存在');
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('Delete style config failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = styleRoutes;
