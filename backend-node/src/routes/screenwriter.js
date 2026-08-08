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
 *  ========== 查询 ==========
 *  GET    /screenwriter/outlines                      大纲列表
 *  GET    /screenwriter/outlines/:outlineId          大纲详情
 *  GET    /screenwriter/outlines/:outlineId/characters 角色列表
 *  GET    /screenwriter/outlines/:outlineId/episodes 分集列表
 *  GET    /screenwriter/episodes/:episodeId          分集详情
 *  GET    /screenwriter/episodes/:episodeId/frames   分镜列表
 *  GET    /screenwriter/episodes/:episodeId/dialogues 台词列表
 *
 *  ========== 修改/重生成（平台文档 3.1 逐段修改 + 场景描述） ==========
 *  PATCH  /screenwriter/outlines/:outlineId           修改大纲（逐段）
 *  POST   /screenwriter/episodes/:episodeId/regenerate 重新生成单集
 *  POST   /screenwriter/scene-description             场景描述生成（含美术风格建议）
 *
 *  ========== 任务查询 ==========
 *  GET    /screenwriter/jobs/:jobId                查询任务状态
 *  GET    /screenwriter/jobs                       任务列表
 *  DELETE /screenwriter/jobs/:jobId                取消任务
 *
 *  ========== 多轮对话（S1-T02） ==========
 *  POST   /screenwriter/chat                       发送消息（多轮对话式编剧）
 *  GET    /screenwriter/chat                       列出会话
 *  GET    /screenwriter/chat/:sessionId            获取对话历史
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

  // ========== 修改/重生成（平台文档 3.1：逐段修改/重生成 + 场景描述） ==========
  // PATCH /ai/screenwriter/outlines/:outlineId — 修改大纲
  router.patch('/outlines/:outlineId', async (req, res) => {
    try {
      const patch = req.body || {};
      const o = swService.updateOutline(db, req.params.outlineId, patch);
      if (!o) return fail(res, 'outline not found', 404, 404);
      ok(res, o);
    } catch (e) { log.error('PATCH /screenwriter/outlines/:id', e.message); fail(res, e.message); }
  });

  // POST /ai/screenwriter/episodes/:episodeId/regenerate — 重新生成单集
  router.post('/episodes/:episodeId/regenerate', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await swService.regenerateEpisode(db, log, req.params.episodeId, body);
      ok(res, result);
    } catch (e) { log.error('POST /screenwriter/episodes/:id/regenerate', e.message); fail(res, e.message); }
  });

  // POST /ai/screenwriter/scene-description — 场景描述生成（含美术风格建议）
  router.post('/scene-description', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.sceneId && !body.location) return fail(res, '缺少 sceneId 或 location');
      const result = await swService.generateSceneDescription(db, log, body);
      ok(res, result);
    } catch (e) { log.error('POST /screenwriter/scene-description', e.message); fail(res, e.message); }
  });

  // ========== Sprint 2 增量：逐段修改/重生成（单幕 / 单角色 / 角色保存） ==========

  // PATCH /ai/screenwriter/characters/:characterId — 保存修改后的角色（人设/外貌/性格等）
  router.patch('/characters/:characterId', async (req, res) => {
    const t0 = Date.now();
    const characterId = req.params.characterId;
    const patch = req.body || {};
    log.info('[router] PATCH /screenwriter/characters/:id 进入', { characterId, patchKeys: Object.keys(patch), patchKeysCount: Object.keys(patch).length, userAgent: req.get('user-agent')?.slice(0, 80) });
    try {
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
        log.warn('[router] PATCH /screenwriter/characters/:id 参数非法：patch 为空', { characterId, elapsedMs: Date.now() - t0 });
        return fail(res, '缺少修改字段');
      }
      const updated = swService.updateCharacter(db, log, characterId, patch);
      if (!updated) {
        log.warn('[router] PATCH /screenwriter/characters/:id 角色不存在或更新失败', { characterId, elapsedMs: Date.now() - t0 });
        return fail(res, 'character not found', 404, 404);
      }
      log.info('[router] PATCH /screenwriter/characters/:id 成功', { characterId, name: updated.name, role: updated.role, elapsedMs: Date.now() - t0 });
      ok(res, updated);
    } catch (e) {
      log.error('[router] PATCH /screenwriter/characters/:id 异常', { characterId, errMsg: e.message, stack: e.stack?.slice(0, 400), elapsedMs: Date.now() - t0 });
      fail(res, e.message);
    }
  });

  // POST /ai/screenwriter/characters/:characterId/regenerate — 单角色重生成（保留定位但丰富细节）
  router.post('/characters/:characterId/regenerate', async (req, res) => {
    const t0 = Date.now();
    const characterId = req.params.characterId;
    const body = req.body || {};
    log.info('[router] POST /screenwriter/characters/:id/regenerate 进入', { characterId, bodyKeys: Object.keys(body), promptAppend: (body.prompt_append || body.promptAppend || '').slice(0, 80) });
    try {
      const result = await swService.regenerateCharacter(db, log, characterId, body);
      log.info('[router] POST /screenwriter/characters/:id/regenerate 成功', { characterId, name: result?.name, role: result?.role, elapsedMs: Date.now() - t0 });
      ok(res, result);
    } catch (e) {
      log.error('[router] POST /screenwriter/characters/:id/regenerate 异常', { characterId, errMsg: e.message, stack: e.stack?.slice(0, 400), elapsedMs: Date.now() - t0 });
      fail(res, e.message);
    }
  });

  // POST /ai/screenwriter/outlines/:outlineId/regenerate-act — 大纲单幕重生成
  // body: { act_index: 0, prompt_append?: "增强冲突感" }
  router.post('/outlines/:outlineId/regenerate-act', async (req, res) => {
    const t0 = Date.now();
    const outlineId = req.params.outlineId;
    const body = req.body || {};
    const actIndex = body.act_index != null ? body.act_index : body.actIndex;
    log.info('[router] POST /screenwriter/outlines/:id/regenerate-act 进入', { outlineId, actIndex, promptAppend: (body.prompt_append || body.promptAppend || '').slice(0, 80), bodyKeys: Object.keys(body) });
    try {
      if (actIndex == null) {
        log.warn('[router] POST /screenwriter/outlines/:id/regenerate-act 参数非法：缺少 act_index', { outlineId, elapsedMs: Date.now() - t0 });
        return fail(res, '缺少 act_index');
      }
      if (Number.isNaN(Number(actIndex))) {
        log.warn('[router] POST /screenwriter/outlines/:id/regenerate-act 参数非法：act_index 不是数字', { outlineId, actIndex, elapsedMs: Date.now() - t0 });
        return fail(res, 'act_index 必须是数字');
      }
      const result = await swService.regenerateAct(db, log, outlineId, actIndex, body);
      log.info('[router] POST /screenwriter/outlines/:id/regenerate-act 成功', { outlineId, actIndex: Number(actIndex), actNumber: result?.act_number, title: result?.title, keyEventCount: (result?.key_events || []).length, elapsedMs: Date.now() - t0 });
      ok(res, { act: result, act_index: actIndex });
    } catch (e) {
      log.error('[router] POST /screenwriter/outlines/:id/regenerate-act 异常', { outlineId, actIndex, errMsg: e.message, stack: e.stack?.slice(0, 400), elapsedMs: Date.now() - t0 });
      fail(res, e.message);
    }
  });

  // ========== S2-T04: 一键创建项目 ==========
  // POST /ai/screenwriter/create-project — AI生成结果一键创建完整项目(剧本+角色+场景+分镜)
  router.post('/create-project', async (req, res) => {
    try {
      const body = req.body || {};
      const outlineId = body.outline_id || body.outlineId;
      if (!outlineId) return fail(res, '缺少 outline_id');
      const userId = currentUserId(req);
      const result = await swService.createProject(db, log, {
        outlineId,
        name: body.name || body.title || undefined,
        userId,
        user: req.user || null,
      });
      ok(res, result);
    } catch (e) { log.error('POST /screenwriter/create-project', e.message); fail(res, e.message); }
  });

  // ========== 多轮对话（S1-T02） ==========
  // POST /ai/screenwriter/chat — 发送消息（支持多轮，自动维护会话上下文）
  router.post('/chat', async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.message) return fail(res, '缺少message');
      const userId = currentUserId(req);
      const result = await swService.chatWithScreenwriter(db, log, {
        sessionId: b.sessionId || undefined,
        message: b.message,
        userId,
        outlineId: b.outlineId || undefined,
        episodeId: b.episodeId || undefined,
        contextType: b.contextType || 'general',
        title: b.title,
        model: b.model,
      });
      return ok(res, result);
    } catch (e) { log.error('POST /screenwriter/chat', e.message); fail(res, e.message); }
  });

  // GET /ai/screenwriter/chat/:sessionId — 获取对话历史
  router.get('/chat/:sessionId', async (req, res) => {
    const items = swService.getChatHistory(db, req.params.sessionId, req.query.limit || 50);
    ok(res, { items, total: items.length });
  });

  // GET /ai/screenwriter/chat — 列出会话
  router.get('/chat', async (req, res) => {
    const userId = currentUserId(req);
    const items = swService.listChatSessions(db, {
      userId: userId || undefined,
      outlineId: req.query.outlineId || undefined,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
    });
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
