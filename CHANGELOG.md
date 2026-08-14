# Changelog

所有版本的重要改动记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

**官方仓库：**
[![GitHub](https://img.shields.io/badge/GitHub-xuanyustudio%2FLocalMiniDrama-181717?logo=github)](https://github.com/xuanyustudio/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee)](https://gitee.com/bi_shang_a/localminidrama)

---

## [1.4.0] - 2026-08-14

### Sprint 15 — API 开放平台

#### 新增

- **S15-T01 API Key 管理系统**（`src/services/apiKeyService.js` + `src/routes/apiKeys.js` + `migrations/51_s15_api_platform.sql`）：
  - 开发者应用：申请创建 / 我的应用列表 / 详情 / 管理端分页与审批（驳回/通过/重复审批拦截/未审批不可建 Key），软删除留痕
  - 管理端审批界面（`front-admin/src/views/system/OpenPlatformApps.vue`，路由 `/system/open-platform-apps`）：应用状态筛选与关键词搜索、通过/驳回（可填原因）、应用详情与密钥脱敏列表（scope/限流/配额/有效期）
  - API 密钥：`sha256` 哈希落库 + 前缀展示 + 明文仅创建时返回一次、状态机（active/revoked）、吊销与续期、限流(次/分)/配额(次/日)/有效天数/IP 白名单落库
  - 权限范围白名单 `API_SCOPES`：`drama:read / drama:write / screenplay:generate / image:generate / asset:read`；IP 白名单支持精确 / `*` 通配 / IPv4 CIDR
  - 数据迁移：5 张表 `api_apps / api_keys / api_call_logs / api_daily_usage / api_rate_windows`
- **S15-T02 API 网关与限流**（`src/middleware/apiGateway.js`）：
  - 统一鉴权：`X-API-Key` / `Bearer` 提取 → 哈希比对密钥 → 状态/有效期/IP 白名单校验 → 每分钟限流 + 每日配额（原子累加落库）
  - 调用全量留痕：成功/失败均写 `api_call_logs`（端点/方法/scope/状态码/错误码/IP/耗时），配额与限流写入 `api_daily_usage` / `api_rate_windows`
  - 错误码：`MISSING_API_KEY / INVALID_API_KEY / API_KEY_EXPIRED / API_KEY_REVOKED / API_KEY_INACTIVE / IP_DENIED / SCOPE_NOT_ALLOWED / RATE_LIMITED / DAILY_QUOTA_EXCEEDED`
- **S15-T03 开放 API 接口**（`src/routes/openApi.js`，挂载 `/api/v1/open/*`）：
  - 项目管理：`GET/POST /dramas`、`GET /dramas/:id`（复用 `dramaService`，数据归属 API Key 用户）
  - 剧本生成：`POST /screenplay/outlines`、`/screenplay/characters`（复用 `screenwriterService`）
  - 图片生成：`POST /images`（异步返回 task_id）、`GET /images/:id`（复用 `imageService` / `taskService`）
  - 素材查询：`GET /assets`（复用 `assetService`）；全部接口走网关鉴权 + scope 校验
- **S15-T04 在线文档 + 多语言 SDK**：
  - Swagger/OpenAPI 3.0：`src/routes/openApiSpec.js` + `openDocs.js`，Swagger UI 挂载 `/api/v1/open/docs`、纯 JSON `/open/docs/openapi.json`
  - Node.js SDK（`sdks/node`，`@localmini/open-api`，Node 18+ 内置 fetch、零依赖）：8 个方法覆盖全部开放接口 + `OpenApiError` 统一异常
  - Python SDK（`sdks/python`，`localmini-openapi`，仅标准库）：对应 8 个方法 + `OpenApiRateLimitError`/`OpenApiPermissionError`
- **S15-T05 开发者控制台**（`front-user/src/views/DeveloperCenter.vue` + `api/openPlatform.js`，路由 `/developer`）：
  - 密钥管理：创建应用（提交审批）、为已通过应用生成密钥（选 scope/限流/配额/天数/IP 白名单）、密钥列表（脱敏）、吊销/续期、明文仅展示一次
  - 调用统计：概览卡片（累计/今日调用/今日错误）+ 调用趋势（近 7/14/30 天柱状图）
  - 配额监控：各密钥当日配额使用率进度条（读 `api_daily_usage`）
  - 错误日志：失败调用分页表格（状态码/错误码/端点/密钥/耗时）
  - 后端统计端点：`GET /open-platform/stats/overview|trend|errors`（`apiKeyService` 的 `getCallOverview/getCallTrend/getErrorLogs` 实时聚合）

#### 测试

- `test/s15ApiKeyManagement.test.js`：11 项（Key 管理 + 开发者控制台统计），真实 MySQL
- `test/s15ApiGateway.test.js`：11 项（网关鉴权/限流/配额/留痕），真实 MySQL
- `test/s15OpenApi.test.js`：9 项（开放 API 认证/scope/项目管理/素材查询，真实 HTTP 集成），真实 MySQL
- `sdks/node/test/smoke.test.js`：Node SDK 冒烟（鉴权头/解包/错误归一化）
- `sdks/python/tests/test_client.py`：Python SDK 冒烟（5 项）

---

## [1.3.0] - 2026-08-13

### Sprint 14 — 模板市场（创作者生态）

#### 新增

- **S14-T01 模板市场后端**（`src/services/marketplaceService.js` + `src/routes/marketplace.js`）：
  - 市场模板列表：分类/关键词/创作者/状态过滤 + `latest` / `popular` / `rating` / `price` 排序 + 分页，默认仅展示 `listed` 在售模板
  - 分类聚合计数、模板详情（含创作者信息、评分聚合、当前用户 `acquired` 标记、内容体解析）
  - 免费下载与付费购买统一入口 `acquireTemplate`：幂等（重复获取返回 `alreadyOwned=true`，不重复计数/扣费/结算）、防自购 `SELF_PURCHASE`、积分不足 `INSUFFICIENT_POINTS`；计费沿用 100 积分 = 1 元换算，金额单位「元」（DECIMAL），全程真实落库
  - 应用市场模板一键建项目（复用 `dramaService` / `templateService` 的 `content_json`）
  - 评分评论：仅已获取者可评（`NOT_ACQUIRED`）、一人一评可更新、`INVALID_RATING` 校验、均分聚合刷新
  - 市场概览 `marketplaceStats`：模板/交易/收益/创作者四维聚合 + 当前平台分成比例
  - 数据迁移 `migrations/50_s14_template_marketplace.sql`：8 张 `marketplace_*` 表 + `global_settings` 写入 `marketplace_platform_rate=0.30`（平台默认抽成 30%）与 `marketplace_min_withdrawal=10`（单笔提现门槛 10 元）
- **S14-T02 模板市场前端**（`front-user/src/views/TemplateMarket.vue` + `CreatorCenter.vue` + `api/marketplace.js`）：
  - 模板画廊：分类导航 + 关键词搜索 + 排序 + 分页卡片墙 + 封面/预览图统一相对/绝对路径处理
  - 模板详情：预览图轮播 + 创作者信息 + 评分展示 + 免费下载/积分购买 + 应用生成项目 + 评分评论
  - 创作者中心：入驻申请与资料维护、我的模板发布/编辑/提交审核/审核轨迹、收益概览与流水、提现申请与记录
- **S14-T03 创作者入驻系统**（`src/services/creatorService.js`）：
  - 申请入驻 `applyCreator`：首次建档 `pending`，被驳回后重新提交回到 `pending` 并清空驳回原因，`approved` 创作者更新资料不失效；展示名必填 `EMPTY_DISPLAY_NAME`
  - 管理端认证审核 `reviewCreator`：通过写 `verified_at`、可设专属分成比例；驳回记录原因
  - `requireApprovedCreator` 守卫未认证访问抛 `CREATOR_NOT_APPROVED`
  - 创作者模板 CRUD：`createTemplate` 草稿态、`updateTemplate`、`deleteTemplate` 保护审核中模板不可删 `NOT_DELETABLE`
  - 收益概览 `earningsOverview`（销售订单/毛利/创作者收入/平台费 + 冻结中提现 + 可提现余额/累计收益/已提现）与收益流水
- **S14-T04 模板审核流程**（`src/services/templateReviewService.js`）：
  - 状态机 `draft → pending → ai_reviewing → ai_passed →（人工）listed / rejected`，另有 `delisted` 下架态
  - 提交审核前置内容非空校验 `EMPTY_TEMPLATE_CONTENT`；`submitForReview` 事务内连贯执行 AI 预审（`evaluateTemplateContent` 基于内置文本合规词库打分，命中阻断阈值直接 `rejected` 且记录原因，否则进 `ai_passed` 待人工）
  - 人工复审 `manualReview`（通过 → `listed` 写 `listed_at`；驳回需填原因 `REJECT_REASON_REQUIRED`）
  - 上下架 `setListing`（仅 `listed` 可下架，非上架态下架抛 `NOT_LISTED`，可恢复）；审核轨迹全程写 `marketplace_review_logs`
  - 管理端审核队列 `listReviewQueue` 默认聚合 `pending/ai_reviewing/ai_passed` 待处理项
- **S14-T05 模板收益分成**（`marketplaceService.settlePurchase`）：
  - 付费购买与结算同一事务内完成，按下载单去重幂等；分成比例优先取创作者专属比例（`resolveCreatorPlatformRate`），否则回落 `global_settings.marketplace_platform_rate`（默认 0.30，越界/异常回落默认）
  - 成交额拆分平台所得与创作者所得，写 `marketplace_settlements` + 创作者收益流水 `income`，原子累加可提现余额与累计收益
  - 提现闭环：申请 `requestWithdrawal`（门槛校验 `BELOW_MIN_WITHDRAWAL`、余额校验 `INSUFFICIENT_BALANCE`、收款账户校验 `NO_SETTLE_ACCOUNT`、事务内冻结余额 + 落 `pending` 单）；管理端 `reviewWithdrawal`（通过 → `paid` 写 `paid_at`、累加 `total_withdrawn`；驳回 → `rejected` 退回冻结金额到余额）
- **管理端审核工作台**（`front-admin/src/views/marketplace/ReviewWorkbench.vue`，已挂 `/marketplace/review` 路由与「模板市场」导航菜单）：市场概览指标卡（在售/待审核/累计获取/GMV/平台分成收入/认证创作者）+ 模板审核队列与审核抽屉（AI 预审明细 + 通过上架/驳回）+ 创作者认证审核（通过/驳回，可设专属分成比例）+ 提现审核（通过打款/驳回退款）+ 分成参数配置（平台抽成比例/最低提现门槛）

#### 测试

- 新增 `test/s14TemplateMarketplace.test.js`：**29 项全部通过**（真实 MySQL，复用真实 `users` 账号：2=创作者、3/4=买家；`before` 清残留、`after` 彻底级联清理 `marketplace_*` 系列表与 `point_logs`；付费购买走真实 `point_logs` 积分抵扣——无 mock、无 SQLite 内存库）
- 覆盖：创作者入驻/认证（通过·驳回·专属分成·守卫）、模板审核（内容非空/AI 预审通过与违规拦截/人工复审通过上架与驳回/上下架/审核队列/轨迹）、列表·分类·搜索·详情·免费下载幂等·评分（仅已获取·一人一评·聚合）、付费购买（防自购/积分不足/扣积分·分成结算·创作者入账/重复购买幂等/收益概览）、提现（门槛·余额·冻结·通过打款·驳回退款）、市场概览与平台参数（四维聚合/分成比例读取与越界回落/专属比例优先）
- 回归验证：后端全量 `node --test test/*.test.js` **639 tests, 639 pass（0 fail）**；`npm run build:user` 与 `npm run build:admin` 均编译成功

---

## [1.2.9] - 2026-08-10

### Sprint 7 — 智能工作流引擎 & 智能剪辑全链路

#### 新增

- **工作流引擎**（`workflowService.js`）：
  - 工作流定义 CRUD（`createDefinition` / `listDefinitions` / `getDefinition` / `updateDefinition` / `deleteDefinition`），支持步骤类型校验（`generate_outline` / `generate_characters` / `generate_episodes` / `generate_images` / `auto_edit`）、`max_retry` 范围校验（1-10）、`trigger_type` 枚举校验
  - 工作流实例全生命周期管理（`createInstance` / `runInstance` / `pauseInstance` / `resumeInstance` / `cancelInstance`），实例创建时自动预创建 `workflow_step_logs` 记录
  - 步骤级操作：`skipStep`（跳过并推进实例进度）、`retryStep`（重置失败步骤 + 恢复实例为 paused）、`reviewStep`（人工审核通过/驳回 + 自动推进进度）
  - 条件分支求值器 `evaluateCondition`，支持 `==` / `!=` / `>=` / `<=` / `>` / `<` 六种操作符，dot 路径解析 context
- **智能剪辑服务**（`editService.js`）：
  - `autoEdit` 全链路：分镜收集 → 节奏匹配 → 转场设置 → ffmpeg 命令构建 → 执行 → 落库，6 个 STAGE 分阶段日志
  - 参数校验：`resolution` 正则校验（`\d{2,5}x\d{2,5}`）、`fps` 范围校验（1-120）
  - ffmpeg 可用性预检测，不存在时降级为模拟模式
  - `resolveClipInput` 输入文件解析器：支持本地文件 / HTTP URL / color lavfi fallback（`EDIT_FALLBACK_COLOR=1` 时启用占位图）
  - `concat=v=1:a=0` 正确拼接（修复 `v=0` 导致的 ffmpeg 报错）
- **配音对齐服务**（`audioAlignService.js`）：
  - `alignStoryboard` 单条对齐 + `batchAlign` 批量对齐，支持 `stretch` / `trim` / `loop` / `silence` 四种策略
  - ffprobe 可用性检测，缺失时使用原时长降级
  - 非法 `strategy` 自动降级为 `stretch`，`audio_duration_ms` 非法时使用原时长
- **Schema 自适应层**（`editService.js` / `audioAlignService.js`）：
  - `probeSchema` 懒探测：自动检测 MySQL/SQLite 环境下的表结构差异
  - 兼容 `storyboard_dubbing` ↔ `audio_generations` 双表名
  - 兼容 `storyboards.drama_id` 列缺失（JOIN episodes 反查）
  - 兼容 `dramas.synopsis` ↔ `dramas.description`、`dramas.genre_type` ↔ `dramas.genre`
  - 兼容 `edit_tasks.simulated` 列缺失
- **路由层增强**（`workflows.js` / `edit.js`）：
  - 每条请求生成 `requestId`（`REQ#WFxxx` / `REQ#EDxxx`），记录入参、用户上下文与响应耗时
  - 权限控制：更新/删除定义时校验 ownership（创建者或超级管理员），实例操作校验项目权限
- **端到端测试**（`test_s7_e2e.js`）：
  - 10 个 Phase 全链路集成测试：初始化 → 定义创建 → 实例执行 → 条件分支 → 审核暂停 → 失败重试 → 智能剪辑 → 配音对齐 → 一致性检查 → 边界异常
  - 82 项断言，覆盖正常流程 + 非法参数 + 状态机非法跳转 + 空数据 + 权限校验

#### 修复

- **`skipStep` 不推进实例进度**：删除 `workflowService.js` 末尾的旧版重复定义（覆盖了增强版），保留带进度推进的版本（更新 `current_step_index` + `completed_steps`）
- **`retryStep` 递增 retry_count 不合理**：手动重试时重置 `retry_count=1`（表示新一轮尝试），而非在已有失败次数上累加
- **`reviewStep` 审核通过后不推进**：审核通过时更新实例 `current_step_index` + `completed_steps`，最后一步则标记实例 `completed`
- **`concat=n=5:v=0:a=0` 参数错误**：ffmpeg concat filter 的 `v=0` 表示无视频流，改为 `v=1:a=0`（每片段一路视频、无音频）
- **`batchAlign` 中 `episodeId` 未定义**：变量名拼写错误，修正为 `episode_id`
- **`evaluateCondition` 边界遗漏**（5 类）：
  - 复合表达式检测（多个操作符或 `&&` / `||` / `and` / `or`）→ WARN + safeMode
  - `leftVal` 为 undefined/null 时 WARN（路径在 context 中不存在）
  - 数值比较时 rightPart 非数字 → WARN + safeMode
  - 数值比较时 leftVal 非数字 → WARN + safeMode
  - 添加 `[WF-COND-EVAL]` 求值日志（输出解析后的左右值与比较结果）
- **条件表达式畸形时静默返回 true**：添加 `[WF-COND-WARN]` 日志，按 `safeMode` 参数处理（默认 true 保持兼容）
- **工作流定义删除时未检查进行中实例**：`deleteDefinition` 查询 `workflow_instances`，若存在 `running/paused/pending` 状态实例则抛出 `[WF-DEL-001]` 错误

#### 日志体系

- **TraceID 全链路追踪**：
  - 工作流引擎：`WF-DEF` / `WF-INST` / `WF-RUN` / `WF-REV` / `WF-SKIP` / `WF-RETRY` / `WF-DEL` / `WF-COND`
  - 智能剪辑：`EDITxxxx`，6 个 STAGE 分阶段输出（入参校验 → 收集片段 → 节奏匹配 → 构建命令 → ffmpeg 执行 → 写库返回）
  - 配音对齐：`AAL-SB` / `AAL-BATCH`
  - 路由层：`REQ#WFxxx` / `REQ#EDxxx`
- **错误码体系**：
  - `WF-DEF-001` ~ `WF-DEF-007`：定义创建参数校验
  - `WF-RUN-002` / `WF-RUN-004`：实例执行状态机防护
  - `WF-DEL-001`：删除前进行中实例检查
  - `WF-REV-001` / `WF-REV-002`：审核状态校验
  - `EDIT-000` ~ `EDIT-003` / `EDIT-ENOENT` / `EDIT-FFMPEG-FAIL`：剪辑参数/资源/工具校验
  - `AAL-000` / `AAL-001` / `AAL-BATCH-000`：对齐参数校验

#### 测试

- 单元测试：69/69 通过（`s7WorkflowService.test.js` + `s7Edit.test.js` + `s7AudioAlign.test.js`）
- E2E 集成测试：82 项，81 PASS / 1 WARN / 0 FAIL（`test_s7_e2e.js`，真实 MySQL）

---

## [1.2.8] - 2026-07-01

### 新增

- **Agnes AI 接入**：新增 `agnes` 接口协议与厂商预设，支持文本（`agnes-2.0-flash`）、图片（`agnes-image-2.1-flash`）、视频（`agnes-video-v2.0`）；AI 配置页提供「一键配置 Agnes」，一个 Key 覆盖文本 / 图片 / 视频三类服务
- **画布模式大幅增强**：
  - **剧本节点**：画布内直接预览、编辑剧本，支持 AI 生成故事与角色/场景/道具提取
  - **右键菜单 / 浮动工具栏 / 新建对话框**：可在画布上新建分镜、集、角色、场景、道具
  - **节点内操作面板**：资源节点、分镜节点、媒体节点面板完善；节点状态遮罩实时显示生成进度
  - **整集生成 composable**：`useCanvasEpisodeGenerate` 支持在画布内批量触发角色/场景/道具/分镜图/视频生成
  - **画布 CRUD**：`useCanvasCrud` 支持在画布内创建、删除实体，无需切回列表页
- **ModelArk 私有资产库配置**：新增 `model_ark_asset` 服务类型与 `modelArkAssetConfigService`，AI 配置页可管理 BytePlus ModelArk / 火山方舟私有资产库（AK/SK 签名 / Bearer 多种鉴权、资产组创建与管理）；角色 SD2 认证优先使用即梦2角色认证，未配置时回退到此处
- **图床配置项化**：`config.yaml` 的 `image_proxy` 支持自定义 `upload_url`、`upload_timeout_seconds`（默认 **180 秒**）、`upload_max_attempts`；不再硬编码上传地址与超时
- **风格缩略图扩充**：新增国风、仙侠、韩漫、都市言情等 8 种风格预览图（`public/style-thumbs/`）

### 优化

- **Seedance 2.0 认证加强**：角色 SD2 认证流程重构，支持 ModelArk 资产库对接、图床 URL 缓存复用与失效重传；`Sd2AssetManagement` 配置面板补充鉴权方式、路径模式、工程名等说明
- **图床缓存校验**：`getProxyCacheValidated` 在使用缓存 URL 前探测远端是否仍可访问，404 / 超时则删缓存并触发重新上传
- **提示词优化**：`promptI18n.js`、`framePromptService.js`、`storyGenerationService.js` 等多处提示词改进，提升剧本/分镜生成质量
- **任务服务**：新增 `taskService` 与 `/api/task` 路由，统一异步任务状态查询

### 修复

- **分镜图片数量上限**：修复分镜图片生成时数量限制未正确生效的 bug

### 文档

- 根目录 `README.md`、`docs/en.md`、`index.html`、各子包 README 同步 **v1.2.8**
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与 lock 文件顶层 **version** 统一为 **1.2.8**

---

## [1.2.7] - 2026-06-02

### 新增

- **尾帧衔接**：分镜视频区「尾帧衔接」按钮；后端 `tailFrameLinkService` 用 **ffmpeg** 提取当前镜已完成视频的末帧，写入 `image_generations` 并设为**下一镜首帧**（`first_frame_image_id` / `image_url` / `local_path`），便于镜间画面连续
- **分镜首帧 / 尾帧独立绑定**：`storyboardFrameBinding` 将尾帧写入 `last_frame_*` 字段，避免尾帧图污染分镜主图或历史记录；支持 `storyboard_first` / `storyboard_last` 等别名归一化
- **导出分镜表**：制作页一键导出当前集分镜为 **HTML 表格**（`exportStoryboardSheet`），含镜号、景别、运镜、场景/角色/道具、对白、解说、提示词、全能片段等列，便于审阅与对外协作
- **统一生成任务进度**：新增 `generationTaskStore` 与 `useGenerationTaskSync`，角色/场景/道具/分镜图（含首帧、尾帧）/分镜视频/流水线等异步任务共用轮询、去重与超时清理；刷新页面后可恢复进行中的任务状态
- **全能片段多子分镜版式统一**：`universalOmniMultiBeatFormat` 与批量分镜生成、「生成 / 润色全能提示词」共用同一套 **分镜1 / 分镜2…** 段落格式与 `@图片1` 环境约束说明
- **Seedance 2.0 角色素材守护**：`seedance2AssetGuards` 在角色主图变更时自动将已认证 `seedance2_asset` / 音色参考标为 **stale**，避免视频引用过期素材
- **媒体画幅规格**：`mediaAspectRatioSpec` 统一图片 / 视频请求的宽高比解析与归一化
- **故事生成 composable**：`useStoryGeneration` 抽离「从梗概生成剧本」流程；`scriptEpisodes` 辅助多集剧本分段

### 优化

- **全能模式生视频校验**：单条「生成 / 重新生成」视频前检测 AI 配置是否为 **`kling_omni`**，或 **`volcengine_omni` + Seedance 2.x 模型**；不匹配时弹窗说明并可选 **强制继续**（降级为仅场景图或分镜主图参考，不再走多图 Omni）
- **传统模式缺图拦截**：经典分镜在无分镜参考图时弹窗提示「需先生成或上传分镜图片」，不再提供纯文案强行生成
- **分镜 / 视频 / 导入导出**：`episodeStoryboardService`、`storyboardService`、`framePromptService`、`dramaImportService` / `dramaExportService` 等与全能字段、尾帧、提示词清洗（`framePromptSanitize`）联动优化
- **工程结构**：桌面壳统一使用仓库内 `backend-node`，移除重复的 `desktop/backend-app-secure` 副本目录

### 文档

- 根目录 `README.md`、`docs/en.md`、`index.html`、各子包 README 同步 **v1.2.7**（版本徽章、下载链接示例、最新亮点）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与 lock 文件顶层 **version** 统一为 **1.2.7**

---

## [1.2.6] - 2026-04-12

### 文档

- 根目录 `README.md`、`docs/en.md`、桌面/后端/前端 README 同步 **v1.2.6**（版本徽章、示例 exe 路径、「最新亮点」标题）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与各自 `package-lock.json` 顶层 **version** 统一为 **1.2.6**

### 说明

- 与 **v1.2.5** 相比无新增功能；主要为**桌面安装包/便携 exe 显示与产物版本号**提升至 **1.2.6**，并与仓库内各包版本对齐

---

## [1.2.5] - 2026-04-09

### 新增

- **火山方舟 Seedance 2.0 视频**：后端 `videoClient.js` 支持方舟「全能 / 多参考图」链路；**AI 配置 → 视频** 可选接口规范 **`volcengine_omni`**，模型填控制台接入点（如 `doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`，以控制台为准）；参考图按 `role: reference_image` 提交，Seedance **2.x** 时长自动吸附到 **4–15 秒**
- **分镜「全能模式」**：制作页分镜可在「经典分镜」与「全能模式」间切换；全能模式中间为**片段描述**（独立字段 `universal_segment_text` 落库），可用「根据分镜生成提示词」由文本模型生成含运镜、机位等的描述；生视频时若片段描述非空则**仅提交该段**，不拼接下方结构化「视频提示词」，避免覆盖 `@图片N` 编排
- **多图参考与 `@图片1`…**：全能模式下列出场景、角色、物品、分镜主图等为参考图（顺序与界面说明一致，方舟侧最多 **9** 张）；提示词中用 **`@图片1`**、**`@图片2`**… 引用（`@图片N` 后建议加半角空格）；可与 **`kling_omni`**（可灵 Omni）或 **`volcengine_omni`**（火山 Seedance 2.0 等）配合使用

### 文档

- 根目录 `README.md`、`docs/en.md`、桌面/后端/前端 README、`docs/configuration.md` 同步 **v1.2.5** 说明（Seedance 2.0、全能模式、接口规范）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 版本号统一为 **1.2.5**

---

## [1.2.3] - 2026-03-24

### 新增

- **分镜解说旁白（narration）**：分镜生成请求支持 `include_narration`；数据库 `storyboards` 表新增 `narration` 字段；提示词要求与角色对白 `dialogue` 分离的纪录片式/第三人称解说文案
- **导出解说 SRT**：前端按分镜顺序与 `duration` 累计时间轴，导出非空解说为 SubRip 文件；项目 `metadata.storyboard_include_narration` 持久化勾选状态
- **解说 TTS**：分镜视频区在存在解说文案时提供「解说配音」按钮，沿用现有音频合成接口

### 修复

- **首镜（及前几镜）解说永久为空**：流式增量写入会先插入不完整对象；原逻辑在最终 `saveStoryboards` 时跳过已插入行且不再更新，导致 `narration` 等后出字段无法落库；改为对增量已写入的 `storyboard_number` 用最终解析结果执行 `UPDATE` 合并（`deriveStoryboardFieldsFromAi` + `updateStoryboardRowFromDerived`）
- **解说漏写**：用户提示与系统提示增加最高优先级说明（首镜开场解说、全镜非空等），减少模型将建立镜头留空

### 优化

- **解说相关 UI**：`FilmCreate.vue` 中解说多行输入框、复选框说明与「导出解说 SRT」按钮在浅色/深色主题下的字色与背景对比度；导出按钮白字紫底

### 文档

- 根目录 `README.md`、`docs/en.md` 版本徽章与「最新亮点」同步至 v1.2.3
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 版本号统一为 1.2.3

---

## [1.2.2] - 2026-03-17

### 新增

- **视频帧连贯性（连贯帧模式）**：批量生成分镜视频新增「连贯帧模式」开关；启用后强制顺序生成，每条视频完成后自动用浏览器 Canvas 提取末帧，上传后作为下一条视频的 `first_frame_url` 参考图，有效减少视频片段间的跳跃感；tooltip 详细说明支持的模型（kling-video、wan2.2-kf2v-flash 等）及不支持模型的静默降级行为
- **小说/长文章节导入**：故事生成区域新增「导入小说」按钮；支持粘贴文本或上传 `.txt/.md` 文件；后端基于正则识别章节标题自动分割，可选 AI 改写为剧本格式；返回章节列表自动填入剧本编辑区，每章对应一集（`novelImportService.js`）
- **场景 AI 生成 tooltip**：场景 AI 生成按钮悬停提示改为「多角度图一张（正/侧/俯/仰）」，原重复的「多视角」独立按钮已移除
- **ffmpeg 自动解压**：安装包首次启动时自动将内置的 `ffmpeg.exe`/`ffprobe.exe` 从 `resources/ffmpeg/` 复制到 userData 工作目录，无需用户手动配置；已存在则跳过，支持用户手动替换版本；`electron-builder-lite.json` 通过 `extraResources` 将 `backend-node/tools/ffmpeg` 打包进安装包

### 修复

- **doubao/火山引擎模型分镜 JSON 解析失败**：修复 doubao-1-5-pro 等模型将 JSON 数组包装成 `{"storyboards":[...]}` 对象格式、叠加 max_tokens 截断导致全部修复策略失效的问题；新增 `extractWrappedArrayStr()` 函数，检测到包装对象后提取内部数组候选串，再走截断修复 → jsonrepair 兜底流水线；同样适用于流式增量保存路径（`tryIncrementalSave`）
- **分镜截断后续写内容重复**：续写 prompt 原只携带末尾 5 条分镜，AI 不知道前面已覆盖哪些情节，导致母亲关怀、雪儿致歉等段落反复出现；改为将全量已生成分镜标题列表（`镜号. [段落] 标题`）一并传入，明确禁止 AI 重复，续写连贯性大幅提升
- **分镜生成默认 max_tokens 过小**：默认不传 max_tokens 导致 doubao 等模型使用 4096 token 默认上限，12000 字符即截断；改为默认传 `max_tokens: 16384`；若模型返回参数错误（HTTP 4xx 含 max_tokens/length/token 关键字），自动降级为不传 max_tokens 重试，所有尝试均记录日志
- **JSON 字符串内原始换行符**：中文 AI 模型在对话/描述字段直接输出换行字节（非 `\n` 转义），导致 `JSON.parse` 报 "Unterminated string"；在 `safeParseAIJSON` 预处理阶段新增 `escapeNewlinesInStrings()` 字符级状态机扫描，将字符串值内的 `\n`/`\r`/`\t` 原始字节转义，修复后所有截断修复策略均可正常执行

### 优化

- **火山引擎默认文本模型**：一键配置和手动选择时，文本/对话默认模型由 doubao-1-5-pro-32k 改为 deepseek-v3-2-251201，生成质量更稳定
- **首页隐藏「自由创作」和「素材库」按钮**：功能待完善，暂时注释隐藏，路由与页面代码保留

---

## [1.2.1] - 2026-03-17

### 新增

- **可灵 Kling AI 接入**：新增可灵图片生成协议（kling-image / kling-omni-image）及视频生成协议（kling-video / kling-omni-video / kling-motion-control），AI 配置页可直接选择可灵作为服务商，Base URL / 端点自动填充
- **场景/道具"加入本集"**：场景库和道具库弹窗新增「加入本集」按钮，与角色库体验对齐；后端 `createScene` / `create`（prop）补充保存 `image_url`、`local_path` 字段，确保素材图片 URL 正确保存
- **视频历史记录与主视频选择**：分镜视频重新生成后保留历史版本，下方缩略图条带一览可选；点击历史缩略图即切换主视频，并将选择持久化到分镜记录的 `video_url`；合成视频时后端优先使用用户选定版本，兜底取最新生成记录
- **参考图独立字段（ref_image）**：角色、场景、道具各自新增 `ref_image` 数据库字段，专门存储用户手动上传的参考图，与 AI 生成的主图（`image_url`/`local_path`）完全分离，互不干扰；`migrate.js` 自动迁移
- **编辑弹窗参考图区域（角色/道具/场景）**：添加与编辑模式均显示参考图上传区；编辑时优先展示已保存的 `ref_image`，其次半透明展示主图；上传新参考图后点击保存自动上传并持久化到 `ref_image` 字段；支持"移除参考图"操作
- **从参考图提取描述**：参考图存在时一键调用视觉 AI 提取角色外貌/场景/道具描述，直接填入对应文本框；`resolveEntityImageSource` 优先使用 `ref_image`（高于主图和 `extra_images`）

### 修复

- **合成视频主视频不对**：`getVideoUrlForStoryboard` 调整为优先读 `storyboard.video_url`（用户选定主视频），再兜底 `video_generations ORDER BY created_at DESC`，修复合成时始终取最新生成记录、忽略用户已选定历史视频的问题
- **重新生成视频后主视频混乱**：`onGenerateSbVideo` / `startBatchVideoGeneration` 在提交新生成任务前自动清除 `storyboard.video_url` 及前端 `sbSelectedVideoId`，确保新视频生成完成后合成使用最新记录
- **视觉 AI 返回空内容（o4-mini）**：`max_tokens: 400` 过小导致推理模型（o4-mini）推理过程耗尽 token 而输出为空；改为 `max_tokens: 2000`；同时检测模型名是否以 `o数字` 开头，推理模型改用 `max_completion_tokens`（不能同时传两个参数），并跳过 `temperature` 参数（推理模型不支持）
- **视觉 API system 消息兼容性**：推理模型（o1/o3/o4 系列）不识别 `system` role，改为将 system prompt 合并到 user 消息前缀传入
- **提取描述后保存的参考图覆盖主图**：修复原先将参考图存为 `image_url/local_path`（覆盖 AI 生成主图）的问题，改为存入独立的 `ref_image` 字段；`putImage` 路由调整为只有明确传入 `image_url` 时才更新主图
- **场景导入重复**：工程导入时按 `location|time` 去重，避免多次导入同名场景累积重复条目

### 优化

- **视觉提示词重构**：角色外貌提取提示词改为"角色造型设计"语境（cosplay/概念图），明确要求描述发型/五官/体型/服装四维度，忽略背景，并加入推断指引和拒绝检测（`isRefusalResponse`）；场景/道具提示词同步优化
- **提示词单一来源**：`EXTRACT_PROMPTS` 常量统一在 `aiClient.js` 定义并导出，`characterLibraryService`、`sceneService`、`propService` 直接引用，消除多处重复维护

### 文档

- README 新增「AI 生成实拍效果」章节，展示即梦 1.0 生成的 3 段连续分镜视频，验证跨镜头角色一致性
- README 新增 3 张界面截图（角色管理、专业分镜参数、场景库加入本集）
- AI 服务商表格加入可灵 Kling AI（图片 + 视频）

---

## [1.2.0] - 2026-03-14

### 新增

- **角色图生提示词（polished_prompt）**：提取角色后异步自动生成 AI 润色的最终图像提示词并保存到数据库；编辑弹窗展示该提示词，支持手动编辑与一键重新生成；生成图片时直接使用该提示词，无需临时拼接
- **道具图生提示词（prompt）**：同上，道具提取后异步生成专业英文图像提示词，展示在编辑弹窗，可编辑和重新生成
- **场景四视图提示词（polished_prompt）**：场景提取后异步生成完整四视图图像提示词，展示在编辑弹窗，与角色/道具体验一致
- **结构化镜头角度三元组**：新增 `angleService.js`，定义 8 水平方向 × 4 仰俯角度 × 3 景别共 96 种组合，分镜表新增 `angle_h`、`angle_v`、`angle_s` 字段；分镜编辑区原单行文本输入替换为三个下拉选择器（景别 / 俯仰 / 方向），旁边实时显示中文标签（如「特写·俯拍·正面」）
- **分镜道具自动关联**：分镜 AI 生成时自动提取该镜头使用的道具 ID，写入 `storyboard_props` 表；分镜卡片显示关联道具，编辑弹窗可手动调整
- **分镜段落分组（segment）**：分镜生成时 AI 自动分配幕次/段落（`segment_index` + `segment_title`），前端以段落标题分组展示（如「第一幕：相遇」）
- **角色身份类型下拉**：编辑角色弹窗将「身份/定位」由文本框改为下拉选择器（主角 / 配角 / 次要角色），与 AI 提取的固定值 `main/supporting/minor` 对齐；角色卡片名称旁显示对应颜色 Tag
- **风格双语提示词**：24 种创作风格每项新增 `promptEn`（英文）字段，`prompt` 保留中文说明；图像/视频 AI 调用时自动使用英文版（效果更好），中文版用于界面展示；`getSelectedStylePrompt()` 返回英文，`getSelectedStylePromptZh()` 返回中文
- **分镜图片/视频提示词全中文**：重构 `generateImagePrompt` / `generateVideoPrompt`，输出全中文提示词，角度部分使用中文标签（`特写·俯拍·正面`），视频提示词同时附上英文括号说明兼容双语模型
- **配置文件统一**：合并 `config.yaml` 与 `config.example.yaml` 为单一 `config.yaml`，简化配置管理；Electron 打包与开发环境均只依赖 `config.yaml`

### 优化

- **编辑弹窗体验**：角色、道具、场景编辑弹窗宽度从固定 720px 改为屏幕 75%；所有多行文本框改为 `autosize` 自适应高度（最少 3~5 行，内容多时自动撑高最多 16 行），提示词框不再需要手动滚动
- **默认风格质量描述**：`config.yaml` 中 `default_role_style`、`default_scene_style`、`default_prop_style` 改为风格无关的通用画质描述词，不再预置特定艺术风格，避免覆盖用户在 UI 选择的风格

### 修复

- **场景 polished_prompt 前端轮询不结束**：修正 Axios 拦截器自动解包 `data` 层导致的路径多嵌套问题（`res?.data?.scene` → `res?.scene`），轮询现可正确检测到生成完成
- **分镜段落生成后刷新丢失**：`dramaService.rowToStoryboard` 和 `storyboardService` 补充返回 `segment_index`、`segment_title`、`angle_h`、`angle_v`、`angle_s` 字段，刷新页面后分组和角度信息不再丢失
- **分镜道具批量保存缺失**：`saveStoryboards`（整批保存路径）补充道具关联写入逻辑，与 `insertOneStoryboard`（流式逐条路径）保持一致
- **风格切换不生效**：修复 `backgroundExtractionService.js` 未将请求 `style` 参数透传给异步 `generateScenePromptOnly` 的问题；修复 `generationStyleOptions` value 字段曾改为长描述导致旧项目 v-model 不匹配的问题

### 架构

- 新增 `angleService.js`：结构化角度定义、`toChineseLabel()`、`toPromptFragment()`、`parseFromLegacyText()` 方法
- 新增迁移文件：`15_storyboard_angle_structured.sql`、`16_character_polished_prompt.sql`（`migrate.js` 自动执行）
- `characterLibraryService` 新增 `generateCharacterPromptOnly()`；`sceneService` 新增 `generateScenePromptOnly()`；`propService` 新增 `generatePropPromptOnly()`
- 新增 API 路由：`GET /characters/:id`、`POST /characters/:id/generate-prompt`；`GET /scenes/:id`、`POST /scenes/:id/generate-prompt`；`GET /props/:id`、`POST /props/:id/generate-prompt`

---

## [1.1.16] - 2026-03-14

### 修复

- **场景四视图生成后不显示**：`createAndGenerateImage` 新增 `scene_id` 参数支持，图片存储目录从 hardcode `characters/` 改为动态判断（`scenes/` / `characters/`），生成成功后自动回写 `scenes.image_url` / `scenes.local_path`
- **分镜图生成结果仍为宫格布局**：修正 Gemini 多模态输入结构，参考图说明文字与图片数据严格交替排列（`[说明] → [图] → [说明] → [图] → [生成指令]`），移除错误的 `systemInstruction` 字段，在生成指令中明确要求输出单张图
- **角色参考图干扰分镜布局**：优先使用拆分后的单张面板作为参考（场景取 `quad_panel_0` 建立远景，角色取 `quad_panel_1` 正面全身），无拆分面板时 fallback 到四视图合图
- **拆分角色面板无法按 ID 查询**：`splitQuadGridToImages` INSERT 时补充 `character_id` 字段，确保面板图片可关联到对应角色
- **参考图标签与传图数量不对齐**：`extra_images` 推入逻辑移入主图存在分支，`refLabels` 强制裁剪到 `refs.length`，Gemini parts 构建时同步对齐

### 架构

- `imageClient.js`：`callGeminiImageApi` 重构多模态 parts 构建逻辑；`MAX_GEMINI_REF_IMAGES` 从 3 提升至 4（支持场景参考图 1 张 + 角色参考图最多 3 张）；`createAndGenerateImage` 支持 `scene_id`，回写 `scenes` 表
- `imageService.js`：`splitQuadGridToImages` INSERT 增加 `character_id`；Step 2 参考图解析优先取拆分面板；移除 Step 2.5 冗余的 `CRITICAL OUTPUT REQUIREMENT` 文字注入；`callImageApi` 调用时传入 `system_prompt`（含参考图标签映射）
- `sceneService.js`：`createAndGenerateImage` 调用时传入 `scene_id`

---

## [1.1.15] - 2026-02-28

### 新增

- **多集剧本生成**：故事生成区新增「生成集数」下拉（1 / 2 / 3 / 4 / 5 / 6 集，默认 1），AI 一次性输出对应集数的连续剧本；返回格式统一为 JSON 数组，每集含 `episode`（序号）、`title`（标题）、`content`（约 800 字正文），多集剧情前后衔接、结尾留悬念；前端自动将所有集数保存到项目并默认选中第 1 集
- **标签优化**：故事生成区「风格」改为「故事风格」、「类型」改为「剧本类型」，语义更清晰
- **AI 并发生成（图片 & 视频）**：「AI 配置 → 生成设置」新增「图片并发数」和「视频并发数」选项（默认各 3，可选 1/2/3/5/8/10 或自定义）；一键生成流水线（角色图 → 场景图 → 分镜图 → 分镜视频）及「补全并生成」均采用 `runConcurrently()` 并发执行，不再串行等待
- **实时任务进度**：流水线运行时底部状态栏同步展示当前正在执行的所有并发任务标签（如「分镜图 #3」「角色图 #1」），含脉冲动画
- **可视化风格选择器（StylePickerButton）**：一键生成视频的「生成风格」从普通下拉框升级为图文选择器弹窗，每种风格显示缩略图（本地 `public/style-thumbs/`）与梯度色块兜底，支持按分类浏览和名称搜索，弹窗尺寸为 `90vw`（最大 1100px），可一次预览更多风格
- **AI JSON 输出强化**：分镜生成、角色提取、场景提取、道具提取全面启用 `json_mode: true`（向兼容模型发送 `response_format: { type: "json_object" }` 约束），从模型层面减少非法 JSON 输出概率
- **jsonrepair 自动修复**：`safeParseAIJSON` 集成 `jsonrepair` 库作为兜底修复策略，自动处理未引号字符串值、括号内容、尾逗号等 AI 常见畸形 JSON；修复时输出 WARN 日志记录修复策略、成功挽救的条目数、原文长度等，方便统计破损率
- **`min_max_tokens` 机制**：`aiClient.generateText` 新增 `min_max_tokens` 参数，调用方可声明最低 token 需求；若用户 AI 配置的 `settings.max_tokens` 低于此需求，自动提升并打 WARN 日志，确保多集剧本等长输出任务不被截断
- **全局设置持久化**：后端新增 `global_settings` 表与 `settingsService`（`getGlobalSetting` / `setGlobalSetting`），并暴露 `GET/PUT /settings/generation` 接口，持久化并发数等全局生成配置
- **AI 配置端点预览**：AI 配置弹窗选择厂商/协议后自动显示实际请求 URL（图片提交地址、视频提交地址），方便排查配置是否正确；特别处理 Google Gemini 的端点拼接规则

### 修复

- **供应商锁定 `api_protocol` 丢失**：`applyVendorLock` 的 `INSERT` 语句补充 `api_protocol` 字段，修复锁定厂商的打包 exe 中视频 API 协议路由错误（如 Vidu 接口返回 `images is required`）
- **导入配置 `api_protocol` 未恢复**：`importConfigs` 中的 `aiAPI.create` 调用补充 `api_protocol`，修复导入旧配置后协议字段丢失问题
- **打包 exe 分镜图片 `fetch failed`**：`uploadService.js` 中图片下载从 Node.js 原生 `fetch` 改为自定义 `downloadBufferViaNodeHttp`（`http`/`https` 模块），支持 3 次重试、30s 超时、自动跟随重定向和 `User-Agent`，解决 Electron 打包环境网络兼容性问题
- **`no such table: storyboard_characters` 警告**：`migrate.js` 补充 `CREATE TABLE IF NOT EXISTS storyboard_characters`，消除九宫格提示词生成时的数据库报错
- **端点预览 URL 重复 `/v1`**：OpenAI 图片端点和 MiniMax 视频端点的预览 URL 去除重复拼接的 `/v1`

### 架构

- **后端**：`safeJson.js` 引入 `jsonrepair` 包；`migrate.js` 新增 `storyboard_characters`、`global_settings` 表；`settingsService.js` 新增全局 KV 设置读写；`routes/settings.js` 暴露并发数 API；`routes/index.js` 注册新路由并向 `settingsRoutes` 传递 `db`；`storyGenerationService.js` 重写为多集 JSON 数组模式；`aiClient.js` 支持 `min_max_tokens`；分镜/角色/背景/道具服务统一启用 `json_mode`
- **前端**：新增 `StylePickerButton.vue` 可视化风格选择器组件；`FilmCreate.vue` 新增 `runConcurrently()` 并发工具函数、`pipelineActiveTasks` 任务进度集合、`storyEpisodeCount` 集数控制、多集 `onGenerateStory` 逻辑；`AIConfigContent.vue` 新增「生成设置」Tab（图片/视频并发数）及端点预览面板；`api/prompts.js` 新增 `generationSettingsAPI`；`public/style-thumbs/` 新增 30 张本地风格缩略图

---

## [1.1.14] - 2026-02-28

### 新增

- **官方仓库链接**：`README.md`、`backend-node/README.md`、`CHANGELOG.md` 均新增 GitHub 与 Gitee 官方仓库徽章链接，方便用户直接提交 Issue 或 PR
- **文档规范化**：`backend-node/README.md` 顶部新增官方仓库说明及 Issue 反馈引导

---

## [1.1.13] - 2026-03-09

### 新增

- **分镜图相机角度视角修正**：`framePromptService.js` 新增 `expandAngleDescription()`，将分镜的 `angle` 字段（平视/仰视/俯视/侧面/背面）翻译为完整的相机透视描述，注入图像提示词上下文，使 AI 生成的背景视角与镜头角度一致
- **四宫格序列图模式（后端拆分）**：分镜配置区新增全局「四宫格序列图」开关。开启后：
  - 生成分镜图时传 `frame_type: 'quad_grid'`，后端并行生成首帧/关键帧×2/尾帧共 4 个帧提示词，拼装为 2×2 象限布局提示词调用一次图片 API
  - 图片保存到本地后，后端使用 `sharp` 自动将整图拆分为 4 张子图（左上/右上/左下/右下），每张子图左上角叠加位置标签，分别存为独立的 `image_generation` 记录（`frame_type = quad_panel_0~3`）
  - 4 张子图与普通生成图完全一致，支持点击缩略图切换主图、重新生成自动更新、历史记录保留
  - 主图选择持久化到 `storyboard.image_url / local_path`，刷新页面后自动从后端恢复

### 修复

- **分镜主图刷新后恢复**：`dramaService.rowToStoryboard()` 和 `storyboardService.getStoryboardById()` 均补充返回 `image_url`、`local_path`、`main_panel_idx` 字段，前端 `restoreSelectionsFromBackend()` 可正确从后端数据比对恢复主图选中状态
- **四宫格生成无变化**：移除前端 Canvas 拆分逻辑后，重新生成触发新的后端拆分，不再受旧内存缓存影响
- **四宫格图片白框**：prompt 改为"NO borders of any color (black, white, gray)，panels must be seamlessly adjacent with no gaps"，杜绝任何颜色边框

### 架构

- **后端**：`imageService.js` 新增 `splitQuadGridToImages()`（依赖 `sharp`），Step 7 自动触发；`buildQuadGridPrompt()` 组装四宫格提示词；`storyboards` 表新增 `image_url`、`local_path`、`main_panel_idx` 列（migrate.js 自动迁移）
- **前端**：删除全部 Canvas 拆分相关代码（`sbQuadPanels`、`splitImageIntoQuadrants`、`triggerSplitQuadGrid`、`_persistPanelToBackend` 等约 120 行），四宫格子图完全复用普通单张图片的展示与选择流程；缩略图条对 `quad_panel_*` 类型图片自动显示位置标签

---

## [1.1.11] - 2026-03-06

### 新增

- **批量生成分镜图 / 批量生成分镜视频**：在「重新生成分镜」按钮右侧新增两个右对齐批量按钮，支持一键为所有缺图分镜生成图片、为所有缺视频分镜生成视频，含实时进度、错误日志和随时停止功能
- **角色/场景影响分镜面板**：角色、场景卡片描述下方新增「影响的分镜：#XX #ZZ」标签行及「↻ 重新生成分镜图」按钮，点击可批量重新生成与该资源关联的所有分镜图片，含确认弹窗和实时进度显示
- **多并发 AI 生成转圈**：同时点击多个角色/道具/场景的「AI生成」或「重新生成」按钮，每个按钮独立保持转圈状态，互不干扰（底层由 `ref(null)` 改为 `reactive(new Set())` 实现）
- **提示词管理动态同步**：`promptOverrides.js` 中的 `default_body` 和 `locked_suffix` 改为从 `promptI18n.js` 动态读取，新增 `getDefaultPromptBody(key)` 和 `getLockedSuffix(key)` 导出函数，UI 展示内容与运行时提示词始终一致，彻底消除双维护问题
- **userData 路径统一**：`desktop/main.js` 将开发模式与打包 exe 的用户数据目录统一固定为 `localminidrama-desktop`，并在首次运行时自动迁移旧路径 `LocalMiniDrama` 下的数据，彻底解决开发/发布切换时数据丢失问题

### 修复

- **手动选择角色不进入分镜生成**：`FilmCreate.vue` 中 `onStoryboardCharacterChange` / `onStoryboardSceneChange` 函数原来为空，导致用户在分镜卡片上手动多选角色或切换场景后，选择不会持久化到后端。现已实现调用 `storyboardsAPI.update`，确保分镜脚本生成时使用用户手动指定的角色/场景
- **道具/角色参考图不生效**：修复 `imageClient.js` 中 `resolveImageRef` 函数的 `isLocalhost` 判断逻辑，使其同时检测 URL 字符串本身是否包含 `localhost/127.0.0.1`；修复 `imageService.js` 在构建分镜参考图列表时未读取 `extra_images` 字段的问题
- **分镜数量控制优化**：当用户指定分镜数量时，在系统提示词末尾动态追加 HIGHEST PRIORITY 级别的数量约束覆盖指令，防止系统提示词中的「独立动作数量匹配」规则与用户数量约束冲突
- **角色数量与分镜动作不一致**：强化 `promptI18n.js` 中的 `character_constraint`、`getStoryboardUserPromptSuffix` 及系统提示词，明确要求 `characters` 数组只填写在本镜头 `action/dialogue` 中有实际描写行为的角色，数量必须与动作描述中出现的人物一致

### 架构

- `promptI18n.js` 新增 `getDefaultPromptBody(key)` / `getLockedSuffix(key)` 两个导出函数，作为提示词默认内容的唯一来源
- `promptOverrides.js` 精简为只维护提示词元数据（key / label / description），彻底去除内容冗余副本

---

## [1.1.10] - 2026-03-05

### 新增

- **Google Gemini 图片生成支持**：新增 `callGeminiImageApi`，使用 `generateContent` 接口，支持 `gemini-2.5-flash-image`、`gemini-3.1-flash-image-preview`、`gemini-3-pro-image-preview` 等模型
- **Google Gemini (Veo) 视频生成支持**：新增 `callGeminiVideoApi`，支持 `veo-3.1-generate-preview`、`veo-3.0-generate-preview`、`veo-3.0-fast-generate-preview` 等模型，含异步任务轮询
- **Gemini 参考图支持（图床方案）**：分镜图片生成时，参考图先上传至中转图床获取公开 URL，再通过 `fileData.fileUri` 传给 Gemini，彻底解决 `inlineData` base64 导致的 503 内存溢出问题
- **图床上传缓存**：新增 `image_proxy_cache` 表，本地图片路径与图床 URL 一一映射，相同图片只上传一次，命中缓存时跳过上传（附 `migrations/12_image_proxy_cache.sql`）
- **API 接口规范字段**：数据库新增 `api_protocol` 列（`migrations/11_add_api_protocol.sql`），可为每条 AI 配置显式指定接口类型（`openai` / `volcengine` / `dashscope` / `gemini` / `nano_banana`），优先级高于厂商自动推断，解决中转站自定义配置走错接口的问题
- **AI 配置页面「接口规范」字段**：自定义厂商时显示下拉框供用户选择接口类型；预设厂商自动填充，无需手动选
- **Gemini 作为分镜图片生成厂商**：在 AI 配置页面，分镜图片生成 (`storyboard_image`) 服务类型增加 Gemini 系列模型选项
- **Gemini 作为视频生成厂商**：在 AI 配置页面，视频生成 (`video`) 服务类型增加 Google Gemini (Veo) 系列模型选项
- **图片/视频风格扩展**：在 `DramaDetail.vue`、`FilmCreate.vue`、`FilmList.vue` 三处将风格选项从 8 个扩展至 29 个，按写实、动漫、中国风、绘画、幻想、数字六大类使用 `el-option-group` 分组展示
- **新增 3:4 竖版比例**：画面比例选项新增「3:4 竖版」
- **分镜生成数量上限提升**：前端 `storyboardCount` 最大值从 50 提升至 200
- **全链路生成日志**：图片生成全链路（接收请求 → 解析参考图 → 图床上传 → Gemini API → 保存图片）均打印带计时的结构化日志，便于排查耗时瓶颈
- **`max_tokens` 自适应上限**：`aiClient.generateText` 读取 AI 配置 `settings.max_tokens` 作为上限，调用方传入值超出时自动截断并打印警告，避免不同模型因上限差异导致 400 错误

### 修复

- **修复 Gemini `MALFORMED_FUNCTION_CALL` 错误**：`generateContent` 接口的请求体中，`aspectRatio` / `numberOfImages` 必须直接放在 `generationConfig` 顶层，而非嵌套在 `imageGenerationConfig`（该字段为 Imagen 独立接口专属），嵌套写法会干扰模型内部 `google:image_gen` 工具调用
- **修复分镜生成 `max_tokens` 超限 400 错误**：移除 `episodeStoryboardService.js` 中写死的 `32768`，由 AI 配置的 `settings.max_tokens` 控制或由模型使用默认值
- **修复分镜生成静默失败**：`onGenerateStoryboard` 轮询超时时间从 6 分钟延长至 15 分钟；正确检查 `pollRes.status` 只在 `completed` 时显示成功提示；超时/失败给出明确提示
- **修复 HTTP 500 错误信息不清晰**：`request.js` Axios 拦截器将后端具体错误信息写回 `error.message`，消除「Request failed with status code 500」的模糊提示
- **图床上传重试机制**：`uploadToImageProxy` 上传失败时自动重试最多 3 次，每次均打印尝试序号和耗时

### 架构

- 确认 `desktop/backend-app` 为构建时由 `copy-backend.js` 自动从 `backend-node` 生成，无需手动同步，日常只需维护 `backend-node`

---

## [1.1.9] - 2026-02-xx

### 新增

- **厂商锁定模式**：`config.yaml` 新增 `vendor_lock` 配置项，启用后强制使用指定 AI 厂商配置，用户仅可修改 API Key 和默认模型，无法新增/删除配置；打包的 exe 每次启动自动同步锁定策略
- **全页面 UI 美化**：四个页面（首页/剧集管理/制作页/AI配置）统一升级为极光渐变背景 + 毛玻璃 Header + 玻璃拟态卡片；Header 改为 `sticky` 吸顶
- **品牌标识双行 Logo**：左上角改为「本地短剧助手 / LocalMiniDrama」双行设计，紫色渐变文字
- **面包屑导航**：剧集管理页和制作页 Header 新增 `›` 分隔符 + 项目名标签；返回按钮移至项目名右侧
- **NanoBanana 图片厂商**：新增 NanoBanana 作为独立图片生成厂商，支持 nano-banana-2 / nano-banana-pro / nano-banana 三个模型
- **AI 配置导出 / 导入**：一键导出全部 AI 配置为 JSON 文件，换机或团队共享配置直接导入
- **端点字段可配置**：图片、分镜、视频类型配置均可手动填写「提交端点」和「查询端点」

### 修复

- **角色提取优化**：移除错误的固定数量限制，改为提取剧本中所有有名字的角色；去除无实际用途的 `personality` 字段，加强中文输出约束，速度提升约 40%
- **分镜截断修复**：`max_tokens` 从 8192 提升至 32768，新增 `repairTruncatedJsonArray` 智能修复截断 JSON
- **分镜参考图优化**：角色图和场景参考图优先读取本地文件并转为 Base64 传给图片 API
- **doubao-seedream 参数修正**：参考图字段名由 `imageUrls` 修正为官方规范 `image`，自动移除 `n` 参数并关闭水印

---

## [1.1.8] - 2026-02-xx

### 新增

- **提示词高级设置**：AI 配置页新增「高级设置（提示词）」Tab，支持自定义 9 个核心提示词，修改后立即生效；JSON 输出格式部分加锁保护；随时一键恢复默认
- **AI 厂商自定义选项**：厂商下拉菜单底部新增「自定义」选项

### 修复

- **多项 UI/UX 优化**：Aurora 渐变背景、玻璃拟态卡片、双行 Logo；DramaDetail / FilmCreate / AiConfig 页面风格统一
- **提示词持久化**：自定义提示词通过 SQLite 持久存储（`prompt_overrides` 表），后端内存缓存加速读取

---

## [1.1.6] - 2026-01-xx

### 新增

- **工程导出/导入**：完整打包工程为 ZIP（含图片、视频、文字、配置），换机或分享一包搞定
- **画面比例设置**：新建项目时选定比例（16:9 / 9:16 / 1:1 / 4:3 等），后续生成全程自动适配
- **视频参数扩展**：视频生成支持 `resolution`、`seed`、`camera_fixed`、`watermark` 等参数
- **视频合并进度展示**：合成完整剧集视频时，前端实时展示合并进度

### 修复

- **图片生成去水印**：火山引擎图片生成默认传入 `watermark: false`
- **导出 ZIP 修复**：修复导出文件只有 9 字节的问题
- **导入数据关联修复**：导入时正确创建 `episode_characters`，修复导入后看不到角色/场景/道具的问题

---

## [1.1.4] - 2026-01-xx

### 新增

- **剧集管理页**：新增独立的剧集管理页面（`/drama/:id`），统一管理剧集信息、本剧资源库与分集列表
- **资源库分层**：本剧资源库（按剧过滤）与全局素材库严格隔离
- **素材库导入**：在剧集管理页可一键从全局素材库导入角色/场景/道具
- **明暗主题切换**：支持暗色/浅色模式，偏好持久保存

---

## [1.1.x] - 早期版本

- 一键生成流水线：自动跳过已有内容，失败自动重试最多 3 次
- 实时进度展示：流水线执行中实时显示步骤与错误日志
- 视频/图片提示词编辑：每个分镜可单独查看和修改提示词
- AI 配置优化：支持多种服务商连接测试

---

## [1.0.x] - 2026-01-xx

- 项目立项与基础架构搭建（Vue 3 + Node.js + Electron）
- 剧本生成、角色/场景/道具提取
- 分镜生成与图片/视频生成核心流程
- SQLite 数据持久化
- Windows exe 打包
