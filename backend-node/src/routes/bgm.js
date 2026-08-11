'use strict';

/**
 * bgm.js
 * Sprint 8 - S8-T04: BGM生成路由
 *
 * 端点：
 *   POST   /ai/bgm                  创建BGM生成任务
 *   GET    /ai/bgm                  列出BGM曲目（支持 drama_id/episode_id/mood/status 筛选）
 *   GET    /ai/bgm/:id              获取BGM详情
 *   DELETE /ai/bgm/:id              删除BGM曲目
 *   POST   /ai/bgm/match            按情绪自动匹配BGM
 *   GET    /ai/bgm/moods            获取可用情绪列表
 */

const express = require('express');
const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const bgmService = require('../services/bgmService');

function bgmRoutes(db, log) {
  const router = express.Router();

  // 获取可用情绪列表
  router.get('/moods', (req, res) => {
    const moods = bgmService.VALID_MOODS.map(m => ({
      value: m,
      label: m,
      bpm: bgmService.MOOD_TO_BPM[m],
      instruments: bgmService.MOOD_TO_INSTRUMENTS[m],
      prompt: bgmService.MOOD_TO_PROMPT[m],
    }));
    const genres = bgmService.VALID_GENRES;
    response.success(res, { moods, genres });
  });

  // 创建BGM生成任务
  router.post('/', requireAuth, async (req, res) => {
    try {
      const body = { ...req.body, created_by: req.user?.id };
      const bgm = await bgmService.createBgm(db, log, body);
      response.created(res, bgm);
    } catch (err) {
      log.error('Create BGM failed', { error: err.message });
      if (err.message.includes('[BGM-')) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message);
    }
  });

  // 列出BGM曲目
  router.get('/', (req, res) => {
    try {
      const filters = {
        drama_id: req.query.drama_id,
        episode_id: req.query.episode_id,
        mood: req.query.mood,
        status: req.query.status,
        limit: req.query.limit,
      };
      const tracks = bgmService.listBgm(db, filters);
      response.success(res, tracks);
    } catch (err) {
      log.error('List BGM failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 获取BGM详情
  router.get('/:id', (req, res) => {
    try {
      const track = bgmService.getBgm(db, req.params.id);
      if (!track) return response.notFound(res, 'BGM曲目不存在');
      response.success(res, track);
    } catch (err) {
      log.error('Get BGM failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 按情绪自动匹配BGM
  router.post('/match', requireAuth, (req, res) => {
    try {
      const { drama_id, episode_id, mood } = req.body || {};
      if (!drama_id) return response.badRequest(res, 'drama_id 必填');
      const track = bgmService.matchBgmByMood(db, drama_id, episode_id, mood);
      response.success(res, track || { message: '未找到匹配的BGM' });
    } catch (err) {
      log.error('Match BGM failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 删除BGM曲目
  router.delete('/:id', requireAuth, (req, res) => {
    try {
      const deleted = bgmService.deleteBgm(db, req.params.id);
      if (!deleted) return response.notFound(res, 'BGM曲目不存在');
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('Delete BGM failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = bgmRoutes;
