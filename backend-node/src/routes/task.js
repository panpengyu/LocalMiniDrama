/**
 * 任务路由模块
 * 
 * 提供任务状态查询、资源关联任务查询和任务取消等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 任务路由处理函数集合
 */
const taskService = require('../services/taskService');
const response = require('../response');

/**
 * 获取任务状态接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function getTaskStatus(db, log) {
  return (req, res) => {
    const task = taskService.getTask(db, req.params.task_id);
    if (!task) return response.notFound(res, '任务不存在');
    response.success(res, task);
  };
}

/**
 * 获取资源关联的任务列表接口
 * 
 * 通过 resource_id 查询该资源相关的所有任务。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function getResourceTasks(db, log) {
  return (req, res) => {
    const resourceId = req.query.resource_id;
    if (!resourceId) return response.badRequest(res, '缺少resource_id参数');
    try {
      const tasks = taskService.getTasksByResource(db, resourceId);
      response.success(res, tasks);
    } catch (err) {
      log.errorw('Get resource tasks failed', { error: err.message });
      response.internalError(res, err.message);
    }
  };
}

/**
 * 取消任务接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function cancelTaskStatus(db, log) {
  return (req, res) => {
    try {
      const result = taskService.cancelTask(db, log, req.params.task_id, req.body?.reason);
      if (!result.ok && result.reason === 'not_found') {
        return response.notFound(res, '任务不存在');
      }
      response.success(res, result.task || { id: req.params.task_id });
    } catch (err) {
      log.errorw('Cancel task failed', { error: err.message, task_id: req.params.task_id });
      response.internalError(res, err.message);
    }
  };
}

module.exports = function taskRoutes(db, log) {
  return {
    getTaskStatus: getTaskStatus(db, log),
    getResourceTasks: getResourceTasks(db, log),
    cancelTaskStatus: cancelTaskStatus(db, log),
  };
};