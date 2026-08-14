'use strict';
/**
 * workflowService.js
 * Sprint 7 — S7-T01 工作流引擎设计 + S7-T02 工作流引擎实现
 *
 * 核心能力：
 *  1) 自定义工作流编排（步骤定义/依赖/条件分支）
 *  2) 步骤间数据传递（context 上下文）
 *  3) 断点续传（每步持久化，中断后从 current_step_index 恢复）
 *  4) 失败重试（每步可配置 max_retry）
 *  5) 暂停审核（need_review=true 的步骤执行完后暂停，等待人工放行）
 *
 * 步骤类型：
 *   generate_outline / generate_characters / generate_episodes /
 *   generate_storyboard / generate_images / generate_tts / auto_edit
 *
 * 日志规范：
 *   所有对外入口函数均生成 traceID（前缀 [WF#xxx]），打印：
 *   · [STAGE#n] 阶段启动 + 关键入参摘要
 *   · [STAGE#n-DONE] 阶段完成 + 耗时 + 结果摘要
 *   · [WARN]  可恢复异常（降级策略）
 *   · [ERROR] 不可恢复异常 + 错误码 + 堆栈前5行
 */

const crypto = require('crypto');
const { getQueue } = require('./queueService');

// 生成追踪 ID: WF + 8位16进制
function makeTraceId(prefix = 'WF') {
  return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// 支持的步骤类型及其执行器映射
const STEP_EXECUTORS = {
  generate_outline: 'screenwriter.outline',
  generate_characters: 'screenwriter.characters',
  generate_episodes: 'screenwriter.episodes',
  generate_storyboard: 'screenwriter.storyboard',
  generate_images: 'image.batch',
  generate_tts: 'tts.batch',
  auto_edit: 'edit.auto',
};

const INSTANCE_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const STEP_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  REVIEWING: 'reviewing',
};

/**
 * 将 Date 转为 MySQL 'YYYY-MM-DD HH:MM:SS'
 */
function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseJSON(str, fallback) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ========== 工作流定义 CRUD ==========

/**
 * 列出工作流定义
 */
function listDefinitions(db, filters = {}) {
  let sql = 'SELECT * FROM workflow_definitions WHERE 1=1';
  const params = [];
  if (filters.drama_id) {
    sql += ' AND (drama_id = ? OR drama_id IS NULL)';
    params.push(Number(filters.drama_id));
  }
  if (filters.is_active != null) {
    sql += ' AND is_active = ?';
    params.push(Number(filters.is_active));
  }
  sql += ' ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

/**
 * 获取工作流定义
 */
function getDefinition(db, id) {
  return db.prepare('SELECT * FROM workflow_definitions WHERE id = ?').get(Number(id));
}

/**
 * 创建工作流定义
 * [边界修复] 增加：name 非空校验、steps_config 数组校验、每个步骤 type 校验、
 *   max_retry 范围校验、trigger_type 枚举校验
 */
function createDefinition(db, body) {
  const traceId = makeTraceId('WF-DEF');
  const t0 = Date.now();

  // === [STAGE#1] 入参校验 ===
  if (!body || !body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw new Error('[WF-DEF-001] 工作流名称不能为空');
  }
  if (!body.steps_config || !Array.isArray(body.steps_config)) {
    throw new Error('[WF-DEF-002] steps_config 必须是数组');
  }
  if (body.steps_config.length === 0) {
    throw new Error('[WF-DEF-003] steps_config 不能为空数组（至少1个步骤）');
  }
  const validTypes = Object.keys(STEP_EXECUTORS);
  body.steps_config.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`[WF-DEF-004] steps_config[${i}] 不是合法的步骤对象`);
    }
    if (!s.type || !validTypes.includes(s.type)) {
      throw new Error(`[WF-DEF-005] steps_config[${i}].type 非法（允许值: ${validTypes.join(', ')}）`);
    }
    if (s.max_retry != null && (!Number.isInteger(s.max_retry) || s.max_retry < 0 || s.max_retry > 10)) {
      throw new Error(`[WF-DEF-006] steps_config[${i}].max_retry 超出范围 0-10`);
    }
  });
  if (body.trigger_type != null && !['manual', 'auto'].includes(body.trigger_type)) {
    throw new Error('[WF-DEF-007] trigger_type 必须为 manual 或 auto');
  }

  console.log(`[${traceId}] [STAGE#1] 入参校验通过`, {
    name: body.name,
    stepsCount: body.steps_config.length,
    stepTypes: body.steps_config.map(s => s.type),
    triggerType: body.trigger_type || 'manual',
    dramaId: body.drama_id || null,
  });

  const stepsConfig = typeof body.steps_config === 'string' ? body.steps_config : JSON.stringify(body.steps_config || []);
  const info = db.prepare(
    `INSERT INTO workflow_definitions (name, description, drama_id, steps_config, trigger_type, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    body.name.trim(),
    body.description || null,
    body.drama_id || null,
    stepsConfig,
    body.trigger_type || 'manual',
    body.is_active != null ? Number(body.is_active) : 1,
    body.created_by || null,
    nowStr(),
    nowStr()
  );
  const def = getDefinition(db, info.lastInsertRowid);
  console.log(`[${traceId}] [STAGE#1-DONE] 工作流定义创建成功`, {
    definitionId: def.id,
    costMs: Date.now() - t0,
  });
  return def;
}

/**
 * 更新工作流定义
 */
function updateDefinition(db, id, body) {
  const existing = getDefinition(db, id);
  if (!existing) return null;
  const fields = [];
  const params = [];
  if (body.name != null) { fields.push('name = ?'); params.push(body.name); }
  if (body.description != null) { fields.push('description = ?'); params.push(body.description); }
  if (body.drama_id != null) { fields.push('drama_id = ?'); params.push(body.drama_id); }
  if (body.steps_config != null) {
    fields.push('steps_config = ?');
    params.push(typeof body.steps_config === 'string' ? body.steps_config : JSON.stringify(body.steps_config));
  }
  if (body.trigger_type != null) { fields.push('trigger_type = ?'); params.push(body.trigger_type); }
  if (body.is_active != null) { fields.push('is_active = ?'); params.push(Number(body.is_active)); }
  fields.push('updated_at = ?'); params.push(nowStr());
  params.push(Number(id));
  db.prepare(`UPDATE workflow_definitions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getDefinition(db, id);
}

/**
 * 跳过指定步骤
 * [边界修复] 跳过后同步更新实例进度
 */
function skipStep(db, instanceId, stepIndex) {
  const traceId = makeTraceId('WF-SKIP');
  const stepLog = db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? AND step_index = ?')
    .get(Number(instanceId), Number(stepIndex));
  if (!stepLog) {
    console.log(`[${traceId}] [ERROR] 步骤日志不存在`, { instanceId, stepIndex });
    throw new Error('[WF-SKIP-001] 步骤日志不存在');
  }
  if (stepLog.status === STEP_STATUS.COMPLETED) {
    console.log(`[${traceId}] [WARN] 已完成的步骤无需跳过`, { instanceId, stepIndex });
  }
  db.prepare('UPDATE workflow_step_logs SET status = ?, completed_at = ? WHERE id = ?')
    .run(STEP_STATUS.SKIPPED, nowStr(), stepLog.id);
  // [边界修复] 同步推进实例进度
  const inst = getInstance(db, instanceId);
  if (inst && stepIndex === inst.current_step_index) {
    const completedSteps = Math.max(inst.completed_steps, stepIndex + 1);
    db.prepare('UPDATE workflow_instances SET current_step_index = ?, completed_steps = ?, updated_at = ? WHERE id = ?')
      .run(stepIndex + 1, completedSteps, nowStr(), Number(instanceId));
    console.log(`[${traceId}] 步骤跳过 → 实例进度推进`, {
      instanceId, stepIndex,
      newCurrentIndex: stepIndex + 1,
      completedSteps,
    });
  } else {
    console.log(`[${traceId}] 步骤跳过（不推进进度）`, { instanceId, stepIndex });
  }
  return getStepLogs(db, instanceId);
}

/**
 * 重试指定步骤
 * [边界修复] 校验 stepIndex 是否为失败步骤；重置失败实例状态为 paused
 */
async function retryStep(db, log, instanceId, stepIndex) {
  const traceId = makeTraceId('WF-RETRY');
  const inst = getInstance(db, instanceId);
  if (!inst) {
    console.log(`[${traceId}] [ERROR] 实例不存在`, { instanceId });
    throw new Error('[WF-RETRY-001] 实例不存在');
  }
  const stepLog = db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? AND step_index = ?')
    .get(Number(instanceId), Number(stepIndex));
  if (!stepLog) {
    console.log(`[${traceId}] [ERROR] 步骤日志不存在`, { instanceId, stepIndex });
    throw new Error('[WF-RETRY-002] 步骤日志不存在');
  }
  console.log(`[${traceId}]`, {
    instanceId, stepIndex,
    prevStepStatus: stepLog.status,
    prevInstanceStatus: inst.status,
    prevRetryCount: stepLog.retry_count,
  });
  // 重置步骤状态 — [边界修复] 手动重试时重置 retry_count=1（新一轮尝试）
  db.prepare('UPDATE workflow_step_logs SET status = ?, retry_count = 1, error_message = NULL WHERE instance_id = ? AND step_index = ?')
    .run(STEP_STATUS.PENDING, Number(instanceId), Number(stepIndex));
  // [边界修复] 将失败实例恢复为 PAUSED，等待用户 resume/run
  const nextStatus = inst.status === INSTANCE_STATUS.FAILED ? INSTANCE_STATUS.PAUSED : inst.status;
  db.prepare('UPDATE workflow_instances SET status = ?, current_step_index = ?, error_message = NULL, updated_at = ? WHERE id = ?')
    .run(nextStatus, Number(stepIndex), nowStr(), Number(instanceId));
  console.log(`[${traceId}] 步骤状态已重置为 pending，实例状态 ${inst.status} → ${nextStatus}`, {
    instanceId, stepIndex,
    newRetryCount: 1,
  });
  return getInstance(db, instanceId);
}

/**
 * 审核步骤（放行或驳回）
 * [边界修复] 审核通过后，如果下一步存在且下一步不是 reviewing，自动推进到下一步
 */
function reviewStep(db, instanceId, stepIndex, { approved, reviewerId, note }) {
  const traceId = makeTraceId('WF-REV');
  const stepLog = db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? AND step_index = ?')
    .get(Number(instanceId), Number(stepIndex));
  if (!stepLog) {
    console.log(`[${traceId}] [ERROR] 步骤日志不存在`, { instanceId, stepIndex });
    throw new Error('[WF-REV-001] 步骤日志不存在');
  }
  if (stepLog.status !== STEP_STATUS.REVIEWING) {
    console.log(`[${traceId}] [ERROR] 步骤不在审核状态`, { instanceId, stepIndex, status: stepLog.status });
    throw new Error('[WF-REV-002] 该步骤不在审核状态');
  }

  const inst = getInstance(db, instanceId);
  const steps = inst?.steps || [];
  const isLastStep = stepIndex >= steps.length - 1;

  // [P0 竞态修复] 审批状态机原子流转：把「仍为 reviewing」的前置条件下沉进 UPDATE 的 WHERE，
  // 以 changes===1 判定并发唯一赢家，避免「读 guard(274) → 写 UPDATE」之间的 TOCTOU 窗口
  // 导致两个并发审批（含 approve+reject 交叉）同时通过、重复推进实例进度 / 覆盖 reviewer。
  // 两条 UPDATE（step_log 流转 + instance 进度）用事务包裹，保证要么全成要么全不动。
  // 范式对齐 templateReviewService.manualReview 的条件 UPDATE + changes 判赢家写法。
  const runTx = () => {
    if (approved) {
      const changed = db.prepare(
        'UPDATE workflow_step_logs SET status = ?, reviewer_id = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = ?'
      ).run(STEP_STATUS.COMPLETED, reviewerId || null, nowStr(), note || null, stepLog.id, STEP_STATUS.REVIEWING).changes;
      // changes===0：该步骤已被其它并发审批处理，判定为不在审核状态，不再重复推进实例
      if (!changed) throw new Error('[WF-REV-002] 该步骤不在审核状态');
      console.log(`[${traceId}] 审核通过`, {
        instanceId, stepIndex,
        reviewerId: reviewerId || '-',
        note: (note || '').substring(0, 50),
      });
      // [边界修复] 审核通过后推进实例进度
      const completedSteps = Math.max(inst?.completed_steps || 0, stepIndex + 1);
      const nextIdx = isLastStep ? stepIndex : stepIndex + 1;
      const nextStatus = isLastStep ? INSTANCE_STATUS.COMPLETED : INSTANCE_STATUS.PENDING;
      db.prepare('UPDATE workflow_instances SET status = ?, current_step_index = ?, completed_steps = ?, error_message = NULL, updated_at = ? WHERE id = ?')
        .run(nextStatus, nextIdx, completedSteps, nowStr(), Number(instanceId));
      if (isLastStep) {
        db.prepare('UPDATE workflow_instances SET completed_at = ? WHERE id = ?').run(nowStr(), Number(instanceId));
        console.log(`[${traceId}] 最后一步审核通过 → 实例全部完成`);
      } else {
        console.log(`[${traceId}] 实例进度已推进，可调用 resume 继续执行`);
      }
    } else {
      const changed = db.prepare(
        'UPDATE workflow_step_logs SET status = ?, reviewer_id = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = ?'
      ).run(STEP_STATUS.FAILED, reviewerId || null, nowStr(), note || '审核未通过', stepLog.id, STEP_STATUS.REVIEWING).changes;
      if (!changed) throw new Error('[WF-REV-002] 该步骤不在审核状态');
      db.prepare('UPDATE workflow_instances SET status = ?, error_message = ? WHERE id = ?')
        .run(INSTANCE_STATUS.FAILED, '审核未通过: ' + (note || ''), Number(instanceId));
      console.log(`[${traceId}] 审核驳回 → 实例标记失败`, {
        instanceId, stepIndex,
        reason: (note || '审核未通过').substring(0, 50),
      });
    }
  };
  db.transaction ? db.transaction(runTx)() : runTx();
  return getStepLogs(db, instanceId);
}

/**
 * 删除工作流定义
 * [边界修复] 删除前检查是否存在进行中实例
 */
function deleteDefinition(db, id) {
  const traceId = makeTraceId('WF-DEL');
  const instCount = db.prepare(
    `SELECT COUNT(*) AS c FROM workflow_instances WHERE definition_id = ? AND status IN ('running','paused','pending')`
  ).get(Number(id)).c;
  if (instCount > 0) {
    console.log(`[${traceId}] [ERROR] 存在运行中的实例，禁止删除`, { definitionId: id, runningCount: instCount });
    throw new Error(`[WF-DEL-001] 存在 ${instCount} 个进行中的实例，禁止删除该定义`);
  }
  const info = db.prepare('DELETE FROM workflow_definitions WHERE id = ?').run(Number(id));
  const ok = info.changes > 0;
  console.log(`[${traceId}] 删除结果`, { definitionId: id, ok });
  return ok;
}

// ========== 工作流执行引擎 ==========

/**
 * 创建工作流执行实例
 * @param {object} db
 * @param {object} log
 * @param {number} definitionId - 工作流定义ID
 * @param {object} options - { drama_id, episode_id, created_by, initial_context }
 * @returns {object} 新建的实例
 */
function createInstance(db, log, definitionId, options = {}) {
  const traceId = makeTraceId('WF-INST');
  const t0 = Date.now();

  // === [STAGE#1] 定义存在性校验 ===
  const def = getDefinition(db, definitionId);
  if (!def) {
    const err = new Error('[WF-INST-001] 工作流定义不存在');
    console.log(`[${traceId}] [ERROR] 定义不存在`, { definitionId });
    throw err;
  }
  console.log(`[${traceId}] [STAGE#1] 定义校验通过`, {
    definitionId: def.id,
    definitionName: def.name,
    isActive: def.is_active,
  });

  const steps = parseJSON(def.steps_config, []);
  if (steps.length === 0) {
    const err = new Error('[WF-INST-002] 工作流定义中 steps_config 为空，无法创建实例');
    console.log(`[${traceId}] [ERROR] steps_config 为空`);
    throw err;
  }
  const context = options.initial_context || {};

  console.log(`[${traceId}] [STAGE#2] 预计算实例元数据`, {
    dramaId: options.drama_id || def.drama_id || null,
    episodeId: options.episode_id || null,
    totalSteps: steps.length,
    contextKeys: Object.keys(context).length,
  });

  const info = db.prepare(
    `INSERT INTO workflow_instances
      (definition_id, drama_id, episode_id, status, current_step_index, context, total_steps, completed_steps, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Number(definitionId),
    options.drama_id || def.drama_id || null,
    options.episode_id || null,
    INSTANCE_STATUS.PENDING,
    0,
    JSON.stringify(context),
    steps.length,
    0,
    options.created_by || null,
    nowStr(),
    nowStr()
  );

  const instance = getInstance(db, info.lastInsertRowid);

  // 预创建所有步骤日志
  steps.forEach((step, index) => {
    db.prepare(
      `INSERT INTO workflow_step_logs
        (instance_id, step_index, step_type, step_name, status, retry_count, input_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Number(instance.id),
      index,
      step.type || 'unknown',
      step.name || step.type || '',
      STEP_STATUS.PENDING,
      0,
      JSON.stringify(step.params || {})
    );
  });

  console.log(`[${traceId}] [STAGE#2-DONE] 工作流实例创建成功`, {
    instanceId: instance.id,
    definitionId: def.id,
    totalSteps: steps.length,
    costMs: Date.now() - t0,
  });
  return instance;
}

/**
 * 获取工作流实例
 */
function getInstance(db, instanceId) {
  const inst = db.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(Number(instanceId));
  if (inst) {
    inst.context = parseJSON(inst.context, {});
    inst.steps = parseJSON(getDefinition(db, inst.definition_id)?.steps_config, '[]');
  }
  return inst;
}

/**
 * 列出工作流实例
 */
function listInstances(db, filters = {}) {
  let sql = `SELECT i.*, d.name AS definition_name
             FROM workflow_instances i
             LEFT JOIN workflow_definitions d ON i.definition_id = d.id
             WHERE 1=1`;
  const params = [];
  if (filters.drama_id) { sql += ' AND i.drama_id = ?'; params.push(Number(filters.drama_id)); }
  if (filters.status) { sql += ' AND i.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY i.id DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit)); }
  return db.prepare(sql).all(...params);
}

/**
 * 获取步骤日志
 */
function getStepLogs(db, instanceId) {
  return db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? ORDER BY step_index ASC').all(Number(instanceId));
}

/**
 * 启动/恢复工作流执行
 * 这是核心执行循环：从 current_step_index 开始，依次执行每个步骤
 */
async function runInstance(db, log, instanceId) {
  const traceId = makeTraceId('WF-RUN');
  const t0 = Date.now();

  // === [STAGE#1] 实例状态前置校验 ===
  const instance = getInstance(db, instanceId);
  if (!instance) {
    const err = new Error('[WF-RUN-001] 工作流实例不存在');
    console.log(`[${traceId}] [ERROR] 实例不存在`, { instanceId });
    throw err;
  }
  if (instance.status === INSTANCE_STATUS.COMPLETED) {
    const err = new Error('[WF-RUN-002] 工作流已完成，禁止重复执行');
    console.log(`[${traceId}] [ERROR] 已完成禁止执行`, { instanceId });
    throw err;
  }
  if (instance.status === INSTANCE_STATUS.CANCELLED) {
    const err = new Error('[WF-RUN-003] 工作流已取消，禁止执行');
    console.log(`[${traceId}] [ERROR] 已取消禁止执行`, { instanceId });
    throw err;
  }
  if (instance.status === INSTANCE_STATUS.FAILED) {
    const err = new Error('[WF-RUN-004] 工作流处于失败状态，请先调用 retryStep 重置失败步骤后再执行');
    console.log(`[${traceId}] [WARN] 失败状态禁止直接执行，需先 retryStep`, { instanceId });
    throw err;
  }

  const steps = instance.steps || [];
  if (steps.length === 0) {
    const err = new Error('[WF-RUN-005] 工作流没有可执行的步骤');
    console.log(`[${traceId}] [ERROR] 步骤为空`, { instanceId });
    throw err;
  }

  console.log(`[${traceId}] [STAGE#1] 实例校验通过，开始执行`, {
    instanceId,
    prevStatus: instance.status,
    startIndex: instance.current_step_index,
    totalSteps: steps.length,
    completedSteps: instance.completed_steps,
  });

  // 标记为运行中
  db.prepare('UPDATE workflow_instances SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?')
    .run(INSTANCE_STATUS.RUNNING, nowStr(), nowStr(), Number(instanceId));

  let context = instance.context || {};
  let currentIndex = instance.current_step_index;

  console.log(`[${traceId}] [STAGE#2] 主循环启动`, {
    startIndex: currentIndex,
    endIndex: steps.length - 1,
    contextSize: JSON.stringify(context).length,
  });

  while (currentIndex < steps.length) {
    const step = steps[currentIndex];
    const stepT0 = Date.now();
    const stepLog = db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? AND step_index = ?')
      .get(Number(instanceId), currentIndex);

    // [边界修复] 步骤日志不存在（可能被删除），跳过
    if (!stepLog) {
      console.log(`[${traceId}] [WARN] 步骤日志不存在，跳过该步骤`, { instanceId, stepIndex: currentIndex });
      currentIndex++;
      continue;
    }

    // 检查是否已被取消或暂停
    const currentInst = getInstance(db, instanceId);
    if (currentInst.status === INSTANCE_STATUS.CANCELLED) {
      console.log(`[${traceId}] [STAGE#2-INTERRUPT] 工作流已取消，停止执行`, { instanceId, stepIndex: currentIndex });
      return { traceId, reason: 'cancelled' };
    }
    if (currentInst.status === INSTANCE_STATUS.PAUSED) {
      console.log(`[${traceId}] [STAGE#2-INTERRUPT] 工作流已暂停，等待恢复`, { instanceId, stepIndex: currentIndex });
      return { traceId, reason: 'paused' };
    }

    // 条件分支检查
    if (step.condition && !evaluateCondition(step.condition, context)) {
      console.log(`[${traceId}] [STEP#${currentIndex}] 条件不满足 → 跳过`, {
        stepType: step.type,
        condition: step.condition,
      });
      db.prepare('UPDATE workflow_step_logs SET status = ?, completed_at = ? WHERE id = ?')
        .run(STEP_STATUS.SKIPPED, nowStr(), stepLog.id);
      currentIndex++;
      continue;
    }

    // reviewing 状态 → 暂停等待审核
    if (stepLog.status === STEP_STATUS.REVIEWING) {
      console.log(`[${traceId}] [STEP#${currentIndex}] 等待人工审核 → 暂停实例`, {
        stepType: step.type,
      });
      db.prepare('UPDATE workflow_instances SET status = ?, current_step_index = ?, updated_at = ? WHERE id = ?')
        .run(INSTANCE_STATUS.PAUSED, currentIndex, nowStr(), Number(instanceId));
      return { traceId, reason: 'reviewing' };
    }

    // 执行步骤（含重试逻辑）
    const maxRetry = step.max_retry || 0;
    let retryCount = stepLog.retry_count || 0;
    let success = false;
    let output = null;
    let lastError = null;

    db.prepare('UPDATE workflow_step_logs SET status = ?, started_at = COALESCE(started_at, ?), input_data = ? WHERE id = ?')
      .run(STEP_STATUS.RUNNING, nowStr(), JSON.stringify({ context_snapshot: context, params: step.params || {} }), stepLog.id);

    console.log(`[${traceId}] [STEP#${currentIndex}-START]`, {
      stepType: step.type,
      stepName: step.name || '-',
      maxRetry,
      initialRetry: retryCount,
    });

    while (retryCount <= maxRetry) {
      try {
        const execT0 = Date.now();
        output = await executeStep(db, log, step, context, instance);
        const durationMs = Date.now() - execT0;

        db.prepare('UPDATE workflow_step_logs SET status = ?, output_data = ?, completed_at = ?, duration_ms = ? WHERE id = ?')
          .run(STEP_STATUS.COMPLETED, JSON.stringify(output), nowStr(), durationMs, stepLog.id);

        if (output && typeof output === 'object') {
          context = { ...context, [step.type]: output, [`step_${currentIndex}`]: output };
        }

        success = true;
        console.log(`[${traceId}] [STEP#${currentIndex}-DONE]`, {
          stepType: step.type,
          durationMs,
          outputKeys: output && typeof output === 'object' ? Object.keys(output) : null,
          totalCostMs: Date.now() - stepT0,
        });
        break;
      } catch (err) {
        lastError = err;
        retryCount++;
        if (retryCount <= maxRetry) {
          console.log(`[${traceId}] [STEP#${currentIndex}-RETRY#${retryCount}]`, {
            stepType: step.type,
            error: err.message,
            remainingRetries: maxRetry - retryCount + 1,
          });
          db.prepare('UPDATE workflow_step_logs SET retry_count = ? WHERE id = ?').run(retryCount, stepLog.id);
        }
      }
    }

    if (!success) {
      const errMsg = lastError ? lastError.message : '未知错误';
      db.prepare('UPDATE workflow_step_logs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?')
        .run(STEP_STATUS.FAILED, errMsg, nowStr(), stepLog.id);
      db.prepare('UPDATE workflow_instances SET status = ?, error_message = ?, current_step_index = ?, updated_at = ? WHERE id = ?')
        .run(INSTANCE_STATUS.FAILED, errMsg, currentIndex, nowStr(), Number(instanceId));
      console.log(`[${traceId}] [ERROR] 工作流执行失败`, {
        instanceId,
        stepIndex: currentIndex,
        stepType: step.type,
        error: errMsg,
        costMs: Date.now() - t0,
      });
      throw lastError;
    }

    // need_review 暂停审核
    if (step.need_review) {
      db.prepare('UPDATE workflow_step_logs SET status = ? WHERE id = ?')
        .run(STEP_STATUS.REVIEWING, stepLog.id);
      db.prepare('UPDATE workflow_instances SET status = ?, current_step_index = ?, completed_steps = ?, context = ?, updated_at = ? WHERE id = ?')
        .run(INSTANCE_STATUS.PAUSED, currentIndex + 1, currentIndex + 1, JSON.stringify(context), nowStr(), Number(instanceId));
      console.log(`[${traceId}] [STEP#${currentIndex}-NEED-REVIEW] 步骤执行完成 → 暂停等待人工放行`, {
        stepType: step.type,
      });
      return { traceId, reason: 'need_review' };
    }

    // 更新进度
    currentIndex++;
    db.prepare('UPDATE workflow_instances SET current_step_index = ?, completed_steps = ?, context = ?, updated_at = ? WHERE id = ?')
      .run(currentIndex, currentIndex, JSON.stringify(context), nowStr(), Number(instanceId));
  }

  // 全部完成
  db.prepare('UPDATE workflow_instances SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
    .run(INSTANCE_STATUS.COMPLETED, nowStr(), nowStr(), Number(instanceId));

  console.log(`[${traceId}] [STAGE#2-DONE] 工作流全部完成 🎉`, {
    instanceId,
    totalSteps: steps.length,
    totalCostMs: Date.now() - t0,
  });
  return { traceId, reason: 'completed' };
}

/**
 * 执行单个步骤
 */
async function executeStep(db, log, step, context, instance) {
  const stepType = step.type;
  const params = { ...(step.params || {}), ...context };

  switch (stepType) {
    case 'generate_outline': {
      const screenwriterService = require('./screenwriterService');
      const result = await screenwriterService.generateOutline(db, log, {
        logline: params.logline || params.creative || '一个精彩的短剧故事',
        user_id: instance.created_by,
        drama_id: instance.drama_id,
      });
      return { outline: result };
    }
    case 'generate_characters': {
      const screenwriterService = require('./screenwriterService');
      const outline = params.generate_outline?.outline || params.outline;
      const result = await screenwriterService.generateCharacters(db, log, {
        outline_id: outline?.id,
        drama_id: instance.drama_id,
        user_id: instance.created_by,
      });
      return { characters: result };
    }
    case 'generate_episodes': {
      const screenwriterService = require('./screenwriterService');
      const result = await screenwriterService.generateEpisodes(db, log, {
        outline_id: params.generate_outline?.outline?.id,
        drama_id: instance.drama_id,
        user_id: instance.created_by,
      });
      return { episodes: result };
    }
    case 'generate_storyboard': {
      const storyboardGenService = require('./storyboardGenService');
      const result = await storyboardGenService.generate(db, log, {
        drama_id: instance.drama_id,
        episode_id: instance.episode_id || params.episode_id,
        user_id: instance.created_by,
      });
      return { storyboards: result };
    }
    case 'generate_images': {
      // 批量生成分镜图片
      const imageService = require('./imageService');
      const storyboards = params.generate_storyboard?.storyboards || [];
      const results = [];
      for (const sb of storyboards) {
        try {
          const img = await imageService.generateImage(db, log, {
            storyboard_id: sb.id,
            drama_id: instance.drama_id,
            user_id: instance.created_by,
          });
          results.push(img);
        } catch (e) {
          log.warn('[Workflow] 单张图片生成失败，继续', { storyboardId: sb.id, error: e.message });
        }
      }
      return { images: results, count: results.length };
    }
    case 'generate_tts': {
      const ttsService = require('./ttsService');
      const result = await ttsService.batchGenerate(db, log, {
        drama_id: instance.drama_id,
        episode_id: instance.episode_id,
        user_id: instance.created_by,
      });
      return { tts: result };
    }
    case 'auto_edit': {
      const editService = require('./editService');
      const result = await editService.autoEdit(db, log, {
        drama_id: instance.drama_id,
        episode_id: instance.episode_id,
        user_id: instance.created_by,
      });
      return { edit: result };
    }
    default:
      throw new Error(`未知的步骤类型: ${stepType}`);
  }
}

/**
 * 条件分支求值
 * [边界修复] 畸形条件表达式不再静默返回 true，而是打印 WARN 并视为条件不通过（跳过）
 *   通过 `safeMode=true` 开关保持向后兼容（默认 true → 失败时不跳过）
 */
function evaluateCondition(condition, context, safeMode = true) {
  // [边界+日志#1] context 非对象（null / 原始类型）→ 明确WARN
  if (context === undefined || context === null || typeof context !== 'object') {
    console.log(`[WF-COND-WARN] context 非对象（type=${context === null ? 'null' : typeof context}），无法解析任何左路径，按 safeMode=${safeMode} 处理: condition="${condition}"`);
    if (condition === 'always' || condition === 'true') return true;
    if (condition === 'false' || condition === 'never') return false;
    return safeMode;
  }
  if (!condition || typeof condition !== 'string' || !condition.trim()) return true;

  // [边界+日志#2] 预处理：去除首尾括号包裹（如 "(count>=3)"）、零宽字符、全角符号标准化
  let raw = condition;
  condition = condition
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // 零宽空格/拼接/不连/零宽非断
    .replace(/\u3000/g, ' ')                   // 全角空格 → 半角
    .replace(/＝/g, '=').replace(/！/g, '!').replace(/＞/g, '>').replace(/＜/g, '<') // 全角操作符
    .trim();
  // 剥一层括号 (允许一次嵌套，比如 "(x==1)" 或 "((x==1))")
  for (let i = 0; i < 2; i++) {
    if (condition.startsWith('(') && condition.endsWith(')')) {
      condition = condition.slice(1, -1).trim();
    }
  }
  // 统一 === → ==、 !== → !=（弱类型语义等价，但更严格）
  condition = condition.replace(/===/g, '==').replace(/!==/g, '!=');

  if (raw !== condition) {
    console.log(`[WF-COND-DEBUG] 表达式预处理: 原始="${raw}" → 规范化="${condition}"`);
  }
  if (condition === 'always' || condition === 'true') return true;
  if (condition === 'false' || condition === 'never') return false;

  // [边界修复] 检测复合表达式（&&/|| 或多个比较操作符）— 当前实现不支持
  const allOps = condition.match(/==|!=|>=|<=|>|</g);
  if (allOps && allOps.length > 1) {
    console.log(`[WF-COND-WARN] 复合条件表达式不支持（含 ${allOps.length} 个操作符=${allOps.join(',')}），按 safeMode=${safeMode} 处理: "${condition}"`);
    return safeMode;
  }
  if (/\band\b|\bor\b|&&|\|\|/.test(condition)) {
    console.log(`[WF-COND-WARN] 逻辑运算符(and/or/&&/||)不支持，按 safeMode=${safeMode} 处理: "${condition}"`);
    return safeMode;
  }

  try {
    const opMatch = condition.match(/(==|!=|>=|<=|>|<)/);
    if (!opMatch) {
      console.log(`[WF-COND-WARN] 条件表达式畸形（无合法操作符），按 safeMode=${safeMode} 处理: "${condition}"`);
      return safeMode;
    }
    const op = opMatch[0];
    const leftPart = condition.substring(0, opMatch.index).trim();
    const rightPart = condition.substring(opMatch.index + op.length).trim().replace(/^['"]|['"]$/g, '');

    if (!leftPart) {
      console.log(`[WF-COND-WARN] 左路径为空，按 safeMode=${safeMode} 处理: "${condition}"`);
      return safeMode;
    }
    // 左路径字符校验：只允许 字母数字_$ 与 .分隔
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*$/.test(leftPart)) {
      console.log(`[WF-COND-WARN] 左路径含非法字符（仅支持"ident.ident..."），按 safeMode=${safeMode} 处理: leftPart="${leftPart}" | condition="${condition}"`);
      return safeMode;
    }
    if (!rightPart && rightPart !== '0') {
      console.log(`[WF-COND-WARN] 右值 为空，按 safeMode=${safeMode} 处理: "${condition}"`);
      return safeMode;
    }

    // 解析左值路径 + 详细定位"哪一级没找到"（用于排查字段名拼写）
    const leftPath = leftPart.split('.');
    let leftVal = context;
    let walked = '';
    for (let i = 0; i < leftPath.length; i++) {
      const p = leftPath[i];
      if (leftVal == null || typeof leftVal !== 'object') {
        const upTo = leftPath.slice(0, i).join('.');
        console.log(`[WF-COND-WARN] 条件路径 "${leftPart}" 在第${i}级 "${upTo}" 处已是 ${leftVal===null?'null':typeof leftVal}（非对象），无法继续取 "${p}"，按 safeMode=${safeMode} 处理。条件="${condition}"  context.topKeys=${JSON.stringify(Object.keys(context||{}))}`);
        leftVal = undefined;
        break;
      }
      if (!Object.prototype.hasOwnProperty.call(leftVal, p) && !(p in leftVal)) {
        const upTo = leftPath.slice(0, i).join('.');
        console.log(`[WF-COND-WARN] 条件路径 "${leftPart}" 到 "${upTo||'(根)'}" 时没有属性 "${p}"（可用keys=${JSON.stringify(Object.keys(leftVal||{}))}），按 safeMode=${safeMode} 处理。条件="${condition}"`);
        leftVal = undefined;
        break;
      }
      leftVal = leftVal[p];
      walked = leftPath.slice(0, i + 1).join('.');
    }

    // [边界修复] leftVal 为 undefined/null 时记录警告（上面细分过了，此处兜底记录最终类型）
    if (leftVal == null) {
      console.log(`[WF-COND-WARN] 左值最终为 ${leftVal === null ? 'null' : 'undefined'}，按 safeMode=${safeMode} 处理: "${condition}"`);
      return safeMode;
    }

    // [边界+日志#5] 数值比较分支
    if (['>=', '<=', '>', '<'].includes(op)) {
      const rightNum = Number(rightPart);
      const leftNum = Number(leftVal);
      // Infinity/-Infinity 允许，但显式打日志（排查超大值）
      if (!Number.isFinite(rightNum) && !Number.isNaN(rightNum)) {
        console.log(`[WF-COND-WARN] 右值 "${rightPart}" 转成非有限数（${rightNum}），仍将参与比较，请注意语义正确性: "${condition}"`);
      }
      if (!Number.isFinite(leftNum) && !Number.isNaN(leftNum)) {
        console.log(`[WF-COND-WARN] 左值 "${leftVal}"(${typeof leftVal}) 转成非有限数（${leftNum}），仍将参与比较，请注意语义正确性: "${condition}"`);
      }
      if (isNaN(rightNum)) {
        console.log(`[WF-COND-WARN] 右值 "${rightPart}" 非数字，数值比较无效，按 safeMode=${safeMode} 处理: "${condition}"`);
        return safeMode;
      }
      if (isNaN(leftNum)) {
        console.log(`[WF-COND-WARN] 左值 (${leftVal}, type=${typeof leftVal}) 非数字，数值比较无效，按 safeMode=${safeMode} 处理: "${condition}"`);
        return safeMode;
      }
      const r = evalNum(leftNum, op, rightNum);
      console.log(`[WF-COND-EVAL] 数值 ${leftPart}=${leftNum} (orig=${JSON.stringify(leftVal)}) ${op} ${rightNum} (orig="${rightPart}") → ${r}`);
      return r;
    }

    // [边界+日志#6] == / != 字符串/布尔 智能比较（布尔 vs "true"/"false"/1/0 做等值映射）
    const leftType = typeof leftVal;
    let leftForEq;
    let rightForEq = rightPart;
    if (leftType === 'boolean') {
      leftForEq = leftVal;
      // 把常见字符串右值 → 布尔：1/0, true/false, yes/no
      const rl = rightPart.toLowerCase();
      const map = { '1': true, '0': false, 'true': true, 'false': false, 'yes': true, 'no': false, 'on': true, 'off': false, '': false };
      if (Object.prototype.hasOwnProperty.call(map, rl)) {
        rightForEq = map[rl];
      } else if (!isNaN(Number(rightPart))) {
        rightForEq = Boolean(Number(rightPart));
      }
      const r = op === '==' ? (leftForEq === rightForEq) : (leftForEq !== rightForEq);
      console.log(`[WF-COND-EVAL] BOOL比较 ${leftPart}=${leftVal}(bool) ${op} "${rightPart}"→映射→${rightForEq}(type=${typeof rightForEq}) → ${r}  | 条件="${condition}"`);
      return r;
    }
    // 默认字符串比较（左值转字符串）
    const leftStr = String(leftVal);
    const result = op === '==' ? leftStr === rightPart : leftStr !== rightPart;
    console.log(`[WF-COND-EVAL] 字符串比较 ${leftPart}=${JSON.stringify(leftStr)} (origType=${leftType}) ${op} ${JSON.stringify(rightPart)} → ${result}`);
    return result;
  } catch (e) {
    console.log(`[WF-COND-ERROR] 条件表达式异常，按 safeMode=${safeMode} 处理`, {
      condition: raw,
      normalized: condition,
      error: e.message,
      stack: e.stack && e.stack.split('\n').slice(0, 3).join(' | '),
    });
    return safeMode;
  }
}

function evalNum(left, op, right) {
  switch (op) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>':  return left > right;
    case '<':  return left < right;
    default:   return false;
  }
}

/**
 * 暂停工作流
 */
function pauseInstance(db, instanceId) {
  const inst = getInstance(db, instanceId);
  if (!inst) return null;
  if (inst.status !== INSTANCE_STATUS.RUNNING) throw new Error('只有运行中的工作流才能暂停');
  db.prepare('UPDATE workflow_instances SET status = ?, updated_at = ? WHERE id = ?')
    .run(INSTANCE_STATUS.PAUSED, nowStr(), Number(instanceId));
  return getInstance(db, instanceId);
}

/**
 * 恢复工作流
 */
async function resumeInstance(db, log, instanceId) {
  const inst = getInstance(db, instanceId);
  if (!inst) return null;
  if (inst.status !== INSTANCE_STATUS.PAUSED) throw new Error('只有暂停状态的工作流才能恢复');
  await runInstance(db, log, instanceId);
  return getInstance(db, instanceId);
}

/**
 * 取消工作流
 */
function cancelInstance(db, instanceId) {
  const inst = getInstance(db, instanceId);
  if (!inst) return null;
  if (inst.status === INSTANCE_STATUS.COMPLETED || inst.status === INSTANCE_STATUS.CANCELLED) {
    throw new Error('已完成或已取消的工作流不能取消');
  }
  db.prepare('UPDATE workflow_instances SET status = ?, updated_at = ? WHERE id = ?')
    .run(INSTANCE_STATUS.CANCELLED, nowStr(), Number(instanceId));
  return getInstance(db, instanceId);
}

module.exports = {
  // 定义 CRUD
  listDefinitions,
  getDefinition,
  createDefinition,
  updateDefinition,
  deleteDefinition,
  // 实例管理
  createInstance,
  getInstance,
  listInstances,
  getStepLogs,
  runInstance,
  pauseInstance,
  resumeInstance,
  cancelInstance,
  skipStep,
  retryStep,
  reviewStep,
  evaluateCondition,
  // 常量
  INSTANCE_STATUS,
  STEP_STATUS,
  STEP_EXECUTORS,
};
