/**
 * 视频路由模块
 * 
 * 提供视频生成记录的完整 CRUD 操作，包括视频列表、创建、查询、删除、
 * 从图片生成视频、章节批量视频生成等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 视频路由处理函数集合
 */
const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { normalizeAspectRatioForApi } = require('../services/videoClient');

function routes(db, log) {
  return {
    /**
     * 获取视频生成记录列表接口（支持分页、筛选）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.query - 查询参数
     * @returns {object} 视频列表（带分页信息）
     */
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 创建视频生成任务接口
     * 
     * 创建视频生成记录并启动异步处理任务。支持多种参数：
     * - 画幅归一化处理（全角冒号转半角）
     * - 风格参数自动追加到提示词
     * - 首尾帧支持 URL 或本地路径
     * - 多图模式（reference_image_urls）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.body - 视频生成参数
     * @returns {object} 创建的视频生成记录
     */
    create: (req, res) => {
      try {
        const body = req.body || {};
        const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''));
        const now = new Date().toISOString();
        const dramaId = Number(body.drama_id) || 0;
        const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
        const provider = body.provider || 'chatfire';
        let prompt = body.prompt || '';
        const style = (body.style || '').toString().trim();
        if (style) {
          const baseLower = String(prompt || '').toLowerCase();
          const styleLower = style.toLowerCase();
          if (!baseLower.includes(styleLower)) {
            prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
          }
        }
        const model = body.model ?? null;
        const duration = body.duration ?? null;
        // 画幅：请求体归一化（全角冒号等）后写入 DB；未传则从 drama.metadata 读取并同样归一化
        let aspectRatio = null;
        if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
          aspectRatio = normalizeAspectRatioForApi(body.aspect_ratio);
        }
        if (!aspectRatio && dramaId) {
          try {
            const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            if (dramaRow && dramaRow.metadata) {
              const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
              if (meta && meta.aspect_ratio) aspectRatio = normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          } catch (_) {}
        }
        const resolution = body.resolution ?? null;
        const seed = body.seed != null ? Number(body.seed) : null;
        const cameraFixed = body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null;
        const watermark = body.watermark != null ? (body.watermark ? 1 : 0) : 0;
        const imageUrl = body.image_url ?? null;
        // 首尾帧：支持 URL 或本地路径（sxy，存到 first_frame_url / last_frame_url）
        const firstFrameUrl = body.first_frame_url ?? body.first_frame_local_path ?? null;
        const lastFrameUrl = body.last_frame_url ?? body.last_frame_local_path ?? null;
        // 多图模式：sxy，存 JSON 数组到 reference_image_urls
        const refImagesJson =
          body.reference_image_urls && Array.isArray(body.reference_image_urls)
            ? JSON.stringify(body.reference_image_urls.slice(0, 10))
            : null;
        db.prepare(
          `INSERT INTO video_generations (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
        ).run(dramaId, storyboardId, provider, prompt, model, duration, aspectRatio, resolution, seed, cameraFixed, watermark, imageUrl, firstFrameUrl, lastFrameUrl, refImagesJson, task.id, now, now);
        const videoGenId = db.prepare('SELECT LAST_INSERT_ID() as id').get().id;
        setImmediate(() => {
          videoService.processVideoGeneration(db, log, videoGenId);
        });
        const item = videoService.getById(db, videoGenId);
        response.created(res, item || { id: videoGenId, task_id: task.id, status: 'processing' });
      } catch (err) {
        log.error('videos create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 获取单个视频生成记录详情接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 视频记录 ID
     * @returns {object} 视频生成记录详情
     */
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 删除视频生成记录接口（软删除）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.id - 视频记录 ID
     * @returns {object} 操作结果
     */
    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 从图片生成视频接口（桩实现）
     * 
     * 根据图片生成记录 ID 创建视频生成任务。
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} req.params.image_gen_id - 图片生成记录 ID
     * @returns {object} 任务信息
     */
    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('videos fromImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /**
     * 章节批量视频生成接口（桩实现）
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @returns {object} 空数组
     */
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('videos episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
