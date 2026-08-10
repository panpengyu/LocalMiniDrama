/**
 * workflows.js
 * Sprint 7 — S7-T03/S7-T04 工作流路由
 *
 * 日志规范：每条请求生成 requestId（格式 [REQ#WFxxxx]），分阶段打印：
 *   · [ENTER] 请求入参 + 认证上下文（脱敏）
 *   · [STAGE#n] 关键步骤启动
 *   · [DONE] 响应结果摘要 + 耗时
 *   · [ERROR] 捕获异常 + 错误码
 *
 * 权限控制 (S7-F05)：
 *   - 定义的更新/删除操作校验 ownership：created_by 匹配或超级管理员
 *   - 实例的写操作校验项目权限（可访问 drama_id 项目）
 */
const workflowService = require('../services/workflowService');
const permissionService = require('../services/permissionService');
const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');

function makeReqId() {
  return 'REQ#WF' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function maskUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username || u.name, role: u.role };
}

/** 校验 drama_id 项目权限（当前用户可访问则通过） */
function ensureDramaAccess(db, user, dramaId, reqId, action = '访问') {
  if (permissionService.isSuperAdmin(user)) return true;
  if (!dramaId) return true;  // 未限定项目（通用模板），跳过
  const drama = db.prepare('SELECT id, created_by, enterprise_id, team_id FROM dramas WHERE id = ?').get(Number(dramaId));
  if (!drama) return true;  // 找不到项目时交给 service 报错
  if (!permissionService.canViewDrama(user, drama)) {
    console.log(`[${reqId}] [403] 无权限${action}该项目 drama_id=${dramaId}，当前用户:`, { user: maskUser(user) });
    return false;
  }
  return true;
}

function workflowRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  // ========== 工作流定义 CRUD ==========

  router.get('/definitions', (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] GET /workflows/definitions`, {
      drama_id: req.query.drama_id,
      is_active: req.query.is_active,
      user: maskUser(req.user),
    });
    try {
      const list = workflowService.listDefinitions(db, {
        drama_id: req.query.drama_id,
        is_active: req.query.is_active,
      });
      console.log(`[${reqId}] [DONE] 获取定义列表 ${list.length} 条，耗时 ${Date.now() - t0}ms`);
      response.success(res, list);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 列表失败:`, err.message);
      log.error('List workflow definitions failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/definitions/:id', (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] GET /workflows/definitions/:id`, { id: req.params.id });
    const def = workflowService.getDefinition(db, req.params.id);
    if (!def) return response.notFound(res, '工作流定义不存在');
    response.success(res, def);
  });

  router.post('/definitions', requireAuth, (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    const body = req.body || {};
    console.log(`[${reqId}] [ENTER] POST /workflows/definitions`, {
      name: body.name,
      drama_id: body.drama_id,
      trigger_type: body.trigger_type,
      steps_count: Array.isArray(body.steps_config) ? body.steps_config.length : null,
      user: maskUser(req.user),
    });
    // [S7-F05] 项目权限
    if (!ensureDramaAccess(db, req.user, body.drama_id, reqId, '创建工作流于')) {
      return response.forbidden(res, '无权在该项目下创建工作流');
    }
    if (!body.name) return response.badRequest(res, 'name 必填');
    if (!body.steps_config || !Array.isArray(body.steps_config) || body.steps_config.length === 0) {
      return response.badRequest(res, 'steps_config 必填且需为非空数组');
    }
    try {
      const def = workflowService.createDefinition(db, { ...body, created_by: req.user?.id });
      console.log(`[${reqId}] [DONE] 定义创建成功 id=${def.id}，耗时 ${Date.now() - t0}ms`);
      response.created(res, def);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 创建失败:`, err.message);
      log.error('Create workflow definition failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/definitions/:id', requireAuth, (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] PUT /workflows/definitions/:id`, {
      id: req.params.id,
      user: maskUser(req.user),
      keys: Object.keys(req.body || {}),
    });
    try {
      const existing = workflowService.getDefinition(db, req.params.id);
      if (!existing) return response.notFound(res, '工作流定义不存在');
      // [S7-F05] 所有权校验
      if (!permissionService.isSuperAdmin(req.user) && existing.created_by != null && existing.created_by !== req.user?.id) {
        console.log(`[${reqId}] [403] 非创建者禁止更新定义`);
        return response.forbidden(res, '无权修改该工作流定义（仅创建者或管理员）');
      }
      const def = workflowService.updateDefinition(db, req.params.id, req.body || {});
      console.log(`[${reqId}] [DONE] 定义更新成功，耗时 ${Date.now() - t0}ms`);
      response.success(res, def);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 更新失败:`, err.message);
      log.error('Update workflow definition failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/definitions/:id', requireAuth, (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] DELETE /workflows/definitions/:id`, { id: req.params.id, user: maskUser(req.user) });
    try {
      const existing = workflowService.getDefinition(db, req.params.id);
      if (!existing) return response.notFound(res, '工作流定义不存在');
      if (!permissionService.isSuperAdmin(req.user) && existing.created_by != null && existing.created_by !== req.user?.id) {
        return response.forbidden(res, '无权删除该工作流定义（仅创建者或管理员）');
      }
      const ok = workflowService.deleteDefinition(db, req.params.id);
      if (!ok) return response.notFound(res, '工作流定义不存在');
      console.log(`[${reqId}] [DONE] 定义删除成功`);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 删除失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  // ========== 工作流实例执行 ==========

  router.get('/instances', (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] GET /workflows/instances`, {
      drama_id: req.query.drama_id,
      status: req.query.status,
      limit: req.query.limit,
    });
    try {
      const list = workflowService.listInstances(db, {
        drama_id: req.query.drama_id,
        status: req.query.status,
        limit: req.query.limit || 50,
      });
      console.log(`[${reqId}] [DONE] 获取实例列表 ${list.length} 条，耗时 ${Date.now() - t0}ms`);
      response.success(res, list);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 列表实例失败:`, err.message);
      log.error('List workflow instances failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/instances/:id', (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] GET /workflows/instances/:id`, { id: req.params.id });
    try {
      const inst = workflowService.getInstance(db, req.params.id);
      if (!inst) return response.notFound(res, '工作流实例不存在');
      const steps = workflowService.getStepLogs(db, req.params.id);
      console.log(`[${reqId}] [DONE] 获取实例详情，步骤日志 ${steps.length} 条，耗时 ${Date.now() - t0}ms`);
      response.success(res, { ...inst, step_logs: steps });
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 获取实例失败:`, err.message);
      log.error('Get workflow instance failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 创建并启动工作流实例
  router.post('/instances', requireAuth, async (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    const body = req.body || {};
    console.log(`[${reqId}] [ENTER] POST /workflows/instances 创建实例并启动`, {
      definition_id: body.definition_id,
      drama_id: body.drama_id,
      episode_id: body.episode_id,
      context_keys: body.context ? Object.keys(body.context) : null,
      user: maskUser(req.user),
    });
    if (!body.definition_id) return response.badRequest(res, 'definition_id 必填');
    // [S7-F05] 项目权限
    if (!ensureDramaAccess(db, req.user, body.drama_id, reqId, '执行工作流于')) {
      return response.forbidden(res, '无权在该项目下执行工作流');
    }
    try {
      const inst = workflowService.createInstance(db, log, body.definition_id, {
        drama_id: body.drama_id,
        episode_id: body.episode_id,
        created_by: req.user?.id,
        initial_context: body.context || {},
      });
      console.log(`[${reqId}] [STAGE#1] 实例创建成功 id=${inst.id}，异步启动执行...`);

      // 异步启动执行（不阻塞响应）
      workflowService.runInstance(db, log, inst.id).then((r) => {
        console.log(`[${reqId}] [ASYNC-DONE] 实例执行结束`, {
          instanceId: inst.id,
          result: r,
          costMs: Date.now() - t0,
        });
      }).catch((err) => {
        console.log(`[${reqId}] [ASYNC-ERROR] 实例执行失败`, {
          instanceId: inst.id,
          error: err.message,
          stack: (err.stack || '').split('\n').slice(0, 5).join(' | '),
        });
        log.error('Workflow run failed', { instanceId: inst.id, error: err.message });
      });

      console.log(`[${reqId}] [DONE] 响应已返回，耗时 ${Date.now() - t0}ms`);
      response.created(res, inst);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 创建实例失败:`, err.message);
      log.error('Create workflow instance failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/run', requireAuth, async (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] POST /instances/:id/run`, { id: req.params.id, user: maskUser(req.user) });
    try {
      const instBefore = workflowService.getInstance(db, req.params.id);
      if (!instBefore) return response.notFound(res, '工作流实例不存在');
      if (!ensureDramaAccess(db, req.user, instBefore.drama_id, reqId, '恢复执行工作流于')) {
        return response.forbidden(res, '无权操作该实例');
      }
      await workflowService.resumeInstance(db, log, req.params.id);
      const inst = workflowService.getInstance(db, req.params.id);
      console.log(`[${reqId}] [DONE] 恢复执行完成，当前状态 ${inst.status}，耗时 ${Date.now() - t0}ms`);
      response.success(res, inst);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 恢复执行失败:`, err.message);
      log.error('Run workflow instance failed', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/pause', requireAuth, (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] POST /instances/:id/pause`, { id: req.params.id });
    try {
      const inst = workflowService.pauseInstance(db, req.params.id);
      response.success(res, inst);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 暂停失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/cancel', requireAuth, (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] POST /instances/:id/cancel`, { id: req.params.id });
    try {
      const inst = workflowService.cancelInstance(db, req.params.id);
      response.success(res, inst);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 取消失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/steps/:stepIndex/skip', requireAuth, (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] skipStep`, {
      instance_id: req.params.id,
      step_index: req.params.stepIndex,
      user: maskUser(req.user),
    });
    try {
      const steps = workflowService.skipStep(db, req.params.id, req.params.stepIndex);
      console.log(`[${reqId}] [DONE] 跳过步骤 ${req.params.stepIndex}，耗时 ${Date.now() - t0}ms`);
      response.success(res, steps);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 跳过失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/steps/:stepIndex/retry', requireAuth, async (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] retryStep`, {
      instance_id: req.params.id,
      step_index: req.params.stepIndex,
      user: maskUser(req.user),
    });
    try {
      const inst = await workflowService.retryStep(db, log, req.params.id, req.params.stepIndex);
      console.log(`[${reqId}] [DONE] 重试步骤 ${req.params.stepIndex}，实例状态=${inst.status}，耗时 ${Date.now() - t0}ms`);
      response.success(res, inst);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 重试失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  router.post('/instances/:id/steps/:stepIndex/review', requireAuth, (req, res) => {
    const reqId = makeReqId();
    const t0 = Date.now();
    console.log(`[${reqId}] [ENTER] reviewStep`, {
      instance_id: req.params.id,
      step_index: req.params.stepIndex,
      approved: req.body?.approved,
      note_len: (req.body?.note || '').length,
      reviewerId: req.user?.id,
    });
    try {
      const steps = workflowService.reviewStep(db, req.params.id, req.params.stepIndex, {
        approved: req.body?.approved,
        reviewerId: req.user?.id,
        note: req.body?.note,
      });
      console.log(`[${reqId}] [DONE] 审核步骤 ${req.params.stepIndex} done=${req.body?.approved}，耗时 ${Date.now() - t0}ms`);
      response.success(res, steps);
    } catch (err) {
      console.log(`[${reqId}] [ERROR] 审核失败:`, err.message);
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = workflowRoutes;
