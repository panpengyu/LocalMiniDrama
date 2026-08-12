# SQLite 兼容迁移修复方案

> 范围：`backend-node/src/` 运行时代码中未做 `db.type` 分支、在 SQLite（`better-sqlite3`）下会报错或行为不一致的 MySQL 专用语法
> 背景：本项目通过 `db.type === 'mysql'` 区分双数据库；SQLite 层直接返回原生实例、**不做 SQL 方言重写**，故未分支的 MySQL 专用语句在 SQLite 下由引擎原样解析 → 报错
> 现状说明：当前开发/生产主库为 MySQL，以下风险仅在切换 SQLite 时暴露；本方案为可选加固，供团队按 SQLite 支持目标决定是否实施
> 取证日期：2026-08-12（所有行号经真实代码核对）

---

## 一、风险总览

> ✅ **实施状态（2026-08-12）**：R1~R6 全部已修复并落地，均按 `db.type` 分支范式实现，MySQL 主库零回归（全量 572 单测通过），SQLite 分支经 `scripts/smoke_r3_r6_sqlite.js` + 内存库单测验证。

| # | 模块 | 位置 | MySQL 专用语法 | SQLite 表现 | 严重度 | 状态 |
|---|------|------|----------------|-------------|--------|------|
| R1 | `settingsService.js` | :64-67, :81-84 | `ON DUPLICATE KEY UPDATE` | 语法报错，配置读写核心路径失效 | 🔴 高 | ✅ 已修复 |
| R2 | `promptOverridesService.js` | :23, :25 | `ON DUPLICATE KEY UPDATE` + 反引号 | 语法报错，提示词覆盖保存失效 | 🔴 高 | ✅ 已修复 |
| R3 | `collaborationService.js` | :160, :179, :190, :203 | `NOW()` / `DATE_ADD(...INTERVAL...SECOND)` | 函数不存在，协作节点锁功能不可用 | 🔴 高 | ✅ 已修复 |
| R4 | `videoService.js` | :39 | `NOW() - INTERVAL 5 MINUTE` | 函数不存在，`status=processing` 列表查询报错 | 🟠 中 | ✅ 已修复 |
| R5 | `routes/admin.js` | :525, :586 | `NOW()`（创建/更新用户时间戳） | 函数不存在，管理员建/改用户报错 | 🟠 中 | ✅ 已修复（改用 `CURRENT_TIMESTAMP`，双库通用） |
| R6 | `INSERT IGNORE`（未分支残留） | `storyboardService.js:38,128`、`propService.js:115`、`dramaImportService.js:359`、`episodeStoryboardService.js:524,555,750,1402,1408` | `INSERT IGNORE` | 语法报错；部分包在 try/catch 内会静默丢失关联数据 | 🟠 中 | ✅ 已修复（9 处全部分支 `INSERT OR IGNORE`） |

> 已保护、无需处理：`editService.js` / `audioAlignService.js` 的 `INFORMATION_SCHEMA`/`DESCRIBE`（try/catch 回退 PRAGMA）；`financeService`/`analyticsService`/`versionService`/`admin` 的 `DATE_FORMAT`（分支 `strftime`）；`characterGenerationService:183` / `dramaService:803` / `dramaImportService:211` / `admin:63` 的 `INSERT IGNORE`（已分支 `INSERT OR IGNORE`）；`libraryDedup.js`（本轮已修复）。

---

## 二、通用修复原则

1. **优先复用已有范式**：项目内已有成熟的 `db.type === 'mysql' ? A : B` 三目分支写法（见 `characterGenerationService.js:181-183` 的 `INSERT IGNORE` 处理、`versionService.js:345` 的 `isMysql` 处理），新修复应保持一致风格。
2. **时间戳统一走参数化 ISO 字符串**：`settingsService`/`promptOverridesService` 已在 JS 层生成 `new Date().toISOString()` 并作为参数传入，两库均可存储，**无需用 `NOW()`**。真正依赖「数据库时钟」的只有 `collaborationService` 的锁过期（跨节点时钟一致性），需单独处理。
3. **UPSERT 语义映射**：MySQL `ON DUPLICATE KEY UPDATE` ↔ SQLite `ON CONFLICT(<唯一键>) DO UPDATE SET ...`（SQLite 3.24+，`better-sqlite3` 已支持）。注意 SQLite 侧引用新值用 `excluded.<col>`。
4. **`INSERT IGNORE` 映射**：MySQL `INSERT IGNORE` ↔ SQLite `INSERT OR IGNORE`。
5. **验证要求**：每处修复后须在 SQLite 内存库与真实 MySQL **双库**下各跑一次，确保语义一致（幂等 upsert 结果相同、锁过期行为一致）。

---

## 三、逐项修复方案

### R1 — settingsService.js（`ON DUPLICATE KEY UPDATE`）

**现状**（[settingsService.js:61-68](file:///Users/panpengyu/Desktop/AI项目/LocalMiniDrama_web/backend-node/src/services/settingsService.js#L61-L68)）：

```js
function setGlobalSetting(db, key, value) {
  const now = new Date().toISOString();
  const str = JSON.stringify(value);
  db.prepare(
    `INSERT INTO global_settings (\`key\`, value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = ?, updated_at = ?`
  ).run(key, str, now, str, now);
}
```

**修复**：按 `db.type` 分支，SQLite 走 `ON CONFLICT(\`key\`) DO UPDATE`（唯一键为 `key`）：

```js
function setGlobalSetting(db, key, value) {
  const now = new Date().toISOString();
  const str = JSON.stringify(value);
  const sql = db.type === 'mysql'
    ? 'INSERT INTO `global_settings` (`key`, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = ?'
    : 'INSERT INTO `global_settings` (`key`, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
  const params = db.type === 'mysql' ? [key, str, now, str, now] : [key, str, now];
  db.prepare(sql).run(...params);
}
```

`setUserSetting`（:78-85）同理处理，唯一键为复合键 `(user_id, \`key\`)` → SQLite 用 `ON CONFLICT(user_id, \`key\`)`。

> 前置检查：确认 `global_settings.key` 与 `user_settings.(user_id, key)` 在两库 schema 中确有唯一索引（否则 ON CONFLICT 不生效）。

### R2 — promptOverridesService.js（`ON DUPLICATE KEY UPDATE`）

**现状**（[promptOverridesService.js:20-27](file:///Users/panpengyu/Desktop/AI项目/LocalMiniDrama_web/backend-node/src/services/promptOverridesService.js#L20-L27)）——两条分支（有/无 userId）。

**修复**：同 R1 模式，唯一键分别为 `(\`key\`, user_id)` 与 `\`key\``。示例（有 userId 分支）：

```js
const sql = db.type === 'mysql'
  ? 'INSERT INTO prompt_overrides (`key`, content, user_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE content = ?, updated_at = ?'
  : 'INSERT INTO prompt_overrides (`key`, content, user_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(`key`, user_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at';
const params = db.type === 'mysql' ? [key, content, userId, now, content, now] : [key, content, userId, now];
db.prepare(sql).run(...params);
```

### R3 — collaborationService.js（`NOW()` / `DATE_ADD`）— 依赖数据库时钟，重点

**现状**：节点锁的过期时间刻意用**数据库时钟**（[:158 注释](file:///Users/panpengyu/Desktop/AI项目/LocalMiniDrama_web/backend-node/src/services/collaborationService.js#L158) 明确说明「使用数据库时钟避免时区偏移」）。涉及 4 处：
- `:160` `DELETE ... WHERE expires_at < NOW()`
- `:179` `SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)`
- `:190` `VALUES (..., NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))`
- `:203`（同 :179）

**修复思路**：引入两个内部时间表达式常量，按 `db.type` 生成——
- 当前时间：MySQL `NOW()` ↔ SQLite `datetime('now')`
- 未来 N 秒：MySQL `DATE_ADD(NOW(), INTERVAL ? SECOND)` ↔ SQLite `datetime('now', '+' || ? || ' seconds')`

```js
// 文件顶部封装
function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}
function futureExpr(db) {
  // 占位符消费一个 TTL 秒数参数
  return db.type === 'mysql'
    ? 'DATE_ADD(NOW(), INTERVAL ? SECOND)'
    : "datetime('now', '+' || ? || ' seconds')";
}
```

改写示例（:179 续约）：

```js
db.prepare(
  `UPDATE node_locks SET expires_at = ${futureExpr(db)}, socket_id = ? WHERE id = ?`
).run(LOCK_TTL_SECONDS, socketId || existing.socket_id, existing.id);
```

> 注意：SQLite `datetime('now')` 返回 UTC。若表内既有数据以本地时区存储，需统一口径；建议锁表统一用 UTC，比较与生成都走同一函数，避免混用。`:190` 的 INSERT 需同时替换 `NOW()`→`nowExpr(db)` 与 `DATE_ADD(...)`→`futureExpr(db)`，注意参数顺序。

### R4 — videoService.js（`NOW() - INTERVAL 5 MINUTE`）

**现状**（[videoService.js:38-39](file:///Users/panpengyu/Desktop/AI项目/LocalMiniDrama_web/backend-node/src/services/videoService.js#L38-L39)）：

```js
if (query.status === 'processing') {
  sql += " AND (status = 'processing' OR (status IN ('completed','failed') AND updated_at >= NOW() - INTERVAL 5 MINUTE))";
}
```

**修复**：

```js
if (query.status === 'processing') {
  const recentExpr = db.type === 'mysql'
    ? "NOW() - INTERVAL 5 MINUTE"
    : "datetime('now', '-5 minutes')";
  sql += ` AND (status = 'processing' OR (status IN ('completed','failed') AND updated_at >= ${recentExpr}))`;
}
```

### R5 — routes/admin.js（创建/更新用户的 `NOW()`）

**现状**：`:525` 建用户 `VALUES (..., NOW(), NOW())`；`:586` 改用户 `updates.push('updated_at = NOW()')`。

**修复**：这两处不依赖数据库时钟，直接用参数化 ISO 字符串最简洁、跨库一致：
- `:525` 将两个 `NOW()` 改为占位符 `?`，`run` 参数追加两个 `new Date().toISOString()`。
- `:586` 改为 `updates.push('updated_at = ?')` 并向参数数组 push `new Date().toISOString()`。

> 若希望保持"数据库时钟"语义，也可用 R3 的 `nowExpr(db)`；但用户时间戳无跨节点一致性需求，ISO 字符串参数化更简单。

### R6 — INSERT IGNORE 残留（未分支的 8 处）

**现状**：以下 8 处仍是裸 `INSERT IGNORE`（同库内已有分支范式可参照 `characterGenerationService.js:181-183`）：

| 文件:行 | 语句 |
|---------|------|
| `storyboardService.js:38` | `INSERT IGNORE INTO storyboard_characters ...` |
| `storyboardService.js:128` | `INSERT IGNORE INTO storyboard_props ...` |
| `propService.js:115` | `INSERT IGNORE INTO storyboard_props ...` |
| `dramaImportService.js:359` | `INSERT IGNORE INTO storyboard_props ...`（注意同文件 :211 已分支，此处漏改） |
| `episodeStoryboardService.js:524/555/750` | `INSERT IGNORE INTO storyboard_props ...` |
| `episodeStoryboardService.js:1402/1408` | `INSERT IGNORE INTO storyboard_characters/props ...` |

**修复**：统一替换为分支写法：

```js
const insSql = (db.type === 'mysql'
  ? 'INSERT IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)'
  : 'INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
const ins = db.prepare(insSql);
```

> 建议抽取一个小工具 `insertIgnore(db, tableCols)` 或在各 service 顶部定义 `IGNORE = db.type === 'mysql' ? 'IGNORE' : 'OR IGNORE'` 复用，减少重复。

---

## 四、建议实施顺序与工作量

| 阶段 | 内容 | 优先级 | 预估 |
|------|------|--------|------|
| P1 | R1 settingsService + R2 promptOverridesService（配置/提示词核心路径，UPSERT 报错必现） | 🔴 最高 | 0.5d |
| P2 | R3 collaborationService（协作锁，需处理时钟语义 + 双库验证） | 🔴 高 | 0.5d |
| P3 | R4 videoService + R5 admin.js（NOW 时间函数，改动小） | 🟠 中 | 0.3d |
| P4 | R6 INSERT IGNORE 8 处（机械替换 + 抽取复用） | 🟠 中 | 0.3d |
| P5 | 双库回归测试 + 补充 SQLite 专项单测 | — | 0.4d |

**合计约 2 人日。**

---

## 五、测试与验收

1. **双库单测**：为 R1~R3 各补一条「SQLite 内存库 + 真实 MySQL」双跑用例，断言 upsert 幂等结果一致、锁过期行为一致。
2. **回归基线**：修复后全量 `node --test test/*.test.js` 须保持 **572/572 全绿**（当前基线）。
3. **手工冒烟**（SQLite 模式，`config.yaml` 切 `type: sqlite`）：保存全局/用户设置、保存提示词覆盖、协作加锁/续约/过期回收、视频 `status=processing` 列表、管理员建/改用户、分镜关联角色/道具批量写入 —— 全部无报错。

---

## 六、结论

共识别 **6 类风险点**（R1~R6），均为**既有跨库兼容缺陷**，与 Sprint 12 改动无关，且**仅在 SQLite 模式下暴露**（当前主库 MySQL 不受影响）。修复遵循项目已有的 `db.type` 分支范式，无架构改动，预估 2 人日。R1/R2（UPSERT）与 R3（协作锁时钟）为高优先级，建议优先处理。
