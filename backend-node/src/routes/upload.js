/**
 * 上传路由模块
 * 
 * 提供图片和音频文件的上传功能，使用 multer 中间件处理文件上传。
 * 支持图片格式（jpg, png, gif, webp）和音频格式（mp3, wav, m4a, ogg）。
 * 
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @param {object} db - 数据库连接实例（可选）
 * @returns {object} 上传路由处理函数集合
 */
const path = require('path');
const multer = require('multer');
const response = require('../response');
const uploadService = require('../services/uploadService');
const storageLayout = require('../services/storageLayout');

// 允许的图片类型
const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

// 单张图片最大尺寸：16MB
const maxSize = 16 * 1024 * 1024;
const MAX_SIZE_MB = 16;

// 使用内存存储（multer.memoryStorage），文件先加载到内存再写入磁盘
const memoryStorage = multer.memoryStorage();

// 图片上传中间件配置
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: maxSize },
  fileFilter: (req, file, cb) => {
    const ct = file.mimetype || 'application/octet-stream';
    if (!allowedTypes.includes(ct)) {
      return cb(new Error('只支持图片格式 (jpg, png, gif, webp)'));
    }
    cb(null, true);
  },
});

// Seedance 2.0 音色参考音频上传支持的格式
const allowedAudioTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
];

// 音频文件最大尺寸：10MB
const audioMaxSize = 10 * 1024 * 1024;

// 音频上传中间件配置
const audioUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: audioMaxSize },
  fileFilter: (req, file, cb) => {
    const ct = file.mimetype || 'application/octet-stream';
    if (!allowedAudioTypes.includes(ct)) {
      return cb(new Error('只支持音频格式 (mp3, wav, m4a, ogg)'));
    }
    cb(null, true);
  },
});

/**
 * 创建上传路由处理函数
 * 
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @param {object} db - 数据库连接实例
 * @returns {object} 路由处理函数集合
 */
function routes(cfg, log, db) {
  const singleUpload = upload.single('file');
  return {
    multerSingle: singleUpload,

    /**
     * 上传图片接口
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {object} req.file - 上传的文件对象
     * @param {number} [req.body.drama_id] - 剧本 ID（用于组织存储路径）
     * @returns {object} 上传结果（包含 URL、路径、文件名、大小）
     */
    uploadImage: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const rawStorage = cfg?.storage?.local_path || './data/storage';
        const storagePath = path.isAbsolute(rawStorage)
          ? rawStorage
          : path.join(process.cwd(), rawStorage);
        const baseUrl = cfg?.storage?.base_url || '';
        let projectSubdir = null;
        if (db) {
          const raw = req.body?.drama_id;
          const did =
            raw !== undefined && raw !== null && String(raw).trim() !== ''
              ? Number(raw)
              : NaN;
          if (Number.isFinite(did) && did > 0) {
            projectSubdir = storageLayout.getProjectStorageSubdir(db, did);
          }
        }
        const result = uploadService.uploadFile(
          storagePath,
          baseUrl,
          log,
          req.file.buffer,
          req.file.originalname || 'image.png',
          req.file.mimetype,
          'uploads',
          projectSubdir
        );
        response.success(res, {
          url: result.url,
          path: result.local_path,
          local_path: result.local_path,
          filename: req.file.originalname,
          size: req.file.size,
        });
      } catch (err) {
        log.error('upload image', { error: err.message });
        response.internalError(res, err.message || '上传失败');
      }
    },
  };
}

module.exports = {
  routes,
  upload,
  multerSingle: upload.single('file'),
  multerAudioSingle: audioUpload.single('file'),
  MAX_IMAGE_SIZE_MB: MAX_SIZE_MB,
};