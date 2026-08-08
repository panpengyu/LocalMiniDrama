# 部署操作手册 — 前端项目拆分

> 适用版本：前端拆分为 `front-user` + `front-admin` 后的部署  
> 最后更新：2026-08-08  
> 维护者：LocalMiniDrama 团队

---

## 目录

1. [架构概览](#1-架构概览)
2. [端口映射表](#2-端口映射表)
3. [前置条件](#3-前置条件)
4. [部署步骤](#4-部署步骤)
   - 4.1 后端配置修改
   - 4.2 前端构建
   - 4.3 启动服务
   - 4.4 验证
5. [回滚步骤](#5-回滚步骤)
6. [常见问题排查](#6-常见问题排查)

---

## 1. 架构概览

```
                    ┌──────────────────────────────────┐
                    │        npm workspaces            │
                    │  ┌─────────┐  ┌──────────┐       │
  浏览器 ──────────►│  │front-user│  │front-admin│      │
  :3013 (用户端)    │  │  (3013) │  │  (3014)  │      │
  :3014 (管理端)    │  └────┬────┘  └────┬─────┘      │
                    │       │            │             │
                    │       ▼            ▼             │
                    │  ┌─────────────────────┐         │
                    │  │ packages/shared     │         │
                    │  │ @localmini/shared   │         │
                    │  └─────────────────────┘         │
                    └──────────────────────────────────┘
                              │ Vite proxy /api, /static
                              ▼
                    ┌──────────────────────┐
                    │  backend-node (5679) │
                    │  Express + MySQL     │
                    │  静态资源: front-user/dist │
                    └──────────────────────┘
```

## 2. 端口映射表

| 服务 | 目录 | 端口 | 启动命令 | 说明 |
|------|------|------|---------|------|
| 后端 API | `backend-node/` | 5679 | `npm run dev` | Express + MySQL，提供 API 和静态资源 |
| 用户端前端 | `front-user/` | 3013 | `npm run dev:user` | Vite dev server，proxy → 5679 |
| 管理端前端 | `front-admin/` | 3014 | `npm run dev:admin` | Vite dev server，proxy → 5679 |
| MySQL | — | 3306 | 系统服务 | 数据库 localminidrama |

### CORS 白名单（config.yaml）

```yaml
cors_origins:
  - http://localhost:3013   # 用户端
  - http://localhost:3014   # 管理端
  - http://127.0.0.1:3013   # 用户端（IP 访问）
  - http://127.0.0.1:3014   # 管理端（IP 访问）
```

> **生产环境**：将上述地址替换为实际域名，如 `https://app.example.com` 和 `https://admin.example.com`。

## 3. 前置条件

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18 |
| MySQL | 8.0+，运行在 localhost:3306，账号 root/root |
| 数据库 | `localminidrama` 已创建（首次部署执行 `npm run migrate`） |
| 端口可用 | 3013、3014、5679、3306 无冲突 |
| 代码 | 已拉取包含 commit `2b05f5d4` 的代码 |

## 4. 部署步骤

### 4.1 后端配置修改

#### 4.1.1 检查 config.yaml

```bash
cat backend-node/configs/config.yaml
```

确认 `cors_origins` 包含 3013 和 3014（见上方白名单）。

如需修改：

```bash
vim backend-node/configs/config.yaml
```

#### 4.1.2 确认静态资源路径

后端 `app.js` 已配置从 `front-user/dist` 提供静态资源：

```javascript
// backend-node/src/app.js L369
const webDist = process.env.WEB_DIST_PATH || path.join(process.cwd(), '..', 'front-user', 'dist');
```

> 生产环境可通过环境变量 `WEB_DIST_PATH` 指定自定义路径。

### 4.2 前端构建

#### 4.2.1 安装依赖（首次或依赖变更时）

```bash
cd /path/to/LocalMiniDrama_web
npm install
```

npm workspaces 会自动安装 `front-user`、`front-admin`、`packages/shared` 的依赖。

#### 4.2.2 构建前端

```bash
# 方式一：一键构建两个前端
npm run build:all

# 方式二：分别构建
npm run build:user    # front-user → front-user/dist/
npm run build:admin   # front-admin → front-admin/dist/
```

#### 4.2.3 验证构建产物

```bash
ls -la front-user/dist/index.html   # 应存在
ls -la front-admin/dist/index.html  # 应存在
```

### 4.3 启动服务

#### 4.3.1 开发模式（dev）

```bash
# 终端 1：后端
cd backend-node && npm run dev

# 终端 2：用户端
npm run dev:user

# 终端 3：管理端
npm run dev:admin
```

#### 4.3.2 生产模式

```bash
# 1. 构建前端
npm run build:all

# 2. 启动后端（自动服务 front-user/dist）
cd backend-node
NODE_ENV=production node src/server.js
```

> 生产环境管理端 `front-admin/dist` 需通过 Nginx 等反向代理单独服务。

#### 4.3.3 Nginx 反向代理参考（生产环境）

```nginx
# 用户端
server {
    listen 80;
    server_name app.example.com;
    root /path/to/front-user/dist;
    location / { try_files $uri /index.html; }
    location /api { proxy_pass http://127.0.0.1:5679; }
    location /static { proxy_pass http://127.0.0.1:5679; }
}

# 管理端
server {
    listen 80;
    server_name admin.example.com;
    root /path/to/front-admin/dist;
    location / { try_files $uri /index.html; }
    location /api { proxy_pass http://127.0.0.1:5679; }
    location /static { proxy_pass http://127.0.0.1:5679; }
}
```

> 使用 Nginx 反向代理时，前端请求 `/api` 由 Nginx 转发，不触发 CORS。  
> 仅当浏览器直连后端 5679 时才需要 CORS 白名单。

### 4.4 验证

#### 4.4.1 服务状态检查

```bash
# 后端
curl -s http://localhost:5679/api/v1/admin-test
# 预期: {"success":true,"message":"admin test","user":null}

# 用户端页面
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3013/dashboard
# 预期: HTTP 200

# 管理端页面
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3014/dashboard
# 预期: HTTP 200
```

#### 4.4.2 API 代理验证

```bash
# 用户端代理
curl -s http://localhost:3013/api/v1/admin-test
# 预期: {"success":true,...}

# 管理端代理
curl -s http://localhost:3014/api/v1/admin-test
# 预期: {"success":true,...}
```

#### 4.4.3 CORS 预检验证

```bash
# 3013（应返回 Allow-Origin）
curl -s -I -X OPTIONS \
  -H "Origin: http://localhost:3013" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:5679/api/v1/admin-test | grep -i access-control-allow-origin

# 3014（应返回 Allow-Origin）
curl -s -I -X OPTIONS \
  -H "Origin: http://localhost:3014" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:5679/api/v1/admin-test | grep -i access-control-allow-origin
```

#### 4.4.4 权限验证

```bash
# 未登录访问管理端 API（应返回 401）
curl -s http://localhost:5679/api/v1/admin/stats
# 预期: {"success":false,"error":{"code":"UNAUTHORIZED","message":"请先登录"}}
```

#### 4.4.5 后端日志检查

```bash
# 查看最近日志
tail -30 backend-node/data/dev.log

# 检查是否有 ERROR
grep "ERROR" backend-node/data/dev.log | tail -10
```

> 正常情况下不应有 `Unhandled error` 或 500 状态码。  
> `auth/login 密码错误` 属于业务日志，非系统异常。

## 5. 回滚步骤

### 5.1 回滚到 frontweb 单前端架构

如果新架构出现问题，可回滚到拆分前的状态。

#### 5.1.1 Git 回滚

```bash
# 查看提交历史
git log --oneline -5

# 方式一：revert（安全，保留历史）
git revert 2b05f5d4   # 回滚 CORS 修复
git revert ccbd7401   # 回滚 frontweb 删除

# 方式二：reset（危险，丢弃历史，仅紧急情况使用）
# git reset --hard a226d0cc   # 回到拆分前的提交
```

#### 5.1.2 恢复 frontweb 目录

```bash
# 从 git 历史恢复
git checkout a226d0cc -- frontweb/

# 重新安装依赖
cd frontweb && npm install
```

#### 5.1.3 恢复后端配置

```bash
# 恢复 config.yaml 的 CORS 为旧配置
vim backend-node/configs/config.yaml
# 改回：
# cors_origins:
#   - http://localhost:3012
#   - http://localhost:3013

# 恢复 app.js 静态资源路径
vim backend-node/src/app.js
# 改回：path.join(process.cwd(), '..', 'frontweb', 'dist')
```

#### 5.1.4 重启服务

```bash
# 重启后端
kill $(lsof -ti :5679)
cd backend-node && npm run dev &

# 启动旧前端
cd frontweb && npm run dev
```

### 5.2 仅回滚 CORS 配置（保留拆分架构）

```bash
# 恢复旧 CORS 配置
git checkout a226d0cc -- backend-node/configs/config.yaml

# 重启后端
kill $(lsof -ti :5679)
cd backend-node && npm run dev &
```

### 5.3 仅回滚前端构建（保留后端配置）

```bash
# 使用旧前端构建
cd frontweb && npm run build

# 临时修改后端静态资源路径
export WEB_DIST_PATH=/path/to/frontweb/dist
cd backend-node && npm run dev
```

## 6. 常见问题排查

### 6.1 管理端页面空白 / API 跨域被拦截

**症状**：浏览器控制台报 CORS 错误

**排查**：
```bash
# 检查 config.yaml 是否包含 3014
grep 3014 backend-node/configs/config.yaml
```

**修复**：在 `cors_origins` 中添加 `http://localhost:3014`，重启后端。

### 6.2 前端构建失败：UploadFilled 导入错误

**症状**：`SyntaxError: The requested module 'element-plus' does not provide 'UploadFilled'`

**原因**：`UploadFilled` 是图标组件，应从 `@element-plus/icons-vue` 导入。

**修复**：
```javascript
// 错误
import { ElMessage, UploadFilled } from 'element-plus'

// 正确
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
```

### 6.3 后端静态资源 404

**症状**：访问 `http://localhost:5679` 返回 404

**排查**：
```bash
# 检查 front-user/dist 是否存在
ls front-user/dist/index.html

# 检查后端日志中的 webDist 路径
grep webDist backend-node/data/dev.log
```

**修复**：执行 `npm run build:user` 重新构建。

### 6.4 依赖版本不一致

**症状**：两个前端运行行为不一致

**排查**：
```bash
npm ls vue vue-router pinia element-plus --workspace front-user
npm ls vue vue-router pinia element-plus --workspace front-admin
```

**修复**：
```bash
npm dedupe
# 或强制重装
rm -rf node_modules package-lock.json && npm install
```

### 6.5 Token 串号（用户端和管理端登录态互相影响）

**症状**：在管理端登录后，用户端也显示已登录

**排查**：检查浏览器 localStorage，确认 key 名称：
- 用户端：`user_token`、`user_info`
- 管理端：`admin_token`、`admin_info`

**修复**：确认 `stores/user.js` 和 `stores/adminUser.js` 使用了不同的 `tokenKey`。

---

## 附录：相关文件清单

| 文件 | 说明 |
|------|------|
| `backend-node/configs/config.yaml` | CORS 白名单、数据库连接、服务端口 |
| `backend-node/src/app.js` | 静态资源服务路径（front-user/dist） |
| `front-user/vite.config.js` | 用户端 Vite 配置（端口 3013，proxy 5679） |
| `front-admin/vite.config.js` | 管理端 Vite 配置（端口 3014，proxy 5679） |
| `packages/shared/src/index.js` | 共享包入口（createRequest / useTheme / mediaUrl） |
| `front-user/src/stores/user.js` | 用户端 store（tokenKey: user_token） |
| `front-admin/src/stores/adminUser.js` | 管理端 store（tokenKey: admin_token） |
| `AGENTS.md` | AI 助手项目指引 |
| `README.md` | 项目说明与开发指南 |
