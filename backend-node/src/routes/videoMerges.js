/**
 * 视频合成路由模块
 * 
 * 提供视频合成（合并）操作的完整 CRUD 接口，支持创建视频合并任务、
 * 查询合并记录、删除合并记录等功能。视频合成用于将多个分镜视频合并
 * 成完整的剧集视频。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 视频合成路由处理函数集合
 */
const response = require('../response');
const videoMergeService = require('../services/videoMergeService');

function routes(db, log) {
  return {
    /**
     * 获取视频合成记录列表接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.query - 查询参数
     * @returns {object} 视频合成记录列表
     */
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const items = videoMergeService.list(db, query);
        response.success(res, items);
      } catch (err) {
        log.error('video-merges list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 创建视频合成任务接口
     * 
     * 创建视频合成记录并启动异步合并任务。
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.body - 合成参数（包含 episode_id 等）
     * @returns {object} 合成任务信息（包含 merge_id 和 task_id）
     */
    create: (req, res) => {
      try {
        const body = req.body || {};
        const rec = videoMergeService.create(db, log, body);
        response.success(res, { merge_id: rec.merge_id, task_id: rec.task_id, ...rec });
      } catch (err) {
        log.error('video-merges create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 获取单个视频合成记录详情接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.merge_id - 合成记录 ID
     * @returns {object} 合成记录详情
     */
    get: (req, res) => {
      try {
        const item = videoMergeService.getById(db, req.params.merge_id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('video-merges get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoMergeService.deleteById(db, log, req.params.merge_id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('video-merges delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
