/**
 * edit.js
 * Sprint 7 — S7-T05/S7-T07 智能剪辑路由
 *
 * 日志规范：每条请求生成 requestId ([REQ#EDxxxx])，分阶段打印 ENTER/DONE/ERROR
 *
 * 权限控制 (S7-F05)：
 *   - POST /auto（智能剪辑）需认证 + 项目权限
 *   - POST /align（配音对齐）需认证 + 项目权限
 *   - GET /tasks/:id 返回的任务 drama_id 与当前用户权限比对
 */
const editService = require('../services/editService');
const audioAlignService = require('../services/audioAlignService');
const transitionEffects = require('../services/transitionEffects');
const permissionService = require('../services/permissionService');
const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');

function makeReqId() { return 'REQ#ED' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function maskUser(u) { return u ? { id: u.id, username: u.username || u.name, role: u.role } : null; }

function ensureDramaAccess(db, user, dramaId, reqId, action = '访问') {
  if (permissionService.isSuperAdmin(user)) return true;
  if (!dramaId) return true;
  const drama = db.prepare('SELECT id, created_by, enterprise_id, team_id FROM dramas WHERE id = ?').get(Number(dramaId));
  if (!drama) return true;
  if (!permissionService.canViewDrama(user, drama)) {
    console.log(`[${reqId}] [403] 无权限${action}该项目 drama_id=${dramaId}，当前用户:`, { user: maskUser(user) });
    return false;
  }
  return true;
}

function editRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  router.post('/auto', requireAuth, async (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    const body = req.body || {};
    console.log(`[${reqId}] [ENTER] POST /ai/edit/auto`, {
      drama_id: body.drama_id,
      episode_id: body.episode_id,
      resolution: body.resolution,
      fps: body.fps,
      transition_default: body.transition_default,
      beat_sync: body.beat_sync,
      user: maskUser(req.user),
    });
    if (!body.drama_id) return response.badRequest(res, 'drama_id 必填');
    if (!ensureDramaAccess(db, req.user, body.drama_id, reqId, '剪辑')) return response.forbidden(res, '无权剪辑该项目');
    try {
      const result = await editService.autoEdit(db, log, {
        drama_id: body.drama_id,
        episode_id: body.episode_id,
        user_id: req.user?.id,
        title: body.title,
        resolution: body.resolution,
        fps: body.fps,
        transition_default: body.transition_default,
        beat_sync: body.beat_sync,
        // S20-T03 剪辑效果参数透传（字幕/水印/调色/音效匹配）
        subtitle_enabled: body.subtitle_enabled,
        subtitle_text: body.subtitle_text,
        subtitle_style: body.subtitle_style,
        watermark_text: body.watermark_text,
        watermark_position: body.watermark_position,
        color_grade: body.color_grade,
        brightness: body.brightness,
        contrast: body.contrast,
        saturation: body.saturation,
        sfx_matches: body.sfx_matches,
      });
      console.log(`[${reqId}] [DONE] 剪辑任务完成 task_id=${result.task_id} status=${result.status}，耗时 ${Date.now() - t0}ms`);
      response.created(res, result);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 剪辑失败:`, err.message);
      log.error('Auto edit failed', { error: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join(' | ') });
      response.internalError(res, err.message || '智能剪辑失败');
    }
  });

  router.get('/tasks', (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] GET /ai/edit/tasks`, { drama_id: req.query.drama_id, status: req.query.status, limit: req.query.limit });
    try {
      const list = editService.listTasks(db, { drama_id: req.query.drama_id, status: req.query.status, limit: req.query.limit || 50 });
      console.log(`[${reqId}] [DONE] 返回 ${list.length} 条任务，耗时 ${Date.now() - t0}ms`);
      response.success(res, list);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 查询任务失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  router.get('/tasks/:id', (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] GET /ai/edit/tasks/:id`, { id: req.params.id });
    const task = editService.getTask(db, req.params.id);
    if (!task) return response.notFound(res, '剪辑任务不存在');
    response.success(res, task);
  });

  router.get('/transitions', (req, res) => {
    const list = transitionEffects.listTransitions();
    response.success(res, list);
  });

  router.post('/align', requireAuth, async (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    const body = req.body || {};
    console.log(`[${reqId}] [ENTER] POST /ai/edit/align 批量配音对齐`, {
      drama_id: body.drama_id,
      episode_id: body.episode_id,
      strategy: body.strategy,
      user: maskUser(req.user),
    });
    if (!body.drama_id) return response.badRequest(res, 'drama_id 必填');
    if (!ensureDramaAccess(db, req.user, body.drama_id, reqId, '配音对齐')) return response.forbidden(res, '无权操作该项目');
    try {
      const result = await audioAlignService.batchAlign(db, log, {
        drama_id: body.drama_id,
        episode_id: body.episode_id,
        strategy: body.strategy || 'stretch',
      });
      console.log(`[${reqId}] [DONE] 配音对齐完成 ${result.aligned_count}/${result.total}，耗时 ${Date.now() - t0}ms`);
      response.success(res, result);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 配音对齐失败:`, err.message);
      log.error('Audio align failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/align-logs', (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] GET /ai/edit/align-logs`, { drama_id: req.query.drama_id, episode_id: req.query.episode_id });
    try {
      const logs = audioAlignService.getAlignLogs(db, { drama_id: req.query.drama_id, episode_id: req.query.episode_id });
      console.log(`[${reqId}] [DONE] 返回 ${logs.length} 条对齐记录，耗时 ${Date.now() - t0}ms`);
      response.success(res, logs);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 查询对齐记录失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = editRoutes;
