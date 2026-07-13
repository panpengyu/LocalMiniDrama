/**
 * 剧本路由模块
 * 
 * 提供剧本的完整 CRUD 操作，包括创建、查询、更新、删除、导出导入、分镜生成等功能。
 * 同时支持角色管理、章节管理、进度保存、画布布局保存等子功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {object} 剧本路由处理函数集合
 */
const dramaService = require('../services/dramaService');
const propService = require('../services/propService');
const response = require('../response');
const dramaExportService = require('../services/dramaExportService');
const dramaImportService = require('../services/dramaImportService');

/**
 * 创建剧本接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function createDrama(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.title || String(body.title).trim() === '') {
      return response.badRequest(res, '标题不能为空');
    }
    try {
      const drama = dramaService.createDrama(db, log, body, req.user);
      response.created(res, drama);
    } catch (err) {
      log.error('Create drama failed', { error: err.message, stack: err.stack });
      response.internalError(res, err.message || '创建失败');
    }
  };
}

/**
 * 获取单个剧本详情接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function getDrama(db, cfg) {
  return (req, res) => {
    const drama = dramaService.getDrama(db, req.params.id, cfg?.storage?.base_url);
    if (!drama) return response.notFound(res, '剧本不存在');
    response.success(res, drama);
  };
}

/**
 * 获取剧本列表接口（支持分页、筛选、搜索）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function listDramas(db, log) {
  return (req, res) => {
    const page = req.query.page || 1;
    const page_size = req.query.page_size || 20;
    const status = req.query.status || '';
    const genre = req.query.genre || '';
    const keyword = req.query.keyword || '';
    try {
      const { dramas, total, page: p, pageSize: ps } = dramaService.listDramas(db, {
        page,
        page_size,
        status,
        genre,
        keyword,
      }, req.user);
      response.successWithPagination(res, dramas, total, p, ps);
    } catch (err) {
      log.errorw('List dramas failed', { error: err.message });
      response.internalError(res, '获取列表失败');
    }
  };
}

/**
 * 更新剧本信息接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function updateDrama(db, log) {
  return (req, res) => {
    const drama = dramaService.updateDrama(db, log, req.params.id, req.body || {});
    if (!drama) return response.notFound(res, '剧本不存在');
    response.success(res, drama);
  };
}

/**
 * 删除剧本接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function deleteDrama(db, log) {
  return (req, res) => {
    const ok = dramaService.deleteDrama(db, log, req.params.id);
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '删除成功' });
  };
}

/**
 * 获取剧本统计数据接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function getDramaStats(db, log) {
  return (req, res) => {
    try {
      const stats = dramaService.getDramaStats(db);
      response.success(res, stats);
    } catch (err) {
      log.errorw('Get drama stats failed', { error: err.message });
      response.internalError(res, '获取统计失败');
    }
  };
}

/**
 * 保存剧本大纲接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function saveOutline(db, log) {
  return (req, res) => {
    const ok = dramaService.saveOutline(db, log, req.params.id, req.body || {});
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

/**
 * 获取剧本角色列表接口
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function getCharacters(db) {
  return (req, res) => {
    const characters = dramaService.getCharacters(db, req.params.id, req.query.episode_id);
    if (characters === null) return response.notFound(res, '剧本或章节不存在');
    response.success(res, characters);
  };
}

/**
 * 保存剧本角色列表接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function saveCharacters(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.characters)) return response.badRequest(res, 'characters 必填且为数组');
    const ok = dramaService.saveCharacters(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本或章节不存在');
    response.success(res, { message: '保存成功' });
  };
}

/**
 * 保存剧本章节列表接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function saveEpisodes(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.episodes)) return response.badRequest(res, 'episodes 必填且为数组');
    const ok = dramaService.saveEpisodes(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

/**
 * 保存剧本创作进度接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function saveProgress(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.current_step) return response.badRequest(res, 'current_step 必填');
    const ok = dramaService.saveProgress(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

/**
 * 保存画布布局接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function saveCanvasLayout(db, log) {
  return (req, res) => {
    try {
      const updated = dramaService.saveCanvasLayout(db, log, req.params.id, req.body || {});
      if (!updated) return response.notFound(res, '剧本不存在');
      response.success(res, updated);
    } catch (err) {
      if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
      log.error('Save canvas layout failed', { error: err.message });
      response.internalError(res, err.message || '保存画布布局失败');
    }
  };
}

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
 * 完成剧集接口（合成视频）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function finalizeEpisode(db, log, cfg) {
  return (req, res) => {
    const episodeId = req.params.episode_id;
    if (!episodeId) return response.badRequest(res, 'episode_id不能为空');
    const baseUrl = cfg?.storage?.base_url || '';
    const result = dramaService.finalizeEpisode(db, log, episodeId, baseUrl, req.body || {});
    if (!result) return response.notFound(res, '剧集不存在');
    response.success(res, result);
  };
}

/**
 * 下载剧集视频接口
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function downloadEpisodeVideo(db) {
  return (req, res) => {
    const episodeId = req.params.episode_id;
    if (!episodeId) return response.badRequest(res, 'episode_id不能为空');
    const result = dramaService.downloadEpisodeVideo(db, episodeId);
    if (!result) return response.notFound(res, '剧集不存在');
    if (result.error) return response.badRequest(res, result.error);
    response.success(res, result);
  };
}

/**
 * 导出剧本接口（ZIP 格式）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function exportDrama(db, cfg, log) {
  return (req, res) => {
    try {
      const { buffer, title } = dramaExportService.exportDrama(db, cfg, log, req.params.id);
      const safeName = (title || 'drama').replace(/[^\w\u4e00-\u9fff\-]/g, '_').slice(0, 50);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.zip`);
      res.send(buffer);
    } catch (err) {
      log.error('Export drama failed', { error: err.message });
      response.internalError(res, err.message || '导出失败');
    }
  };
}

/**
 * 导入剧本接口（ZIP 格式）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function importDrama(db, cfg, log) {
  return (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请上传 ZIP 文件');
      }
      const result = dramaImportService.importDrama(db, cfg, log, req.file.buffer, req.user);
      response.created(res, result);
    } catch (err) {
      log.error('Import drama failed', { error: err.message });
      if (err.message && (err.message.includes('格式') || err.message.includes('缺少') || err.message.includes('损坏'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '导入失败');
    }
  };
}

/**
 * 获取示例剧本目录路径
 * 
 * 优先使用环境变量 EXAMPLE_DRAMA_PATH，其次使用项目根目录下的 example_drama 目录
 * 
 * @returns {string|null} 示例目录路径或 null
 */
function getExampleDramaDir() {
  const path = require('path');
  const fs = require('fs');
  if (process.env.EXAMPLE_DRAMA_PATH && fs.existsSync(process.env.EXAMPLE_DRAMA_PATH)) {
    return process.env.EXAMPLE_DRAMA_PATH;
  }
  const devPath = path.join(__dirname, '..', '..', '..', 'example_drama');
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

/**
 * 获取示例剧本列表接口
 * 
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function listExamples(log) {
  return (_req, res) => {
    const fs = require('fs');
    const dir = getExampleDramaDir();
    if (!dir) return response.success(res, []);
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.zip'));
      const items = files.map(f => {
        const name = f.replace(/\.zip$/, '');
        return { filename: f, name };
      });
      response.success(res, items);
    } catch (err) {
      log.error('List examples failed', { error: err.message });
      response.success(res, []);
    }
  };
}

/**
 * 导入示例剧本接口
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function importExample(db, cfg, log) {
  return (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const filename = req.body?.filename;
    if (!filename) return response.badRequest(res, '请指定示例文件名');
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return response.badRequest(res, '文件名不合法');
    }
    const dir = getExampleDramaDir();
    if (!dir) return response.badRequest(res, '示例目录不存在');
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return response.notFound(res, '示例文件不存在');
    try {
      const buffer = fs.readFileSync(filePath);
      const result = dramaImportService.importDrama(db, cfg, log, buffer, req.user);
      response.created(res, result);
    } catch (err) {
      log.error('Import example failed', { error: err.message });
      response.internalError(res, err.message || '导入示例失败');
    }
  };
}

/**
 * 生成分镜接口（AI 生成）
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function generateStoryboard(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    try {
      const model = (body.model && String(body.model).trim()) ? body.model : undefined;
      log.info('Generate storyboard request', { episode_id: req.params.episode_id, storyboard_count: body.storyboard_count, video_duration: body.video_duration });
      const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
      const resData = await dramaService.generateStoryboard(db, log, req.params.episode_id, {
        model: model,
        style: body.style,
        storyboard_count: body.storyboard_count,
        video_duration: body.video_duration,
        aspect_ratio: body.aspect_ratio,
        include_narration: body.include_narration,
        universal_omni_storyboard: body.universal_omni_storyboard,
      }, userCfg);
      response.success(res, resData);
    } catch (err) {
      log.error('Generate storyboard failed', { error: err.message });
      response.internalError(res, err.message || '生成分镜失败');
    }
  };
}

module.exports = function dramaRoutes(db, cfg, log) {
  return {
    createDrama: createDrama(db, log),
    getDrama: getDrama(db, cfg),
    listDramas: listDramas(db, log),
    updateDrama: updateDrama(db, log),
    deleteDrama: deleteDrama(db, log),
    getDramaStats: getDramaStats(db, log),
    saveOutline: saveOutline(db, log),
    getCharacters: getCharacters(db),
    saveCharacters: saveCharacters(db, log),
    saveEpisodes: saveEpisodes(db, log),
    saveProgress: saveProgress(db, log),
    saveCanvasLayout: saveCanvasLayout(db, log),
    listProps: listProps(db),
    finalizeEpisode: finalizeEpisode(db, log, cfg),
    downloadEpisodeVideo: downloadEpisodeVideo(db),
    generateStoryboard: generateStoryboard(db, log),
    exportDrama: exportDrama(db, cfg, log),
    importDrama: importDrama(db, cfg, log),
    listExamples: listExamples(log),
    importExample: importExample(db, cfg, log),
  };
};