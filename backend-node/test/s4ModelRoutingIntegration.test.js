// ============================================================
// s4ModelRoutingIntegration.test.js — Sprint 4 Integration Test
// S4-T07: AI模型智能路由引擎 — 熔断机制集成测试
//
// 与单元测试（s4ModelRouting.test.js）的区别：
//   - 单元测试：对 recordFailure / recordSuccess / getCircuitState / routeModel 独立验证
//   - 本集成测试：模拟真实链路 — 通过 recordCallLog 连续制造失败，
//     验证熔断器状态转换 + 故障转移逻辑 + 冷却后半开探测 + 成功恢复；
//     同时验证 routeModel() 决策在不同阶段的正确路由。
//
// 覆盖 6 条集成用例：
//   1. S4-INT-RT-01: 初始 closed → 主模型正常路由，不触发 fallback
//   2. S4-INT-RT-02: 连续 N 次失败 → closed→open，校验 failure_count 递增
//   3. S4-INT-RT-03: 主模型 open → routeModel 自动故障转移到 fallback 模型
//   4. S4-INT-RT-04: fallback 也连续失败 → fallback 也熔断 → routeModel 兜底默认
//   5. S4-INT-RT-05: 冷却过后（half-open），一次成功立即恢复为 closed
//   6. S4-INT-RT-06: 综合链路：创建路由规则 → 失败触发熔断 → fallback → 恢复 → getModelStats 聚合数据
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------- 工具 ----------
function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4rt-'));
  const dbFile = path.join(dir, 'test.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE ai_routing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key VARCHAR(64) NOT NULL UNIQUE,
      task_type VARCHAR(32) NOT NULL,
      quality_tier VARCHAR(32) DEFAULT 'standard',
      primary_config_id INT,
      primary_model VARCHAR(255),
      fallback_config_id INT,
      fallback_model VARCHAR(255),
      max_cost_per_call DECIMAL(10,4) DEFAULT 0,
      priority INT DEFAULT 100,
      is_active TINYINT(1) DEFAULT 1,
      description VARCHAR(512),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE ai_model_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id BIGINT, drama_id BIGINT, config_id INT,
      service_type VARCHAR(32), provider VARCHAR(64), model VARCHAR(255),
      task_type VARCHAR(64), status VARCHAR(32) DEFAULT 'success',
      is_fallback TINYINT(1) DEFAULT 0, latency_ms INT DEFAULT 0,
      cost DECIMAL(10,4) DEFAULT 0, quality_score DECIMAL(4,2),
      error_message TEXT, routing_rule_key VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE ai_model_circuit_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_id INT NOT NULL, model VARCHAR(255) NOT NULL,
      state VARCHAR(16) DEFAULT 'closed', failure_count INT DEFAULT 0,
      last_failure_at DATETIME, opened_at DATETIME, half_open_at DATETIME,
      UNIQUE(config_id, model)
    );
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider VARCHAR(64), service_type VARCHAR(32), model TEXT,
      endpoint VARCHAR(512), api_key TEXT, is_active TINYINT(1) DEFAULT 1,
      is_default TINYINT(1) DEFAULT 0, priority INT DEFAULT 0,
      deleted_at DATETIME, created_at DATETIME, updated_at DATETIME
    );
  `);
  return { db, dir };
}

function makeLog() { return { info: () => {}, warn: () => {}, error: () => {} }; }

const routing = require('../src/services/modelRoutingService');

// ========== 集成用例 1 ==========
test('S4-INT-RT-01: 初始 closed → 主模型正常路由，不触发 fallback', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 主 / 备配置
  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, is_active, is_default)
    VALUES (1,'prov-A','image','["primary-1"]',1,1),
           (2,'prov-B','image','["fallback-1"]',1,0)`).run();

  // 创建路由规则
  routing.upsertRule(db, log, {
    ruleKey: 'img-std', taskType: 'image', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'primary-1',
    fallbackConfigId: 2, fallbackModel: 'fallback-1',
    description: '集成测试用规则',
  });

  // 主模型熔断器 closed（初始状态）
  assert.equal(routing.getCircuitState(db, 1, 'primary-1').state, 'closed');

  // 路由决策：应选中主模型
  const route1 = routing.routeModel(db, { taskType: 'image', qualityTier: 'standard' });
  assert.equal(route1.model, 'primary-1');
  assert.equal(route1.isFallback, false);
  assert.equal(route1.config.id, 1);
  assert.ok(route1.rule, '应命中路由规则');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ========== 集成用例 2 ==========
test('S4-INT-RT-02: 连续 N 次失败触发熔断 closed→open，failure_count 递增', () => {
  const { db, dir } = makeDb();
  const threshold = routing.CIRCUIT_FAILURE_THRESHOLD;

  // 先制造 1 次成功（初始化熔断器）
  const r0 = routing.recordSuccess(db, 7, 'model-prime');
  assert.equal(r0.state, 'closed');
  assert.equal(r0.failureCount, 0);

  // 连续 threshold-1 次失败，应保持 closed
  let last = r0;
  for (let i = 1; i <= threshold - 1; i++) {
    last = routing.recordFailure(db, 7, 'model-prime');
    assert.equal(last.state, 'closed', `第${i}次失败，state 应为 closed`);
    assert.equal(last.failureCount, i, `第${i}次失败，failure_count 应为 ${i}`);
  }

  // 第 threshold 次失败 → 触发 open
  const rOpen = routing.recordFailure(db, 7, 'model-prime');
  assert.equal(rOpen.state, 'open', `达到阈值(${threshold}) 应触发熔断 open`);
  assert.equal(rOpen.failureCount, threshold);
  assert.ok(rOpen.openedAt, 'opened_at 字段应当被设置');
  assert.ok(rOpen.lastFailureAt, 'last_failure_at 应当被设置');

  // 超过阈值继续失败 — state 保持 open（不越开越多）
  for (let i = 0; i < 5; i++) {
    const rAgain = routing.recordFailure(db, 7, 'model-prime');
    assert.equal(rAgain.state, 'open', '超过阈值继续失败，保持 open');
    assert.equal(rAgain.failureCount, threshold,
      '达到阈值后 failure_count 不应再继续累加（避免溢出）');
  }

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ========== 集成用例 3 ==========
test('S4-INT-RT-03: 主模型 open → routeModel 自动故障转移到 fallback', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, is_active, is_default)
    VALUES (1,'p1','text','["gpt-main"]',1,1),
           (2,'p2','text','["gpt-fallback"]',1,0),
           (3,'p3','text','["gpt-lastresort"]',1,0)`).run();

  routing.upsertRule(db, log, {
    ruleKey: 't-s', taskType: 'text', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'gpt-main',
    fallbackConfigId: 2, fallbackModel: 'gpt-fallback',
  });

  // 初始：主模型正常
  assert.equal(routing.routeModel(db, { taskType: 'text' }).model, 'gpt-main');

  // 打爆主模型熔断器
  for (let i = 0; i < routing.CIRCUIT_FAILURE_THRESHOLD; i++) {
    routing.recordFailure(db, 1, 'gpt-main');
  }
  assert.equal(routing.getCircuitState(db, 1, 'gpt-main').state, 'open');

  // 路由决策应故障转移到 fallback
  const routeAfter = routing.routeModel(db, { taskType: 'text' });
  assert.equal(routeAfter.model, 'gpt-fallback', '主模型熔断 → 应切到 fallback 模型');
  assert.equal(routeAfter.isFallback, true, 'isFallback 标志应为 true');
  assert.equal(routeAfter.config.id, 2);
  assert.ok(routeAfter.rule, '依然通过路由规则匹配，不是兜底默认配置');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ========== 集成用例 4 ==========
test('S4-INT-RT-04: fallback 也连续熔断 → routeModel 兜底到默认 active config', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, is_active, is_default)
    VALUES (1,'p1','tts','["v-primary"]',1,0),
           (2,'p2','tts','["v-fallback"]',1,0),
           (3,'p3','tts','["v-default"]',1,1)`).run();  // 默认配置 id=3

  routing.upsertRule(db, log, {
    ruleKey: 'tts-s', taskType: 'tts', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'v-primary',
    fallbackConfigId: 2, fallbackModel: 'v-fallback',
  });

  const TH = routing.CIRCUIT_FAILURE_THRESHOLD;

  // 主 + 备 都熔断
  for (let i = 0; i < TH; i++) { routing.recordFailure(db, 1, 'v-primary'); }
  for (let i = 0; i < TH; i++) { routing.recordFailure(db, 2, 'v-fallback'); }
  assert.equal(routing.getCircuitState(db, 1, 'v-primary').state, 'open');
  assert.equal(routing.getCircuitState(db, 2, 'v-fallback').state, 'open');

  // 规则内的主备都挂 → 应绕过规则，兜底到默认 active config（id=3, v-default）
  const r = routing.routeModel(db, { taskType: 'tts' });
  assert.equal(r.config.id, 3, '主备都熔断，应兜底到默认 active 配置');
  assert.equal(r.model, 'v-default');
  assert.equal(r.rule, null, '兜底场景 rule 应为 null');
  assert.equal(r.isFallback, false);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ========== 集成用例 5 ==========
test('S4-INT-RT-05: 冷却过后 half-open → 一次成功立即恢复 closed', () => {
  const { db, dir } = makeDb();

  const COOLDOWN = routing.CIRCUIT_COOLDOWN_MS;

  // 1. 先让熔断器进入 open 状态
  for (let i = 0; i < routing.CIRCUIT_FAILURE_THRESHOLD; i++) {
    routing.recordFailure(db, 9, 'hot-model');
  }
  let st = routing.getCircuitState(db, 9, 'hot-model');
  assert.equal(st.state, 'open');

  // 2. 模拟「冷却时间尚未到」→ 依旧是 open（getCircuitState 带超时判断）
  //    由于 opened_at 是刚刚设的，距离现在 < cooldown，应仍为 open
  st = routing.getCircuitState(db, 9, 'hot-model');
  assert.equal(st.state, 'open', '冷却未到，state 保持 open');

  // 3. 模拟「冷却时间已过」：把 opened_at 往前调到 cooldown + 1 秒前
  const fakePast = new Date(Date.now() - COOLDOWN - 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE ai_model_circuit_state SET opened_at = ? WHERE config_id = 9 AND model = 'hot-model'`)
    .run(fakePast);

  // 4. 现在 getCircuitState → 应变为 half_open
  st = routing.getCircuitState(db, 9, 'hot-model');
  assert.equal(st.state, 'half_open', '冷却已过，state 应过渡为 half_open（探测状态）');
  assert.ok(st.halfOpenAt, 'half_open_at 应被写入');

  // 5. 一次成功 → 立即恢复 closed，并清空 failure_count
  const r = routing.recordSuccess(db, 9, 'hot-model');
  assert.equal(r.state, 'closed', 'half_open 下一次成功 → 恢复 closed');
  assert.equal(r.failureCount, 0, '恢复后 failure_count 应重置为 0');

  // 6. 再次失败（验证不再保持 open）— 正常计数递增 → closed
  const r2 = routing.recordFailure(db, 9, 'hot-model');
  assert.equal(r2.state, 'closed');
  assert.equal(r2.failureCount, 1, '恢复后，下一次失败重新计数');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ========== 集成用例 6 ==========
test('S4-INT-RT-06: 综合链路 — 规则→失败熔断→fallback→恢复→getModelStats 聚合', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // Step A: 预置配置 + 路由规则
  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, is_active, is_default)
    VALUES (11,'vendorX','image','["img-gold"]',1,1),
           (12,'vendorY','image','["img-silver"]',1,0)`).run();
  routing.upsertRule(db, log, {
    ruleKey: 'img-pro', taskType: 'image', qualityTier: 'high',
    primaryConfigId: 11, primaryModel: 'img-gold',
    fallbackConfigId: 12, fallbackModel: 'img-silver',
    maxCostPerCall: 0.8, priority: 1,
  });

  // Step B: 正常成功调用 5 次，记录日志
  for (let i = 0; i < 5; i++) {
    routing.recordCallLog(db, {
      userId: 1, dramaId: 1, configId: 11, serviceType: 'image',
      provider: 'vendorX', model: 'img-gold', taskType: 'image_gen',
      status: 'success', isFallback: false, latencyMs: 1200 + i * 10,
      cost: 0.04, qualityScore: 92, routingRuleKey: 'img-pro',
    });
  }
  // 熔断器 closed，路由 → img-gold
  assert.equal(routing.routeModel(db, { taskType: 'image', qualityTier: 'high' }).model, 'img-gold');

  // Step C: 连续 TH 次失败 → 主模型熔断
  const TH = routing.CIRCUIT_FAILURE_THRESHOLD;
  for (let i = 0; i < TH; i++) {
    routing.recordCallLog(db, {
      configId: 11, serviceType: 'image', provider: 'vendorX',
      model: 'img-gold', taskType: 'image_gen',
      status: 'failed', errorMessage: 'timeout: 30000ms',
      latencyMs: 30000,
    });
  }
  assert.equal(routing.getCircuitState(db, 11, 'img-gold').state, 'open');

  // Step D: 触发熔断 → routeModel 改走 fallback (img-silver)
  const route = routing.routeModel(db, { taskType: 'image', qualityTier: 'high' });
  assert.equal(route.model, 'img-silver');
  assert.equal(route.isFallback, true);

  // Step E: fallback 成功 3 次 + 失败 1 次（累计）
  for (let i = 0; i < 3; i++) {
    routing.recordCallLog(db, {
      configId: 12, serviceType: 'image', provider: 'vendorY',
      model: 'img-silver', taskType: 'image_gen',
      status: 'success', isFallback: true, latencyMs: 2500, cost: 0.02,
      qualityScore: 85, routingRuleKey: 'img-pro',
    });
  }
  routing.recordCallLog(db, {
    configId: 12, serviceType: 'image', provider: 'vendorY',
    model: 'img-silver', taskType: 'image_gen', status: 'failed',
    errorMessage: 'rate limit', isFallback: true,
  });

  // Step F: 主模型冷却过期 → 一次成功 → 恢复 → getModelStats 校验
  const cooldownPast = new Date(Date.now() - routing.CIRCUIT_COOLDOWN_MS - 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE ai_model_circuit_state SET opened_at = ? WHERE config_id = 11 AND model = 'img-gold'`)
    .run(cooldownPast);
  routing.recordSuccess(db, 11, 'img-gold'); // 模拟一次探测成功
  assert.equal(routing.getCircuitState(db, 11, 'img-gold').state, 'closed',
    '主模型 half_open 下成功 → 恢复 closed');

  // Step G: getModelStats 聚合校验
  const stats = routing.getModelStats(db, {});
  assert.ok(stats.length >= 2, '应至少有 img-gold 与 img-silver 的统计');

  const gold = stats.find(s => s.model === 'img-gold');
  assert.ok(gold, '应能查到 img-gold 数据');
  assert.equal(gold.totalCalls, 5 + TH, `img-gold 应为 5 成功 + ${TH} 失败 = ${5+TH} 次总调用`);
  assert.equal(gold.successCount, 5, 'img-gold 成功 5 次');
  assert.equal(gold.failedCount, TH, `img-gold 失败 ${TH} 次`);
  const goldSuccessRate = Number(((5 / (5 + TH)) * 100).toFixed(1));
  assert.equal(gold.successRate, goldSuccessRate, `成功率应为 ${goldSuccessRate}%`);

  const silver = stats.find(s => s.model === 'img-silver');
  assert.ok(silver);
  assert.equal(silver.totalCalls, 4, 'img-silver 共 4 次');
  assert.equal(silver.successCount, 3);
  assert.equal(silver.failedCount, 1);
  assert.equal(Number(silver.totalCost.toFixed(2)), Number((3 * 0.02).toFixed(2)),
    'img-silver 总成本应为 3 * 0.02 = 0.06');

  // 综合评分应为正数（成功率/速度/质量加权）
  assert.ok(gold.score > 0, '综合评分应为正数');
  assert.ok(silver.score > 0, '综合评分应为正数');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
