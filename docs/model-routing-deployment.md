# 智能路由引擎部署配置说明

> 适用模块：Sprint 4 — S4-T07 AI模型智能路由引擎  
> 核心代码：`backend-node/src/services/modelRoutingService.js`  
> REST 路由：`backend-node/src/routes/modelRouting.js`  
> 数据库迁移：`backend-node/migrations/36_s4_model_routing.sql`  
> 集成测试：`backend-node/test/s4ModelRoutingIntegration.test.js`（6/6 PASS）  
> 最后更新：2026-08-09  
> 维护者：LocalMiniDrama 团队

---

## 目录

1. [功能概览](#1-功能概览)
2. [架构与数据流](#2-架构与数据流)
3. [数据库表结构](#3-数据库表结构)
4. [熔断器状态机](#4-熔断器状态机)
5. [核心常量与可调参数](#5-核心常量与可调参数)
6. [REST API 接口](#6-rest-api-接口)
7. [部署步骤](#7-部署步骤)
8. [路由规则配置示例](#8-路由规则配置示例)
9. [与业务服务的集成方式](#9-与业务服务的集成方式)
10. [验证与冒烟测试](#10-验证与冒烟测试)
11. [运维与监控](#11-运维与监控)
12. [常见问题排查](#12-常见问题排查)
13. [回滚步骤](#13-回滚步骤)

---

## 1. 功能概览

智能路由引擎为平台的 AI 调用提供统一的模型选择与故障转移能力，核心目标：

| 能力 | 说明 |
|------|------|
| 智能路由 | 按任务类型（image/video/text/tts）+ 质量层级（low/standard/high/premium）自动选择最优模型 |
| 故障自动转移 | 主模型超时/报错连续达阈值后熔断，自动切换到 fallback 模型（Circuit Breaker 模式） |
| 成本优化 | 支持单次调用成本上限 `max_cost_per_call`，超预算自动跳过 |
| 模型评分 | 根据成功率（40%）+ 速度分（30%）+ 质量分（30%）自动综合评分，辅助运营决策 |
| 调用全量留痕 | 每次调用记录 `ai_model_call_logs`，含耗时、成本、质量分、是否 fallback、错误信息 |

> ⚠️ 本文档示例中的模型名（如 `low_cost_fast_model`、`high_quality_image_model`、`chinese_optimized_model`）仅为示意，实际部署时应使用具体供应方模型名。模型选型需根据成本/合规性/可用性独立评估。

---

## 2. 架构与数据流

```
                      业务服务（storyboardGen / imageService / ttsService / ...）
                                            │
                                            ▼
                          ┌─────────────────────────────────┐
                          │   modelRoutingService.routeModel │
                          │   1. preferModel 直选            │
                          │   2. 路由规则匹配（qualityTier）  │
                          │   3. 熔断状态检查                │
                          │   4. 成本预算校验                │
                          │   5. fallback 故障转移           │
                          │   6. 兜底默认配置                │
                          └────────────┬────────────────────┘
                                       │ { config, model, rule, isFallback }
                                       ▼
                          ┌─────────────────────────────────┐
                          │      aiClient / 业务调用         │
                          │   调用模型 → 成功/失败           │
                          └────────────┬────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────────────┐
                          │  recordCallLog → 熔断状态同步    │
                          │  success → recordSuccess 重置    │
                          │  failed  → recordFailure 累加    │
                          └─────────────────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        ai_routing_rules      ai_model_call_logs    ai_model_circuit_state
        （路由规则）            （调用记录）           （熔断状态）
```

三张表分工：

- `ai_routing_rules`：静态路由策略（主模型 + 备选模型 + 成本上限 + 优先级）
- `ai_model_call_logs`：动态调用流水（耗时/成本/质量/状态），驱动评分系统
- `ai_model_circuit_state`：熔断器实时状态（closed/open/half_open + 失败计数 + 时间戳）

---

## 3. 数据库表结构

迁移文件：`backend-node/migrations/36_s4_model_routing.sql`

### 3.1 ai_routing_rules（路由规则表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| rule_key | VARCHAR(64) UNIQUE | 规则标识，如 `image_simple` / `text_storyboard` |
| task_type | VARCHAR(32) | 任务类型：`image` / `video` / `text` / `tts` |
| quality_tier | VARCHAR(32) | 质量层级：`low` / `standard` / `high` / `premium` |
| primary_config_id | INT | 主模型 `ai_service_configs.id` |
| primary_model | VARCHAR(255) | 主模型名称 |
| fallback_config_id | INT | 备选模型配置 ID（故障转移） |
| fallback_model | VARCHAR(255) | 备选模型名称 |
| max_cost_per_call | DECIMAL(10,4) | 单次调用成本上限（元），0 表示不限制 |
| priority | INT | 优先级，越大越优先匹配 |
| is_active | TINYINT(1) | 是否启用 |
| description | VARCHAR(512) | 规则描述 |

索引：`idx_rr_task(task_type, quality_tier, is_active)`

### 3.2 ai_model_call_logs（调用记录表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| user_id | BIGINT | 调用用户 |
| drama_id | BIGINT | 关联短剧 |
| config_id | INT | 使用的 `ai_service_configs.id` |
| service_type | VARCHAR(32) | image/video/text/tts |
| provider | VARCHAR(64) | 供应方 |
| model | VARCHAR(255) | 实际调用的模型 |
| task_type | VARCHAR(64) | 业务任务类型 |
| status | VARCHAR(32) | `success` / `failed` / `timeout` / `fallback` |
| is_fallback | TINYINT(1) | 是否为故障转移调用 |
| latency_ms | INT | 耗时（毫秒） |
| cost | DECIMAL(10,4) | 估算成本（元） |
| quality_score | DECIMAL(4,2) | 质量评分 0~100 |
| error_message | TEXT | 错误信息 |
| routing_rule_key | VARCHAR(64) | 命中的路由规则 |
| created_at | DATETIME | 记录时间 |

索引：`idx_mcl_model(model, service_type, created_at)`、`idx_mcl_status(status, created_at)`、`idx_mcl_task(task_type, created_at)`

### 3.3 ai_model_circuit_state（熔断状态表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO | 主键 |
| config_id | INT NOT NULL | 模型配置 ID |
| model | VARCHAR(255) NOT NULL | 模型名称 |
| state | VARCHAR(16) | `closed` / `open` / `half_open` |
| failure_count | INT | 连续失败次数 |
| last_failure_at | DATETIME | 最后失败时间 |
| opened_at | DATETIME | 熔断打开时间 |
| half_open_at | DATETIME | 半开探测时间 |

约束：`UNIQUE(config_id, model)`

---

## 4. 熔断器状态机

```
                    连续失败 < 5 次
          ┌────────────────────────────────┐
          ▼                                │
      ┌────────┐  连续失败 ≥ 5 次   ┌──────┴───┐
      │ closed │ ────────────────► │   open   │
      └────┬───┘                   └──────┬───┘
           ▲                              │
           │ 成功（重置 failure_count=0）   │ 冷却 60s 后
           │                              ▼
           │                        ┌───────────┐
           └────────────────────────┤ half_open │
              探测成功 → closed       └─────┬─────┘
                                     │ 探测失败
                                     ▼
                                  回到 open（重新计时 60s）
```

**状态转换规则**（见 `modelRoutingService.js`）：

| 当前状态 | 触发条件 | 新状态 | 说明 |
|---------|---------|--------|------|
| closed | 调用成功 | closed | `recordSuccess` 重置 failure_count=0 |
| closed | 调用失败，failure_count+1 < 5 | closed | failure_count 递增 |
| closed | 调用失败，failure_count+1 ≥ 5 | open | `opened_at` 记录熔断时间 |
| open | 读取状态时 now - opened_at ≥ 60s | half_open | `getCircuitState` 惰性转换，记录 `half_open_at` |
| open | 继续失败 | open | **仅更新 last_failure_at，不再累加 failure_count**（防溢出） |
| half_open | 探测成功 | closed | `recordSuccess` 完全重置 |
| half_open | 探测失败 | open | `recordFailure` 重新打开，更新 `opened_at` |

> 关键修复点：`recordFailure` 在 state=open 时不再累加 failure_count，避免整型溢出；`getCircuitState` 补全 `openedAt/halfOpenAt` 字段，避免 UPDATE 后读旧快照的竞态。

---

## 5. 核心常量与可调参数

定义在 `modelRoutingService.js` 顶部：

| 常量 | 默认值 | 含义 | 调整建议 |
|------|--------|------|---------|
| `CIRCUIT_FAILURE_THRESHOLD` | 5 | 连续失败多少次触发熔断 | 高可用场景可降到 3；网络抖动场景可升到 10 |
| `CIRCUIT_COOLDOWN_MS` | 60000 (60s) | 熔断冷却时间，过后进入 half_open | 模型恢复快可降到 30s；恢复慢可升到 120s |
| `CIRCUIT_HALF_OPEN_PROBES` | 1 | 半开状态允许探测次数 | 当前实现为单次探测，调大需改 `getCircuitState` 逻辑 |

**评分公式**（`_computeScore`）：

```
综合评分 = 成功率 × 40% + 速度分 × 30% + 质量分 × 30%
速度分 = max(0, 100 - avg_latency_ms / 100)
质量分 = avg_quality（无数据时兜底 70）
```

> 如需调整权重或加入成本分维度，修改 `_computeScore(r)` 函数即可。

**环境变量覆盖**（可选，未配置时使用默认值）：

```bash
# .env 或启动脚本中设置
ROUTING_CIRCUIT_FAILURE_THRESHOLD=5
ROUTING_CIRCUIT_COOLDOWN_MS=60000
```

> 当前版本常量为模块级硬编码，如需环境变量化，可在 `modelRoutingService.js` 顶部改为：
> ```js
> const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.ROUTING_CIRCUIT_FAILURE_THRESHOLD) || 5;
> const CIRCUIT_COOLDOWN_MS = Number(process.env.ROUTING_CIRCUIT_COOLDOWN_MS) || 60000;
> ```

---

## 6. REST API 接口

路由挂载点：`backend-node/src/routes/index.js`

```
r.use('/ai/model-routing', modelRoutingRoutes(db, log));
```

完整路径前缀：`/api/v1/ai/model-routing`（需登录鉴权）

| 方法 | 路径 | 功能 | 关键参数 |
|------|------|------|---------|
| GET | `/rules` | 路由规则列表 | query: `taskType`, `isActive` |
| POST | `/rules` | 创建/更新路由规则（按 rule_key upsert） | body: `ruleKey`, `taskType`, `qualityTier`, `primaryConfigId`, `primaryModel`, `fallbackConfigId`, `fallbackModel`, `maxCostPerCall`, `priority`, `isActive` |
| DELETE | `/rules/:id` | 删除路由规则 | path: `id` |
| POST | `/route` | 智能路由决策（返回推荐模型，不实际调用） | body: `taskType`, `qualityTier`, `costBudget`, `preferModel` |
| GET | `/stats` | 模型调用统计与评分 | query: `days`（默认 30） |
| GET | `/circuit/:configId/:model` | 查询熔断状态 | path: `configId`, `model` |
| POST | `/call-log` | 记录调用日志（业务侧调用后回传） | body: `userId`, `dramaId`, `configId`, `serviceType`, `provider`, `model`, `taskType`, `status`, `isFallback`, `latencyMs`, `cost`, `qualityScore`, `errorMessage`, `routingRuleKey` |

**响应格式**（统一）：

```json
{
  "success": true,
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

---

## 7. 部署步骤

### 7.1 前置条件

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18 |
| MySQL | 8.0+，`localminidrama` 数据库已创建 |
| 后端依赖 | `backend-node/` 已执行 `npm install` |
| AI 配置 | 已在「AI 配置」页添加至少一组可用的 `ai_service_configs`（text/image/tts） |
| 迁移文件 | `migrations/36_s4_model_routing.sql` 已存在 |

### 7.2 执行数据库迁移

```bash
cd backend-node
npm run migrate
```

迁移会自动创建 3 张表（`ai_routing_rules`、`ai_model_call_logs`、`ai_model_circuit_state`）。

> 后端启动时也会通过 `ensureColumns()` 自动补齐缺失字段，但首次部署建议显式执行 `npm run migrate`。

### 7.3 验证表创建

```bash
mysql -uroot -proot localminidrama -e "
  SHOW TABLES LIKE 'ai_routing_rules';
  SHOW TABLES LIKE 'ai_model_call_logs';
  SHOW TABLES LIKE 'ai_model_circuit_state';
"
```

应返回 3 张表。

### 7.4 启动后端

```bash
cd backend-node
npm run dev
```

启动日志应包含数据库连接成功信息，无迁移报错。

### 7.5 配置路由规则（见第 8 节）

通过 REST API 或直接 SQL 插入路由规则。规则为空时，`routeModel` 会兜底使用 `ai_service_configs` 中的默认配置，功能可用但无故障转移能力。

---

## 8. 路由规则配置示例

### 8.1 通过 REST API 配置

先获取 `ai_service_configs` 中已有配置的 ID：

```bash
mysql -uroot -proot localminidrama -e "
  SELECT id, service_type, provider, model, is_active, is_default FROM ai_service_configs;
"
```

假设得到：text 类型 config_id=1（低成本快速模型）、config_id=2（高质量模型）。

创建规则（需登录获取 token，或用 admin 账号）：

```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:5679/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.token))")

# 创建路由规则：text 任务 standard 质量层 → 主模型 config_id=1，fallback=config_id=2
curl -X POST http://localhost:5679/api/v1/ai/model-routing/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "ruleKey": "text_storyboard",
    "taskType": "text",
    "qualityTier": "standard",
    "primaryConfigId": 1,
    "primaryModel": "low_cost_fast_model",
    "fallbackConfigId": 2,
    "fallbackModel": "high_quality_model",
    "maxCostPerCall": 0.05,
    "priority": 100,
    "isActive": true,
    "description": "分镜生成用低成本快速模型，失败转移高质量模型"
  }'
```

### 8.2 通过 SQL 批量配置

```sql
-- 文本任务：分镜生成（standard）+ 大纲生成（high）
INSERT INTO ai_routing_rules (rule_key, task_type, quality_tier, primary_config_id, primary_model, fallback_config_id, fallback_model, max_cost_per_call, priority, is_active, description, created_at, updated_at)
VALUES
  ('text_storyboard', 'text', 'standard', 1, 'low_cost_fast_model', 2, 'high_quality_model', 0.05, 100, 1, '分镜生成-标准质量', NOW(), NOW()),
  ('text_outline',    'text', 'high',     2, 'high_quality_model', 1, 'low_cost_fast_model', 0.10, 100, 1, '大纲生成-高质量', NOW(), NOW()),
  ('image_simple',    'image','low',      3, 'fast_image_model',   4, 'hq_image_model',      0.02, 100, 1, '简单图像-低成本', NOW(), NOW()),
  ('image_hq',        'image','premium',  4, 'hq_image_model',     3, 'fast_image_model',    0.08, 100, 1, '高质量图像', NOW(), NOW()),
  ('tts_default',     'tts',  'standard', 5, 'standard_voice',     6, 'backup_voice',        0.01, 100, 1, '配音-标准音色', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
```

> 上述模型名仅为示意，请替换为 `ai_service_configs` 中实际的 model 字段值。

### 8.3 查询路由决策（不实际调用）

```bash
curl -X POST http://localhost:5679/api/v1/ai/model-routing/route \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"taskType":"text","qualityTier":"standard"}'
```

返回推荐的 config/model 及是否 fallback。

---

## 9. 与业务服务的集成方式

智能路由引擎提供两种集成方式：

### 9.1 方式一：业务服务主动调用 routeModel + recordCallLog（推荐）

适用于需要精细控制路由与回传的场景（如分镜生成、图像生成）：

```js
const routing = require('../services/modelRoutingService');

// 1. 路由决策
const { config, model, rule, isFallback } = routing.routeModel(db, {
  taskType: 'text',
  qualityTier: 'standard',
  costBudget: 0.05,
});

// 2. 用 config + model 调用 AI（通过 aiClient 或直接 HTTP）
const t0 = Date.now();
let status = 'success';
let errorMsg = null;
try {
  const result = await aiClient.generateText(db, log, 'text', prompt, systemPrompt, { model });
  // ...业务处理
} catch (err) {
  status = 'failed';
  errorMsg = err.message;
  throw err;
} finally {
  // 3. 回传调用日志（会自动同步熔断状态）
  routing.recordCallLog(db, {
    userId, dramaId,
    configId: config.id,
    serviceType: 'text',
    provider: config.provider,
    model,
    taskType: 's4_storyboard_generate',
    status,
    isFallback,
    latencyMs: Date.now() - t0,
    cost: 0.02,
    qualityScore: null,
    errorMessage: errorMsg,
    routingRuleKey: rule ? rule.ruleKey : null,
  });
}
```

### 9.2 方式二：scene_key 静态映射（aiClient 内置）

`aiClient.generateText` 支持通过 `scene_key` 参数走 `ai_model_map` 静态映射表，适用于无需熔断的简单场景：

```js
await aiClient.generateText(db, log, 'text', prompt, systemPrompt, {
  scene_key: 's4_storyboard_generate',  // 从 ai_model_map 查找配置
});
```

> 两种方式区别：方式一具备熔断 + fallback 能力；方式二仅做静态配置映射，无故障转移。**生产环境推荐方式一**。

---

## 10. 验证与冒烟测试

### 10.1 单元测试

```bash
cd backend-node
node --test test/s4ModelRouting.test.js
```

预期：10 个用例全部 PASS（覆盖 listRules/upsertRule/routeModel/熔断器/recordCallLog/getModelStats）。

### 10.2 集成测试（熔断全链路）

```bash
cd backend-node
node --test test/s4ModelRoutingIntegration.test.js
```

预期：6 个用例全部 PASS，覆盖：

| 用例 | 场景 |
|------|------|
| S4-INT-RT-01 | 初始 closed → 主模型正常路由，不触发 fallback |
| S4-INT-RT-02 | 连续 N 次失败 → closed→open，failure_count 递增 |
| S4-INT-RT-03 | 主模型 open → routeModel 自动故障转移到 fallback |
| S4-INT-RT-04 | fallback 也熔断 → routeModel 兜底默认配置 |
| S4-INT-RT-05 | 冷却过后 half-open，一次成功立即恢复 closed |
| S4-INT-RT-06 | 综合链路：建规则→失败熔断→fallback→恢复→getModelStats 聚合 |

> 集成测试使用 SQLite in-memory 数据库，独立于本地 MySQL，可放心运行。

### 10.3 接口冒烟测试

```bash
# 1. 规则列表应为空或包含已配置规则
curl -s http://localhost:5679/api/v1/ai/model-routing/rules \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# 2. 查询某模型的熔断状态（应返回 closed）
curl -s http://localhost:5679/api/v1/ai/model-routing/circuit/1/low_cost_fast_model \
  -H "Authorization: Bearer $TOKEN"

# 3. 模拟一次失败调用，观察熔断计数
curl -X POST http://localhost:5679/api/v1/ai/model-routing/call-log \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"configId":1,"model":"low_cost_fast_model","serviceType":"text","taskType":"test","status":"failed","latencyMs":5000,"errorMessage":"模拟超时"}'

# 4. 再次查询熔断状态，failureCount 应为 1
curl -s http://localhost:5679/api/v1/ai/model-routing/circuit/1/low_cost_fast_model \
  -H "Authorization: Bearer $TOKEN"
```

### 10.4 查看模型统计

```bash
curl -s "http://localhost:5679/api/v1/ai/model-routing/stats?days=7" \
  -H "Authorization: Bearer $TOKEN"
```

返回各模型的 totalCalls/successRate/avgLatency/avgCost/score。

---

## 11. 运维与监控

### 11.1 熔断状态巡检 SQL

```sql
-- 当前所有处于 open/half_open 的模型（需关注）
SELECT config_id, model, state, failure_count,
       last_failure_at, opened_at, half_open_at
FROM ai_model_circuit_state
WHERE state <> 'closed'
ORDER BY opened_at DESC;

-- 近 24 小时失败率 TOP 模型
SELECT model, service_type,
       COUNT(*) AS total,
       SUM(CASE WHEN status='failed' OR status='timeout' THEN 1 ELSE 0 END) AS failed,
       ROUND(SUM(CASE WHEN status='failed' OR status='timeout' THEN 1 ELSE 0 END)*100.0/COUNT(*), 2) AS fail_rate,
       AVG(latency_ms) AS avg_latency
FROM ai_model_call_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
GROUP BY model, service_type
HAVING total >= 5
ORDER BY fail_rate DESC;
```

### 11.2 手动重置熔断器

当确认模型已恢复，可手动重置熔断状态：

```sql
-- 重置单个模型
UPDATE ai_model_circuit_state
SET state='closed', failure_count=0, last_failure_at=NULL, opened_at=NULL, half_open_at=NULL
WHERE config_id=<configId> AND model='<model>';

-- 重置全部
UPDATE ai_model_circuit_state
SET state='closed', failure_count=0, last_failure_at=NULL, opened_at=NULL, half_open_at=NULL
WHERE state <> 'closed';
```

或通过一次成功调用回传自动重置：

```bash
curl -X POST http://localhost:5679/api/v1/ai/model-routing/call-log \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"configId":1,"model":"low_cost_fast_model","status":"success","latencyMs":800}'
```

### 11.3 调用记录清理（定期维护）

`ai_model_call_logs` 会持续增长，建议按月归档：

```sql
-- 归档 90 天前的记录到历史表后删除
CREATE TABLE IF NOT EXISTS ai_model_call_logs_archive LIKE ai_model_call_logs;
INSERT INTO ai_model_call_logs_archive
  SELECT * FROM ai_model_call_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
DELETE FROM ai_model_call_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

可配置 crontab 每月初执行：

```bash
0 3 1 * *  mysql -uroot -proot localminidrama < /path/to/archive_call_logs.sql
```

### 11.4 监控指标建议

| 指标 | 数据来源 | 告警阈值建议 |
|------|---------|-------------|
| 模型失败率 | `ai_model_call_logs` 按 model 聚合 | 5 分钟窗口 > 30% |
| 熔断中模型数 | `ai_model_circuit_state` WHERE state<>'closed' | > 0 持续 5 分钟 |
| fallback 触发率 | `ai_model_call_logs` SUM(is_fallback)/COUNT(*) | 1 小时窗口 > 20% |
| 平均调用耗时 | `ai_model_call_logs` AVG(latency_ms) | P95 > 15s |
| 单模型日成本 | `ai_model_call_logs` SUM(cost) GROUP BY model | 超预算 |

---

## 12. 常见问题排查

### Q1: routeModel 一直返回兜底默认配置，不走路由规则

**原因**：路由规则未配置，或 `primaryConfigId` 对应的 `ai_service_configs` 已被删除/禁用。

**排查**：

```sql
SELECT r.rule_key, r.task_type, r.quality_tier, r.is_active,
       c.id AS cfg_id, c.is_active AS cfg_active
FROM ai_routing_rules r
LEFT JOIN ai_service_configs c ON r.primary_config_id = c.id
WHERE r.task_type = 'text';
```

若 `cfg_id` 为 NULL 或 `cfg_active=0`，需修正规则的 `primary_config_id`。

### Q2: 模型已恢复但熔断未解除

**原因**：`getCircuitState` 是惰性转换，需有请求触发才会从 open→half_open。若该模型无流量，状态会一直停留在 open。

**解决**：手动执行第 11.2 节的 SQL 重置，或主动发一次请求触发状态读取。

### Q3: failure_count 异常大

**原因**：旧版本 `recordFailure` 在 open 状态仍累加计数。当前版本已修复（open 时仅更新 last_failure_at）。

**解决**：升级到最新 `modelRoutingService.js`，并执行：

```sql
UPDATE ai_model_circuit_state SET failure_count = 5 WHERE state = 'open' AND failure_count > 5;
```

### Q4: 集成测试通过但生产环境 fallback 不生效

**原因**：路由规则未配置 `fallbackConfigId`，或 fallback 模型也处于 open 状态。

**排查**：

```bash
# 查看路由决策返回的 isFallback 字段
curl -X POST http://localhost:5679/api/v1/ai/model-routing/route \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"taskType":"text","qualityTier":"standard"}'
```

检查返回的 `fallbackConfig` 是否为 null。

### Q5: ai_model_call_logs 表过大影响查询

**解决**：按第 11.3 节定期归档，并确认 3 个索引（`idx_mcl_model`、`idx_mcl_status`、`idx_mcl_task`）已创建。

```sql
SHOW INDEX FROM ai_model_call_logs;
```

---

## 13. 回滚步骤

### 13.1 禁用路由引擎（保留表）

将所有路由规则设为 `is_active=0`，`routeModel` 会跳过规则直接走兜底默认配置：

```sql
UPDATE ai_routing_rules SET is_active = 0 WHERE is_active = 1;
```

业务服务若使用方式一集成，需同时回退 `routeModel` 调用（改为直接取默认配置）。

### 13.2 完全回滚（删除表）

```sql
DROP TABLE IF EXISTS ai_model_circuit_state;
DROP TABLE IF EXISTS ai_model_call_logs;
DROP TABLE IF EXISTS ai_routing_rules;
```

并移除 `backend-node/src/routes/index.js` 中的挂载行：

```js
// 删除这一行
r.use('/ai/model-routing', modelRoutingRoutes(db, log));
```

> ⚠️ 删除 `ai_model_call_logs` 会丢失历史调用统计，评分系统将无数据可用，请谨慎操作。

---

## 附录：交付物清单

| 类型 | 文件 | 说明 |
|------|------|------|
| 服务 | `backend-node/src/services/modelRoutingService.js` | 路由规则 CRUD + 熔断器 + 智能路由 + 调用记录 + 统计评分 |
| 路由 | `backend-node/src/routes/modelRouting.js` | 6 个 REST 端点 |
| 迁移 | `backend-node/migrations/36_s4_model_routing.sql` | 3 张表 + 索引 |
| 单元测试 | `backend-node/test/s4ModelRouting.test.js` | 10 个用例 |
| 集成测试 | `backend-node/test/s4ModelRoutingIntegration.test.js` | 6 个熔断全链路用例 |
| Swagger | `backend-node/src/routes/swaggerSpec.js` | 已纳入 `/api/v1/docs` |
