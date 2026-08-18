'use strict';

/**
 * S21-T02 运维自动化：备份/恢复/回滚脚本触发 + 扩缩容建议
 *
 * 安全约束：
 *   - 脚本动作白名单（backup/restore/rollback），参数仅透传备份目录（restore 必须显式指定）
 *   - 脚本只读不落库；执行结果与输出实时回传，无 mock
 *   - 扩缩容建议基于真实指标：CPU(loadavg) / 内存 / 队列积压 / DB 连接数
 */

const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'deploy', 'opsScripts');
const ALLOWED_ACTIONS = ['backup', 'restore', 'rollback'];

/** 在服务端执行运维脚本（白名单动作），实时收集 stdout/stderr */
function runScript(action, { args = [], timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_ACTIONS.includes(action)) {
      return reject(Object.assign(new Error(`不支持的动作: ${action}`), { code: 'BAD_ACTION' }));
    }
    const scriptPath = path.join(SCRIPTS_DIR, `${action}.sh`);
    const child = spawn('/bin/bash', [scriptPath, ...args], {
      cwd: path.dirname(SCRIPTS_DIR),
      timeout: timeoutMs,
      env: { ...process.env, NON_INTERACTIVE: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => reject(Object.assign(err, { code: 'SCRIPT_ERR' })));
    child.on('close', (code) => {
      const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
      if (code === 0) resolve({ code, output });
      else reject(Object.assign(new Error(`脚本退出码 ${code}`), { code: 'SCRIPT_FAIL', output }));
    });
  });
}

/**
 * 扩缩容建议（真实指标采集）：
 *   - CPU：loadavg1 / 核数 占比
 *   - 内存：已用比例
 *   - 队列：Bull waiting/active 积压
 *   - DB：MySQL Threads_running / Threads_connected
 * 阈值（可经环境变量覆盖）：CPU>70% 持续、队列积压>50 判定需要扩容。
 */
async function getScalingAdvice(db, log) {
  const cpus = Math.max(os.cpus().length, 1);
  const load1 = os.loadavg()[0];
  const cpuPct = Math.round((load1 / cpus) * 100);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

  let queue = null;
  try {
    const queueService = require('./queueService');
    // Bull 连接 Redis 不可达时 ioredis 会无限重试，这里限时 5s，避免采集挂起
    queue = await Promise.race([
      queueService.getQueueCounts(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('队列采集超时(5s)')), 5000)),
    ]);
  } catch (e) { log?.warn?.('[S21-T02] 队列采集失败:', e.message); }
  const waiting = Number(queue?.waiting || 0);
  const active = Number(queue?.active || 0);
  const failed = Number(queue?.failed || 0);

  let dbConn = 0;
  let dbRunning = 0;
  try {
    const r = db.prepare(`SHOW GLOBAL STATUS WHERE Variable_name = 'Threads_connected'`).get();
    dbConn = Number(r?.Value || 0);
    const r2 = db.prepare(`SHOW GLOBAL STATUS WHERE Variable_name = 'Threads_running'`).get();
    dbRunning = Number(r2?.Value || 0);
  } catch (e) { log?.warn?.('[S21-T02] DB 状态采集失败:', e.message); }

  // 判定级别
  const cpuHighTh = Number(process.env.OPS_SCALE_CPU_TH || 70);
  const queueHighTh = Number(process.env.OPS_SCALE_QUEUE_TH || 50);
  let level = 'normal';
  const reasons = [];
  if (cpuPct >= cpuHighTh) { level = 'scale-up'; reasons.push(`CPU 占用 ${cpuPct}% ≥ ${cpuHighTh}%`); }
  if (waiting >= queueHighTh) { level = 'scale-up'; reasons.push(`队列积压 ${waiting} ≥ ${queueHighTh}`); }
  if (waiting >= Math.ceil(queueHighTh / 2) || cpuPct >= Math.ceil(cpuHighTh / 2)) {
    if (level === 'normal') { level = 'watch'; }
    if (waiting >= Math.ceil(queueHighTh / 2)) reasons.push(`队列待处理 ${waiting}`);
    if (cpuPct >= Math.ceil(cpuHighTh / 2)) reasons.push(`CPU 占用 ${cpuPct}%`);
  }
  if (level === 'normal') reasons.push('各项指标平稳');

  const suggestion = level === 'scale-up'
    ? `建议扩容：当前 CPU 负载 ${cpuPct}%、队列积压 ${waiting}。可将 PM2 实例数从 1 提升到 ${Math.min(4, Math.max(2, Math.ceil(cpuPct / 50)))}（pm2 scale backend 2），并关注 DB Threads_running=${dbRunning}。`
    : level === 'watch'
      ? `建议观察：CPU ${cpuPct}%、队列 ${waiting}。接近阈值，建议提前准备扩容脚本与连接池参数。`
      : `无需扩容：CPU ${cpuPct}%、内存 ${memPct}%、队列积压 ${waiting}，均低于阈值。`;

  return {
    level,
    reasons,
    suggestion,
    metrics: {
      cpu_pct: cpuPct,
      mem_pct: memPct,
      loadavg1: Number(load1.toFixed(2)),
      cpus,
      queue_waiting: waiting,
      queue_active: active,
      queue_failed: failed,
      db_threads_connected: dbConn,
      db_threads_running: dbRunning,
    },
    sampled_at: new Date().toISOString(),
  };
}

module.exports = { runScript, getScalingAdvice, ALLOWED_ACTIONS, SCRIPTS_DIR };
