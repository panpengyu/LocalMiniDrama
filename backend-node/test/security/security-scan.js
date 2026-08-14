#!/usr/bin/env node
'use strict';

/**
 * Sprint 16 - S16-T03 安全渗透扫描（OWASP Top 10 自动化检测）
 *
 * 用法：
 *   node test/security/security-scan.js [--base http://127.0.0.1:5679] [--username admin] [--password admin123]
 *
 * 说明：
 *   - 对运行中的后端服务做黑盒检测（安全头 / SQL注入 / XSS / 路径穿越 / 认证 / 越权 / 限流 / 敏感信息 / CORS）
 *   - 每个检查项结果写入 MySQL security_scan_results 表（scan_id 批次，真实数据）
 *   - 所有请求均为探测请求（不修改业务数据），无 mock
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.SCAN_BASE || process.argv.find((a, i) => a === '--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://127.0.0.1:5679';
const USERNAME = process.env.SCAN_USERNAME || process.argv.find((a, i) => a === '--username') ? process.argv[process.argv.indexOf('--username') + 1] : 'admin';
const PASSWORD = process.env.SCAN_PASSWORD || process.argv.find((a, i) => a === '--password') ? process.argv[process.argv.indexOf('--password') + 1] : 'admin123';

const scanId = `scan-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const results = [];

function req(method, path, { token, body, headers } = {}) {
  return new Promise((resolve) => {
    const u = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...headers
      }
    }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s.slice(0, 2000) }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

function record(category, name, status, severity, detail, fix) {
  results.push({ category, name, status, severity, detail: String(detail).slice(0, 1000), fix });
}

async function login() {
  const r = await req('POST', '/api/v1/auth/login', { body: { username: USERNAME, password: PASSWORD } });
  try { return JSON.parse(r.body).data.token; } catch { return null; }
}

async function run() {
  // 1) 安全响应头（helmet）
  const h = await req('GET', '/health');
  const hdrs = h.headers;
  const headerChecks = [
    ['X-Frame-Options', 'clickjacking'],
    ['X-Content-Type-Options', 'mime-sniffing'],
    ['Referrer-Policy', 'referrer-leak'],
    ['Strict-Transport-Security', 'ssl-strip'],
    ['X-DNS-Prefetch-Control', 'dns-prefetch'],
    ['X-Permitted-Cross-Domain-Policies', 'cross-domain']
  ];
  for (const [name, cat] of headerChecks) {
    const present = hdrs[name.toLowerCase()] !== undefined;
    record('security_headers', name, present ? 'pass' : 'fail', present ? 'info' : 'medium',
      present ? `已存在: ${hdrs[name.toLowerCase()]}` : `响应头缺失`,
      present ? '' : '在 app.js 挂载 helmet（本项目已修复，缺失则升级依赖）');
  }
  if (hdrs['x-powered-by']) {
    record('security_headers', 'X-Powered-By 隐藏', 'fail', 'low', '泄露技术栈版本', 'app.use(helmet({ hidePoweredBy: true })) 或移除');
  } else {
    record('security_headers', 'X-Powered-By 隐藏', 'pass', 'info', '未泄露 X-Powered-By', '');
  }

  // 2) SQL 注入探测（参数化查询验证：注入字符串不应导致 500 或泄露 SQL 错误）
  const sqliPayloads = ["' OR '1'='1", "1; DROP TABLE users--", "' UNION SELECT 1,2,3--"];
  for (const p of sqliPayloads) {
    const r = await req('GET', `/api/v1/dramas?page=1&page_size=20&keyword=${encodeURIComponent(p)}`);
    const leak = /sql|mysql|syntax|ER_|prepare|stack/i.test(r.body) && r.status === 500;
    record('sql_injection', `参数化校验-${p.slice(0, 20)}`, leak ? 'fail' : 'pass',
      leak ? 'high' : 'info', leak ? '疑似 SQL 错误泄露' : `返回 ${r.status}（未泄露）`,
      '保持全部查询参数化（本项目 db.prepare 已参数化）');
  }

  // 3) 反射型 XSS 探测
  const xssPayload = '<script>alert(1)</script>';
  const xr = await req('GET', `/api/v1/dramas?keyword=${encodeURIComponent(xssPayload)}`);
  const xssReflect = /<script>alert\(1\)<\/script>/i.test(xr.body);
  record('xss', '反射型 XSS 探测', xssReflect ? 'fail' : 'pass', xssReflect ? 'high' : 'info',
    xssReflect ? '输入被原样回显' : '未发现反射回显',
    '前端对输出做转义（本项目 Vue 默认转义 + 后端 JSON 序列化）');

  // 4) 路径穿越探测（静态资源目录）
  const travPayload = '/static/../../../../etc/passwd';
  const tr = await req('GET', travPayload);
  const traversed = tr.status === 200 && /root:.*:0:0/.test(tr.body);
  record('path_traversal', '路径穿越探测', traversed ? 'fail' : 'pass', traversed ? 'critical' : 'info',
    traversed ? '读取到系统文件' : `返回 ${tr.status}（已拦截）`,
    '静态资源路径规范化 + 白名单（本项目 download-proxy 已有防护）');

  // 5) 未授权访问管理端点
  const adminProbe = await req('GET', '/api/v1/admin/monitor/ops');
  record('access_control', '管理端点认证拦截', adminProbe.status === 401 || adminProbe.status === 403 ? 'pass' : 'fail',
    adminProbe.status === 401 || adminProbe.status === 403 ? 'info' : 'high',
    `未认证访问 /admin/monitor/ops 返回 ${adminProbe.status}（期望 401/403）`,
    '管理端路由统一 requireAuth + requireRole(super_admin)');

  // 6) 认证暴力破解限流（登录接口 15min/20 次，OWASP 推荐阈值）
  let blocked = false;
  for (let i = 0; i < 25; i++) {
    const r = await req('POST', '/api/v1/auth/login', { body: { username: USERNAME, password: 'wrong-' + i } });
    if (r.status === 429) { blocked = true; break; }
  }
  record('rate_limit', '登录接口限流', blocked ? 'pass' : 'fail', blocked ? 'info' : 'medium',
    blocked ? '连续错误登录触发 429 限流' : '连续错误登录未触发 429（阈值 15min/20 次）',
    '登录接口挂载 express-rate-limit，阈值收紧至 15min/20 次');

  // 7) 敏感信息泄露：错误响应不应含堆栈/内部路径
  const errProbe = await req('GET', '/api/v1/help/docs/not-a-number-xyz');
  const leakStack = /at\s+\w+\s+\(|node_modules|\/Users\/|\/home\//.test(errProbe.body);
  record('sensitive_info', '错误响应信息泄露', leakStack ? 'fail' : 'pass', leakStack ? 'medium' : 'info',
    leakStack ? '错误响应包含内部路径/堆栈' : `返回 ${errProbe.status}（无内部信息）`,
    '生产环境隐藏堆栈，统一 error handler');

  // 8) CORS 空来源拒绝
  const corsProbe = await req('GET', '/health', { headers: { Origin: 'null' } });
  const corsAllow = corsProbe.headers['access-control-allow-origin'];
  record('cors', 'Origin=null 拒绝', corsAllow === 'null' ? 'fail' : 'pass',
    corsAllow === 'null' ? 'medium' : 'info',
    corsAllow ? `允许来源: ${corsAllow}` : '未允许 null Origin（通过 CORS 白名单策略）',
    'CORS 白名单配置（本项目 config.server.cors_origins）');

  // 9) SSRF 防护探测（下载代理禁止访问内网地址）
  const ssrfProbe = await req('GET', '/api/v1/tools/download-proxy?url=http://127.0.0.1:5679/health');
  const ssrfBlocked = ssrfProbe.status === 403 || /禁止访问内网|SSRF|blocked/i.test(ssrfProbe.body);
  record('ssrf', 'SSRF 内网地址拦截', ssrfBlocked ? 'pass' : 'fail',
    ssrfBlocked ? 'info' : 'high',
    ssrfBlocked ? `内网 127.0.0.1 请求被拦截（${ssrfProbe.status}）` : `可请求内网 127.0.0.1（${ssrfProbe.status}，存在 SSRF 风险）`,
    '下载代理增加内网 IP 校验（isPrivateIP + resolveHostnameSafe 防 DNS rebinding，覆盖 127.0.0.1/10.x/172.16-31/192.168/::1/ULA）');

  // 10) 加密配置：密码存储使用 bcrypt/argon2（读取代码静态校验）
  const fs = require('fs');
  const path2 = require('path');
  const authSrc = fs.existsSync(path2.join(__dirname, '..', '..', 'src', 'services', 'authService.js'))
    ? fs.readFileSync(path2.join(__dirname, '..', '..', 'src', 'services', 'authService.js'), 'utf8') : '';
  const usesBcrypt = /bcrypt\.hashSync\(password,\s*10\)/.test(authSrc) || /argon2/.test(authSrc);
  const usesWeakHash = /createHash\('md5'\)|createHash\('sha1'\)/.test(authSrc);
  record('cryptography', '密码哈希强度', usesBcrypt && !usesWeakHash ? 'pass' : 'fail',
    usesBcrypt && !usesWeakHash ? 'info' : 'high',
    usesBcrypt && !usesWeakHash ? '使用 bcrypt cost=10（OWASP 推荐）' : '未使用 bcrypt/argon2 或存在 MD5/SHA1 弱哈希',
    '密码必须使用 bcrypt(cost>=10) 或 argon2 存储');

  // 11) 敏感配置泄露：JWT 密钥不应为默认占位
  const jwtSecret = (authSrc.match(/JWT_SECRET\s*=\s*'([^']+)'/) || [])[1] || '';
  const weakSecret = !jwtSecret || jwtSecret.length < 32 || /default|secret|localmini|2026/i.test(jwtSecret) && jwtSecret.length < 32;
  record('sensitive_info', 'JWT 密钥强度', weakSecret ? 'fail' : 'pass', weakSecret ? 'medium' : 'info',
    weakSecret ? 'JWT 密钥过短或含默认值' : `JWT 密钥长度 ${jwtSecret.length} 字符`,
    'JWT_SECRET 应从环境变量读取且长度 ≥ 32 随机字符');

  // 12) 已知组件漏洞：核心依赖版本风险检查（生产建议及时升级）
  const pkgPath = path2.join(__dirname, '..', '..', 'package.json');
  const deps = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dependencies || {};
  const risky = [];
  // 常见已知风险版本（CVE 简表，仅高风险主版本）
  if (deps['express'] && /^4\.(0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19)\./.test(deps['express'])) risky.push(`express ${deps['express']} 版本过旧`);
  if (deps['lodash'] && /^4\.17\.(1[0-9])/.test(deps['lodash'])) risky.push(`lodash ${deps['lodash']} 存在已知 CVE（<4.17.21 建议升级）`);
  if (deps['axios'] && /^0\.(2[0-9])\./.test(deps['axios'])) risky.push(`axios ${deps['axios']} 版本过旧`);
  if (deps['jsonwebtoken'] && /^8\./.test(deps['jsonwebtoken']) && /^8\.(0|1|2|3|4|5)\./.test(deps['jsonwebtoken'])) risky.push(`jsonwebtoken ${deps['jsonwebtoken']} 存在 CVE-2022-23529 风险`);
  record('vulnerable_components', '已知组件漏洞', risky.length === 0 ? 'pass' : 'fail',
    risky.length ? 'high' : 'info',
    risky.length ? risky.join('；') : '核心依赖未发现已知高危版本',
    '定期执行 npm audit / npm update，修复 CVE');

  // 持久化到 MySQL security_scan_results
  let saved = 0;
  try {
    const path = require('path');
    const { loadConfig } = require(path.join(__dirname, '..', '..', 'src', 'config'));
    const { getDb } = require(path.join(__dirname, '..', '..', 'src', 'db'));
    const db = getDb(loadConfig().database);
    for (const r of results) {
      db.prepare(
        `INSERT INTO security_scan_results (scan_id, category, name, status, severity, detail, fix)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(scanId, r.category, r.name, r.status, r.severity, r.detail, r.fix);
      saved++;
    }
    db.prepare(`DELETE FROM security_scan_results WHERE scan_id <> ? AND checked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`).run(scanId);
  } catch (e) {
    console.error('[安全扫描] 结果持久化失败:', e.message);
  }

  // 报告输出
  console.log(`\n=== S16-T03 OWASP 安全扫描报告 scan_id=${scanId} ===`);
  const fails = results.filter((r) => r.status === 'fail');
  const passes = results.filter((r) => r.status === 'pass');
  console.log(`通过 ${passes.length} 项，发现问题 ${fails.length} 项，已持久化 ${saved} 条到 MySQL security_scan_results\n`);
  for (const r of results) {
    const mark = r.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`  ${mark} [${r.category}] ${r.name} (${r.severity}): ${r.detail}`);
    if (r.status === 'fail' && r.fix) console.log(`       修复建议: ${r.fix}`);
  }
  console.log(`\n总结: ${passes.length} 项通过 / ${fails.length} 项问题（详见 security_scan_results 表）`);
  process.exit(fails.length > 0 ? 1 : 0);
}

run().catch((e) => { console.error('扫描异常:', e); process.exit(2); });
