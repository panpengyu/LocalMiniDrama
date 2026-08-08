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

  // ============================================================
  // 同源下载代理接口（流式转发 + 强制下载）
  //
  // 解决问题：跨域图片通过 <a download> 时，浏览器会忽略 download 属性
  // 导致直接在新窗口预览而不是保存文件。
  //
  // 方案：前端请求本同源接口 (/api/v1/tools/download-proxy?url=...) ，
  // 后端通过 HTTP(S) 向远端拉取图片流，通过 pipe 流式转发给前端，
  // 同时显式设置 Content-Disposition: attachment 响应头，
  // 强制浏览器弹出"保存文件"对话框，绝不预览。
  //
  // 安全：
  //  1. 只允许 http / https 协议，防止 file:// / ftp:// 等 SSRF 攻击
  //  2. 禁止请求内网 IP (127.0.0.1 / 10.x / 172.16-31.x / 192.168.x / localhost)
  // ============================================================
  const urlModule = require('url');
  const net = require('net');
  const https = require('https');
  const httpModule = require('http');

  function isPrivateIP(hostname) {
    if (!hostname) return true;
    const h = hostname.toLowerCase();
    if (h === 'localhost') return true;
    // IPv4 内网/回环判断
    if (net.isIPv4(h)) {
      const parts = h.split('.').map(Number);
      if (parts[0] === 127) return true;                 // 127.0.0.0/8
      if (parts[0] === 10) return true;                  // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
      if (parts[0] === 0) return true;                   // 0.0.0.0
    }
    // IPv6 链路本地 / 内网 / 回环 简单判断（阻止 fe80:: / ::1 / fc00::/7）
    if (net.isIPv6(h)) {
      if (h === '::1') return true;
      if (h.startsWith('fe80') || h.startsWith('fe90') || h.startsWith('fea0') || h.startsWith('feb0')) return true;
      if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULAs fc00::/7
    }
    return false;
  }

  async function resolveHostnameSafe(hostname) {
    // 通过 DNS 解析真实 IP，防止 DNS rebinding 攻击
    return new Promise((resolve, reject) => {
      const dns = require('dns');
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return reject(err);
        if (!addresses || addresses.length === 0) return reject(new Error('DNS 解析失败'));
        resolve(addresses.map(a => a.address));
      });
    });
  }

  app.get('/api/v1/tools/download-proxy', async (req, res) => {
    try {
      const rawUrl = req.query.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).json({ success: false, error: '缺少 url 参数' });
      }

      // 解析 URL，初步协议校验
      let parsed;
      try {
        parsed = urlModule.parse(rawUrl);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'URL 格式错误' });
      }
      if (!parsed.protocol || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return res.status(400).json({ success: false, error: '仅允许 http / https 协议' });
      }

      const hostname = parsed.hostname;
      if (!hostname) {
        return res.status(400).json({ success: false, error: 'URL 缺少主机名' });
      }

      // 直接 hostname 检查（先快速拦截）
      if (isPrivateIP(hostname)) {
        log.warn('download-proxy blocked private hostname', { hostname });
        return res.status(403).json({ success: false, error: '禁止访问内网地址' });
      }

      // 解析 DNS 获得真实 IP 并再次做内网检查（防 DNS Rebinding）
      let resolvedIPs;
      try {
        resolvedIPs = await resolveHostnameSafe(hostname);
      } catch (dnsErr) {
        return res.status(400).json({ success: false, error: 'DNS 解析失败: ' + dnsErr.message });
      }
      const hasPrivate = resolvedIPs.some(ip => isPrivateIP(ip));
      if (hasPrivate) {
        log.warn('download-proxy blocked DNS-rebind to private', { hostname, ips: resolvedIPs });
        return res.status(403).json({ success: false, error: '禁止访问内网地址' });
      }

      // 文件名：优先 query.filename（必须做安全清洗，防路径穿越），否则从 URL path 提取，再否则使用时间戳
      let filename = req.query.filename;
      if (filename && typeof filename === 'string') {
        // 统一清洗：去除路径字符、控制字符，限制长度
        filename = filename
          .replace(/[\x00-\x1F\x7F\\/:*?"<>|]/g, '_')
          .slice(0, 200);
        // 确保清洗后不为空
        if (!filename.trim()) filename = null;
      }
      if (!filename) {
        const pathname = parsed.pathname || '/image.jpg';
        const base = path.posix.basename(pathname);
        filename = base && base.includes('.') ? base : `image_${Date.now()}.jpg`;
        filename = filename.replace(/[\x00-\x1F\x7F\\/:*?"<>|]/g, '_').slice(0, 200);
      }

      // ==========================================
      // 支持自动跟随重定向的代理请求函数
      //  - 最多 5 次重定向，防止死循环
      //  - 每次重定向目标都要重新做 SSRF 安全检查
      // ==========================================
      const MAX_REDIRECTS = 5;
      const pendingReqs = []; // 追踪所有待关闭的请求，出错时统一销毁
      let finished = false;

      // 客户端断开时关闭所有正在进行的远端请求
      req.on('aborted', () => {
        finished = true;
        pendingReqs.forEach(r => { try { r.destroy(); } catch(_) {} });
      });

      function cleanupAndReturnError(status, msg) {
        if (finished) return;
        finished = true;
        pendingReqs.forEach(r => { try { r.destroy(); } catch(_) {} });
        if (!res.headersSent) {
          res.status(status).json({ success: false, error: msg });
        } else {
          try { res.end(); } catch(_) {}
        }
      }

      // 递归发起请求（支持重定向）
      function doRequest(targetUrlObj, redirectsLeft) {
        if (finished) return;
        if (redirectsLeft < 0) {
          return cleanupAndReturnError(502, '源站重定向次数过多');
        }

        const protocolOk = targetUrlObj.protocol === 'https:' ? https : httpModule;
        const port = targetUrlObj.port || (targetUrlObj.protocol === 'https:' ? 443 : 80);
        const requestOpts = {
          method: 'GET',
          hostname: targetUrlObj.hostname,
          port: port,
          path: (targetUrlObj.path || '/'),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LocalMiniDrama-DownloadProxy/1.0)',
            'Accept': 'image/*,*/*;q=0.8',
            // 对重定向目标保留相同的 Referer 策略（不传递真实用户 Referer）
          },
          timeout: 60000,
        };

        const outgoing = protocolOk.request(requestOpts, (remoteRes) => {
          const sc = remoteRes.statusCode || 0;

          // ========== 重定向处理：301/302/303/307/308 ==========
          const isRedirect = (sc === 301 || sc === 302 || sc === 303 || sc === 307 || sc === 308);
          if (isRedirect && remoteRes.headers.location) {
            try { remoteRes.resume(); } catch(_) {}

            let nextParsed;
            try {
              const baseForResolve = `${targetUrlObj.protocol}//${targetUrlObj.host}${targetUrlObj.pathname || '/'}`;
              const resolved = urlModule.resolve(baseForResolve, remoteRes.headers.location);
              nextParsed = urlModule.parse(resolved);
            } catch (e) {
              return cleanupAndReturnError(502, '源站重定向地址解析失败: ' + e.message);
            }

            if (!nextParsed || !nextParsed.protocol || !nextParsed.hostname) {
              return cleanupAndReturnError(502, '源站重定向地址无效');
            }
            if (nextParsed.protocol !== 'http:' && nextParsed.protocol !== 'https:') {
              return cleanupAndReturnError(403, '源站重定向协议不允许');
            }
            const nextHost = nextParsed.hostname;
            if (isPrivateIP(nextHost)) {
              log.warn('download-proxy redirect blocked private hostname', { from: targetUrlObj.hostname, to: nextHost });
              return cleanupAndReturnError(403, '禁止重定向到内网地址');
            }
            doRequest(nextParsed, redirectsLeft - 1);
            return;
          }

          // ========== 非 2xx：报错 ==========
          if (sc < 200 || sc >= 300) {
            try { remoteRes.resume(); } catch(_) {}
            return cleanupAndReturnError(sc >= 400 ? sc : 502, `源站返回错误: ${sc}`);
          }

          // ========== 2xx：成功，流式转发 + 强制下载 ==========
          if (finished) { try { remoteRes.resume(); } catch(_) {} return; }

          const contentType = remoteRes.headers['content-type'] || 'image/jpeg';
          const encodedName = encodeURIComponent(filename);
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
          );
          res.setHeader('Content-Type', contentType);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          if (remoteRes.headers['content-length']) {
            res.setHeader('Content-Length', remoteRes.headers['content-length']);
          }
          res.status(200);
          finished = true;

          remoteRes.on('error', (err) => {
            log.error('download-proxy remote stream error', { error: err.message });
            try { res.end(); } catch(_) {}
          });
          remoteRes.pipe(res);
        });

        pendingReqs.push(outgoing);

        outgoing.on('timeout', () => {
          try { outgoing.destroy(new Error('Request timeout')); } catch(_) {}
        });
        outgoing.on('error', (err) => {
          log.error('download-proxy outgoing request error', {
            host: targetUrlObj.hostname, error: err.message
          });
          cleanupAndReturnError(502, '下载代理请求失败: ' + (err.message || '未知错误'));
        });
        outgoing.end();
      }

      // 发起首次请求
      doRequest(parsed, MAX_REDIRECTS);
    } catch (err) {
      log.error('download-proxy unexpected error', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: '服务器内部错误: ' + (err.message || 'unknown'),
        });
      }
    }
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