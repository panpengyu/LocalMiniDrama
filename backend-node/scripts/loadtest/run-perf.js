#!/usr/bin/env node
'use strict';

/**
 * Sprint 16 - S16-T02 全链路性能压测（真实 MySQL 数据 + 结果持久化）
 *
 * 用法：
 *   node scripts/loadtest/run-perf.js \
 *     [--base http://127.0.0.1:5679] \
 *     [--concurrency 100] [--duration 5] \
 *     [--scenarios health,dramas,library,recommend,help] \
 *     [--username admin] [--password admin123]
 *
 * 说明：
 *   - 登录获取真实 token 后对核心 API 场景逐一压测（零 mock）
 *   - 每个场景结果写入 MySQL perf_test_results 表（含 P50/P90/P95/P99/QPS/错误率）
 *   - 最后输出 SLO 达标检查（P99 < 500ms 为生产验收目标）
 */

const { execFileSync } = require('child_process');
const http = require('http');
const path = require('path');

const BASE = process.env.LOADTEST_BASE || 'http://127.0.0.1:5679';
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY || 100);
const DURATION = Number(process.env.LOADTEST_DURATION || 5);
const USERNAME = process.env.LOADTEST_USERNAME || 'admin';
const PASSWORD = process.env.LOADTEST_PASSWORD || 'admin123';

const SCENARIOS = {
  health: { method: 'GET', path: '/health', needAuth: false },
  dramas: { method: 'GET', path: '/api/v1/dramas?page=1&page_size=20', needAuth: true },
  library: { method: 'GET', path: '/api/v1/character-library?page=1&page_size=20', needAuth: true },
  recommend: { method: 'GET', path: '/api/v1/recommend/trending?limit=20', needAuth: true },
  help: { method: 'GET', path: '/api/v1/help/docs?category=manual', needAuth: true }
};

/** 进程内 HTTP JSON 请求（避免子进程转义问题） */
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
      }
    }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => {
        try { resolve(JSON.parse(s)); } catch (e) { reject(new Error(`响应解析失败: ${s.slice(0, 200)}`)); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login() {
  const res = await request('POST', '/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
  const token = res?.data?.token;
  if (!token) throw new Error(`登录失败: ${JSON.stringify(res)}`);
  return token;
}

async function main() {
  const token = await login();
  const baseUrl = new URL(BASE);
  const results = [];

  for (const [name, sc] of Object.entries(SCENARIOS)) {
    const url = BASE + sc.path;
    const argv = [
      path.join(__dirname, 'loadtest.js'),
      '--url', url,
      '--concurrency', String(CONCURRENCY),
      '--duration', String(DURATION),
      '--method', sc.method,
      '--scenario', name
    ];
    if (sc.needAuth && token) argv.push('--token', token);
    argv.push('--x-perf', '1'); // 压测旁路全局限流（非生产环境）
    let output;
    try {
      output = JSON.parse(execFileSync(process.execPath, argv, { encoding: 'utf8' }).trim());
    } catch (e) {
      console.error(`[压测] 场景 ${name} 执行失败:`, e.message);
      continue;
    }
    results.push({ ...output, host: `${baseUrl.hostname}:${baseUrl.port || 80}`, pid: process.pid });
    const line = `  [${name}] qps=${output.qps} p50=${output.p50Ms}ms p95=${output.p95Ms}ms p99=${output.p99Ms}ms err=${(output.errorRate * 100).toFixed(2)}%`;
    console.log(line);
  }

  // 结果持久化到 MySQL perf_test_results（真实数据）
  let saved = 0;
  try {
    const { loadConfig } = require(path.join(__dirname, '..', '..', 'src', 'config'));
    const { getDb } = require(path.join(__dirname, '..', '..', 'src', 'db'));
    const db = getDb(loadConfig().database);
    for (const r of results) {
      const safe = (v, d = null) => (v == null || v === '' ? d : v);
      db.prepare(
        `INSERT INTO perf_test_results
           (scenario, method, path, concurrency, duration_ms, total_requests, success_count, fail_count,
            qps, p50_ms, p90_ms, p95_ms, p99_ms, error_rate, env, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        safe(r.scenario), safe(r.method), safe(r.url, ''), Number(r.concurrency || 0), Number(r.durationMs || 0),
        Number(r.totalRequests || 0), Number(r.successCount || 0), Number(r.failCount || 0),
        Number(r.qps || 0), Number(r.p50Ms || 0), Number(r.p90Ms || 0), Number(r.p95Ms || 0),
        Number(r.p99Ms || 0), Number(r.errorRate || 0), safe(r.host + ' pid:' + (r.pid || process.pid), ''),
        safe(r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 19).replace('T', ' ') : null)
      );
      saved++;
    }
    db.prepare(`DELETE FROM perf_test_results WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`).run();
    console.log(`[压测] 已持久化 ${saved} 条结果到 MySQL perf_test_results`);
  } catch (e) {
    console.error('[压测] 结果持久化失败:', e.message);
  }

  // SLO 达标检查（生产验收：P99 < 500ms）
  console.log('\n=== S16-T02 SLO 达标检查（生产目标: API P99 < 500ms）===');
  for (const r of results) {
    const ok = r.p99Ms < 500;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} [${r.scenario}] p99=${r.p99Ms}ms ${ok ? '< 500ms ✓' : '≥ 500ms ✗'}`);
  }
  process.exit(0);
}

main();
