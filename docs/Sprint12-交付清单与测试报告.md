# Sprint 12 交付清单与测试报告

> 主题：素材管理 + 对象存储 + 后台深度运营（M3 里程碑）
> 报告日期：2026-08-12
> 数据库：本地真实 MySQL 8（库 `localminidrama`），SQLite 兼容层（`better-sqlite3`）
> 技术栈：纯 JS（无 TS）· 后端 Express（`backend-node/`, :5679）· 管理后台 Vue3+Vite+Element Plus（`front-admin/`, :3014）· 用户端 Vue3（`front-user/`, :3013）

---

## 一、任务完成总览

| 编号 | 任务 | 类型 | 状态 |
|------|------|------|------|
| S12-T01 | 素材智能标签系统 | 后端/前端 | ✅ 完成 |
| S12-T02 | 三级素材库（项目/个人/团队） | 后端/前端 | ✅ 完成 |
| S12-T03 | 存储层抽象与对象存储迁移 | 后端 | ✅ 完成 |
| S12-T04 | 用户生命周期管理 | 后端/前端 | ✅ 完成 |
| S12-T05 | 财务与计费增强（含欠费闭环补齐） | 后端/前端 | ✅ 完成 |
| S12-T06 | 系统监控大屏 | 前端 | ✅ 完成 |
| S12-T07 | 权限与安全增强 | 后端/前端 | ✅ 完成 |
| S12-T08 | 数据分析平台 | 后端/前端 | ✅ 完成 |

**8/8 全部验收通过。**

---

## 二、交付清单（按层次）

### 2.1 数据库迁移（`backend-node/migrations/`）

| 文件 | 说明 |
|------|------|
| `45_s12_material_storage_ops.sql` | S12 全部表：`material_tags`/`material_tag_relations`、三库表作用域列、`billing_rules`/`finance_daily_reports`、`user_lifecycle`、`system_metric_snapshots`、`storage_objects` 等 |
| `46_s12_fix_churn_risk_type.sql` | 修复 `user_lifecycle.churn_risk` 列类型（FLOAT→VARCHAR(12)，避免字符串风险标签被 MySQL 截断为 0）；`migrate.js` 增加 SQLite 不支持 MODIFY/CHANGE 的安全跳过分支 |
| `47_s12_finance_notifications.sql` | 平台级站内通知表 `platform_notifications`（承载欠费/平台级通知，`dedup_key` 唯一索引做幂等）——支撑欠费闭环「触发通知」 |

### 2.2 后端服务（`backend-node/src/services/`）

| 文件 | 覆盖任务 | 核心能力 |
|------|----------|----------|
| `materialTagService.js` | S12-T01 | 五维度智能标签（AI 优先 + 规则降级）、标签落库幂等、按标签检索、词典统计、手动增删 |
| `libraryScopeService.js` | S12-T02 | 三级库作用域切换（project/personal/team）、跨项目复用（连带复制标签）、作用域概览 |
| `storage/StorageAdapter.js` + `LocalAdapter.js` + `MinIOAdapter.js` + `index.js` | S12-T03 | 统一读写契约（put/get/delete/exists/publicUrl/healthCheck）；Local 完整可用、MinIO（S3 协议）惰性可选；工厂返回单例 |
| `storageObjectService.js` | S12-T03 | 对象台账管理与生命周期扫描 |
| `userLifecycleService.js` | S12-T04 | 健康分模型（活跃 40+充值 25+消费 20+新鲜度 15）、阶段判定、流失风险分级、画像标签 |
| `financeService.js` | S12-T05 | 实时成本核算、收入/积分收支、毛利/ARPU、智能计费规则（`computeCharge`）、财务日报；**欠费闭环新增 `getUserBalance` / `notifyArrears`（幂等）/ `arrearsWarnings`（识别）** |
| `systemMonitorService.js` | S12-T06 | 采集 CPU/内存/磁盘/负载 + API 指标 + 队列积压，周期采样落库 |
| `securityService.js` | S12-T07 | 数据脱敏（手机/邮箱/身份证/银行卡）、字段级权限、操作审计、登录日志 |
| `analyticsService.js` | S12-T08 | 用户行为分析、创作漏斗、模型效果、留存分析（cohort d1/d7/d30） |

### 2.3 后端中间件与路由（`backend-node/src/`）

| 文件 | 说明 |
|------|------|
| `middleware/balanceGuard.js` | **欠费闭环「限权」核心**——工厂中间件，余额 < 阈值拦截 403，super_admin 豁免，未登录放行，异常 fail-open |
| `routes/index.js` | 实例化 `requireSufficientBalance` 并接入 15 个核心图片/视频生成 POST 路由 |
| `routes/finance.js` | 财务接口，**新增 `POST /admin/finance/arrears/notify`** 触发欠费通知 |
| `routes/lifecycle.js` | 生命周期概览/画像/流失预警/重算/前台埋点 |
| `routes/monitor.js` | 监控快照/历史/手动采样 |
| `routes/security.js` | 审计日志/审计统计/登录日志/登录统计 |
| `routes/analytics.js` | 概览/行为/漏斗/模型效果/留存 |
| `routes/storage.js` | 对象列表/统计/健康/生命周期扫描/删除 |

### 2.4 前端（`front-admin/src/`）

| 视图 | 覆盖任务 | API 模块 |
|------|----------|----------|
| `views/content-asset/MaterialTags.vue` | S12-T01/T02 | — |
| `views/user-team/UserLifecycle.vue` | S12-T04 | `api/lifecycle.js` |
| `views/finance/Overview.vue` | S12-T05 | `api/finance.js` |
| `views/system/Monitor.vue`（ECharts 实时曲线） | S12-T06 | `api/monitor.js` |
| `views/system/OperationLogs.vue` + `views/system/LoginLogs.vue` | S12-T07 | `api/security.js` |
| `views/operation/DataAnalytics.vue`（五大分析区） | S12-T08 | `api/analytics.js` |

### 2.5 测试数据脚本（`backend-node/scripts/`）

| 文件 | 说明 |
|------|------|
| `seed_s12_ops_test_data.sql` + `.js` | 6 名测试用户（99510~99515）+ 行为/积分/充值/AI 调用/登录/审计日志 + 5 条计费规则 + 7 天财务日报 + 系统指标快照；runner 依真实行为计算生命周期画像入库 |
| `seed_s12_material_test_data.sql` + `.js` | 素材管理模块测试数据（三级库/标签），落地本地 MySQL |
| `verify_s12_arrears_warning.js` | **欠费闭环端到端验证脚本**（真实 MySQL，临时用户，结束清理，5/5 全绿） |

---

## 三、S12-T05 欠费闭环专项（本次重点补齐）

### 3.1 背景
原 `arrearsWarnings` 仅为只读检测（识别负余额，分 `arrears`/`low` 两级），**既不触发通知，也不限制创作权限**。经全代码核查确认生成/创作路径无任何余额预检守卫，遂补齐完整闭环。

### 3.2 三段闭环

| 环节 | 实现 |
|------|------|
| **识别** | `arrearsWarnings`（最新 `point_logs.balance_after` < 阈值）+ 新增 `getUserBalance`（统一余额口径，无流水返回 0） |
| **通知** | `platform_notifications` 表（migration 47）+ `notifyArrears`（`dedup_key = arrears:{uid}:{yyyymmdd}` 先查后插，同日幂等；欠费 `critical`、低额 `warning`）+ `POST /admin/finance/arrears/notify` |
| **限权** | `balanceGuard` 中间件（余额<阈值拦截 403；super_admin 豁免；未登录放行；异常 fail-open）接入 15 个生成路由 |

> 架构说明：因既有 `collaboration_notifications` 表强依赖 `drama_id`（NOT NULL），不适合承载平台级欠费通知，故独立建 `platform_notifications` 表。限权不逐一改写各生成端点，而是做可复用工厂中间件统一接入。

### 3.3 端到端验证（真实 MySQL，`verify_s12_arrears_warning.js`）

| 验证项 | 结果 |
|--------|------|
| [1] 欠费识别（level=arrears） | ✅ 通过 |
| [2] 自动触发站内通知 | ✅ 通过 |
| [2b] 通知同日幂等（重复触发不重复推送） | ✅ 通过 |
| [3] 限制创作权限（欠费用户被拦截 403） | ✅ 通过 |
| [4] 不误伤（正常用户放行） | ✅ 通过 |

---

## 四、测试报告

### 4.1 单元测试

| 文件 | 覆盖 | 项数 | 结果 |
|------|------|------|------|
| `test/s12MaterialStorage.test.js` | S12-T01~T03 | 20 | 全绿 |
| `test/s12OpsServices.test.js` | S12-T04/T05/T07/T08 | 17 | 全绿 |

`s12OpsServices.test.js` 新增的欠费闭环用例：
- `getUserBalance`：取最新 `point_logs.balance_after`（无流水返回 0）
- `notifyArrears`：欠费用户写入通知且同日幂等
- `balanceGuard`：欠费拦截 403 / 正常放行 / super_admin 豁免 / 未登录放行

> 全部连接本地真实 MySQL（无 mock），使用高位测试 ID（drama 99601/99602、用户 99510~99615、欠费闭环 99590/99591/99598/99599）隔离，`after`/`finally` 精确清理，不污染业务数据。

### 4.2 全量回归

```
node --test test/*.test.js
# tests 572
# suites 92
# pass 572
# fail 0
# cancelled 0
# skipped 0
```

**572 tests，全部通过，0 失败。**（较 Sprint 11 的 533，新增 39 项 S12 单测）

### 4.3 附带修复：libraryDedup 跨库兼容缺陷

- **问题**：`src/services/libraryDedup.js` 的 `hasColumn` 无条件使用 MySQL 专用 `INFORMATION_SCHEMA.COLUMNS`，在 SQLite 内存库下报 `no such table`（`SQLITE_ERROR`），导致 `libraryDedup.test.js` 原有 3 项失败。**属既有缺陷，与本 Sprint 改动无关。**
- **修复**：按 `db.type` 分支——MySQL 走 `INFORMATION_SCHEMA.COLUMNS`，SQLite 走 `PRAGMA table_info`（表名经 `assertKnownTable` 白名单校验，无注入风险）。
- **验证**（原生 better-sqlite3 实例）：
  - 列存在 → 正常写入 source_id ✅
  - 列缺失 → 该字段被过滤，不报错 ✅
  - 未知表 → 白名单拦截抛错 ✅
- **效果**：全量回归由 569 pass / 3 fail → **572 pass / 0 fail**。

---

## 五、SQLite 兼容性排查结论（补充）

本次顺带对 `backend-node/src/` 运行时 SQL 做了 MySQL 专用语法排查，供后续参考（**非本 Sprint 范围，仅记录，未改动**）：

- **已保护（安全）**：`editService.js`/`audioAlignService.js` 的 `INFORMATION_SCHEMA`/`DESCRIBE`（try/catch 回退 PRAGMA）；`financeService`/`analyticsService`/`versionService`/`admin` 的 `DATE_FORMAT`（`db.type` 分支到 `strftime`）；部分 `INSERT IGNORE`（`characterGenerationService`/`dramaService`/`dramaImportService:210`/`admin:63`，分支到 `INSERT OR IGNORE`）；`libraryDedup`（本次已修复）。反引号、`COALESCE`、`CURRENT_TIMESTAMP` 两库通用。
- **潜在未保护（SQLite 环境风险，建议后续处理）**：
  - `ON DUPLICATE KEY UPDATE` 无分支：`settingsService.js:66,83`、`promptOverridesService.js:23,25`
  - `INSERT IGNORE` 无分支：`storyboardService.js:38,128`、`propService.js:115`、`dramaImportService.js:359`、`episodeStoryboardService.js`（多处）
  - `NOW()`/`DATE_ADD`/`INTERVAL` 无分支：`collaborationService.js`（节点锁）、`videoService.js:39`、`admin.js:525,586`

> 注：当前生产/开发均以 MySQL 为主库，上述风险仅在切换 SQLite 时暴露。是否修复由团队按 SQLite 支持目标决定。

---

## 六、结论

Sprint 12 全部 8 项任务验收通过，S12-T05 欠费闭环（识别→通知→限权）补齐并端到端验证 5/5 全绿，39 项 S12 单测全绿，**全量回归 572/572 全绿**，全部测试数据落地本地 MySQL 且用后即清。附带修复 `libraryDedup` 跨库兼容缺陷。**M3 里程碑达成。**
