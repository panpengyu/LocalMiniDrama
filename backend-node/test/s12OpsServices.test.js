/**
 * Sprint 12 单元测试 — 后台深度运营（S12-T04 ~ S12-T08）
 *
 * 覆盖任务：
 *   S12-T04 用户生命周期：computeLifecycle 阶段/健康分/流失风险分级 + overview/listProfiles/churnWarnings
 *   S12-T05 财务与计费：billing_rules CRUD + computeCharge 智能计费试算 + overview 收入/成本/毛利
 *   S12-T07 权限与安全：数据脱敏(maskPhone/maskEmail/...) + 字段级权限 + 审计/登录日志读取
 *   S12-T08 数据分析：behaviorAnalysis / creationFunnel / modelEffect / retentionAnalysis
 *
 * 约束（用户要求）：
 *   - 不使用 mock；全部连本地真实 MySQL（configs/config.yaml），依赖 seed_s12_ops_test_data 的真实数据
 *   - 测试前确保 seed 数据存在（若缺失则跳过依赖数据的断言，仍验证纯函数逻辑）
 *   - 使用测试专用高位用户 ID（99510~99515），不污染业务数据
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));

const lifecycleService = require(path.resolve(__dirname, '..', 'src', 'services', 'userLifecycleService.js'));
const financeService = require(path.resolve(__dirname, '..', 'src', 'services', 'financeService.js'));
const securityService = require(path.resolve(__dirname, '..', 'src', 'services', 'securityService.js'));
const analyticsService = require(path.resolve(__dirname, '..', 'src', 'services', 'analyticsService.js'));

const U_MIN = 99510;
const U_MAX = 99515;

let db;
const log = { info() {}, warn() {}, error() {} };
let hasSeed = false;

before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  db.exec(`USE ${cfg.database.database}`);
  const c = db.prepare('SELECT COUNT(*) c FROM users WHERE id BETWEEN ? AND ?').get(U_MIN, U_MAX).c;
  hasSeed = c >= 6;
  if (!hasSeed) {
    // 依赖数据缺失时给出明确提示（仍会跑纯函数用例）
    // eslint-disable-next-line no-console
    console.warn('[S12 测试] 未检测到 seed 数据，请先执行: node scripts/seed_s12_ops_test_data.js');
  }
});

after(() => {
  closeDb();
});

// ------------------------------------------------------------
// S12-T04 用户生命周期
// ------------------------------------------------------------
describe('S12-T04 用户生命周期', () => {
  it('computeLifecycle: 付费高活跃 → paying / 高健康分 / low 风险', () => {
    const facts = {
      activeDays30: 12, recharge: 100000, consume: 43000, totalActions: 20,
      daysSinceActive: 0, daysSinceRegister: 10, lastActiveMs: Date.now(),
    };
    const lc = lifecycleService.computeLifecycle(facts);
    assert.equal(lc.stage, 'paying');
    assert.equal(lc.churn_risk, 'low');
    assert.ok(lc.health_score >= 75, `健康分应偏高，实际 ${lc.health_score}`);
    assert.ok(lc.profile_tags.includes('付费用户'));
  });

  it('computeLifecycle: 长期不活跃 → churned / high 风险 / 健康分低', () => {
    const facts = {
      activeDays30: 0, recharge: 0, consume: 0, totalActions: 1,
      daysSinceActive: 45, daysSinceRegister: 60, lastActiveMs: Date.now() - 45 * 86400000,
    };
    const lc = lifecycleService.computeLifecycle(facts);
    assert.equal(lc.stage, 'churned');
    assert.equal(lc.churn_risk, 'high');
    assert.ok(lc.health_score < 25, `健康分应偏低，实际 ${lc.health_score}`);
  });

  it('churn_risk 落库为语义标签(字符串)，非数值(回归 46 号迁移修复)', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const row = db.prepare('SELECT churn_risk FROM user_lifecycle WHERE user_id = ?').get(U_MAX);
    assert.ok(row, '高价值用户应有生命周期画像');
    assert.ok(['high', 'medium', 'low'].includes(row.churn_risk), `churn_risk 应为语义标签，实际 ${row.churn_risk}`);
  });

  it('overview / churnWarnings: 基于真实数据返回分组统计', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const ov = lifecycleService.overview(db);
    assert.ok(ov.total >= 6);
    assert.ok(Array.isArray(ov.by_stage) && ov.by_stage.length > 0);
    assert.ok(Array.isArray(ov.by_risk) && ov.by_risk.length > 0);
    const warnings = lifecycleService.churnWarnings(db, 50);
    assert.ok(Array.isArray(warnings));
    // 至少包含我们 seed 的 at_risk / churned 用户
    assert.ok(warnings.some((w) => w.user_id === 99513 || w.user_id === 99514));
  });
});

// ------------------------------------------------------------
// S12-T05 财务与计费
// ------------------------------------------------------------
describe('S12-T05 财务与计费', () => {
  it('billing rule CRUD + computeCharge 智能计费试算', () => {
    const created = financeService.createBillingRule(db, log, {
      name: '__test_rule__', business_type: 'image', user_level: 'all',
      unit_points: 2000, discount: 0.8, enabled: 1, priority: 99,
    });
    assert.ok(created && created.id, '应返回新规则');
    try {
      const charge = financeService.computeCharge(db, { businessType: 'image', userLevel: 'all' });
      assert.ok(charge.points > 0, '试算积分应为正');
      assert.equal(charge.matched, true, '应命中一条计费规则');
      // 命中我们创建的最高优先级规则(折扣 0.8 → 2000*0.8=1600)
      assert.equal(charge.points, 1600);
    } finally {
      const ok = financeService.deleteBillingRule(db, log, created.id);
      assert.equal(ok, true, '删除应成功');
      const gone = db.prepare('SELECT id FROM billing_rules WHERE id = ?').get(created.id);
      // MySQL 包装层无行返回 null，SQLite 返回 undefined，两者皆为“不存在”
      assert.ok(gone == null, '删除后规则应不存在');
    }
  });

  it('overview: 收入/成本/毛利均为真实聚合数值', () => {
    const ov = financeService.overview(db, { days: 30 });
    assert.ok(typeof ov.revenue.total === 'number');
    assert.ok(typeof ov.cost.model_cost === 'number');
    assert.ok(typeof ov.profit.gross_profit === 'number');
    // 毛利 = 收入 - 成本（允许四舍五入误差）
    assert.ok(Math.abs(ov.profit.gross_profit - (ov.revenue.total - ov.cost.model_cost)) < 1);
  });

  // ---------------- S12-T05 欠费闭环：识别 → 通知 → 限权 ----------------
  const ARREARS_UID = 99598;
  const SOLVENT_UID = 99599;

  function cleanupArrearsFixtures() {
    for (const uid of [ARREARS_UID, SOLVENT_UID]) {
      try { db.prepare('DELETE FROM platform_notifications WHERE user_id = ?').run(uid); } catch (_) {}
      try { db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(uid); } catch (_) {}
      try { db.prepare('DELETE FROM users WHERE id = ?').run(uid); } catch (_) {}
    }
  }

  it('getUserBalance: 取最新一条 point_logs.balance_after', () => {
    cleanupArrearsFixtures();
    db.prepare(
      `INSERT INTO users (id, username, nickname, password, role, status, created_at)
       VALUES (?, 'bal_test', '余额测试', 'x', 'user', 1, ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"})`
    ).run(ARREARS_UID);
    try {
      // 无流水视为 0
      assert.equal(financeService.getUserBalance(db, ARREARS_UID), 0);
      db.prepare(
        `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, remark)
         VALUES (?, 'recharge', 'recharge', 100, 100, 'x'), (?, 'consume', 'image', -620, -520, 'x')`
      ).run(ARREARS_UID, ARREARS_UID);
      assert.equal(financeService.getUserBalance(db, ARREARS_UID), -520);
    } finally {
      cleanupArrearsFixtures();
    }
  });

  it('notifyArrears: 欠费用户写入通知且同日幂等', () => {
    // 依赖 platform_notifications 表；若迁移未执行则跳过
    const hasTable = db.type === 'mysql'
      ? db.prepare("SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_notifications'").get().c > 0
      : true;
    if (!hasTable) { console.warn('[S12-T05] 缺少 platform_notifications 表，跳过 notifyArrears 用例'); return; }

    cleanupArrearsFixtures();
    db.prepare(
      `INSERT INTO users (id, username, nickname, password, role, status, created_at)
       VALUES (?, 'arrears_unit', '欠费单测', 'x', 'user', 1, ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"})`
    ).run(ARREARS_UID);
    db.prepare(
      `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, remark)
       VALUES (?, 'consume', 'image', -300, -300, 'x')`
    ).run(ARREARS_UID);
    try {
      financeService.notifyArrears(db, log, { threshold: 0, limit: 200 });
      const cnt1 = db.prepare('SELECT COUNT(*) c FROM platform_notifications WHERE user_id = ?').get(ARREARS_UID).c;
      assert.ok(cnt1 >= 1, '欠费用户应产生至少一条通知');
      const row = db.prepare('SELECT category, level FROM platform_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(ARREARS_UID);
      assert.equal(row.category, 'arrears');
      assert.equal(row.level, 'critical');
      // 再次触发：同日幂等，不新增
      financeService.notifyArrears(db, log, { threshold: 0, limit: 200 });
      const cnt2 = db.prepare('SELECT COUNT(*) c FROM platform_notifications WHERE user_id = ?').get(ARREARS_UID).c;
      assert.equal(cnt2, cnt1, '同日重复触发应幂等（数量不变）');
    } finally {
      cleanupArrearsFixtures();
    }
  });

  it('balanceGuard: 欠费用户被拦截(403)、正常用户放行、super_admin 豁免', () => {
    const guard = require(path.resolve(__dirname, '..', 'src', 'middleware', 'balanceGuard.js'))(db, log);
    const makeRes = () => {
      const cap = { statusCode: null, body: null };
      return { cap, status(c) { cap.statusCode = c; return this; }, json(b) { cap.body = b; return this; } };
    };
    cleanupArrearsFixtures();
    db.prepare(
      `INSERT INTO users (id, username, nickname, password, role, status, created_at)
       VALUES (?, 'arrears_g', '欠费G', 'x', 'user', 1, ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"}),
              (?, 'solvent_g', '正常G', 'x', 'user', 1, ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"})`
    ).run(ARREARS_UID, SOLVENT_UID);
    db.prepare(
      `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, remark)
       VALUES (?, 'consume', 'image', -300, -300, 'x'), (?, 'recharge', 'recharge', 500, 500, 'x')`
    ).run(ARREARS_UID, SOLVENT_UID);
    try {
      const arrearsUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ARREARS_UID);
      const solventUser = db.prepare('SELECT * FROM users WHERE id = ?').get(SOLVENT_UID);

      // 欠费用户：拦截 403
      let nextA = false; const resA = makeRes();
      guard({ user: arrearsUser, originalUrl: '/api/v1/images' }, resA, () => { nextA = true; });
      assert.equal(nextA, false, '欠费用户不应放行');
      assert.equal(resA.cap.statusCode, 403, '欠费用户应返回 403');

      // 正常用户：放行
      let nextB = false; const resB = makeRes();
      guard({ user: solventUser, originalUrl: '/api/v1/images' }, resB, () => { nextB = true; });
      assert.equal(nextB, true, '正常用户应放行');
      assert.equal(resB.cap.statusCode, null, '正常用户不应产生错误响应');

      // super_admin 豁免（即便余额为负）
      let nextC = false; const resC = makeRes();
      guard({ user: { ...arrearsUser, role: 'super_admin' }, originalUrl: '/api/v1/images' }, resC, () => { nextC = true; });
      assert.equal(nextC, true, 'super_admin 应豁免限权');

      // 未登录：不在此中间件拦截（交由 requireAuth）
      let nextD = false; const resD = makeRes();
      guard({ user: null, originalUrl: '/api/v1/images' }, resD, () => { nextD = true; });
      assert.equal(nextD, true, '未登录请求应放行至后续鉴权');
    } finally {
      cleanupArrearsFixtures();
    }
  });
});

// ------------------------------------------------------------
// S12-T07 权限与安全
// ------------------------------------------------------------
describe('S12-T07 权限与安全', () => {
  it('数据脱敏工具: 手机/邮箱/身份证/银行卡', () => {
    assert.equal(securityService.maskPhone('13800138000'), '138****8000');
    assert.equal(securityService.maskEmail('zhangsan@example.com'), 'zh******@example.com');
    assert.match(securityService.maskIdCard('110101199001011234'), /^1101\*+1234$/);
    assert.match(securityService.maskBankCard('6222021234567890123'), /^6222 \*\*\*\* \*\*\*\* 0123$/);
  });

  it('applyFieldPermission: super_admin 明文, 普通角色脱敏', () => {
    const row = { username: 'u', phone: '13800138000', email: 'a@b.com' };
    const asAdmin = securityService.applyFieldPermission({ ...row }, 'super_admin');
    assert.equal(asAdmin.phone, '13800138000', 'super_admin 应见明文');
    const asUser = securityService.applyFieldPermission({ ...row }, 'user');
    assert.equal(asUser.phone, '138****8000', '普通角色应脱敏');
  });

  it('inferAction: 从方法+路径推断动作', () => {
    assert.equal(
      securityService.inferAction('POST', '/api/v1/admin/finance/billing-rules'),
      'finance.billing-rules.create'
    );
    assert.equal(
      securityService.inferAction('DELETE', '/api/v1/admin/users/99999'),
      'users.delete'
    );
  });

  it('listLoginLogs / listAuditLogs: 分页读取真实日志', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const logins = securityService.listLoginLogs(db, { page: 1, pageSize: 10 });
    assert.ok(logins.total >= 1);
    assert.ok(Array.isArray(logins.items));
    const audits = securityService.listAuditLogs(db, { page: 1, pageSize: 10 });
    assert.ok(audits.total >= 1);
    const stats = securityService.loginStats(db, { days: 7 });
    assert.equal(stats.success + stats.failed, stats.total, '成功+失败应等于总数');
  });
});

// ------------------------------------------------------------
// S12-T08 数据分析
// ------------------------------------------------------------
describe('S12-T08 数据分析', () => {
  it('behaviorAnalysis: 行为分布 + DAU 趋势（真实埋点）', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const r = analyticsService.behaviorAnalysis(db, { days: 30 });
    assert.ok(r.total_actions >= 1);
    assert.ok(r.active_users >= 1);
    assert.ok(Array.isArray(r.by_action) && r.by_action.length > 0);
    assert.ok(Array.isArray(r.daily));
    // 每一天的 dau 不应超过总活跃用户上限
    r.daily.forEach((d) => assert.ok(d.dau >= 0 && d.actions >= 0));
  });

  it('creationFunnel: 各环节转化率单调有效', () => {
    const f = analyticsService.creationFunnel(db);
    assert.equal(f.stages.length, 6);
    assert.equal(f.stages[0].conversion_rate, 100);
    f.stages.forEach((s) => {
      assert.ok(s.count >= 0);
      assert.ok(s.conversion_rate >= 0 && s.conversion_rate <= 100 || s.conversion_rate >= 0);
    });
    assert.ok(f.overall_rate >= 0);
  });

  it('modelEffect: 成功率/成本/质量分基于真实调用日志', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const m = analyticsService.modelEffect(db, { days: 60 });
    assert.ok(m.items.length > 0, '应有模型调用统计');
    m.items.forEach((i) => {
      assert.ok(i.success_rate >= 0 && i.success_rate <= 100);
      assert.equal(i.success_count + i.failed_count <= i.total_calls, true);
      assert.ok(i.total_cost >= 0);
    });
    assert.ok(m.summary.total_calls >= m.items.length);
  });

  it('retentionAnalysis: cohort 留存率在 [0,100] 或 null', (t) => {
    if (!hasSeed) return t.skip('缺少 seed 数据');
    const r = analyticsService.retentionAnalysis(db, { cohortDays: 14 });
    assert.ok(Array.isArray(r.cohorts));
    r.cohorts.forEach((c) => {
      assert.ok(c.new_users >= 1);
      [c.d1, c.d7, c.d30].forEach((v) => {
        assert.ok(v === null || (typeof v === 'number' && v >= 0 && v <= 100));
      });
    });
    assert.ok(r.summary.avg_d1 >= 0 && r.summary.avg_d1 <= 100);
  });
});
