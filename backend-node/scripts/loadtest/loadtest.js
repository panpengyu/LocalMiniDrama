#!/usr/bin/env node
'use strict';

/**
 * Sprint 16 - S16-T02 通用 HTTP 并发压测器（零外部依赖，Node 原生 http）
 *
 * 用法：
 *   node scripts/loadtest/loadtest.js \
 *     --url http://127.0.0.1:5679/health \
 *     --concurrency 100 --duration 5 \
 *     [--method GET|POST] [--body '{"a":1}'] \
 *     [--token <Bearer Token>] [--headers '{"X-Foo":"bar"}'] \
 *     [--scenario health] [--json]
 *
 * 输出（stdout JSON）：
 *   { scenario, url, method, concurrency, durationMs, totalRequests,
 *     successCount, failCount, qps, avgMs, p50Ms, p90Ms, p95Ms, p99Ms,
 *     errorRate, startedAt }
 */

const http = require('http');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function run(args) {
  const url = new URL(args.url || 'http://127.0.0.1:5679/health');
  const concurrency = Math.max(Number(args.concurrency) || 10, 1);
  const durationMs = Math.max(Number(args.duration) || 5, 1) * 1000;
  const method = String(args.method || 'GET').toUpperCase();
  const body = args.body ? Buffer.from(args.body) : null;
  const token = args.token || null;
  const scenario = String(args.scenario || url.pathname);
  const timeoutMs = Math.max(Number(args.timeout) || 30, 1) * 1000;

  let extraHeaders = {};
  try { extraHeaders = args.headers ? JSON.parse(args.headers) : {}; } catch (e) { /* ignore */ }
  // 压测旁路头（仅非生产环境生效，用于绕过全局限流）
  if (args['x-perf'] === '1' || args['x-perf'] === 'true') {
    extraHeaders['X-Perf-Test'] = '1';
  }

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(body ? { 'Content-Length': body.length } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    }
  };

  let started = false;
  let total = 0;
  let success = 0;
  let fail = 0;
  let failedMsgs = 0;
  const latencies = [];
  let cursor = 0;
  const MAX_LATENCIES = 500000;

  function doRequest() {
    const t0 = Date.now();
    let counted = false;
    function countFail() {
      if (counted) return;
      counted = true;
      const dur = Date.now() - t0;
      if (cursor < MAX_LATENCIES) { latencies.push(dur); cursor++; }
      total++;
      fail++;
      if (++failedMsgs > 20) { /* 抑制过多网络错误输出 */ }
      if (started) loop();
      else finish();
    }
    function countOk(status) {
      if (counted) return;
      counted = true;
      const dur = Date.now() - t0;
      if (cursor < MAX_LATENCIES) { latencies.push(dur); cursor++; }
      total++;
      if (status && status < 500) success++; else fail++;
      if (started) loop();
      else finish();
    }
    const req = http.request(options, (res) => { res.resume(); countOk(res.statusCode); });
    req.on('error', countFail);
    req.setTimeout(timeoutMs, () => { req.destroy(); }); // destroy 触发 error → countFail
    if (body) req.write(body);
    req.end();
  }

  function loop() {
    if (Date.now() - startedAt >= durationMs) { finish(); return; }
    doRequest();
  }

  let startedAt = 0;
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    const durMs = Math.max(Date.now() - startedAt, 1);
    const sorted = latencies.slice().sort((a, b) => a - b);
    const result = {
      scenario,
      url: url.href,
      method,
      concurrency,
      durationMs: durMs,
      totalRequests: total,
      successCount: success,
      failCount: fail,
      qps: Number((total / (durMs / 1000)).toFixed(2)),
      avgMs: Number((sorted.reduce((s, x) => s + x, 0) / Math.max(sorted.length, 1)).toFixed(2)),
      p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
      p90Ms: Number(percentile(sorted, 0.9).toFixed(2)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
      p99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
      errorRate: Number((fail / Math.max(total, 1)).toFixed(4)),
      startedAt: new Date(startedAt).toISOString()
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  startedAt = Date.now();
  started = true;
  for (let i = 0; i < concurrency; i++) doRequest();
}

run(parseArgs(process.argv.slice(2)));
