/**
 * 道具路由模块
 * 
 * 提供道具的完整 CRUD 操作，包括道具创建、查询、更新、删除、图片生成、
 * AI 提示词生成、从图片提取道具描述、道具提取、道具关联、素材库管理等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {object} 道具路由处理函数集合
 */
const propService = require('../services/propService');
const propLibraryService = require('../services/propLibraryService');
const response = require('../response');

/**
 * 获取剧本道具列表接口
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function listProps(db) {
  return (req, res) => {
    const props = propService.listByDramaId(db, req.params.id);
    response.success(res, props);
  };
}

/**
 * 创建道具接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function createProp(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.drama_id || !body.name) return response.badRequest(res, 'drama_id 和 name 必填');
    try {
      const prop = propService.create(db, log, body);
      response.created(res, prop);
    } catch (err) {
      log.errorw('Create prop failed', { error: err.message });
      response.internalError(res, '创建失败');
    }
  };
}

/**
 * 更新道具信息接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function updateProp(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const prop = propService.update(db, log, id, req.body || {});
    if (!prop) return response.notFound(res, '道具不存在');
    response.success(res, prop);
  };
}

/**
 * 删除道具接口（软删除）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function deleteProp(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const ok = propService.deleteById(db, log, id);
    if (!ok) return response.notFound(res, '道具不存在');
    response.success(res, { message: '删除成功' });
  };
}

/**
 * 生成道具图片接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function generateImage(db, log) {
  const propImageGenerationService = require('../services/propImageGenerationService');
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const model = req.body?.model != null ? String(req.body.model).trim() || null : null;
    const style = req.body?.style != null ? String(req.body.style).trim() || null : null;
    try {
      const taskId = propImageGenerationService.generatePropImage(db, log, id, { model, style });
      response.success(res, { task_id: taskId });
    } catch (err) {
      if (err.message === '道具不存在') return response.notFound(res, err.message);
      if (err.message === '道具没有图片提示词') return response.badRequest(res, err.message);
      log.error('generatePropImage failed', { error: err.message });
      response.internalError(res, err.message || '生成失败');
    }
  };
}

/**
 * 从剧本提取道具接口（AI 提取）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function extractProps(db, log, cfg) {
  const propExtractionService = require('../services/propExtractionService');
  return (req, res) => {
    const episodeId = req.params.episode_id;
    if (!episodeId) return response.badRequest(res, '缺少 episode_id');
    try {
      const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
      const taskId = propExtractionService.extractPropsForEpisode(db, log, episodeId, userCfg);
      response.success(res, { task_id: taskId });
    } catch (err) {
      if (err.message === 'episode not found' || err.message?.includes('剧本内容为空')) {
        return response.badRequest(res, err.message);
      }
      log.error('extractProps failed', { error: err.message });
      response.internalError(res, err.message || '提取失败');
    }
  };
}

/**
 * 关联道具到分镜接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function associateProps(db, log) {
  return (req, res) => {
    const storyboardId = parseInt(req.params.id, 10);
    const propIds = Array.isArray(req.body?.prop_ids) ? req.body.prop_ids : [];
    propService.associateWithStoryboard(db, log, storyboardId, propIds);
    response.success(res, { message: '关联成功' });
  };
}

/**
 * 将道具添加到本剧道具库接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function addToLibrary(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const out = propLibraryService.addPropToLibrary(db, log, id);
    if (!out.ok) {
      if (out.error === 'prop not found') return response.notFound(res, '道具不存在');
      if (out.error === 'unauthorized') return response.forbidden(res, '无权限');
      return response.badRequest(res, out.error);
    }
    response.success(res, { message: '已加入本剧道具库', item: out.item });
  };
}

/**
 * 将道具添加到全局素材库接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function addToMaterialLibrary(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const out = propLibraryService.addPropToMaterialLibrary(db, log, id);
    if (!out.ok) {
      if (out.error === 'prop not found') return response.notFound(res, '道具不存在');
      return response.badRequest(res, out.error);
    }
    response.success(res, { message: '已加入全局素材库', item: out.item });
  };
}

/**
 * 获取单个道具详情接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function getPropById(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    const prop = propService.getById(db, id);
    if (!prop) return response.notFound(res, '道具不存在');
    response.success(res, { prop });
  };
}

/**
 * 生成道具提示词接口（仅生成提示词，不生成图片）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function generatePropPrompt(db, log, cfg) {
  return async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    try {
      const body = req.body || {};
      const out = await propService.generatePropPromptOnly(db, log, cfg, id, body.model || undefined, body.style || undefined);
      if (!out.ok) {
        if (out.error === 'prop not found') return response.notFound(res, '道具不存在');
        return response.badRequest(res, out.error);
      }
      response.success(res, { message: '提示词已生成', prompt: out.prompt });
    } catch (err) {
      log.error('generatePropPrompt failed', { error: err.message });
      response.internalError(res, err.message);
    }
  };
}

/**
 * 从图片提取道具描述接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function extractPropFromImage(db, log, cfg) {
  return async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的ID');
    try {
      const out = await propService.extractPropFromImage(db, log, cfg, id);
      if (!out.ok) {
        if (out.error === 'prop not found') return response.notFound(res, '道具不存在');
        return response.badRequest(res, out.error);
      }
      response.success(res, { message: '道具描述已提取', description: out.description });
    } catch (err) {
      log.error('extractPropFromImage failed', { error: err.message });
      response.internalError(res, err.message);
    }
  };
}

module.exports = function propRoutes(db, log, cfg) {
  return {
    listProps: listProps(db),
    createProp: createProp(db, log),
    updateProp: updateProp(db, log),
    deleteProp: deleteProp(db, log),
    getPropById: getPropById(db, log),
    generateImage: generateImage(db, log),
    generatePropPrompt: generatePropPrompt(db, log, cfg),
    extractProps: extractProps(db, log, cfg),
    associateProps: associateProps(db, log),
    addToLibrary: addToLibrary(db, log),
    addToMaterialLibrary: addToMaterialLibrary(db, log),
    extractPropFromImage: extractPropFromImage(db, log, cfg),
  };
};