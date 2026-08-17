/**
 * S20-T01 分支叙事 REST 路由
 *
 * 端点：
 *   GET    /dramas/:id/branches                    分支列表（含主线）
 *   POST   /dramas/:id/branches                    创建分支 {source_episode_id, name}
 *   PUT    /dramas/:id/branches/:branchId          重命名分支 {name}
 *   DELETE /dramas/:id/branches/:branchId          删除分支（其下集与分镜一并删除）
 *   PUT    /dramas/:id/episodes/:episodeId/branch  移动集到分支 {branch_id}
 *   PUT    /dramas/:id/storyboards/:sceneId/branch-condition  设置条件连线 {condition, target_scene_id}
 *   GET    /dramas/:id/export-script               按分支导出剧本 ?branch_id=（缺省为主线）
 */

'use strict';

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const branchService = require('../services/branchService');

function branchRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  function fail(res, err) {
    if (['EPISODE_NOT_FOUND', 'BRANCH_NOT_FOUND', 'SCENE_NOT_FOUND'].includes(err.code)) return response.notFound(res, err.message);
    if (['EMPTY_NAME', 'MAIN_BRANCH_IMMUTABLE'].includes(err.code)) return response.badRequest(res, err.message);
    log.error('[S20-T01] 分支接口异常', { code: err.code, error: err.message });
    return response.internalError(res, err.message);
  }

  // 分支列表
  router.get('/dramas/:id/branches', requireAuth, (req, res) => {
    try {
      response.success(res, { items: branchService.listBranches(db, Number(req.params.id)) });
    } catch (err) { fail(res, err); }
  });

  // 创建分支
  router.post('/dramas/:id/branches', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const branch = branchService.createBranch(db, log, {
        dramaId: Number(req.params.id),
        sourceEpisodeId: Number(b.source_episode_id),
        name: b.name,
      });
      response.created(res, branch);
    } catch (err) { fail(res, err); }
  });

  // 重命名分支
  router.put('/dramas/:id/branches/:branchId', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const branch = branchService.renameBranch(db, log, {
        dramaId: Number(req.params.id),
        branchId: req.params.branchId,
        name: b.name,
      });
      response.success(res, branch);
    } catch (err) { fail(res, err); }
  });

  // 删除分支
  router.delete('/dramas/:id/branches/:branchId', requireAuth, (req, res) => {
    try {
      const result = branchService.deleteBranch(db, log, {
        dramaId: Number(req.params.id),
        branchId: req.params.branchId,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 移动集到分支
  router.put('/dramas/:id/episodes/:episodeId/branch', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const result = branchService.moveEpisode(db, log, {
        episodeId: Number(req.params.episodeId),
        branchId: b.branch_id || null,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 条件连线
  router.put('/dramas/:id/storyboards/:sceneId/branch-condition', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const result = branchService.setStoryboardCondition(db, log, {
        sceneId: Number(req.params.sceneId),
        condition: b.condition,
        targetSceneId: b.target_scene_id,
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 按分支导出剧本（纯文本，可下载）
  router.get('/dramas/:id/export-script', requireAuth, (req, res) => {
    try {
      const result = branchService.exportByBranch(db, log, {
        dramaId: Number(req.params.id),
        branchId: req.query.branch_id || null,
      });
      if (req.query.download === '1') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="script_${req.params.id}.txt"`);
        return res.send(result.text);
      }
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = branchRoutes;
