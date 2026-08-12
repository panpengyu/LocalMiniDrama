/**
 * 后端路由总入口模块
 * 
 * 负责将所有子路由模块整合到一个 Express Router 中，定义完整的 API 路由表。
 * 路由按功能模块分组，包括：认证、管理员、剧本、AI配置、生成、资源库、角色、道具、场景、分镜等。
 * 
 * @param {object} cfg - 配置对象
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} Express Router 实例
 */
const express = require('express');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const tailFrameLinkRoutes = require('./storyboards_tail_link');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptOverridesRoutes = require('./promptOverrides');
const sceneModelMapRoutes = require('./sceneModelMap');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerSpec');
const authRoutes = require('./auth');
const adminRoutes = require('./admin');
const screenwriterRoutes = require('./screenwriter');
const consistencyRoutes = require('./consistency');
const storyboardAIRoutes = require('./storyboardAI');
const ttsPipelineRoutes = require('./ttsPipeline');
const moderationRoutes = require('./moderation');
const modelRoutingRoutes = require('./modelRouting');
const workflowRoutes = require('./workflows');
const editRoutes = require('./edit');
const styleRoutes = require('./styles');
const bgmRoutes = require('./bgm');

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const drama = dramaRoutes(db, cfg, log);
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const aiConfig = aiConfigRoutes(db, log, cfg);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  
  const uploadService = require('../services/uploadService');
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const storyboards = storyboardRoutes(db, log, cfg);
  const tailFrameLink = tailFrameLinkRoutes(db, cfg, log);
  const images = imageRoutes(db, cfg, log);
  const videos = videoRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const assets = assetRoutes(db, log);
  const audio = audioRoutes(db, log, cfg);
  const promptOverrides = promptOverridesRoutes.routes(db, log);
  const auth = authRoutes(db, log);
  const admin = adminRoutes(db, log);
  const screenwriter = screenwriterRoutes(db, cfg, log);
  const { requireAuth, requireRole } = require('../middleware/auth');
  // S12-T05 欠费闭环：创作类接口余额守卫（余额为负则拦截，super_admin 豁免）
  const requireSufficientBalance = require('../middleware/balanceGuard')(db, log);
  // S13-T05 会员配额守卫（生成次数 / 项目数 / 协作人数）
  const quotaGuard = require('../middleware/quotaGuard')(db, log);

  // ---------- 认证模块 ----------
  r.post('/auth/register', auth.register);
  r.post('/auth/login', auth.login);
  r.post('/auth/logout', auth.logout);
  r.get('/auth/profile', auth.profile);
  
  r.get('/admin-test', (req, res) => {
    res.json({ success: true, message: 'admin test', user: req.user ? { id: req.user.id, role: req.user.role } : null });
  });

  // ---------- 管理员模块（超级管理员权限）----------
  r.get('/admin/stats', requireAuth, requireRole(['super_admin']), admin.getStats);
  r.get('/admin/stats/trend', requireAuth, requireRole(['super_admin']), admin.getStatsTrend);
  r.get('/admin/stats/consumption', requireAuth, requireRole(['super_admin']), admin.getConsumptionBreakdown);
  // Sprint 4 - S4-T05: 智能运营看板扩展
  r.get('/admin/stats/funnel', requireAuth, requireRole(['super_admin']), admin.getCreationFunnel);
  r.get('/admin/stats/model-cost', requireAuth, requireRole(['super_admin']), admin.getModelCost);
  r.get('/admin/stats/insights', requireAuth, requireRole(['super_admin']), admin.getAiInsights);

  r.get('/admin/users', requireAuth, requireRole(['super_admin']), admin.getUsers);
  r.post('/admin/users', requireAuth, requireRole(['super_admin']), admin.createUser);
  r.put('/admin/users/:id', requireAuth, requireRole(['super_admin']), admin.updateUser);
  r.delete('/admin/users/:id', requireAuth, requireRole(['super_admin']), admin.deleteUser);
  
  r.get('/admin/enterprises', requireAuth, requireRole(['super_admin']), admin.getEnterprises);
  r.post('/admin/enterprises', requireAuth, requireRole(['super_admin']), admin.createEnterprise);
  r.put('/admin/enterprises/:id', requireAuth, requireRole(['super_admin']), admin.updateEnterprise);
  r.delete('/admin/enterprises/:id', requireAuth, requireRole(['super_admin']), admin.deleteEnterprise);
  
  r.get('/admin/teams', requireAuth, requireRole(['super_admin']), admin.getTeams);
  r.post('/admin/teams', requireAuth, requireRole(['super_admin']), admin.createTeam);
  r.put('/admin/teams/:id', requireAuth, requireRole(['super_admin']), admin.updateTeam);
  r.delete('/admin/teams/:id', requireAuth, requireRole(['super_admin']), admin.deleteTeam);

  // ---------- 数据异常检测 ----------
  r.get('/admin/data-anomalies',          requireAuth, requireRole(['super_admin']), admin.getDataAnomalies);
  r.get('/admin/data-anomalies/config',   requireAuth, requireRole(['super_admin']), admin.getAnomalyConfig);
  r.post('/admin/data-anomalies/fix/:id', requireAuth, requireRole(['super_admin']), admin.fixDataAnomaly);

  // ---------- 数据异常：告警通知（渠道/历史/手动触发/全量扫描） ----------
  r.get('/admin/alert-channels',                 requireAuth, requireRole(['super_admin']), admin.listAlertChannels);
  r.post('/admin/alert-channels',                requireAuth, requireRole(['super_admin']), admin.createAlertChannel);
  r.put('/admin/alert-channels/:id',             requireAuth, requireRole(['super_admin']), admin.updateAlertChannel);
  r.delete('/admin/alert-channels/:id',          requireAuth, requireRole(['super_admin']), admin.deleteAlertChannel);
  r.get('/admin/alert-events',                   requireAuth, requireRole(['super_admin']), admin.listAlertEvents);
  r.post('/admin/data-anomalies/alert/:id',      requireAuth, requireRole(['super_admin']), admin.dispatchAlertForAnomaly);
  r.post('/admin/data-anomalies/alert-scan',     requireAuth, requireRole(['super_admin']), admin.runAlertScan);
  
  // ---------- 剧本模块 ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', quotaGuard.project, drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  // 导出/导入（放在 :id 路由前，避免被 :id 捕获）
  r.get('/dramas/:id/export', drama.exportDrama);
  const multer = require('multer');
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
  r.post('/dramas/import', importUpload.single('file'), drama.importDrama);
  r.post('/dramas/import-novel', importUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      response.internalError(res, err.message);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.put('/dramas/:id/outline', drama.saveOutline);
  r.get('/dramas/:id/characters', drama.getCharacters);
  r.put('/dramas/:id/characters', drama.saveCharacters);
  r.put('/dramas/:id/episodes', drama.saveEpisodes);
  r.put('/dramas/:id/progress', drama.saveProgress);
  r.put('/dramas/:id/canvas-layout', drama.saveCanvasLayout);
  r.get('/dramas/:id/props', drama.listProps);
  r.get('/dramas/:id', drama.getDrama);
  r.put('/dramas/:id', drama.updateDrama);
  r.delete('/dramas/:id', drama.deleteDrama);

  // ---------- AI配置模块 ----------
  r.get('/ai-configs', aiConfig.list);
  r.post('/ai-configs', aiConfig.create);
  r.post('/ai-configs/test', aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', aiConfig.modelArkAsset);
  r.get('/ai-configs/vendor-lock', aiConfig.vendorLock);
  r.put('/ai-configs/bulk-update-key', aiConfig.bulkUpdateKey);
  r.get('/ai-configs/:id', aiConfig.get);
  r.put('/ai-configs/:id', aiConfig.update);
  r.delete('/ai-configs/:id', aiConfig.delete);

  // ---------- AI生成模块 ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
      const taskId = characterGenerationService.generateCharacters(db, userCfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      const userCfg = { ...cfg, userId: req.user?.id, user: req.user };
      if (body.drama_id) {
        const taskId = storyGenerationService.startStoryGeneration(db, log, body, userCfg);
        return response.success(res, { task_id: taskId, status: 'pending' });
      }
      const result = await storyGenerationService.generateStory(db, log, body, userCfg);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- 角色库模块 ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', charLibrary.get);
  r.put('/character-library/:id', charLibrary.update);
  r.delete('/character-library/:id', charLibrary.delete);

  // ---------- 场景库模块 ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', sceneLibrary.get);
  r.put('/scene-library/:id', sceneLibrary.update);
  r.delete('/scene-library/:id', sceneLibrary.delete);

  // ---------- 道具库模块 ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', propLibrary.get);
  r.put('/prop-library/:id', propLibrary.update);
  r.delete('/prop-library/:id', propLibrary.delete);

  // ---------- 角色模块 ----------
  r.get('/characters/:id', characters.getOne);
  r.put('/characters/:id', characters.update);
  r.delete('/characters/:id', characters.delete);
  r.post('/characters/batch-generate-images', requireSufficientBalance, characters.batchGenerateImages);
  r.post('/characters/:id/generate-image', requireSufficientBalance, characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', requireSufficientBalance, characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', characters.generatePrompt);
  r.post('/characters/:id/upload-image', uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', characters.putImage);
  r.put('/characters/:id/image-from-library', characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', characters.sd2CertifyRefresh);
  r.post('/characters/:id/sd2-voice-upload', uploadModule.multerAudioSingle, characters.sd2VoiceUpload);
  r.post('/characters/:id/sd2-voice-refresh', characters.sd2VoiceRefresh);
  r.post('/characters/:id/extract-from-image', characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', characters.extractAnchors);

  // ---------- 道具模块 ----------
  r.get('/props/:id', prop.getPropById);
  r.post('/props', prop.createProp);
  r.put('/props/:id', prop.updateProp);
  r.delete('/props/:id', prop.deleteProp);
  r.post('/props/:id/generate', requireSufficientBalance, prop.generateImage);
  r.post('/props/:id/generate-prompt', prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', prop.extractPropFromImage);

  // ---------- 图片提取描述 ----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 上传模块 ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);

  // ---------- 剧集模块 ----------
  r.post('/episodes/:episode_id/storyboards', drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', storyboards.episodeStoryboardsGet);
  r.post('/episodes/:episode_id/finalize', drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', drama.downloadEpisodeVideo);

  // ---------- 任务模块 ----------
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.post('/tasks/:task_id/cancel', task.cancelTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- 场景模块 ----------
  r.get('/scenes/:scene_id', scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', scenes.generatePrompt);
  r.put('/scenes/:scene_id', scenes.update);
  r.put('/scenes/:scene_id/prompt', scenes.updatePrompt);
  r.delete('/scenes/:scene_id', scenes.delete);
  r.post('/scenes/generate-image', requireSufficientBalance, scenes.generateImage);
  r.post('/scenes', scenes.create);
  r.post('/scenes/:scene_id/generate-four-view-image', requireSufficientBalance, scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/add-to-library', scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', scenes.extractFromImage);

  // ---------- 图片模块 ----------
  r.get('/images', images.list);
  r.post('/images', requireSufficientBalance, quotaGuard.generation, images.create);
  r.get('/images/episode/:episode_id/backgrounds', images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', requireSufficientBalance, images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', requireSufficientBalance, images.episodeBatch);
  r.post('/images/scene/:scene_id', requireSufficientBalance, images.scene);
  r.post('/images/upload', images.upload);
  r.get('/images/:id', images.get);
  r.delete('/images/:id', images.delete);

  // ---------- 视频模块 ----------
  r.get('/videos', videos.list);
  r.post('/videos', requireSufficientBalance, quotaGuard.generation, videos.create);
  r.post('/videos/image/:image_gen_id', requireSufficientBalance, videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', requireSufficientBalance, videos.episodeBatch);
  r.get('/videos/:id', videos.get);
  r.delete('/videos/:id', videos.delete);

  // ---------- 视频合成模块 ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', videoMerges.get);
  r.delete('/video-merges/:merge_id', videoMerges.delete);

  // ---------- 资源模块 ----------
  r.get('/assets', assets.list);
  r.post('/assets', assets.create);
  r.post('/assets/import/image/:image_gen_id', assets.importImage);
  r.post('/assets/import/video/:video_gen_id', assets.importVideo);
  r.get('/assets/:id', assets.get);
  r.put('/assets/:id', assets.update);
  r.delete('/assets/:id', assets.delete);

  // ---------- 分镜模块 ----------
  r.get('/storyboards/episode/:episode_id/generate', storyboards.episodeStoryboardsGenerate);
  r.post('/storyboards', storyboards.create);
  r.post('/storyboards/:id/insert-before', storyboards.insertBefore);
  r.get('/storyboards/:id', storyboards.getOne);
  r.put('/storyboards/:id', storyboards.update);
  r.delete('/storyboards/:id', storyboards.delete);
  r.post('/storyboards/:id/props', prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', storyboards.framePromptsGet);
  r.put('/storyboards/:id/frame-prompts/:frame_type', storyboards.framePromptSave);
  r.post('/storyboards/:id/link-tail-frame', tailFrameLink.linkTailFrame);
  r.post('/storyboards/:id/polish-prompt', storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.post('/storyboards/:id/upscale', storyboards.upscale);
  r.post('/storyboards/:id/regenerate-layout-description', storyboards.regenerateLayoutDescription);
  r.post('/storyboards/:id/rebuild-video-prompt', storyboards.rebuildVideoPrompt);
  r.post('/storyboards/:id/split-by-audio', storyboards.splitByAudio);

  // ---------- 音频模块 ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- 设置模块 ----------
  r.get('/settings/language', settings.getLanguage);
  r.put('/settings/language', settings.updateLanguage);
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', settings.updateGenerationSettings);

  // ---------- 提示词覆盖模块 ----------
  r.get('/settings/prompts', promptOverrides.list);
  r.put('/settings/prompts/:key', promptOverrides.update);
  r.delete('/settings/prompts/:key', promptOverrides.reset);

  // ---------- 场景模型映射模块 ----------
  r.get('/scene-model-map', sceneModelMap.list);
  r.post('/scene-model-map', sceneModelMap.create);
  r.get('/scene-model-map/:key', sceneModelMap.get);
  r.put('/scene-model-map/:key', sceneModelMap.update);
  r.delete('/scene-model-map/:key', sceneModelMap.delete);

  // ---------- Swagger API 文档（Sprint 1：API接口文档更新要求） ----------
  // 文档地址（生产/开发）：http://localhost:5679/api/v1/docs
  r.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'LocalMiniDrama API Docs (Sprint 1)',
    explorer: false,
  }));
  // 纯 JSON spec（供代码生成）: /api/v1/docs/openapi.json
  r.get('/docs/openapi.json', (req, res) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.json(swaggerSpec); });

  // ---------- AI编剧助手模块（Sprint 1） ----------
  r.use('/ai/screenwriter', screenwriter);

  // ---------- 角色一致性模块（Sprint 2: S2-T05~T08） ----------
  r.use('/ai/consistency', consistencyRoutes(db, log));

  // ---------- 智能分镜模块（Sprint 4: S4-T01） ----------
  r.use('/ai/storyboard', storyboardAIRoutes(db, cfg, log));

  // ---------- 智能配音流水线模块（Sprint 4: S4-T03/T04） ----------
  r.use('/ai/tts', ttsPipelineRoutes(db, cfg, log));

  // ---------- 内容审核模块（Sprint 4: S4-T08） ----------
  r.use('/ai/moderation', moderationRoutes(db, log));

  // ---------- AI模型智能路由模块（Sprint 4: S4-T07） ----------
  r.use('/ai/model-routing', modelRoutingRoutes(db, log));

  // ---------- 智能工作流引擎模块（Sprint 7: S7-T01~T04） ----------
  r.use('/workflows', workflowRoutes(db, log));

  // ---------- 智能剪辑模块（Sprint 7: S7-T05~T08） ----------
  r.use('/ai/edit', editRoutes(db, log));

  // ---------- 风格配置模块（Sprint 8: S8-T01/T03） ----------
  r.use('/', styleRoutes(db, log));

  // ---------- BGM生成模块（Sprint 8: S8-T04） ----------
  r.use('/ai/bgm', bgmRoutes(db, log));

  // ---------- 团队协作 + 版本管理模块（Sprint 11: S11-T02/T04/T05/T06/T07/T08） ----------
  const collaborationRoutes = require('./collaboration');
  r.use('/', collaborationRoutes(db, log));

  // ---------- 素材标签 + 三级素材库模块（Sprint 12: S12-T01/T02） ----------
  const materialRoutes = require('./materials');
  r.use('/', materialRoutes(db, log));

  // ---------- 存储管理模块（Sprint 12: S12-T03 对象存储 / 生命周期 / 迁移追踪） ----------
  const storageRoutes = require('./storage');
  r.use('/', storageRoutes(cfg, db, log));

  // ---------- 用户生命周期管理（Sprint 12: S12-T04） ----------
  const lifecycleRoutes = require('./lifecycle');
  r.use('/', lifecycleRoutes(db, log));

  // ---------- 财务与计费增强（Sprint 12: S12-T05） ----------
  const financeRoutes = require('./finance');
  r.use('/', financeRoutes(db, log));

  // ---------- 系统监控大屏（Sprint 12: S12-T06） ----------
  const monitorRoutes = require('./monitor');
  r.use('/', monitorRoutes(cfg, db, log));

  // ---------- 权限与安全增强（Sprint 12: S12-T07 操作审计 / 登录日志 / 脱敏） ----------
  const securityRoutes = require('./security');
  r.use('/', securityRoutes(db, log));

  // ---------- 数据分析平台（Sprint 12: S12-T08 行为/漏斗/模型效果/留存） ----------
  const analyticsRoutes = require('./analytics');
  r.use('/', analyticsRoutes(db, log));

  // ---------- 会员体系（Sprint 13: S13-T01~T05 等级/计费/支付/配额） ----------
  const membershipRoutes = require('./membership');
  r.use('/', membershipRoutes(db, log));

  // ---------- 评论批注系统（Sprint 13: S13-T06 画布评论/时间戳批注/@提及/已读未读/批量回复） ----------
  const commentRoutes = require('./comments');
  r.use('/', commentRoutes(db, log));

  // ---------- CDN状态查询（Sprint 8: S8-T08） ----------
  r.get('/cdn/status', (req, res) => {
    const cdnService = require('../services/cdnService');
    response.success(res, cdnService.getStatus());
  });

  // ---------- 缓存统计查询（Sprint 8: S8-T07） ----------
  r.get('/cache/stats', (req, res) => {
    const cacheService = require('../services/cacheService');
    response.success(res, cacheService.getStats());
  });

  // 启动时将已有的覆盖加载到 promptI18n 内存缓存
  try {
    const promptI18n = require('../services/promptI18n');
    const promptOverridesService = require('../services/promptOverridesService');
    const saved = promptOverridesService.listOverrides(db);
    promptI18n.loadOverridesIntoCache(saved);
  } catch (e) {
    console.warn('Failed to load prompt overrides:', e.message);
  }

  return r;
}

module.exports = { setupRouter };