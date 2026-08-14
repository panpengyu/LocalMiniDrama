/**
 * Sprint 16 - S16-T04 生产环境 PM2 集群配置
 *
 * 用法：
 *   pm2 start ecosystem.config.js          # 以集群模式启动（自动利用多核 CPU）
 *   pm2 reload ecosystem.config.js         # 零停机重载
 *   pm2 logs localminidrama-api            # 查看日志
 *   pm2 save && pm2 startup                # 开机自启
 *
 * 说明：
 *   - instances = -1 表示按 CPU 核数启动多个实例，前端 Nginx 做负载均衡
 *   - 集群模式下需确保无内存态依赖（本项目全部数据走 MySQL/Redis，可安全集群化）
 *   - 生产配置通过 env 指向 config.production.yaml（NODE_ENV=production 时自动加载）
 */
module.exports = {
  apps: [
    {
      name: 'localminidrama-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: process.env.PM2_INSTANCES || -1, // -1 = CPU 核数
      exec_mode: 'cluster',
      max_memory_restart: '800M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      shutdown_with_message: true,
      watch: false,
      merge_logs: true,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
        PORT: 5679
      }
    }
  ]
};
