'use strict';
/**
 * routes/screenwriter.js
 * Sprint 1 - T10: AI编剧助手 REST API
 *
 * 接口清单：
 *  ========== 字典/基础设施 ==========
 *  GET    /screenwriter/templates                  剧本结构模板列表
 *  GET    /screenwriter/genres                     漫剧类型字典
 *  GET    /screenwriter/styles                     风格基调字典
 *  GET    /screenwriter/shot-types                 镜头类型字典
 *  GET    /screenwriter/emotions                   台词情感字典
 *
 *  ========== 生成接口（async 队列） ==========
 *  POST   /screenwriter/outline                    S1-T03 生成大纲（async）
 *  POST   /screenwriter/characters                 S1-T04 生成角色档案（async）
 *  POST   /screenwriter/episodes                   S1-T05 分集剧情拆分（async）
 *  POST   /screenwriter/storyboard                 S1-T06 分镜脚本生成（async）
 *  POST   /screenwriter/dialogue                   S1-T07 对话台词生成（async）
 *
 *  ========== 同步版本（生成+立即返回） ==========
 *  POST   /screenwriter/outline/sync
 *  POST   /screenwriter/characters/sync
 *  POST   /screenwriter/episodes/sync
 *  POST   /screenwriter/storyboard/sync
 *  POST   /screenwriter/dialogue/sync
 *
 *  ========== 查询接口 ==========
 *  GET    /screenwriter/outlines                   大纲列表
 *  GET    /screenwriter/outlines/:outlineId        大纲详情
 *  GET    /screenwriter/outlines/:outlineId/characters 角色列表
 *  GET    /screenwriter/outlines/:outlineId/episodes   分集列表
 *  GET    /screenwriter/episodes/:episodeId        分集详情（含场景）
 *  GET    /screenwriter/episodes/:episodeId/frames     分镜列表
 *  GET    /screenwriter/episodes/:episodeId/dialogues  台词列表
 *
 *  ========== 任务查询 ==========
 *  GET    /screenwriter/jobs/:jobId                查询任务状态
 *  GET    /screenwriter/jobs                       任务列表
 *  DELETE /screenwriter/jobs/:jobId                取消任务
 */

const express = require('express');
const response = require('../response');
const queueService = require('../services/queueService');
const swService = require('../services/screenwriterService');

module.exports = function routes(db, cfg, log) {
  log = log || { info: console.log, warn: console.warn, error: console.error };
  const router = express.Router();
  const { requireAuth } = require('../middleware/auth') || { requireAuth: (req, res, next) => next() };

  // ---------- 取当前user ----------
  function currentUserId(req) {
    return (req.user && (req.user.id || req.user.userId)) || (req.session && req.session.userId) || null;
  }

  function ok(res, data, msg) {
    res.json({ success: true, code: 0, message: msg || 'ok', data });
  }
  function fail(res, msg, code, status) {
    res.status(status || 400).json({ success: false, code: code || 400, message: msg || 'bad request', data: null });
  }

  // ========== 字典/模板 ==========
  router.get('/templates', (req, res) => {
    const list = swService.listTemplates(db, req.query.category);
    ok(res, { items: list, total: list.length });
  });
  router.get('/genres', (req, res) => ok(res, { items: swService.listGenres(db) }));
  router.get('/styles', (req, res) => ok(res, { items: swService.listStyles(db) }));
  router.get('/shot-types', (req, res) => ok(res, { items: swService.listShotTypes(db) }));
  router.get('/emotions', (req, res) => ok(res, { items: swService.listEmotions(db) }));

  // ========== 通用 async 包装 ==========
  async function enqueueOrRun(jobType, payload, sync) {
    const swJobId = swService.uid('swjob');
    const payload2 = { ...payload, swJobId };
    // 初始化 DB 记录（pending）
    try {
      swService.createJobRecord(db, {
        jobId: swJobId,
        userId: payload.userId,
        enterpriseId: payload.enterpriseId,
        jobType,
        payload: payload2,
        status: 'pending',
        progress: 0,
      });
    } catch (_) {}
    if (sync) {
      let jobResult = null;
      switch (jobType) {
        case 'outline': jobResult = await swService.generateOutline(db, log, payload2); break;
        case 'characters': jobResult = await swService.generateCharacters(db, log, payload2); break;
        case 'episodes': jobResult = await swService.generateEpisodes(db, log, payload2); break;
        case 'storyboard': jobResult = await swService.generateStoryboard(db, log, payload2); break;
        case 'dialogue': jobResult = await swService.generateDialogue(db, log, payload2); break;
        case 'tts': jobResult = { todo: true }; break;
      }
      // 同步路径也填充 outline_id/episode_id 等关联字段，与 async 路径一致
      const relatedPatch = {};
      if (jobType === 'outline') relatedPatch.outlineId = jobResult?.outlineId || null;
      else if (jobType === 'characters') relatedPatch.outlineId = jobResult?.outlineId || null;
      else if (jobType === 'episodes') relatedPatch.outlineId = jobResult?.outlineId || null;
      else if (jobType === 'storyboard') {
        relatedPatch.episodeId = jobResult?.episodeId || null;
        relatedPatch.outlineId = jobResult?.outlineId || null;
      } else if (jobType === 'dialogue') {
        relatedPatch.episodeId = jobResult?.episodeId || null;
        relatedPatch.outlineId = jobResult?.outlineId || null;
      } else if (jobType === 'tts') relatedPatch.dialogueId = jobResult?.dialogueId || null;
      swService.updateJobRecord(db, swJobId, {
        status: 'completed',
        progress: 100,
        result: jobResult,
        completedAt: swService.nowStr(),
        ...relatedPatch,
      });
      return { mode: 'sync', jobId: swJobId, jobType, result: jobResult };
    } else {
      const qj = await queueService.createJob({
        jobType,
        payload: payload2,
        customJobId: swJobId,
      });
      swService.updateJobRecord(db, swJobId, { bullJobId: qj.jobId });
      return { mode: 'async', jobId: swJobId, jobType, bullJobId: qj.jobId };
    }
  }

  const syncFlag = (req) => false; // sync接口单独写

  // ========== 生成接口（async） ==========
  router.post('/outline', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      const result = await enqueueOrRun('outline', { ...b, userId }, false);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/outline', e.message); fail(res, e.message); }
  });
  router.post('/characters', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.outlineId) return fail(res, '缺少outlineId');
      const result = await enqueueOrRun('characters', { ...b, userId }, false);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/characters', e.message); fail(res, e.message); }
  });
  router.post('/episodes', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.outlineId) return fail(res, '缺少outlineId');
      const result = await enqueueOrRun('episodes', { ...b, userId }, false);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/episodes', e.message); fail(res, e.message); }
  });
  router.post('/storyboard', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.episodeId) return fail(res, '缺少episodeId');
      const result = await enqueueOrRun('storyboard', { ...b, userId }, false);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/storyboard', e.message); fail(res, e.message); }
  });
  router.post('/dialogue', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.episodeId) return fail(res, '缺少episodeId');
      const result = await enqueueOrRun('dialogue', { ...b, userId }, false);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/dialogue', e.message); fail(res, e.message); }
  });

  // ========== 同步版 ==========
  router.post('/outline/sync', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      const result = await enqueueOrRun('outline', { ...b, userId }, true);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/outline/sync', e.message); fail(res, e.message); }
  });
  router.post('/characters/sync', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.outlineId) return fail(res, '缺少outlineId');
      const result = await enqueueOrRun('characters', { ...b, userId }, true);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/characters/sync', e.message); fail(res, e.message); }
  });
  router.post('/episodes/sync', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.outlineId) return fail(res, '缺少outlineId');
      const result = await enqueueOrRun('episodes', { ...b, userId }, true);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/episodes/sync', e.message); fail(res, e.message); }
  });
  router.post('/storyboard/sync', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.episodeId) return fail(res, '缺少episodeId');
      const result = await enqueueOrRun('storyboard', { ...b, userId }, true);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/storyboard/sync', e.message); fail(res, e.message); }
  });
  router.post('/dialogue/sync', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = currentUserId(req);
      if (!b.episodeId) return fail(res, '缺少episodeId');
      const result = await enqueueOrRun('dialogue', { ...b, userId }, true);
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/dialogue/sync', e.message); fail(res, e.message); }
  });

  // ========== 查询接口 ==========
  router.get('/outlines', async (req, res) => {
    const userId = currentUserId(req);
    const items = swService.listOutlines(db, {
      userId: userId || undefined,
      dramaId: req.query.dramaId || undefined,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
    });
    ok(res, { items, total: items.length });
  });
  router.get('/outlines/:outlineId', async (req, res) => {
    const o = await swService.getOutline(db, req.params.outlineId);
    if (!o) return fail(res, 'outline not found', 404, 404);
    ok(res, o);
  });
  router.get('/outlines/:outlineId/characters', async (req, res) => {
    const items = await swService.listCharacters(db, req.params.outlineId);
    ok(res, { items, total: items.length });
  });
  router.get('/outlines/:outlineId/episodes', async (req, res) => {
    const items = swService.listEpisodes(db, req.params.outlineId);
    ok(res, { items, total: items.length });
  });
  router.get('/episodes/:episodeId', async (req, res) => {
    const e = await swService.getEpisode(db, req.params.episodeId);
    if (!e) return fail(res, 'episode not found', 404, 404);
    ok(res, e);
  });
  router.get('/episodes/:episodeId/frames', async (req, res) => {
    const items = await swService.listFrames(db, req.params.episodeId);
    ok(res, { items, total: items.length });
  });
  router.get('/episodes/:episodeId/dialogues', async (req, res) => {
    const items = await swService.listDialogues(db, req.params.episodeId);
    ok(res, { items, total: items.length });
  });

  // ========== 任务 ==========
  router.get('/jobs/:jobId', async (req, res) => {
    const { jobId } = req.params;
    // 合并Bull状态和DB状态
    const dbJob = swService.getJobRecord(db, jobId);
    let bull = null;
    try { bull = await queueService.getJobStatus(jobId); } catch (_) {}
    ok(res, { job: dbJob, bull });
  });
  router.get('/jobs', async (req, res) => {
    const q = req.query || {};
    const userId = currentUserId(req);
    const items = swService.listJobs(db, {
      userId: userId || undefined,
      jobType: q.jobType || undefined,
      status: q.status || undefined,
      limit: q.limit || 50,
      offset: q.offset || 0,
    });
    ok(res, { items, total: items.length });
  });
  router.delete('/jobs/:jobId', async (req, res) => {
    try {
      const r = await queueService.cancelJob(req.params.jobId);
      if (r && r.exists) swService.updateJobRecord(db, req.params.jobId, { status: 'cancelled', errorMessage: 'User cancelled' });
      ok(res, r);
    } catch (e) { fail(res, e.message); }
  });

  return router;
};
