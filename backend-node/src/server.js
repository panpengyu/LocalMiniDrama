/**
 * LocalMiniDrama 后端服务启动入口文件
 * 
 * 负责：
 * 1. 加载配置并处理 TLS 证书校验设置
 * 2. 创建 Express 应用实例
 * 3. 启动 HTTP 服务器
 * 4. 处理进程优雅退出（SIGINT/SIGTERM）
 */

// 加载配置模块
const { loadConfig } = require('./config/index.js');

// 加载预配置，检查是否启用不安全 TLS（跳过证书校验，仅用于测试环境）
const preConfig = loadConfig();
const tlsFlag = preConfig.server?.insecure_tls ?? preConfig.server?.INSECURE_TLS;
const insecureTlsOn =
  tlsFlag === true ||
  tlsFlag === 1 ||
  tlsFlag === '1' ||
  String(tlsFlag).toLowerCase() === 'true';

// 如果启用不安全 TLS，设置环境变量跳过证书校验
if (insecureTlsOn) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[config] server.insecure_tls 已启用：全局跳过 TLS 证书校验，仅用于测试');
}

// 引入应用创建、数据库关闭和日志模块
const { createApp } = require('./app.js');
const { closeDb } = require('./db/index.js');
const logger = require('./logger.js');

// 创建 Express 应用实例并获取配置
const { app, config, db } = createApp();

// 确定服务端口：优先使用环境变量 PORT，其次使用配置文件，默认 5679
const port = Number(process.env.PORT) || config.server?.port || 5679;

// 确定服务主机：默认 0.0.0.0（允许所有网络接口访问）
const host = config.server?.host || '0.0.0.0';

// 启动 HTTP 服务器
const server = app.listen(port, host, () => {
  logger.info('Server starting', { port, host });
  logger.info('Frontend:  http://localhost:' + port);
  logger.info('API:       http://localhost:' + port + '/api/v1');
  logger.info('Health:    http://localhost:' + port + '/health');
  logger.info('Server is ready!');
});

// ========== Sprint 11 - S11-T01: 团队协作实时通信网关（Socket.io） ==========
// 挂载到同一 HTTP server，复用端口 5679，路径 /socket.io
let collaborationIo = null;
try {
  const { initCollaborationGateway } = require('./realtime/collaborationGateway.js');
  collaborationIo = initCollaborationGateway(server, db, logger, {
    corsOrigins: config.server?.cors_origins,
  });
} catch (e) {
  logger.warn('[S11-T01] 协作网关启动失败(非致命，实时协作不可用):', e.message);
}

/**
 * 优雅关闭服务器函数
 * 
 * 流程：
 * 1. 记录关闭日志
 * 2. 关闭 HTTP 服务器
 * 3. 关闭数据库连接
 * 4. 退出进程
 * 5. 设置 5 秒超时强制退出
 */
function shutdown() {
  logger.info('Shutting down server...');
  // S11-T01: 先关闭协作网关（断开所有 socket 连接）
  if (collaborationIo) {
    try { collaborationIo.close(); } catch (_) {}
  }
  server.close(() => {
    closeDb();
    logger.info('Server exited');
    process.exit(0);
  });
  // 5 秒超时强制退出，防止进程僵死
  setTimeout(() => process.exit(1), 5000);
}

// 监听 SIGINT 信号（Ctrl+C），触发优雅关闭
process.on('SIGINT', shutdown);

// 监听 SIGTERM 信号（kill 命令），触发优雅关闭
process.on('SIGTERM', shutdown);