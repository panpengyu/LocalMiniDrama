/**
 * 桩路由模块
 * 
 * 与 Go 后端路由一一对应的桩实现，保证前端可一键切换前后端；
 * 后续可逐步替换为真实逻辑。部分接口已实现真实逻辑（如分镜生成）。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {object} 桩路由处理函数集合
 */
const response = require('../response');
const taskService = require('../services/taskService');
const episodeStoryboardService = require('../services/episodeStoryboardService');

/**
 * 返回成功响应的辅助函数
 * 
 * @param {object} res - Express 响应对象
 * @param {object} data - 返回数据
 */
function stubSuccess(res, data = {}) {
  response.success(res, data);
}

/**
 * 返回创建成功响应的辅助函数
 * 
 * @param {object} res - Express 响应对象
 * @param {object} data - 返回数据
 */
function stubCreated(res, data = {}) {
  response.created(res, data);
}

module.exports = function stubRoutes(db, cfg, log) {
  return {
    /**
     * 生成角色接口（桩实现）
     * 
     * 创建角色生成任务，立即返回任务 ID。
     */
    generationCharacters: (req, res) => {
      const body = req.body || {};
      const task = taskService.createTask(db, log, 'character_generation', body.drama_id || '');
      setTimeout(() => taskService.updateTaskResult(db, task.id, { characters: [], count: 0 }), 100);
      response.success(res, { task_id: task.id, status: 'pending' });
    },

    // ========== 角色库接口（桩实现）==========
    characterLibraryList: (req, res) => stubSuccess(res, []),
    characterLibraryCreate: (req, res) => stubCreated(res, { id: 0, name: '', image_url: '', ...req.body }),
    characterLibraryGet: (req, res) => stubSuccess(res, { id: req.params.id, name: '', image_url: '' }),
    characterLibraryDelete: (req, res) => response.success(res, { message: '删除成功' }),

    // ========== 角色接口（桩实现）==========
    characterUpdate: (req, res) => response.success(res, { message: '保存成功' }),
    characterDelete: (req, res) => response.success(res, { message: '删除成功' }),
    characterBatchGenerateImages: (req, res) => {
      const task = taskService.createTask(db, log, 'batch_character_image', '');
      setTimeout(() => taskService.updateTaskResult(db, task.id, {}), 100);
      response.success(res, { task_id: task.id });
    },
    characterGenerateImage: (req, res) => {
      const task = taskService.createTask(db, log, 'character_image', req.params.id);
      setTimeout(() => taskService.updateTaskResult(db, task.id, {}), 100);
      response.success(res, { task_id: task.id });
    },
    characterUploadImage: (req, res) => response.success(res, { message: '上传成功' }),
    characterPutImage: (req, res) => response.success(res, { message: '保存成功' }),
    characterImageFromLibrary: (req, res) => response.success(res, { message: '应用成功' }),
    characterAddToLibrary: (req, res) => response.success(res, { message: '已加入角色库' }),

    // ========== 上传接口（桩实现）==========
    uploadImage: (req, res) => response.success(res, { url: '', path: '' }),

    // ========== 章节接口（部分已实现真实逻辑）==========
    episodeStoryboardsGenerate: (req, res) => {
      const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
      const taskId = episodeStoryboardService.generateStoryboard(
        db,
        log,
        req.params.episode_id,
        req.query.model,
        req.query.style,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        userCfg
      );
      response.success(res, { task_id: taskId, status: 'pending', message: '分镜头生成任务已创建，正在后台处理...' });
    },
    episodeStoryboardsGet: (req, res) => {
      const list = episodeStoryboardService.getStoryboardsForEpisode(db, req.params.episode_id);
      response.success(res, list);
    },
    episodeCharactersExtract: (req, res) => {
      const task = taskService.createTask(db, log, 'character_extraction', req.params.episode_id);
      setTimeout(() => taskService.updateTaskResult(db, task.id, { characters: [], count: 0 }), 100);
      response.success(res, { task_id: task.id });
    },

    // ========== 场景接口（桩实现）==========
    sceneUpdate: (req, res) => response.success(res, { message: '保存成功' }),
    sceneUpdatePrompt: (req, res) => response.success(res, { message: '保存成功' }),
    sceneDelete: (req, res) => response.success(res, { message: '删除成功' }),
    sceneGenerateImage: (req, res) => response.success(res, { task_id: '', image_url: '' }),
    sceneCreate: (req, res) => stubCreated(res, { id: 0, ...req.body }),

    // ========== 图片接口（桩实现）==========
    imageList: (req, res) => response.success(res, []),
    imageCreate: (req, res) => {
      const task = taskService.createTask(db, log, 'image_generation', '');
      setTimeout(() => taskService.updateTaskResult(db, task.id, { id: 0, status: 'pending' }), 100);
      response.created(res, { id: 0, task_id: task.id, status: 'pending' });
    },
    imageGet: (req, res) => response.notFound(res, '记录不存在'),
    imageDelete: (req, res) => response.success(res, { message: '删除成功' }),
    imageScene: (req, res) => response.success(res, []),
    imageUpload: (req, res) => response.created(res, { id: 0, image_url: '' }),
    imageEpisodeBackgrounds: (req, res) => response.success(res, []),
    imageEpisodeBackgroundsExtract: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'background_extraction', req.params.episode_id);
        const taskId = task && task.id ? task.id : '';
        setTimeout(() => {
          try { taskService.updateTaskResult(db, taskId, { backgrounds: [] }); } catch (_) {}
        }, 100);
        if (!res.headersSent) {
          response.success(res, { task_id: taskId, status: 'pending', message: '场景提取任务已创建，正在后台处理...' });
        }
      } catch (err) {
        log.errorw('backgrounds/extract failed', { error: err.message });
        if (!res.headersSent) response.internalError(res, err.message || '任务创建失败');
      }
    },
    imageEpisodeBatch: (req, res) => response.success(res, []),

    // ========== 视频接口（桩实现）==========
    videoList: (req, res) => response.success(res, []),
    videoCreate: (req, res) => {
      const task = taskService.createTask(db, log, 'video_generation', '');
      setTimeout(() => taskService.updateTaskResult(db, task.id, { id: 0, status: 'pending' }), 100);
      response.created(res, { id: 0, task_id: task.id, status: 'pending' });
    },
    videoGet: (req, res) => response.notFound(res, '记录不存在'),
    videoDelete: (req, res) => response.success(res, { message: '删除成功' }),
    videoFromImage: (req, res) => {
      const task = taskService.createTask(db, log, 'video_generation', '');
      response.success(res, { task_id: task.id });
    },
    videoEpisodeBatch: (req, res) => response.success(res, []),

    // ========== 视频合并接口（桩实现）==========
    videoMergeList: (req, res) => response.success(res, []),
    videoMergeCreate: (req, res) => {
      const task = taskService.createTask(db, log, 'video_merge', req.body?.episode_id || '');
      response.success(res, { merge_id: 0, task_id: task.id });
    },
    videoMergeGet: (req, res) => response.notFound(res, '记录不存在'),
    videoMergeDelete: (req, res) => response.success(res, { message: '删除成功' }),

    // ========== 资源接口（桩实现）==========
    assetList: (req, res) => response.success(res, []),
    assetCreate: (req, res) => stubCreated(res, { id: 0 }),
    assetGet: (req, res) => response.notFound(res, '资源不存在'),
    assetUpdate: (req, res) => response.success(res, { message: '保存成功' }),
    assetDelete: (req, res) => response.success(res, { message: '删除成功' }),
    assetImportImage: (req, res) => stubCreated(res, { id: 0 }),
    assetImportVideo: (req, res) => stubCreated(res, { id: 0 }),

    // ========== 分镜接口（部分已实现真实逻辑）==========
    storyboardCreate: (req, res) => stubCreated(res, { id: 0, ...req.body }),
    storyboardUpdate: (req, res) => response.success(res, { message: '保存成功' }),
    storyboardDelete: (req, res) => response.success(res, { message: '删除成功' }),
    storyboardFramePrompt: (req, res) => {
      const task = taskService.createTask(db, log, 'frame_prompt_generation', req.params.id);
      response.success(res, task.id);
    },
    storyboardFramePromptsGet: (req, res) => response.success(res, []),

    // ========== 音频接口（桩实现）==========
    audioExtract: (req, res) => response.success(res, { url: '' }),
    audioExtractBatch: (req, res) => response.success(res, []),
  };
};