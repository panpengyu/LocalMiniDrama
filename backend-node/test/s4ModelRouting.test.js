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
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock、不使用 SQLite。测试数据使用高位 ID
//       （99xxxx）与独立命名空间（s4t07_*）隔离，beforeEach 清理。
// ============================================================
'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const routingService = require('../src/services/modelRoutingService');

// ---------- 测试专用数据命名空间 ----------
const TASK_IMAGE = 's4t07_image';   // 独立服务类型，避免 ensureSingleDefaultPerType 影响真实配置
const TASK_TEXT = 's4t07_text';
const RULE_KEY = 's4t07_image_standard';
// 高位测试 config id，避免与真实配置（1~42）冲突
const CONFIG_ID_OPENAI = 991101;
const CONFIG_ID_STABILITY = 991102;
const CONFIG_ID_TEXT = 991103;
const CONFIG_ID_PREFER = 991104;
const CONFIG_ID_CIRCUIT_10 = 991201;
const CONFIG_ID_CIRCUIT_20 = 991202;
const CONFIG_ID_CALLLOG = 991203;

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function db() {
  return getDb(loadConfig().database);
}

// 清理本次测试产生的数据（同时清除历史遗留的 s4test_* 测试规则）
function cleanup() {
  const d = db();
  d.prepare("DELETE FROM ai_routing_rules WHERE rule_key LIKE 's4t07_%' OR rule_key LIKE 's4test_%'").run();
  d.prepare('DELETE FROM ai_service_configs WHERE id >= 991000 AND id <= 991999').run();
  d.prepare('DELETE FROM ai_model_circuit_state WHERE config_id >= 991000 AND config_id <= 991999').run();
  d.prepare(
    "DELETE FROM ai_model_call_logs WHERE config_id >= 991000 AND config_id <= 991999 OR model LIKE 's4t07-%'"
  ).run();
}

function insertConfig(id, serviceType, model, extra = {}) {
  db().prepare(
    `INSERT INTO ai_service_configs
       (id, service_type, provider, name, model, api_key, endpoint, priority, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    serviceType,
    extra.provider || 'openai',
    extra.name || `s4t07-config-${id}`,
    model,
    extra.apiKey || 'sk-test',
    extra.endpoint || '/images/generations',
    extra.priority != null ? extra.priority : 0,
    extra.isDefault ? 1 : 0,
    extra.isActive != null ? (extra.isActive ? 1 : 0) : 1
  );
}

before(() => { cleanup(); });
beforeEach(() => { cleanup(); });
after(() => { cleanup(); closeDb(); });

// ---------- 路由规则 CRUD ----------

test('S4-T07-1: 路由规则 CRUD（创建/查询/更新/删除）', () => {
  const d = db();

  // 新增
  const created = routingService.upsertRule(d, silentLog, {
    ruleKey: RULE_KEY, taskType: TASK_IMAGE, qualityTier: 'standard',
    primaryConfigId: CONFIG_ID_OPENAI, primaryModel: 'dall-e-3',
    fallbackConfigId: CONFIG_ID_STABILITY, fallbackModel: 'stable-diffusion-xl',
    maxCostPerCall: 0.5, priority: 100, description: '标准图像生成（s4t07 测试）',
  });
  assert.ok(created.id);
  assert.equal(created.updated, false);

  // 查询
  const rules = routingService.listRules(d, { taskType: TASK_IMAGE });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].ruleKey, RULE_KEY);
  assert.equal(rules[0].primaryModel, 'dall-e-3');
  assert.equal(rules[0].fallbackModel, 'stable-diffusion-xl');
  assert.equal(rules[0].isActive, true);

  // 更新（相同 ruleKey）
  routingService.upsertRule(d, silentLog, {
    ruleKey: RULE_KEY, taskType: TASK_IMAGE, qualityTier: 'high',
    primaryConfigId: CONFIG_ID_STABILITY, primaryModel: 'midjourney-v6',
  });
  const updated = routingService.listRules(d, { taskType: TASK_IMAGE });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].primaryModel, 'midjourney-v6');
  assert.equal(updated[0].qualityTier, 'high');

  // 删除
  const del = routingService.deleteRule(d, silentLog, updated[0].id);
  assert.equal(del.deleted, true);
  assert.equal(routingService.listRules(d, { taskType: TASK_IMAGE }).length, 0);
});

// ---------- routeModel 智能路由 ----------

test('S4-T07-2: routeModel 规则匹配 → 主模型', () => {
  const d = db();
  insertConfig(CONFIG_ID_OPENAI, TASK_IMAGE, 'dall-e-3', { isDefault: true });
  insertConfig(CONFIG_ID_STABILITY, TASK_IMAGE, 'sdxl', { provider: 'stability', endpoint: '/images' });

  routingService.upsertRule(d, silentLog, {
    ruleKey: RULE_KEY, taskType: TASK_IMAGE, qualityTier: 'standard',
    primaryConfigId: CONFIG_ID_OPENAI, primaryModel: 'dall-e-3',
    fallbackConfigId: CONFIG_ID_STABILITY, fallbackModel: 'sdxl',
  });

  const result = routingService.routeModel(d, { taskType: TASK_IMAGE, qualityTier: 'standard' });
  assert.ok(result.config);
  assert.equal(result.model, 'dall-e-3');
  assert.equal(result.isFallback, false);
  assert.ok(result.rule);
});

test('S4-T07-3: routeModel 主模型熔断 → 故障转移到备选模型', () => {
  const d = db();
  insertConfig(CONFIG_ID_OPENAI, TASK_IMAGE, 'dall-e-3', { isDefault: true });
  insertConfig(CONFIG_ID_STABILITY, TASK_IMAGE, 'sdxl', { provider: 'stability', endpoint: '/images' });

  routingService.upsertRule(d, silentLog, {
    ruleKey: RULE_KEY, taskType: TASK_IMAGE, qualityTier: 'standard',
    primaryConfigId: CONFIG_ID_OPENAI, primaryModel: 'dall-e-3',
    fallbackConfigId: CONFIG_ID_STABILITY, fallbackModel: 'sdxl',
  });

  // 将主模型熔断
  for (let i = 0; i < routingService.CIRCUIT_FAILURE_THRESHOLD; i++) {
    routingService.recordFailure(d, CONFIG_ID_OPENAI, 'dall-e-3');
  }
  const circuit = routingService.getCircuitState(d, CONFIG_ID_OPENAI, 'dall-e-3');
  assert.equal(circuit.state, 'open');

  // 路由应故障转移到备选模型
  const result = routingService.routeModel(d, { taskType: TASK_IMAGE, qualityTier: 'standard' });
  assert.ok(result.config);
  assert.equal(result.model, 'sdxl');
  assert.equal(result.isFallback, true);
});

test('S4-T07-4: routeModel 指定 preferModel 优先使用', () => {
  const d = db();
  insertConfig(CONFIG_ID_PREFER, TASK_IMAGE, JSON.stringify(['dall-e-3', 'dall-e-2']), { isDefault: true });

  const result = routingService.routeModel(d, { taskType: TASK_IMAGE, preferModel: 'dall-e-2' });
  assert.ok(result.config);
  assert.equal(result.model, 'dall-e-2');
  assert.equal(result.isFallback, false);
});

test('S4-T07-5: routeModel 无规则 → 兜底默认配置', () => {
  const d = db();
  insertConfig(CONFIG_ID_TEXT, TASK_TEXT, 'gpt-4', {
    endpoint: '/chat/completions', isDefault: true, priority: 10,
  });

  // 无路由规则，应兜底到默认配置
  const result = routingService.routeModel(d, { taskType: TASK_TEXT });
  assert.ok(result.config);
  assert.equal(result.model, 'gpt-4');
  assert.equal(result.rule, null);
});

// ---------- 熔断器 ----------

test('S4-T07-6: recordFailure 达到阈值触发熔断 open', () => {
  const d = db();
  const threshold = routingService.CIRCUIT_FAILURE_THRESHOLD;

  for (let i = 1; i < threshold; i++) {
    const r = routingService.recordFailure(d, CONFIG_ID_CIRCUIT_10, 'test-model');
    assert.equal(r.state, 'closed');
    assert.equal(r.failureCount, i);
  }

  // 达到阈值 → open
  const r = routingService.recordFailure(d, CONFIG_ID_CIRCUIT_10, 'test-model');
  assert.equal(r.state, 'open');
  assert.equal(r.failureCount, threshold);

  const circuit = routingService.getCircuitState(d, CONFIG_ID_CIRCUIT_10, 'test-model');
  assert.equal(circuit.state, 'open');
});

test('S4-T07-7: recordSuccess 重置熔断器为 closed', () => {
  const d = db();

  // 先制造几次失败
  for (let i = 0; i < 3; i++) routingService.recordFailure(d, CONFIG_ID_CIRCUIT_20, 'model-x');
  assert.equal(routingService.getCircuitState(d, CONFIG_ID_CIRCUIT_20, 'model-x').failureCount, 3);

  // 成功 → 重置
  routingService.recordSuccess(d, CONFIG_ID_CIRCUIT_20, 'model-x');
  const circuit = routingService.getCircuitState(d, CONFIG_ID_CIRCUIT_20, 'model-x');
  assert.equal(circuit.state, 'closed');
  assert.equal(circuit.failureCount, 0);
});

// ---------- 调用记录 ----------

test('S4-T07-8: recordCallLog 记录调用日志 + 联动熔断状态', () => {
  const d = db();
  const model = 's4t07-dall-e-3';

  // 成功调用
  routingService.recordCallLog(d, {
    userId: 1, dramaId: 100, configId: CONFIG_ID_CALLLOG, serviceType: TASK_IMAGE,
    provider: 'openai', model, taskType: 'image_gen',
    status: 'success', latencyMs: 1500, cost: 0.04, qualityScore: 92,
  });
  let logs = d.prepare('SELECT * FROM ai_model_call_logs WHERE config_id = ?').all(CONFIG_ID_CALLLOG);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'success');
  assert.equal(logs[0].model, model);

  // 失败调用 → 增加熔断失败计数
  routingService.recordCallLog(d, {
    configId: CONFIG_ID_CALLLOG, serviceType: TASK_IMAGE, model,
    status: 'failed', errorMessage: 'timeout',
  });
  const circuit = routingService.getCircuitState(d, CONFIG_ID_CALLLOG, model);
  assert.equal(circuit.failureCount, 1);

  logs = d.prepare('SELECT * FROM ai_model_call_logs WHERE config_id = ?').all(CONFIG_ID_CALLLOG);
  assert.equal(logs.length, 2);
});

// ---------- 模型评分统计 ----------

test('S4-T07-9: getModelStats 模型调用统计 + 综合评分', () => {
  const d = db();
  const modelDall = 's4t07-dall-e-3';
  const modelSdxl = 's4t07-sdxl';

  // 插入若干调用记录（使用测试专用模型名，避免与真实日志混淆）
  const insertLog = d.prepare(`INSERT INTO ai_model_call_logs
    (model, service_type, provider, status, latency_ms, cost, quality_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertLog.run(modelDall, TASK_IMAGE, 'openai', 'success', 1200, 0.04, 92, '2026-08-09 10:00:00');
  insertLog.run(modelDall, TASK_IMAGE, 'openai', 'success', 1500, 0.04, 88, '2026-08-09 10:01:00');
  insertLog.run(modelDall, TASK_IMAGE, 'openai', 'failed', 30000, 0.00, null, '2026-08-09 10:02:00');
  insertLog.run(modelSdxl, TASK_IMAGE, 'stability', 'success', 800, 0.02, 80, '2026-08-09 10:03:00');

  const stats = routingService.getModelStats(d, {});
  // 只统计本次测试插入的模型（真实库可能还有其他调用日志）
  const ours = stats.filter(s => s.model === modelDall || s.model === modelSdxl);
  assert.equal(ours.length, 2);

  // s4t07-dall-e-3: 3 calls, 2 success, 1 failed
  const dall = ours.find(s => s.model === modelDall);
  assert.ok(dall);
  assert.equal(dall.totalCalls, 3);
  assert.equal(dall.successCount, 2);
  assert.equal(dall.failedCount, 1);
  assert.ok(dall.successRate > 0);
  assert.ok(dall.totalCost > 0);
  assert.ok(dall.score > 0);

  // s4t07-sdxl: 1 call, 1 success
  const sdxl = ours.find(s => s.model === modelSdxl);
  assert.ok(sdxl);
  assert.equal(sdxl.totalCalls, 1);
  assert.equal(sdxl.successCount, 1);
  assert.equal(sdxl.successRate, 100);
});

// ---------- 常量校验 ----------

test('S4-T07-10: 熔断器常量校验', () => {
  assert.ok(routingService.CIRCUIT_FAILURE_THRESHOLD >= 3, '熔断阈值应 >= 3');
  assert.ok(routingService.CIRCUIT_COOLDOWN_MS >= 30000, '冷却时间应 >= 30秒');
});
