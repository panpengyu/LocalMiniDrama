'use strict';
/**
 * routes/ttsPipeline.js
 * Sprint 4 - S4-T03/T04 智能配音流水线 REST API
 *
 * 接口清单：
 *   GET    /tts/voices               音色列表
 *   GET    /tts/emotions             情感语调列表
 *   GET    /tts/voice-bindings       角色音色绑定列表
 *   POST   /tts/voice-bindings       绑定角色音色
 *   DELETE /tts/voice-bindings/:id   删除音色绑定
 *   POST   /tts/extract-dialogues    从分镜提取台词
 *   POST   /tts/batch-synthesize     批量TTS合成
 *   GET    /tts/dubbing/episode/:id  分集配音记录
 */

const express = require('express');
const path = require('path');
const ttsService = require('../services/ttsService');

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
  function fail(res, msg, status) {
    res.status(status || 400).json({ success: false, code: status || 400, message: msg || 'bad request', data: null });
  }

  function getStorageBase() {
    return cfg?.storage?.base || path.join(__dirname, '../../../backend-node/data/storage') || path.join(process.cwd(), 'data/storage');
  }

  // ========== 音色/情感字典 ==========
  router.get('/voices', (req, res) => ok(res, { items: ttsService.listVoices() }));
  router.get('/emotions', (req, res) => ok(res, { items: ttsService.listEmotions() }));

  // ========== 角色音色绑定 ==========
  router.get('/voice-bindings', requireAuth, (req, res) => {
    try {
      const list = ttsService.listVoiceBindings(db, { dramaId: req.query.dramaId || null });
      ok(res, { items: list, total: list.length });
    } catch (err) { fail(res, err.message, 500); }
  });

  router.post('/voice-bindings', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const result = ttsService.bindVoice(db, log, {
        dramaId: body.dramaId,
        characterId: body.characterId,
        characterName: body.characterName,
        voiceId: body.voiceId,
        voiceName: body.voiceName,
        provider: body.provider,
        emotion: body.emotion,
        speed: body.speed,
        pitch: body.pitch,
        language: body.language,
        isDefault: body.isDefault,
      });
      ok(res, result, '音色绑定成功');
    } catch (err) { fail(res, err.message); }
  });

  router.delete('/voice-bindings/:id', requireAuth, (req, res) => {
    try {
      const result = ttsService.deleteVoiceBinding(db, log, req.params.id);
      ok(res, result);
    } catch (err) { fail(res, err.message); }
  });

  // ========== 台词提取 ==========
  router.post('/extract-dialogues', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const items = ttsService.extractDialogues(db, {
        dramaId: body.dramaId || null,
        episodeId: body.episodeId || null,
      });
      ok(res, { items, total: items.length });
    } catch (err) { fail(res, err.message, 500); }
  });

  // ========== 批量TTS合成 ==========
  router.post('/batch-synthesize', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!Array.isArray(body.items) || body.items.length === 0) return fail(res, 'items 台词列表不能为空');
      const result = await ttsService.batchSynthesize(db, log, {
        dramaId: body.dramaId || null,
        episodeId: body.episodeId || null,
        items: body.items,
        storageBase: getStorageBase(),
        userId: currentUserId(req),
      });
      ok(res, result, `批量配音完成：成功${result.success}/${result.total}`);
    } catch (err) {
      log.error('[TTS-ROUTE] batch error', { error: err.message });
      fail(res, err.message, 500);
    }
  });

  // ========== 分集配音记录 ==========
  router.get('/dubbing/episode/:id', requireAuth, (req, res) => {
    try {
      const list = ttsService.listDubbingByEpisode(db, req.params.id);
      ok(res, { items: list, total: list.length });
    } catch (err) { fail(res, err.message, 500); }
  });

  return router;
};
