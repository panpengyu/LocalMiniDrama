# Sprint 14 · 模板市场数据快照（收益流水 + 分成比例）

> 快照时间：2026-08-13 · 数据来源：本地真实 MySQL（后端 `:5679` 实时接口 + 直查）
> 用途：周报同步 —— 演示数据核对 / 收益分成明细 / 审核工作台实时统计确认
> 关联报告：[Sprint14-模板市场验收报告.md](./Sprint14-模板市场验收报告.md)

---

## 一、演示数据显示核对结论

| 检查项 | 页面/接口 | 结果 |
| --- | --- | --- |
| 用户端模板市场画廊 | `:3013/marketplace` | ✅ 正常：4 在售 · 4 累计获取 · 2 认证创作者，4 个演示模板与分类筛选（都市 2 / costume 1 / life 1）均显示 |
| 管理端审核工作台概览 | `:3014/marketplace/review` | ✅ 正常：4 在售 · 1 待审核 · 4 累计获取 · GMV ¥50.00 · 平台分成 ¥13.00 · 2/2 认证创作者 |
| 后端市场概览接口 | `GET /api/v1/marketplace/stats` | ✅ 与页面一致（见下） |

> 📝 **一个观察**：首次打开审核工作台时曾短暂显示「0 / 暂无数据」，经直查数据库与接口确认数据完整（见第四节），刷新/重新加载后统计恢复正常。判定为**前端视图未及时拉取的瞬时态**，非数据丢失。**排查结论（本次）**：与「刷新概览」按钮的初始态**无关**——该按钮仅绑定 `:loading="loadingStats"`（初值 `false`），全组件无任何 `:disabled` 绑定。真实成因是 `stats` 初始化为全零的 `emptyStats()` 且概览网格无条件渲染，在 `onMounted` 异步 `loadStats()` 完成前的窗口期直接呈现零值；且旧逻辑在请求失败时于 `catch` 中静默重置为全零、无提示。**已修复**：新增 `statsLoaded` 标志 + 首屏骨架占位（拉取成功前不渲染零值），失败时保留旧数据并 `ElMessage` 提示。详见 [ReviewWorkbench.vue](../../front-admin/src/views/marketplace/ReviewWorkbench.vue)。

**`GET /api/v1/marketplace/stats` 实时返回**

```json
{
  "templates":    { "total": 5, "listed": 4, "in_review": 1, "paid": 2 },
  "transactions": { "downloads": 4, "purchases": 2, "gmv": 50 },
  "revenue":      { "platform_income": 13, "creator_income": 37 },
  "creators":     { "total": 2, "approved": 2 },
  "platform_rate": 0.3
}
```

---

## 二、分成比例明细

平台默认分成比例 `platform_rate = 0.3`（平台抽成 30%）。创作者可设置**专属比例**覆盖默认值；`marketplace_creators.commission_rate` 存储的是**平台抽成比例**，创作者到手比例 = `1 − commission_rate`。

| 创作者 | 用户ID | 认证 | 平台抽成（DB 存储） | 创作者到手 | 收款账户 | 累计收益 | 可提现余额 | 已提现 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 晚风工作室 | 2 | approved | **0.20（专属）** | **80%** | 支付宝 · 138****00 | ¥16.00 | ¥1.00 | ¥0.00 |
| 光影叙事 | 3 | approved | 平台默认 0.30 | 70% | 支付宝 · 139****00 | ¥21.00 | ¥21.00 | ¥0.00 |

> `commission_rate = null` 表示未设专属比例，结算时回落平台默认 0.30。管理端「创作者认证」页展示为「创作者 80% / 70%」，即到手比例。

---

## 三、分成结算明细（marketplace_settlements）

| 结算ID | 模板ID | 买家 | 创作者 | 成交额 | 平台抽成率 | 平台分成 | 创作者分成 | 结算时间 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14 | 84 | user 4 | 晚风工作室(14) | ¥20.00 | 0.20 | ¥4.00 | **¥16.00** | 2026-08-13 05:56:57 |
| 15 | 85 | user 4 | 光影叙事(15) | ¥30.00 | 0.30 | ¥9.00 | **¥21.00** | 2026-08-13 05:56:57 |
| **合计** | | | | **¥50.00** | | **¥13.00** | **¥37.00** | |

**校验**：GMV ¥50 = ¥20 + ¥30 ✅；平台分成 ¥13 = ¥4 + ¥9 ✅；创作者分成 ¥37 = ¥16 + ¥21 ✅。专属比例（0.20）与默认比例（0.30）分别正确生效。

---

## 四、创作者收益流水（marketplace_creator_ledger）

### 晚风工作室（creator_id=14）

| 流水ID | 类型 | 金额 | 变更后余额 | 备注 | 时间 |
| --- | --- | --- | --- | --- | --- |
| 37 | income（收益入账） | +16.00 | 16.00 | 模板销售分成（订单 TP…D537A2） | 2026-08-13 05:56:57 |
| 39 | withdraw（提现出账） | −15.00 | 1.00 | 提现申请（WD202608131356575B65A4） | 2026-08-13 05:56:57 |

> 余额校验：16.00 − 15.00 = **1.00**（与创作者中心「可提现余额 ¥1.00」一致）。

### 光影叙事（creator_id=15）

| 流水ID | 类型 | 金额 | 变更后余额 | 备注 | 时间 |
| --- | --- | --- | --- | --- | --- |
| 38 | income（收益入账） | +21.00 | 21.00 | 模板销售分成（订单 TP…486B4E） | 2026-08-13 05:56:57 |

> 余额校验：21.00（无提现，余额=累计收益）。

---

## 五、提现记录（marketplace_withdrawals）

| 提现单号 | 创作者 | 金额 | 收款账户 | 状态 | 审核人 | 申请时间 |
| --- | --- | --- | --- | --- | --- | --- |
| WD202608131356575B65A4 | 晚风工作室(14) | ¥15.00 | 支付宝 · 13800000000 | **pending（待审核）** | — | 2026-08-13 05:56:57 |

> 该提现已冻结创作者 ¥15 余额（余额由 16 → 1），进入管理端「提现审核」队列，等待「通过打款 / 驳回」。

---

## 六、审核队列（marketplace_templates · 待审核）

| 模板 | 编号 | 创作者 | 分类 | 定价 | AI 预审 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| S14演示 待审核·校园青春 | MT20260813135657DE5D58 | 光影叙事 | 校园 | 免费 | AI通过 100 分 | ai_passed（待人工复核） |

---

## 七、本次新增截图

| 文件 | 说明 |
| --- | --- |
| `s14-screenshots/08-marketplace-verify-reseed.png` | 用户端模板市场 —— 重新播种后数据正常显示 |
| `s14-screenshots/09-admin-workbench-live-sync.png` | 管理端审核工作台 —— GMV/分成统计实时同步确认 |

---

## 八、审核队列并发压测（防重复 / 幂等 / 状态机一致性）

针对「多审核员同时人工复审同一模板」的并发风险，新增压测脚本 [stress_s14_review_concurrency.js](../../backend-node/scripts/stress_s14_review_concurrency.js)：直连本地真实 MySQL、走真实服务层，以**多进程**（各自独立 DB 连接）在同一起跑栅栏对同一 `ai_passed` 模板并发发起复审。

### 首轮暴露的缺陷（修复前）

| 断言 | 现象 | 判定 |
| --- | --- | --- |
| 恰好 1 个 approve 成功 | 8 并发全部成功（成功=8） | ❌ 状态机守卫被击穿 |
| 审计一致（1 条终态日志） | 写入 8 条 `approve` 日志 | ❌ 审计轨迹污染 |

**根因**：`manualReview` 采用「读取状态（guard）→ 事务内无条件 UPDATE」两步，存在 TOCTOU 窗口——并发下所有 worker 都读到 `ai_passed` 通过校验，各自的 `UPDATE ... WHERE id=?` 均生效，重复写日志。

### 修复方案

将状态流转改为**单条原子 UPDATE 自带前置条件**：`UPDATE ... WHERE id=? AND status IN ('pending','ai_reviewing','ai_passed')`，仅 `changes===1` 的调用判为唯一赢家、才写审计与刷新计数；其余 `changes===0` 抛 `NOT_REVIEWABLE`。上下架 `setListing` 同步采用 `WHERE id=? AND status=<from>` 原子守卫。

### 修复后压测结果（8 并发 × 3 轮 + 幂等轮 + 混合争用轮，全绿）

| 断言 | 结果 |
| --- | --- |
| A 原子性：恰好 1 个 approve 成功，其余 7 个 `NOT_REVIEWABLE` | ✅ |
| B 终态一致：`status=listed`，`listed_at`/`reviewer_id` 非空 | ✅ |
| C 审计一致：`manual` 终态日志恰好 1 条 | ✅ |
| D 计数不重复：`creator.template_count` == 真实 listed 条数 | ✅ |
| E 幂等：对已 listed 模板并发再 approve 全部被拒、状态与日志不变 | ✅ |
| F 混合争用：approve/reject 交替并发仍恰好 1 个终态胜出 | ✅ |

> 回归：`node --test test/s14TemplateMarketplace.test.js` —— 29/29 通过，非并发路径无回归。

---

## 九、复现命令

```bash
# 实时市场概览
curl -s http://localhost:5679/api/v1/marketplace/stats

# 重新播种演示数据（含分成结算 + 待审核提现）
cd backend-node && node scripts/seed_s14_marketplace_demo.js

# 审核队列并发压测（8 并发 × 5 轮 + approve/reject 混合争用）
cd backend-node && node scripts/stress_s14_review_concurrency.js --workers 8 --rounds 5 --mixed

# 将本快照导出为 PDF（零依赖，借助本机 Chrome headless）
node scripts/md-to-pdf.mjs "docs/reports/Sprint14-数据快照-收益与分成.md"
```
