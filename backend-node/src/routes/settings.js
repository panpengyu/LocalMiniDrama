/**
 * 设置路由模块
 * 
 * 提供系统设置相关的 API 接口，包括语言设置、生成相关设置（并发数、视频超时时间等）。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {object} 设置路由处理函数集合
 */
const settingsService = require('../services/settingsService');
const response = require('../response');
const { loadConfig } = require('../config');
const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');

/**
 * 获取系统语言设置接口
 * 
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function getLanguage(cfg) {
  return (req, res) => {
    const language = settingsService.getLanguage(cfg);
    response.success(res, { language });
  };
}

/**
 * 更新系统语言设置接口
 * 
 * 仅支持 zh（中文）和 en（英文）两种语言。
 * 
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function updateLanguage(cfg, log) {
  return (req, res) => {
    const lang = req.body?.language;
    if (lang !== 'zh' && lang !== 'en') {
      return response.badRequest(res, '语言参数错误，只支持 zh 或 en');
    }
    const out = settingsService.updateLanguage(cfg, log, lang);
    if (!out.ok) return response.badRequest(res, out.error);
    const message = lang === 'en' ? 'Language switched to English' : '语言已切换为中文';
    response.success(res, { message, language: lang });
  };
}

/**
 * 获取生成相关设置接口
 * 
 * 返回图片并发数、视频并发数和视频生成超时时间。
 * 超级管理员获取全局设置，普通用户获取个人设置。
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function getGenerationSettings(db) {
  return (req, res) => {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'super_admin';
    const concurrency = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_concurrency', 3);
    const video_concurrency = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_video_concurrency', 3);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, { concurrency, video_concurrency, video_generation_timeout_minutes });
  };
}

/**
 * 更新生成相关设置接口
 * 
 * 更新图片并发数和视频并发数（1-20之间的整数）。
 * 超级管理员更新全局设置，普通用户更新个人设置。
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function updateGenerationSettings(db) {
  return (req, res) => {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'super_admin';
    const { concurrency, video_concurrency } = req.body || {};
    if (concurrency !== undefined) {
      const n = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '图片并发数需为 1-20 之间的整数');
      }
      if (isAdmin) {
        settingsService.setGlobalSetting(db, 'pipeline_concurrency', n);
      } else {
        settingsService.setUserSetting(db, userId, 'pipeline_concurrency', n);
      }
    }
    if (video_concurrency !== undefined) {
      const n = Number(video_concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '视频并发数需为 1-20 之间的整数');
      }
      if (isAdmin) {
        settingsService.setGlobalSetting(db, 'pipeline_video_concurrency', n);
      } else {
        settingsService.setUserSetting(db, userId, 'pipeline_video_concurrency', n);
      }
    }
    const saved = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_concurrency', 3);
    const saved_video = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_video_concurrency', 3);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, {
      concurrency: saved,
      video_concurrency: saved_video,
      video_generation_timeout_minutes,
    });
  };
}

module.exports = function settingsRoutes(db, cfg, log) {
  return {
    getLanguage: getLanguage(cfg),
    updateLanguage: updateLanguage(cfg, log),
    getGenerationSettings: getGenerationSettings(db),
    updateGenerationSettings: updateGenerationSettings(db),
  };
};