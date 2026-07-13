/**
 * 场景路由模块
 * 
 * 提供场景的完整 CRUD 操作，包括场景创建、查询、更新、删除、
 * AI 生成提示词、从图片提取场景描述、四视图生成、素材库管理等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {object} 场景路由处理函数集合
 */
const response = require('../response');
const sceneService = require('../services/sceneService');
const sceneLibraryService = require('../services/sceneLibraryService');
const imageService = require('../services/imageService');

function routes(db, log, cfg) {
  return {
    /**
     * 获取单个场景详情接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 场景详情数据
     */
    getOne: (req, res) => {
      try {
        const scene = sceneService.getSceneById(db, Number(req.params.scene_id));
        if (!scene) return response.notFound(res, '场景不存在');
        response.success(res, { scene });
      } catch (err) {
        log.error('scenes getOne', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 生成场景提示词接口（仅生成提示词，不生成图片）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @param {string} [req.body.model] - AI 模型名称
     * @param {string} [req.body.style] - 风格参数
     * @returns {object} 生成的提示词
     */
    generatePrompt: async (req, res) => {
      try {
        const body = req.body || {};
        const out = await sceneService.generateScenePromptOnly(
          db, log, cfg, req.params.scene_id, body.model || undefined, body.style || undefined
        );
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '提示词已生成', polished_prompt: out.polished_prompt });
      } catch (err) {
        log.error('scenes generatePrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 从图片提取场景描述接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 提取的场景描述
     */
    extractFromImage: async (req, res) => {
      try {
        const out = await sceneService.extractSceneFromImage(db, log, cfg, req.params.scene_id);
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '场景描述已提取', prompt: out.prompt });
      } catch (err) {
        log.error('scenes extract-from-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 更新场景信息接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @param {object} req.body - 更新数据
     * @returns {object} 操作结果
     */
    update: (req, res) => {
      try {
        const out = sceneService.updateScene(db, log, req.params.scene_id, req.body || {});
        if (!out.ok) return response.notFound(res, '场景不存在');
        response.success(res, { message: '保存成功' });
      } catch (err) {
        log.error('scenes update', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 更新场景提示词接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @param {object} req.body - 更新数据
     * @returns {object} 操作结果
     */
    updatePrompt: (req, res) => {
      try {
        const out = sceneService.updateScenePrompt(db, log, req.params.scene_id, req.body || {});
        if (!out.ok) return response.notFound(res, '场景不存在');
        response.success(res, { message: '场景提示词已更新' });
      } catch (err) {
        log.error('scenes updatePrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 删除场景接口（软删除）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 操作结果
     */
    delete: (req, res) => {
      try {
        const out = sceneService.deleteScene(db, log, req.params.scene_id);
        if (!out.ok) return response.notFound(res, '场景不存在');
        response.success(res, { message: '场景已删除' });
      } catch (err) {
        log.error('scenes delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 创建场景接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.body.drama_id - 剧本 ID
     * @param {object} req.body - 场景数据
     * @returns {object} 创建的场景数据
     */
    create: (req, res) => {
      try {
        const body = req.body || {};
        const dramaId = body.drama_id;
        if (dramaId == null) return response.badRequest(res, '缺少 drama_id');
        const scene = sceneService.createScene(db, log, dramaId, body);
        response.created(res, scene);
      } catch (err) {
        log.error('scenes create', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 生成场景图片接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.body.scene_id - 场景 ID
     * @param {string} [req.body.model] - AI 模型名称
     * @param {string} [req.body.style] - 风格参数
     * @returns {object} 生成任务信息
     */
    generateImage: async (req, res) => {
      try {
        const body = req.body || {};
        const sceneId = body.scene_id != null ? Number(body.scene_id) : null;
        if (sceneId == null) return response.badRequest(res, '缺少 scene_id');
        const out = await sceneService.generateSceneFourViewImage(
          db, log, cfg, sceneId, body.model || undefined, body.style || undefined
        );
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          if (out.error === 'unauthorized') return response.notFound(res, '剧集不存在或无权限');
          return response.badRequest(res, out.error);
        }
        response.success(res, {
          message: '场景四视图生成任务已提交',
          image_generation: out.image_generation,
        });
      } catch (err) {
        log.error('scenes generateImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 将场景添加到本剧场景库接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 操作结果（包含库项信息）
     */
    addToLibrary: (req, res) => {
      try {
        const out = sceneLibraryService.addSceneToLibrary(db, log, req.params.scene_id);
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          if (out.error === 'unauthorized') return response.forbidden(res, '无权限');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '已加入本剧场景库', item: out.item });
      } catch (err) {
        log.error('scenes add-to-library', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 将场景添加到全局素材库接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 操作结果（包含库项信息）
     */
    addToMaterialLibrary: (req, res) => {
      try {
        const out = sceneLibraryService.addSceneToMaterialLibrary(db, log, req.params.scene_id);
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '已加入全局素材库', item: out.item });
      } catch (err) {
        log.error('scenes add-to-material-library', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 生成场景四视图图片接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @param {string} [req.body.model_name] - AI 模型名称
     * @param {string} [req.body.style] - 风格参数
     * @returns {object} 生成任务信息
     */
    generateFourViewImage: async (req, res) => {
      try {
        const body = req.body || {};
        const modelName = body.model_name || body.model || undefined;
        const style = body.style || undefined;
        const out = await sceneService.generateSceneFourViewImage(db, log, cfg, req.params.scene_id, modelName, style);
        if (!out.ok) {
          if (out.error === 'scene not found') return response.notFound(res, '场景不存在');
          if (out.error === 'unauthorized') return response.notFound(res, '剧集不存在或无权限');
          return response.badRequest(res, out.error);
        }
        response.success(res, { message: '场景四视图生成任务已提交', image_generation: out.image_generation });
      } catch (err) {
        log.error('scenes generate-four-view-image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;