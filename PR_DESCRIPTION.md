# PR: 前端项目拆分 — CORS 适配与部署文档完善

## 变更类型

- [x] fix（修复缺陷）
- [x] docs（文档更新）
- [x] refactor（代码重构/清理）

## 关联 Commit

| Commit | 说明 |
|--------|------|
| `ccbd7401` | refactor: 移除旧前端 frontweb 目录，完成前端项目拆分清理 |
| `2b05f5d4` | fix(cors): 适配前端双项目拆分，更新 CORS 白名单与部署文档 |

## 变更背景

项目原先为单一前端 `frontweb/`（端口 3013），已拆分为两个独立前端项目：

| 项目 | 目录 | 端口 | 用途 |
|------|------|------|------|
| 用户端 | `front-user/` | 3013 | 短剧创作工具（项目列表/画布/AI 生成） |
| 管理端 | `front-admin/` | 3014 | 运营管理后台（用户/财务/系统管理） |

共享代码提取至 `packages/shared/`（`@localmini/shared`），使用 npm workspaces 管理依赖。

## 变更内容

### 1. CORS 白名单修复（`backend-node/configs/config.yaml`）

**问题**：旧配置仅允许 `localhost:3012` 和 `localhost:3013`，管理端 3014 缺失，生产环境直连后端时跨域被拦截。

**修复**：
```yaml
# 修复前
cors_origins:
  - http://localhost:3012
  - http://localhost:3013

# 修复后
cors_origins:
  - http://localhost:3013
  - http://localhost:3014
  - http://127.0.0.1:3013
  - http://127.0.0.1:3014
```

### 2. 旧 frontweb 目录清理

- 删除 `frontweb/`（158MB，153 文件）
- 更新 10 个文件中的 `frontweb` → `front-user` 引用：
  - `backend-node/src/app.js`（静态资源服务路径）
  - `desktop/main.js`、`desktop/scripts/copy-front.js`
  - `desktop/package.json`、3 份 electron-builder 配置
  - `backend-node/src/utils/dramaStyleMerge.js`、`constants/generationStylePresets.js`（注释）
  - `AGENTS.md`（项目结构说明）

### 3. 前端构建修复

- 修复 3 个文件 `UploadFilled` 图标错误导入（`element-plus` → `@element-plus/icons-vue`）
- 消除 `front-user/src/utils/mediaUrl.js` 重复代码，改为从 `@localmini/shared` 重新导出

### 4. 文档更新

- `README.md`：更新源码开发指南为 npm workspaces 模式，新增依赖一致性检查与项目拆分维护章节
- `AGENTS.md`：更新项目结构、端口配置、构建命令

## 验证结果

| 验证项 | 结果 |
|--------|------|
| front-user 构建 | ✅ 成功（9.53s） |
| front-admin 构建 | ✅ 成功（10.46s） |
| front-user dev (3013) | ✅ HTTP 200，页面正常加载 |
| front-admin dev (3014) | ✅ HTTP 200，页面正常加载 |
| 后端 5679 admin-test | ✅ HTTP 200 |
| 3013 → /api 代理 | ✅ 正常 |
| 3014 → /api 代理 | ✅ 正常 |
| CORS 预检 3013 | ✅ Allow-Origin 返回 |
| CORS 预检 3014 | ✅ Allow-Origin 返回 |
| CORS 预检 3015（未授权） | ✅ 无 Allow-Origin，拦截生效 |
| 未登录访问 /admin/stats | ✅ HTTP 401 |
| 后端日志（重启后） | ✅ 无 ERROR / 无 unhandled error |

## 依赖一致性

两个前端所有共享依赖实际安装版本完全一致（npm workspaces 自动去重）：

| 依赖 | 版本 |
|------|------|
| vue | 3.5.41 |
| vue-router | 4.6.4 |
| pinia | 2.3.1 |
| element-plus | 2.14.4 |
| @element-plus/icons-vue | 2.3.2 |
| axios | 1.19.0 |
| vite | 5.4.21 |
| @vitejs/plugin-vue | 5.2.4 |

## 破坏性变更

- `frontweb/` 目录已删除，如有外部脚本引用需同步更新
- 后端静态资源路径从 `frontweb/dist` 变更为 `front-user/dist`
- CORS 不再允许 `localhost:3012`（该端口无对应服务）

## 回滚方案

详见 [docs/deployment-guide.md](docs/deployment-guide.md) 的「回滚步骤」章节。
