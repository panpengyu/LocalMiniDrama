'use strict';

/**
 * Sprint 19 - S19-T01/T02 模型 A/B 测试 + 用量配额 集成测试
 *
 * 约束：真实 MySQL（configs/config.yaml），无 mock；数据落 model_ab_test / model_usage_quota /
 * ai_model_call_logs.ab_group / ai_service_configs；独立 ID 区间（9000007xx）+ s19m_ 前缀隔离。
 *
 * 覆盖：
 *   [1] abTestService CRUD（创建/列表/更新激活互斥/删除）
 *   [2] routeTask 流量比例路由（A/B 组稳定性哈希 + 比例切换）
 *   [3] modelRoutingService.recordCallLog 写 ab_group
 *   [4] compareReport 对比报告（成功率/延迟/成本/质量分）
 *   [5] setDefault 一键设默认（A/B 组配置提升为 is_default）
 *   [6] modelQuotaService CRUD + periodKey（daily/weekly/monthly）
 *   [7] checkQuota / consume 原子防超发（达到上限后拒绝 + 剩余量正确）
 *   [8] usageSummary 用量汇总
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const abTest = require(path.resolve(__dirname, '..', 'src', 'services', 'abTestService.js'));
const quota = require(path.resolve(__dirname, '..', 'src', 'services', 'modelQuotaService.js'));
const routing = require(path.resolve(__dirname, '..', 'src', 'services', 'modelRoutingService.js'));
const aiConfig = require(path.resolve(__dirname, '..', 'src', 'services', 'aiConfigService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);
const SVC = `s19m_text_${TAG}`; // 独立 service_type，避免与既有配置冲突
const ADMIN_ID = 900000701;
const USER_A = 900000702;
const USER_B = 900000703;

// 配置使用独立高位 ID 区间（999100~999199），避免自增 ID 落入其它测试
// 的清理区间（991xxx/996xxx）导致并行执行时被误删
const CFG_ID_A = 999100;
const CFG_ID_B = 999101;

let cfgAId = null;
let cfgBId = null;
let abTestId = null;
let quotaId = null;

function insertConfig(id, serviceType, name, model, extra = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_service_configs
       (id, service_type, provider, api_protocol, name, base_url, api_key, model, default_model,
        endpoint, query_endpoint, priority, is_default, is_active, settings, icon_char, description,
        tags, is_builtin, user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'https', ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 1, NULL, '', ?, NULL, 0, NULL, ?, ?)`
  ).run(
    id, serviceType, extra.provider || 's19m_openai', name,
    extra.base_url || 'https://s19m.example.com/v1', extra.apiKey || 'sk-test',
    JSON.stringify([model]), extra.endpoint || '/chat/completions',
    extra.priority ?? 0, extra.isDefault ? 1 : 0, extra.description || '',
    now, now
  );
}

function cleanup() {
  db.prepare('DELETE FROM model_ab_test WHERE task_type = ?').run(`s19m_task_${TAG}`);
  db.prepare('DELETE FROM model_usage_quota WHERE scope_value IN (?, ?) OR scope_value = ?')
    .run(String(USER_A), String(USER_B), `s19m_model_${TAG}`);
  db.prepare('DELETE FROM ai_model_call_logs WHERE task_type = ?').run(`s19m_task_${TAG}`);
  db.prepare('DELETE FROM ai_service_configs WHERE id >= 999100 AND id <= 999199').run();
  db.prepare('DELETE FROM ai_service_configs WHERE service_type = ?').run(SVC);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', 'S19 集成测试要求 MySQL');
  db = getDb(cfg.database);
  cleanup();
});

test.after(() => {
  cleanup();
  closeDb(db);
});

test('S19-T01 [1] 创建 A/B 测试（两个真实模型配置）', () => {
  // 两个真实 AI 配置（独立 service_type + 显式高位 ID，避免并行清理误删）
  insertConfig(CFG_ID_A, SVC, `s19m_cfg_a_${TAG}`, 's19m-model-a');
  insertConfig(CFG_ID_B, SVC, `s19m_cfg_b_${TAG}`, 's19m-model-b');
  cfgAId = CFG_ID_A;
  cfgBId = CFG_ID_B;
  assert.equal(aiConfig.getConfig(db, cfgAId).model[0], 's19m-model-a', '配置 A 应可读取');
  assert.equal(aiConfig.getConfig(db, cfgBId).model[0], 's19m-model-b', '配置 B 应可读取');

  const created = abTest.createTest(db, log, {
    name: `s19m_ab_${TAG}`,
    taskType: `s19m_task_${TAG}`,
    serviceType: 'text',
    groupA: { configId: cfgAId, model: 's19m-model-a' },
    groupB: { configId: cfgBId, model: 's19m-model-b' },
    trafficRatioB: 50,
    description: 'S19 测试 A/B',
  });
  abTestId = created.id;
  assert.ok(abTestId, '应返回 A/B 测试 ID');
  assert.equal(created.trafficRatioB, 50);
  assert.equal(created.isActive, false, '新建默认未激活');

  const list = abTest.listTests(db, { taskType: `s19m_task_${TAG}` });
  assert.equal(list.length, 1);
  assert.equal(list[0].groupA.configId, cfgAId);
});

test('S19-T01 [2] 激活互斥 + 更新流量比例', () => {
  const updated = abTest.updateTest(db, log, abTestId, { isActive: true });
  assert.equal(updated.isActive, true, '激活生效');

  // 同 task_type 再建一个并激活 → 旧测试自动停用
  const second = abTest.createTest(db, log, {
    name: `s19m_ab2_${TAG}`,
    taskType: `s19m_task_${TAG}`,
    serviceType: 'text',
    groupA: { configId: cfgAId, model: 's19m-model-a' },
    groupB: { configId: cfgBId, model: 's19m-model-b' },
    trafficRatioB: 30,
  });
  abTest.updateTest(db, log, second.id, { isActive: true });
  const after = abTest.getTest(db, abTestId);
  assert.equal(after.isActive, false, '同任务类型只允许一个激活，旧测试应自动停用');
  const secondAfter = abTest.getTest(db, second.id);
  assert.equal(secondAfter.isActive, true);
  abTest.deleteTest(db, log, second.id);

  abTest.updateTest(db, log, abTestId, { isActive: true, trafficRatioB: 100 });
  const final = abTest.getTest(db, abTestId);
  assert.equal(final.isActive, true);
  assert.equal(final.trafficRatioB, 100);
});

test('S19-T01 [3] routeTask 流量比例路由（稳定哈希 + 比例边界）', () => {
  // ratioB=100 → 全部进入 B 组
  let hitB = 0;
  let hitA = 0;
  for (let i = 0; i < 200; i += 1) {
    const out = abTest.routeTask(db, { taskType: `s19m_task_${TAG}`, userId: 900000100 + i });
    assert.ok(out, '激活测试应命中');
    if (out.group === 'B') hitB += 1;
    else hitA += 1;
  }
  assert.equal(hitA, 0, 'ratioB=100 时不应命中 A 组');
  assert.equal(hitB, 200, 'ratioB=100 时全部命中 B 组');
  assert.equal(abTest.getTest(db, abTestId).trafficRatioB, 100);

  // ratioB=0 → 全部进入 A 组
  abTest.updateTest(db, log, abTestId, { trafficRatioB: 0 });
  let hitA2 = 0;
  let hitB2 = 0;
  for (let i = 0; i < 200; i += 1) {
    const out = abTest.routeTask(db, { taskType: `s19m_task_${TAG}`, userId: 900000200 + i });
    if (out.group === 'A') hitA2 += 1;
    else hitB2 += 1;
  }
  assert.equal(hitB2, 0, 'ratioB=0 时不应命中 B 组');
  assert.equal(hitA2, 200, 'ratioB=0 时全部命中 A 组');

  // 稳定性：同一用户同一任务多次路由结果一致
  const r1 = abTest.routeTask(db, { taskType: `s19m_task_${TAG}`, userId: 900000300 });
  const r2 = abTest.routeTask(db, { taskType: `s19m_task_${TAG}`, userId: 900000300 });
  assert.equal(r1.group, r2.group, '同用户同任务应稳定落入同一组');
  assert.equal(r1.config.id, cfgAId, 'A 组配置应指向配置 A');
});

test('S19-T01 [4] recordCallLog 写 ab_group + 对比报告', () => {
  // 写 20 条 A 组成功日志 + 10 条 B 组成功日志（含延迟/成本/质量分）
  for (let i = 0; i < 20; i += 1) {
    routing.recordCallLog(db, {
      userId: USER_A, configId: cfgAId, serviceType: 'text', provider: 's19m_openai',
      model: 's19m-model-a', taskType: `s19m_task_${TAG}`, status: 'success',
      latencyMs: 1200, cost: 0.02, qualityScore: 8, abGroup: 'A',
    });
  }
  for (let i = 0; i < 10; i += 1) {
    routing.recordCallLog(db, {
      userId: USER_B, configId: cfgBId, serviceType: 'text', provider: 's19m_openai',
      model: 's19m-model-b', taskType: `s19m_task_${TAG}`, status: 'success',
      latencyMs: 600, cost: 0.01, qualityScore: 9, abGroup: 'B',
    });
  }
  // 2 条失败日志（B 组）
  for (let i = 0; i < 2; i += 1) {
    routing.recordCallLog(db, {
      userId: USER_B, configId: cfgBId, serviceType: 'text', provider: 's19m_openai',
      model: 's19m-model-b', taskType: `s19m_task_${TAG}`, status: 'failed',
      latencyMs: 300, cost: 0.01, errorMessage: 's19m timeout', abGroup: 'B',
    });
  }

  const report = abTest.compareReport(db, abTestId, { days: 30 });
  assert.equal(report.groups.length, 2);
  const ga = report.groups.find((g) => g.group === 'A');
  const gb = report.groups.find((g) => g.group === 'B');
  assert.equal(ga.totalCalls, 20);
  assert.equal(ga.successRate, 100);
  assert.equal(gb.totalCalls, 12);
  assert.equal(gb.successRate, Math.round((10 / 12) * 10000) / 100);
  assert.ok(gb.avgLatency < ga.avgLatency, 'B 组延迟更低');
  assert.ok(gb.avgQuality > ga.avgQuality, 'B 组质量分更高');
  assert.ok(['A', 'B', 'tie'].includes(report.winner), '应给出对比结论');
});

test('S19-T01 [5] setDefault 一键设默认', () => {
  // 将 A 组配置设为默认
  const out = abTest.setDefault(db, log, abTestId, 'A');
  assert.equal(out.ok, true);
  assert.equal(out.group, 'A');
  assert.equal(out.configId, cfgAId);
  const cfg = aiConfig.getConfig(db, cfgAId);
  assert.equal(cfg.is_default, true, 'A 组配置应成为默认');
  const cfgB = aiConfig.getConfig(db, cfgBId);
  assert.equal(cfgB.is_default, false, 'B 组配置应取消默认');
});

test('S19-T02 [6] 配额 CRUD + periodKey', () => {
  const daily = quota.periodKey('daily', new Date('2026-08-16T10:00:00'));
  assert.equal(daily, '2026-08-16');
  const monthly = quota.periodKey('monthly', new Date('2026-08-16T10:00:00'));
  assert.equal(monthly, '2026-08');
  const weekly = quota.periodKey('weekly', new Date('2026-08-16T10:00:00')); // 周日
  assert.equal(weekly, '2026-W33', 'ISO 周编号应为 33');

  const created = quota.createQuota(db, log, {
    scopeType: 'account',
    scopeValue: String(USER_A),
    periodType: 'daily',
    quotaValue: 5,
    remark: `s19m_quota_${TAG}`,
  });
  quotaId = created.id;
  assert.ok(quotaId, '应返回配额 ID');
  assert.equal(created.quotaValue, 5);
  assert.equal(created.usedValue, 0);
  assert.equal(created.periodKey, quota.periodKey('daily'));

  const list = quota.listQuotas(db, { scopeType: 'account' });
  assert.ok(list.some((q) => q.id === quotaId));

  // 同 (scope, period) 重复创建 → 更新 quota_value 而非新建
  const dup = quota.createQuota(db, log, {
    scopeType: 'account',
    scopeValue: String(USER_A),
    periodType: 'daily',
    quotaValue: 10,
  });
  assert.equal(dup.id, quotaId, '重复创建应复用同一规则');
  assert.equal(dup.quotaValue, 10);
});

test('S19-T02 [7] checkQuota / consume 原子防超发', () => {
  // 上限 10 次：连续消耗 10 次成功，第 11 次拒绝
  let i;
  for (i = 0; i < 10; i += 1) {
    const out = quota.consume(db, { userId: USER_A, model: 's19m-model-a', periodType: 'daily' });
    assert.equal(out.ok, true, `第 ${i + 1} 次消耗应成功`);
  }
  const blocked = quota.consume(db, { userId: USER_A, model: 's19m-model-a', periodType: 'daily' });
  assert.equal(blocked.ok, false, '超过上限应被拒绝');
  assert.equal(blocked.used, 10);

  // checkQuota 预检：恰好用完 → not allowed
  const check = quota.checkQuota(db, { userId: USER_A, model: 's19m-model-a', periodType: 'daily' });
  assert.equal(check.allowed, false);
  assert.equal(check.remaining, 0);

  // 其它用户不受影响
  const other = quota.checkQuota(db, { userId: USER_B, model: 's19m-model-b', periodType: 'daily' });
  assert.equal(other.allowed, true, '未配置规则用户不受限');
});

test('S19-T02 [8] usageSummary 用量汇总', () => {
  const summary = quota.usageSummary(db, { scopeType: 'account', periodType: 'daily' });
  const mine = summary.find((s) => s.scopeValue === String(USER_A));
  assert.ok(mine, '汇总应含目标账户');
  assert.ok(mine.used >= 10, '用量应已累计');
  assert.ok(mine.quota >= 10, '配额应已更新为 10');

  // 清理后 usageSummary 不再包含
  db.prepare('DELETE FROM model_usage_quota WHERE id = ?').run(quotaId);
  const after = quota.usageSummary(db, { scopeType: 'account', periodType: 'daily' });
  assert.ok(!after.some((s) => s.scopeValue === String(USER_A)), '清理后不应再出现');
});
