/**
 * 图片路由模块
 * 
 * 提供图片生成记录的完整 CRUD 操作，包括图片列表、创建、查询、删除、
 * 场景图片生成、章节背景获取、章节背景提取、章节批量图片等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {object} 图片路由处理函数集合
 */
const response = require('../response');
const imageService = require('../services/imageService');
const taskService = require('../services/taskService');
const backgroundExtractionService = require('../services/backgroundExtractionService');

function routes(db, cfg, log) {
  return {
    /**
     * 获取图片生成记录列表接口（支持分页、筛选）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.query - 查询参数
     * @returns {object} 图片列表（带分页信息）
     */
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = imageService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('images list', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 创建图片生成任务接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.body - 图片生成参数
     * @returns {object} 创建的图片生成记录
     */
    create: (req, res) => {
      try {
        const body = req.body || {};
        const rec = imageService.create(db, log, body);
        response.created(res, rec);
      } catch (err) {
        log.error('images create', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 获取单个图片生成记录详情接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 图片记录 ID
     * @returns {object} 图片生成记录详情
     */
    get: (req, res) => {
      try {
        const item = imageService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('images get', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 删除图片生成记录接口（软删除）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 图片记录 ID
     * @returns {object} 操作结果
     */
    delete: (req, res) => {
      try {
        const ok = imageService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('images delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 生成场景图片接口（桩实现）
     * 
     * 创建场景图片生成任务。
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.scene_id - 场景 ID
     * @returns {object} 任务信息
     */
    scene: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'image_generation', req.params.scene_id);
        setTimeout(() => taskService.updateTaskResult(db, task.id, []), 100);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('images scene', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 获取章节背景图片列表接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.episode_id - 章节 ID
     * @returns {object} 背景图片列表
     */
    episodeBackgrounds: (req, res) => {
      try {
        const list = imageService.getBackgroundsForEpisode(db, req.params.episode_id);
        response.success(res, list);
      } catch (err) {
        log.error('images episode backgrounds', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 提取章节背景图片接口（AI 提取）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.episode_id - 章节 ID
     * @param {string} [req.body.model] - AI 模型名称
     * @param {string} [req.body.style] - 风格参数
     * @param {string} [req.body.language] - 语言参数
     * @returns {object} 任务信息
     */
    episodeBackgroundsExtract: (req, res) => {
      try {
        const body = req.body || {};
        const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
        const taskId = backgroundExtractionService.extractBackgroundsForEpisode(
          db,
          userCfg,
          log,
          req.params.episode_id,
          body.model,
          body.style,
          body.language
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '场景提取任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('images episode backgrounds extract', { error: err.message });
        if (err.message && (err.message.includes('script content') || err.message.includes('not found'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message || '任务创建失败');
      }
    },

    /**
     * 章节批量图片接口（桩实现）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @returns {object} 空数组
     */
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('images episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 上传图片接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.body - 图片数据
     * @returns {object} 创建的图片记录
     */
    upload: (req, res) => {
      try {
        const body = req.body || {};
        const item = imageService.upload(db, log, body);
        response.created(res, item);
      } catch (err) {
        log.error('images upload', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;