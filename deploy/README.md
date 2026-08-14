# Sprint 16 - S16-T04 生产环境部署手册

本文档描述 LocalMiniDrama 正式商用的生产部署拓扑与操作步骤。全部为真实基础设施配置（PM2 集群 + Nginx 负载均衡 + MySQL 主从 + Redis 哨兵），无模拟。

## 1. 目标拓扑

```
                        ┌────────────┐
        HTTPS ────────▶ │   Nginx    │ (负载均衡 + gzip + 静态资源 + 安全头)
                        └─────┬──────┘
                              │ /api/ 轮询
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ PM2 实例1 │   │ PM2 实例2 │   │ PM2 实例N │   (cluster 模式，CPU 核数)
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             └──────────────┼──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ MySQL 主库    │◀─▶│ MySQL 从库    │   │ Redis 主+哨兵 │
  │ (读写/写)     │   │ (只读/报表)   │   │ 1主2从+3哨兵   │
  └──────────────┘   └──────────────┘   └──────────────┘
```

## 2. 前置准备

- Node.js 18+ / npm、PM2（`npm i -g pm2`）、Nginx、MySQL 8、Redis 7
- 代码与依赖：
  ```bash
  cd LocalMiniDrama_web
  npm install
  cd backend-node && npm install --production
  ```

## 3. 数据库初始化（主库）

```bash
# 1) 建库（utf8mb4）
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS localminidrama DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
# 2) 配置生产账号并授权
mysql -uroot -p < deploy/mysql-replication.sql
# 3) 首次启动会自动执行 migrations/*.sql（幂等），亦可用显式迁移：
cd backend-node && npm run migrate
```

## 4. 配置生产环境

```bash
cd backend-node/configs
cp config.production.yaml config.yaml
# 编辑：数据库口令 / CORS 域名 / storage.base_url / Redis 哨兵信息
```

## 5. 启动后端（PM2 集群）

```bash
cd backend-node
pm2 start ecosystem.config.js        # 按 CPU 核数启动集群
pm2 save && pm2 startup              # 开机自启
pm2 reload localminidrama-api        # 部署新版本后零停机重载
```

健康检查：`curl http://127.0.0.1:5679/health` 返回 `{"success":true,...}`。

## 6. Nginx 负载均衡

```bash
cp deploy/nginx.conf /etc/nginx/conf.d/localminidrama.conf
# 按实际域名/静态路径修改后：
nginx -t && systemctl reload nginx
```

## 7. MySQL 主从

见 `deploy/mysql-replication.sql` 内注释（主库开 binlog → 全量 dump → 从库 CHANGE MASTER → START SLAVE → SHOW SLAVE STATUS 双 Yes）。

## 8. Redis 哨兵

见 `deploy/redis-sentinel.conf` 注释（三节点，quorum=2，主故障自动切换）。本项目 Bull 队列与缓存对 Redis 短时不可用有内存降级，哨兵切换期间业务不中断。

## 9. 监控与告警（S16-T05）

- 管理端「系统监控大屏」：`GET /api/v1/admin/monitor/snapshot`、`history`
- 全链路运维快照：`GET /api/v1/admin/monitor/ops`（DB/队列/API/前端错误）
- 全链路异常扫描告警：`POST /api/v1/admin/monitor/ops-scan`
- 前端错误上报自动入 `frontend_error_logs`，管理端分页查看

## 10. 性能与安全验证（发布门禁）

```bash
# 压测（并发 100、5s，结果落 MySQL perf_test_results）
cd backend-node && node scripts/loadtest/run-perf.js
# 安全扫描（结果落 MySQL security_scan_results，发现 fail 返回 1）
cd backend-node && node test/security/security-scan.js
```

## 11. 发布 Checklist（S16-T07）

- [ ] 全量回归测试通过：`cd backend-node && node --test --test-concurrency=1 test/*.test.js`
- [ ] 生产配置替换完成（无默认口令）
- [ ] PM2 集群健康、Nginx 转发正常
- [ ] 压测 SLO：P99 < 500ms（`perf_test_results` 查询确认）
- [ ] 安全扫描 0 fail（`security_scan_results` 查询确认）
- [ ] 监控告警通道可用（ops-scan 触发一次验证）
- [ ] 帮助中心上线、文档齐备
