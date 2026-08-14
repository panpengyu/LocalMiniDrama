/**
 * S15-T03 开放 API 接口（Open Platform REST API）
 * ------------------------------------------------------------------
 * 面向第三方开发者，复用内部业务服务（dramaService / screenwriterService /
 * imageService / assetService），统一走 API 网关（createApiGateway）做
 * 密钥认证 + 权限范围(scope)校验，数据归属按 API Key 所属用户隔离。
 *
 * 挂载路径：/api/v1/open/*
 * 认证方式：X-API-Key: <api_key>  或  Authorization: Bearer <api_key>
 *
 * 接口清单（scope 校验）：
 *   项目管理   GET  /open/dramas          (drama:read)   项目列表
 *              GET  /open/dramas/:id      (drama:read)   项目详情
 *              POST /open/dramas          (drama:write)  创建项目
 *   剧本生成   POST /open/screenplay/outlines   (screenplay:generate) 生成大纲
 *              POST /open/screenplay/characters (screenplay:generate) 生成角色
 *   图片生成   POST /open/images          (image:generate) 生成图片(异步)
 *              GET  /open/images/:id      (image:generate) 查询生成结果
 *   素材查询   GET  /open/assets          (asset:read)   素材列表
 *
 * 响应统一：{ success, data } / { success, error: { code, message } }
 */
const express = require('express');
const createApiGateway = require('../middleware/apiGateway');
const dramaService = require('../services/dramaService');
const screenwriterService = require('../services/screenwriterService');
const imageService = require('../services/imageService');
const assetService = require('../services/assetService');
const taskService = require('../services/taskService');
const response = require('../response');

module.exports = function openApiRouter(db, cfg, log) {
  const router = express.Router();
  const gw = createApiGateway(db, log);
  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /** 根据 API Key 所属用户，构造内部服务所需的 user 上下文（含角色/企业/团队归属） */
  function buildUserContext(req) {
    const userId = req.apiAuth ? req.apiAuth.userId : null;
    if (!userId) return null;
    const row = db.prepare(
      'SELECT id, username, role, enterprise_id, team_id FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(userId);
    return row || { id: userId, role: 'user', enterprise_id: null, team_id: null };
  }

  /** 请求体 JSON 解析（兼容已解析的 req.body） */
  function body(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
  }

  /** 统一的异步处理包装：捕获异常并返回 400/500 */
  function wrap(handler, errorMessage) {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        log.errorw && log.errorw(`[open] ${errorMessage}`, { error: err.message, stack: err.stack });
        const code = err.code || 'OPEN_API_ERROR';
        const status = err.statusCode || 400;
        response.error(res, status, code, err.message || errorMessage);
      }
    };
  }

  /* =========================================================================
   * 1) 项目管理
   * ========================================================================= */
  router.get('/dramas', gw.gateway, gw.requireScope('drama:read'), wrap((req, res) => {
    const page = req.query.page || 1;
    const page_size = req.query.page_size || 20;
    const status = req.query.status || '';
    const genre = req.query.genre || '';
    const keyword = req.query.keyword || '';
    const user = buildUserContext(req);
    const { dramas, total, pageSize } = dramaService.listDramasLite(db, { page, page_size, status, genre, keyword }, user);
    response.successWithPagination(res, dramas, total, Number(page), pageSize);
  }, '查询项目列表失败'));

  router.get('/dramas/:id', gw.gateway, gw.requireScope('drama:read'), wrap((req, res) => {
    const drama = dramaService.getDrama(db, req.params.id);
    if (!drama) return response.notFound(res, '项目不存在');
    response.success(res, drama);
  }, '查询项目详情失败'));

  router.post('/dramas', gw.gateway, gw.requireScope('drama:write'), wrap((req, res) => {
    const user = buildUserContext(req);
    const b = body(req);
    if (!b.title || !String(b.title).trim()) {
      return response.badRequest(res, '项目标题(title)必填');
    }
    // 复用内部 insertDramaRow 落库（含权限归属字段），随后回读完整记录返回
    const id = dramaService.insertDramaRow(db, log, {
      title: b.title,
      description: b.description,
      genre: b.genre,
      style: b.style,
      metadata: b.metadata,
    }, user);
    const drama = dramaService.getDramaById(db, id);
    response.created(res, drama && Object.keys(drama).length ? drama : { id });
  }, '创建项目失败'));

  /* =========================================================================
   * 2) 剧本生成
   * ========================================================================= */
  router.post('/screenplay/outlines', gw.gateway, gw.requireScope('screenplay:generate'), wrap(async (req, res) => {
    const b = body(req);
    if (!b.idea || !String(b.idea).trim()) {
      return response.badRequest(res, '创意梗概(idea)必填');
    }
    const user = buildUserContext(req);
    const outline = await screenwriterService.generateOutline(db, log, {
      idea: b.idea,
      outlineId: b.outline_id || uid('outline'),
      userId: user ? user.id : null,
      enterpriseId: user ? user.enterprise_id : null,
      dramaId: b.drama_id || null,
      title: b.title,
      genre: b.genre,
      style: b.style,
      structure: b.structure,
      episodeCount: b.episode_count || b.episodeCount || 10,
      targetAudience: b.target_audience,
      model: b.model,
    });
    response.created(res, outline);
  }, '生成剧本大纲失败'));

  router.post('/screenplay/characters', gw.gateway, gw.requireScope('screenplay:generate'), wrap(async (req, res) => {
    const b = body(req);
    if (!b.outline_id && !b.outline) {
      return response.badRequest(res, 'outline_id 或 outline 必填');
    }
    const user = buildUserContext(req);
    const chars = await screenwriterService.generateCharacters(db, log, {
      outlineId: b.outline_id,
      outline: b.outline || undefined,
      userId: user ? user.id : null,
      dramaId: b.drama_id || null,
      count: b.count,
    });
    response.created(res, chars);
  }, '生成剧本角色失败'));

  /* =========================================================================
   * 3) 图片生成
   * ========================================================================= */
  router.post('/images', gw.gateway, gw.requireScope('image:generate'), wrap((req, res) => {
    const b = body(req);
    if (!b.drama_id) {
      return response.badRequest(res, 'drama_id 必填');
    }
    const result = imageService.create(db, log, {
      drama_id: b.drama_id,
      scene_id: b.scene_id,
      storyboard_id: b.storyboard_id,
      prompt: b.prompt,
      negative_prompt: b.negative_prompt,
      frame_type: b.frame_type,
      reference_images: b.reference_images,
      provider: b.provider,
      model: b.model,
      size: b.size,
    });
    response.created(res, {
      image_id: result.id,
      task_id: result.task_id,
      status: result.status,
    });
  }, '提交图片生成失败'));

  router.get('/images/:id', gw.gateway, gw.requireScope('image:generate'), wrap((req, res) => {
    const task = taskService.getTask(db, req.params.id);
    if (!task) return response.notFound(res, '任务不存在');
    response.success(res, task);
  }, '查询图片生成结果失败'));

  /* =========================================================================
   * 4) 素材查询
   * ========================================================================= */
  router.get('/assets', gw.gateway, gw.requireScope('asset:read'), wrap((req, res) => {
    const data = assetService.list(db, {
      drama_id: req.query.drama_id,
      type: req.query.type,
      page: req.query.page,
      page_size: req.query.page_size,
    });
    response.success(res, data);
  }, '查询素材失败'));

  return router;
};
