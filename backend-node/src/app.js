/**
 * Express 应用创建和配置模块
 * 
 * 负责：
 * 1. 初始化数据库连接（MySQL 或 SQLite）
 * 2. 执行数据库迁移
 * 3. 初始化系统服务（管理员账号、异步任务、视频处理等）
 * 4. 配置 Express 中间件（CORS、静态资源、认证等）
 * 5. 设置路由和错误处理
 */

// 引入依赖模块
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db/index.js');
const { loadConfig } = require('./config/index.js');
const logger = require('./logger.js');
const { setupRouter } = require('./routes/index.js');

/**
 * 创建 Express 应用实例
 * 
 * @returns {Object} { app, config, db } - 应用实例、配置对象、数据库连接
 */
function createApp() {
  // 加载应用配置
  const config = loadConfig();
  
  // 初始化数据库连接
  const db = getDb(config.database);
  
  // 如果是 MySQL 数据库，创建数据库并切换到该数据库
  if (db.type === 'mysql') {
    db.exec(`CREATE DATABASE IF NOT EXISTS \`${config.database.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db.exec(`USE \`${config.database.database}\``);
  }
  
  // 执行数据库迁移和列确保
  const { runMigrationsAndEnsure } = require('./db/migrate.js');
  runMigrationsAndEnsure(db);

  // 厂商锁定模式：在迁移完成后同步 vendor_lock 配置
  const { applyVendorLock } = require('./services/aiConfigService');
  applyVendorLock(db, logger, config);
  const log = logger;

  // 启动时处理孤立的异步任务（标记失败）
  const taskService = require('./services/taskService');
  taskService.failOrphanedAsyncTasksOnStartup(db, log);

  // 初始化管理员账号
  const authService = require('./services/authService');
  authService.initAdmin(db);

  // 恢复视频生成处理（继续之前中断的任务）
  const { resumeProcessingVideoGenerations } = require('./services/videoService');
  resumeProcessingVideoGenerations(db, log);

  // 创建 Express 应用实例
  const app = express();
  
  // 解析 JSON 请求体，最大 10MB
  app.use(express.json({ limit: '10mb' }));
  
  // 解析 URL 编码的请求体
  app.use(express.urlencoded({ extended: true }));

  // 配置 CORS（跨域资源共享）
  app.use(
    cors({
      origin: config.server.cors_origins && config.server.cors_origins.length
        ? config.server.cors_origins
        : '*',  // 默认允许所有来源
    })
  );

  // 请求日志中间件：记录所有请求的方法和路径
  app.use((req, res, next) => {
    log.info(req.method, req.path);
    next();
  });

  // 认证中间件：处理用户登录状态和权限验证
  const { authMiddleware } = require('./middleware/auth');
  app.use(authMiddleware);

  // 静态资源目录：统一转为绝对路径（打包 exe 下相对路径可能解析异常）
  const storageRoot = config.storage?.local_path
    ? (path.isAbsolute(config.storage.local_path)
        ? config.storage.local_path
        : path.join(process.cwd(), config.storage.local_path))
    : path.join(process.cwd(), 'data', 'storage');
  
  // 创建存储目录（如果不存在）并挂载静态资源服务
  try {
    if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });
    app.use('/static', express.static(storageRoot));
  } catch (e) {
    console.warn('Static storage mount skipped:', e.message);
  }

  // 健康检查接口：用于服务监控和容器探针
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: config.app.name,
      version: config.app.version,
    });
  });

  // 挂载 API 路由（版本 v1）
  app.use('/api/v1', setupRouter(config, db, log));

  // 前端静态资源服务（生产环境）
  // Electron 打包时可通过 WEB_DIST_PATH 环境变量指定
  const webDist = process.env.WEB_DIST_PATH || path.join(process.cwd(), '..', 'frontweb', 'dist');
  console.log('webDist', webDist);
  
  // 如果前端构建目录存在，提供静态资源服务
  if (fs.existsSync(webDist)) {
    // 挂载 /assets 目录
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    
    // 服务 dist 根目录的静态文件（如 wx.jpg、favicon.ico 等）
    app.use(express.static(webDist, { index: false }));
    
    // 处理 favicon.ico 请求
    app.get('/favicon.ico', (req, res) => {
      const fav = path.join(webDist, 'favicon.ico');
      if (fs.existsSync(fav)) res.sendFile(fav);
      else res.status(404).end();
    });
    
    // SPA 路由回退：所有非 API 请求返回 index.html
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(webDist, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else next();
    });
  } else {
    // 如果前端未构建，返回提示页面
    app.get('/', (req, res) => {
      res.send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LocalMiniDrama</title></head><body>' +
          '<h1>LocalMiniDrama API</h1><p>后端已启动。请先构建前端：</p>' +
          '<pre>cd web &amp;&amp; pnpm install &amp;&amp; pnpm build</pre>' +
          '<p>然后将 <code>web/dist</code> 放到与 backend-node 同级的 <code>web/dist</code>，或访问 <a href="/health">/health</a> 检查接口。</p></body></html>'
      );
    });
  }

  // 404 错误处理：API 路由返回 JSON，其他路由返回文本
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).send('Not Found');
  });

  // 全局错误处理中间件
  app.use((err, req, res, next) => {
    log.errorw('Unhandled error', { error: err.message, path: req.path });
    
    // 如果响应还未发送，返回错误响应
    if (!res.headersSent) {
      // 判断是否为文件过大错误
      const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE' || (err.message && err.message.includes('File too large'));
      const status = isFileTooLarge ? 413 : 500;
      const message = isFileTooLarge ? '图片大小不能超过 16MB，请压缩后重试' : (err.message || '服务器错误');
      
      res.status(status).json({ 
        success: false, 
        error: { 
          code: isFileTooLarge ? 'FILE_TOO_LARGE' : 'INTERNAL_ERROR', 
          message 
        }, 
        timestamp: new Date().toISOString() 
      });
    }
  });

  // 返回应用实例、配置和数据库连接
  return { app, config, db };
}

// 导出 createApp 函数供 server.js 使用
module.exports = { createApp };