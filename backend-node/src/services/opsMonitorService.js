'use strict';

const { DEFAULT_PAGE_SIZE } = require('../constants/pagination');

/**
 * Sprint 16 - S16-T05 全链路监控告警（运维侧扩展）
 *
 * 在 S12-T06 系统指标采样器基础上，补充端到端可观测：
 *   - 数据库：MySQL 全局状态（Threads_connected / Threads_running / Slow_queries 增量 / Questions）
 *   - 队列：Bull 队列各状态（waiting/active/failed/delayed）
 *   - API：近 60s 错误率（复用 systemMonitorService.apiMetrics）
 *   - 前端：frontend_error_logs 上报聚合（近 1 小时 error 数量）
 *
 * 自动告警：scanAndAlertOps 检测阈值（默认值可经环境变量/参数覆盖），
 * 复用 alertService.dispatchItem 走既有告警通道（钉钉/企微/飞书）+ 写 anomaly_alert_events，
 * 全部真实数据，无 mock。
 */

const queueService = require('./queueService');
const systemMonitorService = require('./systemMonitorService');
const alertService = require('./alertService');

const DB_STATUS_VARS = [
  'Threads_connected', 'Threads_running', 'Slow_queries',
  'Questions', 'Aborted_connects', 'Connection_errors_max_connections'
];

/** 采集全链路运维快照（真实数据） */
async function collectOpsSnapshot(db, log) {
  const snapshot = { db: {}, queue: null, api: null, frontend: {}, collected_at: new Date().toISOString() };

  // 1) 数据库（MySQL 全局状态）
  try {
    const rows = db.prepare(
      `SHOW GLOBAL STATUS WHERE Variable_name IN (${DB_STATUS_VARS.map(() => '?').join(',')})`
    ).all(...DB_STATUS_VARS);
    for (const r of rows || []) snapshot.db[r.Variable_name] = Number(r.Value) || 0;
  } catch (e) { log?.warn?.('[S16-T05] 数据库状态采集失败:', e.message); }

  // 2) 队列
  try {
    snapshot.queue = await queueService.getQueueCounts();
  } catch (e) { log?.warn?.('[S16-T05] 队列状态采集失败:', e.message); }

  // 3) API 近 60s 指标
  try {
    snapshot.api = systemMonitorService.apiMetrics();
  } catch (e) { log?.warn?.('[S16-T05] API 指标采集失败:', e.message); }

  // 4) 前端错误聚合
  try {
    const r = db.prepare(
      `SELECT COUNT(*) AS c FROM frontend_error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`
    ).get();
    snapshot.frontend.hourly_total = Number(r?.c || 0);
    const r2 = db.prepare(
      `SELECT category, COUNT(*) AS c FROM frontend_error_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       GROUP BY category ORDER BY c DESC LIMIT 10`
    ).all() || [];
    snapshot.frontend.by_category = r2.map((x) => ({ category: x.category, count: Number(x.c) }));
  } catch (e) { log?.warn?.('[S16-T05] 前端错误聚合失败:', e.message); }

  return snapshot;
}

/** 前端错误上报 → frontend_error_logs（真实数据） */
function reportFrontendError(db, log, { userId = null, level = 'error', category = 'js_error', message, source, lineno, colno, stack, pageUrl, userAgent }) {
  const levelOk = ['error', 'warning', 'info'].includes(String(level)) ? String(level) : 'error';
  // 支持前端实际上报的类别（window_error / vue_error）+ 既有类别，未知降级 js_error
  const catOk = ['js_error', 'window_error', 'unhandledrejection', 'resource_error', 'route_error', 'api_error', 'vue_error'].includes(String(category))
    ? String(category) : 'js_error';
  const info = db.prepare(
    `INSERT INTO frontend_error_logs (user_id, level, category, message, source, lineno, colno, stack, page_url, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId ? Number(userId) : null,
    levelOk, catOk,
    message ? String(message).slice(0, 1024) : null,
    source ? String(source).slice(0, 255) : null,
    lineno != null ? Number(lineno) : null,
    colno != null ? Number(colno) : null,
    stack ? String(stack).slice(0, 8000) : null,
    pageUrl ? String(pageUrl).slice(0, 512) : null,
    userAgent ? String(userAgent).slice(0, 255) : null,
    new Date().toISOString()
  );
  return { ok: true, id: Number(info.insertId || info.lastInsertRowid || 0) };
}

/** 管理端分页查询前端错误 */
function listFrontendErrors(db, log, { page = 1, pageSize = DEFAULT_PAGE_SIZE, category, level } = {}) {
  const where = ['1=1'];
  const params = [];
  if (category) { where.push('category = ?'); params.push(String(category)); }
  if (level) { where.push('level = ?'); params.push(String(level)); }
  const pageN = Math.max(Number(page) || 1, 1);
  const pageSizeN = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM frontend_error_logs WHERE ${where.join(' AND ')}`).get(...params).c;
  const items = db.prepare(
    `SELECT id, user_id, level, category, message, source, lineno, colno, page_url, user_agent, created_at
     FROM frontend_error_logs WHERE ${where.join(' AND ')}
     ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSizeN, (pageN - 1) * pageSizeN) || [];
  return { total, page: pageN, pageSize: pageSizeN, items };
}

/** 全链路异常扫描并告警（复用既有告警通道） */
async function scanAndAlertOps(db, log, overrides = {}) {
  const results = [];
  const snapshot = await collectOpsSnapshot(db, log);

  // 1) 队列失败任务堆积
  const queueFailedTh = Number(overrides.queue_failed_threshold ?? process.env.OPS_QUEUE_FAILED_TH ?? 10);
  const failed = Number(snapshot.queue?.failed || 0);
  if (failed >= queueFailedTh) {
    const item = {
      id: 's16_queue_failed',
      type: 's16_queue_failed',
      severity: 'warning',
      reason: `任务队列失败数 ${failed} 达到阈值 ${queueFailedTh}`,
      row: { failed, waiting: Number(snapshot.queue?.waiting || 0), active: Number(snapshot.queue?.active || 0) }
    };
    try { results.push({ type: item.type, result: await alertService.dispatchItem({ db, log }, item) }); }
    catch (e) { log?.warn?.('[S16-T05] 队列告警发送失败:', e.message); }
  }

  // 2) API 错误率突增
  const errRateTh = Number(overrides.api_error_rate_threshold ?? process.env.OPS_API_ERROR_RATE_TH ?? 0.10);
  const api = snapshot.api || {};
  const apiTotal = Number(api.total || 0);
  const apiErrorRate = Number(api.errorRate || 0);
  if (apiTotal >= 20 && apiErrorRate >= errRateTh) {
    const item = {
      id: 's16_api_error_rate',
      type: 's16_api_error_rate',
      severity: 'warning',
      reason: `近 60s API 错误率 ${(apiErrorRate * 100).toFixed(1)}% ≥ 阈值 ${(errRateTh * 100).toFixed(0)}%（请求 ${apiTotal}）`,
      row: { total: apiTotal, errors: Number(api.errors || 0), error_rate: apiErrorRate, avg_ms: Number(api.avgMs || 0) }
    };
    try { results.push({ type: item.type, result: await alertService.dispatchItem({ db, log }, item) }); }
    catch (e) { log?.warn?.('[S16-T05] API 错误率告警发送失败:', e.message); }
  }

  // 3) 前端错误突增
  const feTh = Number(overrides.frontend_error_threshold ?? process.env.OPS_FRONTEND_ERROR_TH ?? 50);
  const feCount = Number(snapshot.frontend?.hourly_total || 0);
  if (feCount >= feTh) {
    const item = {
      id: 's16_frontend_error',
      type: 's16_frontend_error',
      severity: 'warning',
      reason: `近 1 小时前端错误上报 ${feCount} 条 ≥ 阈值 ${feTh}`,
      row: { hourly_total: feCount, by_category: JSON.stringify(snapshot.frontend?.by_category || []) }
    };
    try { results.push({ type: item.type, result: await alertService.dispatchItem({ db, log }, item) }); }
    catch (e) { log?.warn?.('[S16-T05] 前端错误告警发送失败:', e.message); }
  }

  // 4) 慢查询增量（两次采样间 Slow_queries 增长）
  const slowDelta = slowQueryDelta(db, log);
  const slowTh = Number(overrides.slow_query_threshold ?? process.env.OPS_SLOW_QUERY_TH ?? 20);
  if (slowDelta >= slowTh) {
    const item = {
      id: 's16_db_slow_query',
      type: 's16_db_slow_query',
      severity: 'info',
      reason: `采样周期内 MySQL 慢查询新增 ${slowDelta} 条 ≥ 阈值 ${slowTh}`,
      row: { delta: slowDelta }
    };
    try { results.push({ type: item.type, result: await alertService.dispatchItem({ db, log }, item) }); }
    catch (e) { log?.warn?.('[S16-T05] 慢查询告警发送失败:', e.message); }
  }

  return { snapshot, results };
}

let _lastSlowQueries = null;

/** 计算慢查询增量（真实 MySQL 全局状态 Slow_queries 差值） */
function slowQueryDelta(db, log) {
  try {
    const r = db.prepare(`SHOW GLOBAL STATUS WHERE Variable_name = 'Slow_queries'`).get();
    const cur = Number(r?.Value || 0);
    if (_lastSlowQueries == null) { _lastSlowQueries = cur; return 0; }
    const delta = Math.max(0, cur - _lastSlowQueries);
    _lastSlowQueries = cur;
    return delta;
  } catch (e) { log?.warn?.('[S16-T05] 慢查询统计失败:', e.message); return 0; }
}

module.exports = {
  collectOpsSnapshot,
  reportFrontendError,
  listFrontendErrors,
  scanAndAlertOps
};
