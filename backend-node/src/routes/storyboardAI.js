'use strict';
/**
 * routes/storyboardAI.js
 * Sprint 4 - S4-T01 智能分镜生成 REST API
 *
 * 接口清单：
 *   POST   /storyboard/generate       智能分镜生成（剧本段落→专业分镜列表）
 *   POST   /storyboard/polish-prompt  单帧提示词润色
 *   GET    /storyboard/generations    生成批次列表
 *   GET    /storyboard/generations/:id 生成批次详情
 *   GET    /storyboard/dictionaries   分镜字典（镜头类型/运镜/构图/情绪/转场）
 */

const express = require('express');
const response = require('../response');
const sbGenService = require('../services/storyboardGenService');

module.exports = function routes(db, cfg, log) {
  log = log || { info: console.log, warn: console.warn, error: console.error };
  const router = express.Router();
  const { requireAuth } = require('../middleware/auth') || { requireAuth: (req, res, next) => next() };

  function currentUserId(req) {
    return (req.user && (req.user.id || req.user.userId)) || (req.session && req.session.userId) || null;
  }

  function ok(res, data, msg) {
    res.json({ success: true, code: 0, message: msg || 'ok', data });
  }
  function fail(res, msg, code, status) {
    res.status(status || 400).json({ success: false, code: code || 400, message: msg || 'bad request', data: null });
  }

  // ========== 智能分镜生成 ==========
  router.post('/generate', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.scriptText || !body.scriptText.trim()) {
        return fail(res, '剧本段落不能为空');
      }
      const result = await sbGenService.generate(db, log, {
        scriptText: body.scriptText,
        dramaId: body.dramaId || null,
        episodeId: body.episodeId || null,
        style: body.style || 'vertical_916',
        count: body.count || 8,
        characters: body.characters || [],
        scenes: body.scenes || [],
        userId: currentUserId(req),
      });
      ok(res, result, '分镜生成成功');
    } catch (err) {
      log.error('[SB-GEN-ROUTE] generate error', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('不能为空'))) {
        return fail(res, err.message);
      }
      fail(res, err.message || '分镜生成失败', 500, 500);
    }
  });

  // ========== 单帧提示词润色 ==========
  router.post('/polish-prompt', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.frame) return fail(res, '缺少 frame 参数');
      const result = await sbGenService.polishFramePrompt(db, log, {
        frame: body.frame,
        style: body.style || 'vertical_916',
      });
      ok(res, result, '提示词润色成功');
    } catch (err) {
      log.error('[SB-GEN-ROUTE] polish error', { error: err.message });
      fail(res, err.message || '润色失败', 500, 500);
    }
  });

  // ========== 生成批次列表 ==========
  router.get('/generations', requireAuth, (req, res) => {
    try {
      const list = sbGenService.listGenerations(db, {
        dramaId: req.query.dramaId || null,
        userId: currentUserId(req),
        limit: req.query.limit || 50,
        offset: req.query.offset || 0,
      });
      ok(res, { items: list, total: list.length });
    } catch (err) {
      fail(res, err.message, 500, 500);
    }
  });

  // ========== 生成批次详情 ==========
  router.get('/generations/:id', requireAuth, (req, res) => {
    try {
      const detail = sbGenService.getGeneration(db, req.params.id);
      if (!detail) return fail(res, '生成批次不存在', 404, 404);
      ok(res, detail);
    } catch (err) {
      fail(res, err.message, 500, 500);
    }
  });

  // ========== 分镜字典 ==========
  router.get('/dictionaries', (req, res) => {
    ok(res, {
      shotTypes: sbGenService.SHOT_TYPES,
      cameraMovements: sbGenService.CAMERA_MOVEMENTS,
      compositions: sbGenService.COMPOSITIONS,
      emotions: sbGenService.EMOTIONS,
      transitions: sbGenService.TRANSITIONS,
    });
  });

  return router;
};
