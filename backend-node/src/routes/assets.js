/**
 * 资源路由模块
 * 
 * 提供资源的完整 CRUD 操作，包括资源创建、查询、更新、删除、
 * 从图片生成记录导入、从视频生成记录导入等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 资源路由处理函数集合
 */
const response = require('../response');
const assetService = require('../services/assetService');

function routes(db, log) {
  return {
    /**
     * 获取资源列表接口（支持分页、筛选）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.query - 查询参数
     * @returns {object} 资源列表（带分页信息）
     */
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = assetService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('assets list', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 创建资源接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.body - 资源数据
     * @returns {object} 创建的资源数据
     */
    create: (req, res) => {
      try {
        const item = assetService.create(db, log, req.body || {});
        response.created(res, item);
      } catch (err) {
        log.error('assets create', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 获取单个资源详情接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 资源 ID
     * @returns {object} 资源详情数据
     */
    get: (req, res) => {
      try {
        const item = assetService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        log.error('assets get', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 更新资源信息接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 资源 ID
     * @param {object} req.body - 更新数据
     * @returns {object} 更新后的资源数据
     */
    update: (req, res) => {
      try {
        const item = assetService.update(db, log, req.params.id, req.body || {});
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        log.error('assets update', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 删除资源接口（软删除）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 资源 ID
     * @returns {object} 操作结果
     */
    delete: (req, res) => {
      try {
        const ok = assetService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '资源不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('assets delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 从图片生成记录导入资源接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.image_gen_id - 图片生成记录 ID
     * @returns {object} 创建的资源数据
     */
    importImage: (req, res) => {
      try {
        const item = assetService.importFromImage(db, log, req.params.image_gen_id);
        if (!item) return response.notFound(res, '图片生成记录不存在');
        response.created(res, item);
      } catch (err) {
        log.error('assets import image', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 从视频生成记录导入资源接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.video_gen_id - 视频生成记录 ID
     * @returns {object} 创建的资源数据
     */
    importVideo: (req, res) => {
      try {
        const item = assetService.importFromVideo(db, log, req.params.video_gen_id);
        if (!item) return response.notFound(res, '视频生成记录不存在');
        response.created(res, item);
      } catch (err) {
        log.error('assets import video', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;