'use strict';

/**
 * abTestService.js
 * Sprint 19 - S19-T01 模型 A/B 测试
 *
 * 功能：
 *   1. A/B 测试配置 CRUD（分组 A/B 各指向 ai_service_configs 配置 + 模型）
 *   2. 流量比例路由：按 hash(用户+任务类型+测试ID) 落入 A/B 组
 *   3. 对比报告：聚合 ai_model_call_logs（ab_group 维度：成功率/延迟/成本/质量分）
 *   4. 一键设默认：将胜出组的配置提升为 is_default
 *
 * 幂等约束：同一 task_type 仅允许一个激活测试；新增时自动停用其它激活测试。
 * 路由在调用日志中写入 ab_group（A/B），供报表聚合。
 */

const aiConfigService = require('./aiConfigService');
const { snowflakeId } = require('../utils/snowflake');

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- CRUD ----------

function toTest(row) {
  return {
    id: row.id,
    name: row.name,
    taskType: row.task_type,
    serviceType: row.service_type,
    groupA: {
      configId: row.group_a_config_id,
      model: row.group_a_model,
    },
    groupB: {
      configId: row.group_b_config_id,
      model: row.group_b_model,
    },
    trafficRatioB: Number(row.traffic_ratio_b),
    isActive: !!row.is_active,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTests(db, params = {}) {
  const w = ['deleted_at IS NULL'];
  const p = [];
  if (params.taskType) { w.push('task_type = ?'); p.push(params.taskType); }
  if (params.isActive !== undefined) { w.push('is_active = ?'); p.push(params.isActive ? 1 : 0); }
  const sql = `SELECT * FROM model_ab_test WHERE ${w.join(' AND ')} ORDER BY is_active DESC, created_at DESC`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(toTest);
}

function getTest(db, id) {
  const row = db.prepare('SELECT * FROM model_ab_test WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? toTest(row) : null;
}

function resolveConfigId(db, serviceType, fallback) {
  if (fallback) {
    const c = aiConfigService.getConfig(db, fallback);
    if (c) return c.id;
  }
  const def = db.prepare(
    'SELECT id FROM ai_service_configs WHERE service_type = ? AND is_default = 1 AND is_active = 1 AND deleted_at IS NULL ORDER BY priority DESC, id ASC LIMIT 1'
  ).get(serviceType);
  return def ? def.id : null;
}

function createTest(db, log, params) {
  log = log || console;
  const { name, taskType, serviceType = 'text', groupA, groupB, trafficRatioB = 50, description } = params;
  if (!name || !taskType || !groupA || !groupB) throw new Error('name/taskType/groupA/groupB 必填');
  // configId 缺省时自动解析该服务类型的默认配置，前端仅填模型名即可
  const gAConfigId = resolveConfigId(db, serviceType, groupA.configId);
  const gBConfigId = resolveConfigId(db, serviceType, groupB.configId);
  if (!gAConfigId || !gBConfigId) throw new Error('A/B 组均需配置 configId（或该服务类型存在默认配置）');
  if (!groupA.model || !groupB.model) throw new Error('A/B 组均需填写 model');
  const ratio = Math.max(0, Math.min(100, Number(trafficRatioB) || 50));
  const id = snowflakeId();
  const now = nowStr();
  db.prepare(
    `INSERT INTO model_ab_test
      (id, name, task_type, service_type, group_a_config_id, group_a_model, group_b_config_id, group_b_model,
       traffic_ratio_b, is_active, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id, name, taskType, serviceType, gAConfigId, groupA.model, gBConfigId, groupB.model,
    ratio, description || null, now, now
  );
  log.info('[ABTEST] 创建 A/B 测试', { id, taskType, name });
  return getTest(db, id);
}

function updateTest(db, log, id, params) {
  log = log || console;
  const existing = getTest(db, id);
  if (!existing) throw new Error('A/B 测试不存在');
  const sets = [];
  const p = [];
  if (params.name != null) { sets.push('name = ?'); p.push(params.name); }
  if (params.taskType != null) { sets.push('task_type = ?'); p.push(params.taskType); }
  if (params.serviceType != null) { sets.push('service_type = ?'); p.push(params.serviceType); }
  if (params.description != null) { sets.push('description = ?'); p.push(params.description); }
  if (params.groupA) {
    if (params.groupA.configId != null) { sets.push('group_a_config_id = ?'); p.push(params.groupA.configId); }
    if (params.groupA.model != null) { sets.push('group_a_model = ?'); p.push(params.groupA.model); }
  }
  if (params.groupB) {
    if (params.groupB.configId != null) { sets.push('group_b_config_id = ?'); p.push(params.groupB.configId); }
    if (params.groupB.model != null) { sets.push('group_b_model = ?'); p.push(params.groupB.model); }
  }
  if (params.trafficRatioB != null) {
    const ratio = Math.max(0, Math.min(100, Number(params.trafficRatioB) || 0));
    sets.push('traffic_ratio_b = ?');
    p.push(ratio);
  }
  if (params.isActive === true) {
    // 激活当前测试 → 同 task_type 其它测试全部停用
    db.prepare('UPDATE model_ab_test SET is_active = 0 WHERE task_type = ? AND id != ?').run(existing.taskType, id);
    sets.push('is_active = 1');
  } else if (params.isActive === false) {
    sets.push('is_active = 0');
  }
  if (!sets.length) return existing;
  sets.push('updated_at = ?');
  p.push(nowStr());
  p.push(id);
  db.prepare(`UPDATE model_ab_test SET ${sets.join(', ')} WHERE id = ?`).run(...p);
  log.info('[ABTEST] 更新 A/B 测试', { id });
  return getTest(db, id);
}

function deleteTest(db, log, id) {
  db.prepare('UPDATE model_ab_test SET deleted_at = ? WHERE id = ?').run(nowStr(), id);
  log.info('[ABTEST] 删除 A/B 测试', { id });
  return { deleted: true, id };
}

// ---------- 流量路由 ----------

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 按流量比例路由到 A/B 组
 * @param {object} db
 * @param {object} params - { taskType, userId, req }
 * @returns {object|null} { test, group: 'A'|'B', config, model } 无激活测试返回 null
 */
function routeTask(db, params) {
  const { taskType, userId } = params;
  const active = db.prepare(
    'SELECT * FROM model_ab_test WHERE task_type = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'
  ).get(taskType);
  if (!active) return null;

  const test = toTest(active);
  // 稳定性哈希：同一用户同一任务类型始终进入同一组
  const salt = `${userId ?? 'anon'}:${taskType}:${test.id}`;
  const bucket = hashKey(salt) % 100;
  const group = bucket < (100 - test.trafficRatioB) ? 'A' : 'B';
  const chosen = group === 'A' ? test.groupA : test.groupB;

  const config = aiConfigService.getConfig(db, chosen.configId);
  if (!config || !config.is_active) return null; // 配置被停用则跳过 A/B 路由

  return {
    test,
    group,
    config,
    model: chosen.model || (Array.isArray(config.model) ? config.model[0] : config.model),
  };
}

// ---------- 对比报告 ----------

/**
 * 生成 A/B 对比报告（聚合 ai_model_call_logs 的 ab_group 维度）
 */
function compareReport(db, id, params = {}) {
  const test = getTest(db, id);
  if (!test) throw new Error('A/B 测试不存在');
  const days = params.days || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const rows = db.prepare(
    `SELECT ab_group,
       COUNT(*) AS total_calls,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
       SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END) AS failed_count,
       AVG(latency_ms) AS avg_latency,
       AVG(cost) AS avg_cost,
       SUM(cost) AS total_cost,
       AVG(quality_score) AS avg_quality
     FROM ai_model_call_logs
     WHERE ab_group IN ('A','B') AND created_at >= ? AND ab_group IS NOT NULL
     GROUP BY ab_group`
  ).all(since);

  const map = {};
  for (const r of rows) {
    map[r.ab_group] = r;
  }
  const build = (group, cfg) => {
    const r = map[group] || {};
    const total = Number(r.total_calls || 0);
    const success = Number(r.success_count || 0);
    const latency = Number(r.avg_latency || 0);
    return {
      group,
      model: cfg ? cfg.model : null,
      configId: cfg ? cfg.configId : null,
      totalCalls: total,
      successCount: success,
      failedCount: Number(r.failed_count || 0),
      successRate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
      avgLatency: latency ? Math.round(latency) : 0,
      avgCost: Number(r.avg_cost || 0),
      totalCost: Number(r.total_cost || 0),
      avgQuality: r.avg_quality ? Number(Number(r.avg_quality).toFixed(2)) : null,
    };
  };
  const groups = [
    build('A', test.groupA),
    build('B', test.groupB),
  ];
  const a = groups[0];
  const b = groups[1];
  let winner = null;
  if (a.totalCalls > 0 && b.totalCalls > 0) {
    const score = (g) => g.successRate * 0.5 + (g.avgQuality ?? 0) * 0.3 + Math.max(0, 100 - g.avgLatency / 100) * 0.2;
    const sa = score(a);
    const sb = score(b);
    winner = sa > sb ? 'A' : sb > sa ? 'B' : 'tie';
  }
  return {
    test,
    days,
    groups,
    winner,
    generatedAt: nowStr(),
  };
}

/**
 * 一键设默认：将 A/B 某组的配置设为该 service_type 的默认配置
 */
function setDefault(db, log, id, group) {
  log = log || console;
  const test = getTest(db, id);
  if (!test) throw new Error('A/B 测试不存在');
  const target = group === 'B' ? test.groupB : test.groupA;
  if (!target.configId) throw new Error('目标组无配置');
  const config = aiConfigService.getConfig(db, target.configId);
  if (!config) throw new Error('目标配置不存在');

  const stmt = db.prepare(
    'UPDATE ai_service_configs SET is_default = 0 WHERE service_type = ? AND id != ? AND deleted_at IS NULL'
  );
  stmt.run(config.service_type, config.id);
  const upd = db.prepare('UPDATE ai_service_configs SET is_default = 1 WHERE id = ?').run(config.id);
  log.info('[ABTEST] 设默认配置', { abTestId: id, group, configId: config.id, model: target.model });
  return {
    ok: upd.changes > 0,
    group,
    configId: config.id,
    model: target.model,
    serviceType: config.service_type,
  };
}

module.exports = {
  listTests,
  getTest,
  createTest,
  updateTest,
  deleteTest,
  routeTask,
  compareReport,
  setDefault,
  hashKey,
};
