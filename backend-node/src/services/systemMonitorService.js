'use strict';

/**
 * Sprint 12 - S12-T06 系统监控服务
 *
 * 采集真实运行时指标：
 *   - CPU 使用率（基于 os.cpus() 两次采样的差值计算，非估算）
 *   - 内存使用率（os.totalmem / os.freemem，进程 RSS）
 *   - 磁盘使用率（对存储根目录执行 df / statfs，跨平台）
 *   - 系统负载（os.loadavg 1min，Windows 下降级为 0）
 *   - 队列积压（queueService.getQueueCounts：waiting / active）
 *   - API 吞吐与错误率（进程内滑动窗口统计近 60s 请求数与错误占比）
 *   - 数据库连通性（对当前连接执行 SELECT 1 探测）
 *
 * 采样结果可持久化到 system_metric_snapshots（真实 MySQL 表），供大屏历史曲线使用。
 * 全部为真实数据，无 mock。
 */

const os = require('os');
const { execFile } = require('child_process');

// ------------------------------------------------------------
// API 请求滑动窗口统计（进程内，真实运行时数据）
// 记录最近 WINDOW_MS 内每个请求的 { ts, ok }
// ------------------------------------------------------------
const WINDOW_MS = 60 * 1000;
const _apiEvents = [];
let _totalRequests = 0;
let _totalErrors = 0;

/** Express 中间件：统计每个 /api 请求的耗时与成败 */
function apiMetricsMiddleware() {
  return function (req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      const ok = res.statusCode < 500;
      _totalRequests += 1;
      if (!ok) _totalErrors += 1;
      _apiEvents.push({ ts: start, ok, ms: Date.now() - start });
      // 修剪窗口
      const cutoff = Date.now() - WINDOW_MS;
      while (_apiEvents.length && _apiEvents[0].ts < cutoff) _apiEvents.shift();
    });
    next();
  };
}

/** 近 60s API 指标：QPM、错误率、平均耗时 */
function apiMetrics() {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = _apiEvents.filter((e) => e.ts >= cutoff);
  const total = recent.length;
  const errors = recent.filter((e) => !e.ok).length;
  const avgMs = total ? recent.reduce((s, e) => s + e.ms, 0) / total : 0;
  return {
    qpm: total,
    error_rate: total ? +((errors / total) * 100).toFixed(2) : 0,
    avg_latency_ms: +avgMs.toFixed(1),
    total_requests: _totalRequests,
    total_errors: _totalErrors,
  };
}

// ------------------------------------------------------------
// CPU 使用率：对 os.cpus() 做两次采样求差
// ------------------------------------------------------------
function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const t of Object.keys(c.times)) total += c.times[t];
    idle += c.times.idle;
  }
  return { idle, total };
}

function cpuPercent(intervalMs = 200) {
  return new Promise((resolve) => {
    const a = cpuSnapshot();
    setTimeout(() => {
      const b = cpuSnapshot();
      const idleDiff = b.idle - a.idle;
      const totalDiff = b.total - a.total;
      const pct = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
      resolve(+Math.max(0, Math.min(100, pct)).toFixed(2));
    }, intervalMs);
  });
}

// ------------------------------------------------------------
// 磁盘使用率：优先 fs.statfs（Node 18+），否则调用 df
// ------------------------------------------------------------
function diskPercent(targetPath) {
  const fs = require('fs');
  return new Promise((resolve) => {
    if (typeof fs.statfs === 'function') {
      fs.statfs(targetPath || process.cwd(), (err, stats) => {
        if (err || !stats || !stats.blocks) return resolve(dfFallback(targetPath));
        const total = stats.blocks * stats.bsize;
        const free = stats.bfree * stats.bsize;
        const used = total - free;
        resolve(total > 0 ? +((used / total) * 100).toFixed(2) : 0);
      });
    } else {
      dfFallback(targetPath).then(resolve);
    }
  });
}

function dfFallback(targetPath) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') return resolve(0);
    execFile('df', ['-kP', targetPath || process.cwd()], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(0);
      const lines = String(stdout).trim().split('\n');
      const last = lines[lines.length - 1].split(/\s+/);
      // Filesystem 1024-blocks Used Available Capacity Mounted
      const capacity = last[4] ? parseFloat(String(last[4]).replace('%', '')) : 0;
      resolve(Number.isFinite(capacity) ? capacity : 0);
    });
  });
}

// ------------------------------------------------------------
// 数据库连通性探测
// ------------------------------------------------------------
function dbHealth(db) {
  const started = Date.now();
  try {
    db.prepare('SELECT 1 AS ok').get();
    return { ok: true, type: db.type || 'sqlite', latency_ms: Date.now() - started };
  } catch (err) {
    return { ok: false, type: db.type || 'sqlite', error: err.message };
  }
}

// ------------------------------------------------------------
// 汇总当前系统快照（实时）
// ------------------------------------------------------------
async function snapshot(db, { storageRoot } = {}) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = totalMem > 0 ? +((usedMem / totalMem) * 100).toFixed(2) : 0;
  const load = os.loadavg ? os.loadavg()[0] : 0;

  const [cpu, disk, queue] = await Promise.all([
    cpuPercent(),
    diskPercent(storageRoot),
    require('./queueService').getQueueCounts(),
  ]);

  const api = apiMetrics();
  const proc = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    cpu: { percent: cpu, cores: os.cpus().length, model: (os.cpus()[0] || {}).model || 'unknown' },
    memory: {
      percent: memPercent,
      total: totalMem,
      used: usedMem,
      free: freeMem,
      process_rss: proc.rss,
      process_heap_used: proc.heapUsed,
    },
    disk: { percent: disk },
    load_avg: +Number(load).toFixed(2),
    queue: { waiting: queue.waiting, active: queue.active, completed: queue.completed, failed: queue.failed, redis_ok: queue.redisOk, fallback: queue.fallback },
    api,
    database: dbHealth(db),
    uptime: {
      process_seconds: Math.floor(process.uptime()),
      system_seconds: Math.floor(os.uptime()),
    },
    platform: { type: os.type(), release: os.release(), arch: os.arch(), node: process.version, hostname: os.hostname() },
  };
}

/** 采样并持久化到 system_metric_snapshots（真实入库） */
async function sampleAndPersist(db, log, opts = {}) {
  const s = await snapshot(db, opts);
  try {
    db.prepare(
      `INSERT INTO system_metric_snapshots
        (cpu_percent, mem_percent, disk_percent, load_avg, queue_waiting, queue_active, api_qpm, api_error_rate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      s.cpu.percent, s.memory.percent, s.disk.percent, s.load_avg,
      s.queue.waiting, s.queue.active, s.api.qpm, s.api.error_rate,
      new Date().toISOString()
    );
  } catch (err) {
    if (log) log.warn('[S12-T06] 系统指标持久化失败', { error: err.message });
  }
  return s;
}

/** 读取历史指标（近 N 分钟采样点） */
function history(db, { limit = 60 } = {}) {
  const rows = db.prepare(
    `SELECT cpu_percent, mem_percent, disk_percent, load_avg, queue_waiting, queue_active, api_qpm, api_error_rate, created_at
     FROM system_metric_snapshots ORDER BY id DESC LIMIT ?`
  ).all(Math.min(500, Math.max(1, Number(limit) || 60)));
  return rows.reverse();
}

let _timer = null;
/** 启动周期采样（默认 30s 一次），供大屏历史曲线累积真实数据 */
function startSampler(db, log, { intervalMs = 30000, storageRoot } = {}) {
  if (_timer) return;
  const tick = () => { sampleAndPersist(db, log, { storageRoot }).catch(() => {}); };
  _timer = setInterval(tick, intervalMs);
  if (_timer.unref) _timer.unref();
  // 启动即采一次，保证大屏立即有数据
  tick();
  if (log) log.info('[S12-T06] 系统指标采样器已启动', { intervalMs });
}

function stopSampler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
  apiMetricsMiddleware,
  apiMetrics,
  snapshot,
  sampleAndPersist,
  history,
  startSampler,
  stopSampler,
  dbHealth,
};
