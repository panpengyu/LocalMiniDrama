// ============================================================
// s4ModelRouting.test.js — Sprint 4
// S4-T07: AI模型智能路由引擎测试
// 覆盖场景：
//   1) 路由规则 CRUD（listRules / upsertRule / deleteRule）
//   2) routeModel 智能路由：规则匹配 → 主模型
//   3) routeModel 主模型熔断 → 故障转移到备选模型
//   4) routeModel 指定 preferModel 优先使用
//   5) routeModel 无规则 → 兜底默认配置
//   6) 熔断器：recordFailure 达到阈值触发 open
//   7) 熔断器：recordSuccess 重置为 closed
//   8) recordCallLog 记录调用日志 + 联动熔断状态
//   9) getModelStats 模型调用统计 + 综合评分
//  10) 常量校验
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4mr-'));
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

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const routingService = require('../src/services/modelRoutingService');

// ---------- 路由规则 CRUD ----------

test('S4-T07-1: 路由规则 CRUD（创建/查询/更新/删除）', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 新增
  const created = routingService.upsertRule(db, log, {
    ruleKey: 'image_standard', taskType: 'image', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'dall-e-3',
    fallbackConfigId: 2, fallbackModel: 'stable-diffusion-xl',
    maxCostPerCall: 0.5, priority: 100, description: '标准图像生成',
  });
  assert.ok(created.id);
  assert.equal(created.updated, false);

  // 查询
  const rules = routingService.listRules(db, { taskType: 'image' });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].ruleKey, 'image_standard');
  assert.equal(rules[0].primaryModel, 'dall-e-3');
  assert.equal(rules[0].fallbackModel, 'stable-diffusion-xl');
  assert.equal(rules[0].isActive, true);

  // 更新（相同 ruleKey）
  routingService.upsertRule(db, log, {
    ruleKey: 'image_standard', taskType: 'image', qualityTier: 'high',
    primaryConfigId: 3, primaryModel: 'midjourney-v6',
  });
  const updated = routingService.listRules(db, { taskType: 'image' });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].primaryModel, 'midjourney-v6');
  assert.equal(updated[0].qualityTier, 'high');

  // 删除
  const del = routingService.deleteRule(db, log, updated[0].id);
  assert.equal(del.deleted, true);
  assert.equal(routingService.listRules(db, {}).length, 0);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- routeModel 智能路由 ----------

test('S4-T07-2: routeModel 规则匹配 → 主模型', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 插入 AI 配置
  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, endpoint, api_key, is_active, is_default)
    VALUES (1, 'openai', 'image', 'dall-e-3', '/images/generations', 'sk-test', 1, 1)`).run();

  routingService.upsertRule(db, log, {
    ruleKey: 'image_standard', taskType: 'image', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'dall-e-3',
  });

  const result = routingService.routeModel(db, { taskType: 'image', qualityTier: 'standard' });
  assert.ok(result.config);
  assert.equal(result.model, 'dall-e-3');
  assert.equal(result.isFallback, false);
  assert.ok(result.rule);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T07-3: routeModel 主模型熔断 → 故障转移到备选模型', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 插入两个 AI 配置
  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, endpoint, api_key, is_active, is_default)
    VALUES (1, 'openai', 'image', 'dall-e-3', '/images/generations', 'sk-test', 1, 1)`).run();
  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, endpoint, api_key, is_active, is_default)
    VALUES (2, 'stability', 'image', 'sdxl', '/images', 'sk-stab', 1, 0)`).run();

  routingService.upsertRule(db, log, {
    ruleKey: 'image_standard', taskType: 'image', qualityTier: 'standard',
    primaryConfigId: 1, primaryModel: 'dall-e-3',
    fallbackConfigId: 2, fallbackModel: 'sdxl',
  });

  // 将主模型熔断
  for (let i = 0; i < routingService.CIRCUIT_FAILURE_THRESHOLD; i++) {
    routingService.recordFailure(db, 1, 'dall-e-3');
  }
  const circuit = routingService.getCircuitState(db, 1, 'dall-e-3');
  assert.equal(circuit.state, 'open');

  // 路由应故障转移到备选模型
  const result = routingService.routeModel(db, { taskType: 'image', qualityTier: 'standard' });
  assert.ok(result.config);
  assert.equal(result.model, 'sdxl');
  assert.equal(result.isFallback, true);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T07-4: routeModel 指定 preferModel 优先使用', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, endpoint, api_key, is_active, is_default)
    VALUES (1, 'openai', 'image', ?, '/images/generations', 'sk-test', 1, 1)`).run(JSON.stringify(['dall-e-3', 'dall-e-2']));

  const result = routingService.routeModel(db, { taskType: 'image', preferModel: 'dall-e-2' });
  assert.ok(result.config);
  assert.equal(result.model, 'dall-e-2');
  assert.equal(result.isFallback, false);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T07-5: routeModel 无规则 → 兜底默认配置', () => {
  const { db, dir } = makeDb();

  db.prepare(`INSERT INTO ai_service_configs (id, provider, service_type, model, endpoint, api_key, is_active, is_default)
    VALUES (1, 'openai', 'text', 'gpt-4', '/chat/completions', 'sk-test', 1, 1)`).run();

  // 无路由规则，应兜底到默认配置
  const result = routingService.routeModel(db, { taskType: 'text' });
  assert.ok(result.config);
  assert.equal(result.model, 'gpt-4');
  assert.equal(result.rule, null);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 熔断器 ----------

test('S4-T07-6: recordFailure 达到阈值触发熔断 open', () => {
  const { db, dir } = makeDb();
  const threshold = routingService.CIRCUIT_FAILURE_THRESHOLD;

  for (let i = 1; i < threshold; i++) {
    const r = routingService.recordFailure(db, 10, 'test-model');
    assert.equal(r.state, 'closed');
    assert.equal(r.failureCount, i);
  }

  // 达到阈值 → open
  const r = routingService.recordFailure(db, 10, 'test-model');
  assert.equal(r.state, 'open');
  assert.equal(r.failureCount, threshold);

  const circuit = routingService.getCircuitState(db, 10, 'test-model');
  assert.equal(circuit.state, 'open');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T07-7: recordSuccess 重置熔断器为 closed', () => {
  const { db, dir } = makeDb();

  // 先制造几次失败
  for (let i = 0; i < 3; i++) routingService.recordFailure(db, 20, 'model-x');
  assert.equal(routingService.getCircuitState(db, 20, 'model-x').failureCount, 3);

  // 成功 → 重置
  routingService.recordSuccess(db, 20, 'model-x');
  const circuit = routingService.getCircuitState(db, 20, 'model-x');
  assert.equal(circuit.state, 'closed');
  assert.equal(circuit.failureCount, 0);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 调用记录 ----------

test('S4-T07-8: recordCallLog 记录调用日志 + 联动熔断状态', () => {
  const { db, dir } = makeDb();

  // 成功调用
  routingService.recordCallLog(db, {
    userId: 1, dramaId: 100, configId: 1, serviceType: 'image',
    provider: 'openai', model: 'dall-e-3', taskType: 'image_gen',
    status: 'success', latencyMs: 1500, cost: 0.04, qualityScore: 92,
  });
  let logs = db.prepare('SELECT * FROM ai_model_call_logs').all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'success');
  assert.equal(logs[0].model, 'dall-e-3');

  // 失败调用 → 增加熔断失败计数
  routingService.recordCallLog(db, {
    configId: 1, serviceType: 'image', model: 'dall-e-3',
    status: 'failed', errorMessage: 'timeout',
  });
  const circuit = routingService.getCircuitState(db, 1, 'dall-e-3');
  assert.equal(circuit.failureCount, 1);

  logs = db.prepare('SELECT * FROM ai_model_call_logs').all();
  assert.equal(logs.length, 2);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 模型评分统计 ----------

test('S4-T07-9: getModelStats 模型调用统计 + 综合评分', () => {
  const { db, dir } = makeDb();

  // 插入若干调用记录
  const insertLog = db.prepare(`INSERT INTO ai_model_call_logs
    (model, service_type, provider, status, latency_ms, cost, quality_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertLog.run('dall-e-3', 'image', 'openai', 'success', 1200, 0.04, 92, '2026-08-09 10:00:00');
  insertLog.run('dall-e-3', 'image', 'openai', 'success', 1500, 0.04, 88, '2026-08-09 10:01:00');
  insertLog.run('dall-e-3', 'image', 'openai', 'failed', 30000, 0.00, null, '2026-08-09 10:02:00');
  insertLog.run('sdxl', 'image', 'stability', 'success', 800, 0.02, 80, '2026-08-09 10:03:00');

  const stats = routingService.getModelStats(db, {});
  assert.equal(stats.length, 2);

  // dall-e-3: 3 calls, 2 success, 1 failed
  const dall = stats.find(s => s.model === 'dall-e-3');
  assert.ok(dall);
  assert.equal(dall.totalCalls, 3);
  assert.equal(dall.successCount, 2);
  assert.equal(dall.failedCount, 1);
  assert.ok(dall.successRate > 0);
  assert.ok(dall.totalCost > 0);
  assert.ok(dall.score > 0);

  // sdxl: 1 call, 1 success
  const sdxl = stats.find(s => s.model === 'sdxl');
  assert.ok(sdxl);
  assert.equal(sdxl.totalCalls, 1);
  assert.equal(sdxl.successCount, 1);
  assert.equal(sdxl.successRate, 100);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 常量校验 ----------

test('S4-T07-10: 熔断器常量校验', () => {
  assert.ok(routingService.CIRCUIT_FAILURE_THRESHOLD >= 3, '熔断阈值应 >= 3');
  assert.ok(routingService.CIRCUIT_COOLDOWN_MS >= 30000, '冷却时间应 >= 30秒');
});
