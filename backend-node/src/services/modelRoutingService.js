'use strict';
/**
 * modelRoutingService.js
 * Sprint 4 - S4-T07 AI模型智能路由引擎
 *
 * 功能：
 *   1. 智能路由：根据任务类型/质量要求/成本预算自动选择最优模型
 *   2. 故障自动转移：模型API超时/报错时自动切换到备用模型（Circuit Breaker）
 *   3. 成本优化：简单任务用低成本模型，复杂任务用高质量模型
 *   4. 模型评分：根据成功率/耗时自动评分排序
 *
 * 架构：
 *   - ai_routing_rules: 路由规则表（主模型 + 备选模型）
 *   - ai_model_call_logs: 调用记录（成本/耗时/质量评分）
 *   - ai_model_circuit_state: 熔断状态（closed/open/half_open）
 *
 * 熔断器模式（Circuit Breaker）：
 *   closed（正常）→ 连续失败 N 次 → open（熔断，拒绝请求）
 *   open → 等待冷却时间 → half_open（允许探测）→ 成功 → closed / 失败 → open
 */

const aiConfigService = require('./aiConfigService');

// ---------- 常量 ----------
const CIRCUIT_FAILURE_THRESHOLD = 5;   // 连续失败5次触发熔断
const CIRCUIT_COOLDOWN_MS = 60 * 1000; // 熔断冷却60秒
const CIRCUIT_HALF_OPEN_PROBES = 1;    // 半开状态允许1次探测

// ---------- 工具 ----------
function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- 路由规则 CRUD ----------

/**
 * 列出路由规则
 */
function listRules(db, params = {}) {
  const w = []; const p = [];
  if (params.taskType) { w.push('task_type = ?'); p.push(params.taskType); }
  if (params.isActive !== undefined) { w.push('is_active = ?'); p.push(params.isActive ? 1 : 0); }
  const sql = `SELECT * FROM ai_routing_rules ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY priority DESC, id ASC`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(r => ({
    id: r.id, ruleKey: r.rule_key, taskType: r.task_type, qualityTier: r.quality_tier,
    primaryConfigId: r.primary_config_id, primaryModel: r.primary_model,
    fallbackConfigId: r.fallback_config_id, fallbackModel: r.fallback_model,
    maxCostPerCall: Number(r.max_cost_per_call), priority: r.priority,
    isActive: !!r.is_active, description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

/**
 * 创建/更新路由规则
 */
function upsertRule(db, log, params) {
  log = log || console;
  const { ruleKey, taskType, qualityTier = 'standard', primaryConfigId, primaryModel,
    fallbackConfigId, fallbackModel, maxCostPerCall = 0, priority = 100,
    isActive = true, description } = params;
  if (!ruleKey || !taskType) throw new Error('ruleKey/taskType 必填');
  const now = nowStr();

  const existing = db.prepare('SELECT id FROM ai_routing_rules WHERE rule_key = ?').get(ruleKey);
  if (existing) {
    db.prepare(`UPDATE ai_routing_rules SET task_type = ?, quality_tier = ?, primary_config_id = ?,
      primary_model = ?, fallback_config_id = ?, fallback_model = ?, max_cost_per_call = ?,
      priority = ?, is_active = ?, description = ?, updated_at = ? WHERE id = ?`).run(
      taskType, qualityTier, primaryConfigId || null, primaryModel || null,
      fallbackConfigId || null, fallbackModel || null, maxCostPerCall,
      priority, isActive ? 1 : 0, description || null, now, existing.id
    );
    log.info('[ROUTING] 更新路由规则', { ruleKey, id: existing.id });
    return { id: existing.id, ruleKey, updated: true };
  }

  const ins = db.prepare(`INSERT INTO ai_routing_rules
    (rule_key, task_type, quality_tier, primary_config_id, primary_model, fallback_config_id, fallback_model, max_cost_per_call, priority, is_active, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ruleKey, taskType, qualityTier, primaryConfigId || null, primaryModel || null,
    fallbackConfigId || null, fallbackModel || null, maxCostPerCall,
    priority, isActive ? 1 : 0, description || null, now, now
  );
  log.info('[ROUTING] 新增路由规则', { ruleKey, id: ins.lastInsertRowid });
  return { id: ins.lastInsertRowid, ruleKey, updated: false };
}

function deleteRule(db, log, id) {
  const info = db.prepare('DELETE FROM ai_routing_rules WHERE id = ?').run(id);
  return { deleted: info.changes > 0, id };
}

// ---------- 熔断器 ----------

/**
 * 获取模型的熔断状态
 */
function getCircuitState(db, configId, model) {
  try {
    let row = db.prepare('SELECT * FROM ai_model_circuit_state WHERE config_id = ? AND model = ?').get(configId, model);
    if (!row) return { state: 'closed', failureCount: 0 };
    const now = Date.now();
    let state = row.state;
    let halfOpenAtValue = row.half_open_at;

    // open → 检查是否超过冷却时间 → half_open
    if (state === 'open' && row.opened_at) {
      const openedAt = new Date(row.opened_at).getTime();
      if (now - openedAt >= CIRCUIT_COOLDOWN_MS) {
        state = 'half_open';
        halfOpenAtValue = nowStr();
        db.prepare('UPDATE ai_model_circuit_state SET state = ?, half_open_at = ? WHERE id = ?')
          .run('half_open', halfOpenAtValue, row.id);
      }
    }
    return {
      state,
      failureCount: row.failure_count,
      lastFailureAt: row.last_failure_at,
      openedAt: row.opened_at,
      halfOpenAt: halfOpenAtValue,
    };
  } catch (_) {
    return { state: 'closed', failureCount: 0 };
  }
}

/**
 * 记录调用成功：重置熔断器
 * @returns {{ state: string, failureCount: number }} 统一的熔断器状态返回
 */
function recordSuccess(db, configId, model) {
  try {
    let existing = db.prepare('SELECT id FROM ai_model_circuit_state WHERE config_id = ? AND model = ?').get(configId, model);
    if (existing) {
      db.prepare(`UPDATE ai_model_circuit_state
        SET state = 'closed', failure_count = 0, half_open_at = NULL, last_failure_at = NULL, opened_at = NULL
        WHERE id = ?`).run(existing.id);
    } else {
      // 未初始化时，先插入一条 closed 行（作为起点）
      db.prepare(`INSERT INTO ai_model_circuit_state
        (config_id, model, state, failure_count) VALUES (?, ?, 'closed', 0)`).run(configId, model);
    }
    return { state: 'closed', failureCount: 0 };
  } catch (_) {
    return { state: 'closed', failureCount: 0 };
  }
}

/**
 * 记录调用失败：增加失败计数，达到阈值触发熔断
 * @returns {{ state: string, failureCount: number, openedAt?: string, lastFailureAt?: string }}
 */
function recordFailure(db, configId, model) {
  try {
    const existing = db.prepare('SELECT id, failure_count, state FROM ai_model_circuit_state WHERE config_id = ? AND model = ?').get(configId, model);
    const now = nowStr();
    if (existing) {
      // 超过阈值继续失败 — 保持 open 状态，不再累加 failure_count（避免整型溢出）
      if (existing.state === 'open') {
        db.prepare('UPDATE ai_model_circuit_state SET last_failure_at = ? WHERE id = ?').run(now, existing.id);
        return { state: 'open', failureCount: CIRCUIT_FAILURE_THRESHOLD, lastFailureAt: now, openedAt: null };
      }
      const newCount = (existing.failure_count || 0) + 1;
      const newState = newCount >= CIRCUIT_FAILURE_THRESHOLD ? 'open' : 'closed';
      db.prepare(`UPDATE ai_model_circuit_state
        SET state = ?, failure_count = ?, last_failure_at = ?, opened_at = COALESCE(?, opened_at)
        WHERE id = ?`)
        .run(newState, newCount, now, newState === 'open' ? now : null, existing.id);
      return { state: newState, failureCount: newCount, lastFailureAt: now, openedAt: newState === 'open' ? now : undefined };
    }
    // 新建记录 — 首次直接计数为 1
    db.prepare(`INSERT INTO ai_model_circuit_state (config_id, model, state, failure_count, last_failure_at, opened_at)
      VALUES (?, ?, ?, 1, ?, NULL)`).run(configId, model, 'closed', now);
    return { state: 'closed', failureCount: 1, lastFailureAt: now };
  } catch (_) {
    return { state: 'closed', failureCount: 0 };
  }
}

// ---------- 智能路由核心 ----------

/**
 * 智能路由：根据任务类型和质量层级选择最优模型
 * @param {object} db - 数据库
 * @param {object} params - { taskType, qualityTier, costBudget, preferModel }
 * @returns {object} { config, model, rule, isFallback, fallbackConfig, fallbackModel }
 */
function routeModel(db, params = {}) {
  const { taskType, qualityTier = 'standard', costBudget, preferModel } = params;

  // 1. 若指定了 preferModel，直接查找对应配置
  if (preferModel) {
    const configs = aiConfigService.listConfigs(db, taskType);
    const matched = configs.find(c => {
      const models = Array.isArray(c.model) ? c.model : [c.model];
      return models.some(m => m === preferModel);
    });
    if (matched) {
      const circuit = getCircuitState(db, matched.id, preferModel);
      if (circuit.state !== 'open') {
        return { config: matched, model: preferModel, rule: null, isFallback: false };
      }
    }
  }

  // 2. 查找路由规则
  const rules = listRules(db, { taskType, isActive: true });
  // 按质量层级和优先级匹配
  const matchedRule = rules.find(r => r.qualityTier === qualityTier) || rules[0];

  if (matchedRule && matchedRule.primaryConfigId) {
    const primaryConfig = aiConfigService.getConfig(db, matchedRule.primaryConfigId);
    const primaryModel = matchedRule.primaryModel;
    if (primaryConfig) {
      const circuit = getCircuitState(db, matchedRule.primaryConfigId, primaryModel);
      if (circuit.state !== 'open') {
        // 成本预算检查
        if (costBudget && matchedRule.maxCostPerCall && matchedRule.maxCostPerCall > costBudget) {
          // 超预算，尝试备选
        } else {
          return {
            config: primaryConfig,
            model: primaryModel,
            rule: matchedRule,
            isFallback: false,
            fallbackConfig: matchedRule.fallbackConfigId ? aiConfigService.getConfig(db, matchedRule.fallbackConfigId) : null,
            fallbackModel: matchedRule.fallbackModel || null,
          };
        }
      }
    }
    // 3. 故障转移：主模型熔断或超预算 → 使用备选模型
    if (matchedRule.fallbackConfigId) {
      const fallbackConfig = aiConfigService.getConfig(db, matchedRule.fallbackConfigId);
      const fallbackModel = matchedRule.fallbackModel;
      if (fallbackConfig) {
        const fc = getCircuitState(db, matchedRule.fallbackConfigId, fallbackModel);
        if (fc.state !== 'open') {
          return {
            config: fallbackConfig,
            model: fallbackModel,
            rule: matchedRule,
            isFallback: true,
          };
        }
      }
    }
  }

  // 4. 兜底：使用默认配置
  const configs = aiConfigService.listConfigs(db, taskType);
  const activeConfigs = configs.filter(c => c.is_active);
  const defaultConfig = activeConfigs.find(c => c.is_default) || activeConfigs[0];
  if (defaultConfig) {
    const model = Array.isArray(defaultConfig.model) ? defaultConfig.model[0] : defaultConfig.model;
    return { config: defaultConfig, model, rule: null, isFallback: false };
  }

  return { config: null, model: null, rule: null, isFallback: false };
}

// ---------- 调用记录 ----------

/**
 * 记录模型调用日志
 */
function recordCallLog(db, params) {
  const { userId, dramaId, configId, serviceType, provider, model, taskType,
    status, isFallback, latencyMs, cost, qualityScore, errorMessage, routingRuleKey } = params;
  try {
    db.prepare(`INSERT INTO ai_model_call_logs
      (user_id, drama_id, config_id, service_type, provider, model, task_type, status, is_fallback, latency_ms, cost, quality_score, error_message, routing_rule_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId || null, dramaId || null, configId || null, serviceType || null,
      provider || null, model || null, taskType || null, status || 'success',
      isFallback ? 1 : 0, latencyMs || 0, cost || 0, qualityScore || null,
      errorMessage || null, routingRuleKey || null, nowStr()
    );
  } catch (_) {}

  // 同步更新熔断状态
  if (configId && model) {
    if (status === 'success') recordSuccess(db, configId, model);
    else if (status === 'failed' || status === 'timeout') recordFailure(db, configId, model);
  }
}

// ---------- 模型评分/统计 ----------

/**
 * 获取模型调用统计（用于模型评分系统）
 */
function getModelStats(db, params = {}) {
  const w = []; const p = [];
  if (params.days) {
    const since = new Date(Date.now() - params.days * 86400000).toISOString();
    w.push('created_at >= ?'); p.push(since);
  }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const sql = `SELECT
    model, service_type, provider,
    COUNT(*) as total_calls,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
    AVG(latency_ms) as avg_latency,
    AVG(cost) as avg_cost,
    SUM(cost) as total_cost,
    AVG(quality_score) as avg_quality
    FROM ai_model_call_logs ${where}
    GROUP BY model, service_type ${where ? 'HAVING ' + w.join(' AND ') : ''}
    ORDER BY total_calls DESC`;
  // SQLite 不支持 HAVING 引用 WHERE 条件变量，简化处理
  const simpleSql = `SELECT
    model, service_type, provider,
    COUNT(*) as total_calls,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
    AVG(latency_ms) as avg_latency,
    AVG(cost) as avg_cost,
    SUM(cost) as total_cost,
    AVG(quality_score) as avg_quality
    FROM ai_model_call_logs ${where}
    GROUP BY model, service_type
    ORDER BY total_calls DESC`;
  const rows = p.length ? db.prepare(simpleSql).all(...p) : db.prepare(simpleSql).all();
  return rows.map(r => ({
    model: r.model, serviceType: r.service_type, provider: r.provider,
    totalCalls: r.total_calls,
    successCount: r.success_count,
    failedCount: r.failed_count,
    successRate: r.total_calls > 0 ? Number(((r.success_count / r.total_calls) * 100).toFixed(2)) : 0,
    avgLatency: Math.round(r.avg_latency || 0),
    avgCost: Number(r.avg_cost || 0),
    totalCost: Number(r.total_cost || 0),
    avgQuality: r.avg_quality ? Number(Number(r.avg_quality).toFixed(2)) : null,
    // 综合评分 = 成功率*40% + 速度分*30% + 质量分*30%（速度分 = max(0, 100 - avgLatency/100)）
    score: _computeScore(r),
  }));
}

function _computeScore(r) {
  const successRate = r.total_calls > 0 ? (r.success_count / r.total_calls) * 100 : 0;
  const speedScore = Math.max(0, 100 - (r.avg_latency || 0) / 100);
  const qualityScore = r.avg_quality ? Number(r.avg_quality) : 70;
  return Number((successRate * 0.4 + speedScore * 0.3 + qualityScore * 0.3).toFixed(2));
}

module.exports = {
  // 路由规则 CRUD
  listRules,
  upsertRule,
  deleteRule,
  // 智能路由
  routeModel,
  // 熔断器
  getCircuitState,
  recordSuccess,
  recordFailure,
  // 调用记录
  recordCallLog,
  // 统计
  getModelStats,
  // 常量
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
};
