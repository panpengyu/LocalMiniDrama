'use strict';

/**
 * Sprint 17 - T17-01 充值套餐管理（membership_plans 表）集成测试
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock、无 SQLite in-memory。
 *   - 数据真实落库 membership_plans / membership_orders / user_memberships。
 *   - 测试套餐等级代码使用 s17t1_ 前缀隔离，after 阶段按前缀精确清理，不污染业务数据。
 *
 * 覆盖：
 *   [1] createPlan  正常新增（名称/价格/配额/权益/状态/排序）
 *   [2] createPlan  缺少 level_code → INVALID_ARGS
 *   [3] createPlan  重复 level_code → DUPLICATE_LEVEL
 *   [4] listPlans   管理端全量（含下架）包含新套餐
 *   [5] updatePlan  更新价格/名称/下架，未传字段保持不变
 *   [6] listPlans   用户端（仅上架）不包含下架套餐
 *   [7] deletePlan  无引用 → 物理删除
 *   [8] deletePlan  有订单引用 → 软删除为下架
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const membership = require(path.resolve(__dirname, '..', 'src', 'services', 'membershipService.js'));

let db;
const PREFIX = 's17t1_';
const log = { info() {}, warn() {}, error() {} };

// 生成的测试套餐等级代码（随机后缀避免并行冲突）
const TAG = String(Date.now()).slice(-6);
const CODE_MAIN = `${PREFIX}premium_${TAG}`;
const CODE_DEL = `${PREFIX}temp_${TAG}`;
const ORDER_NO = `S17T1${TAG}`;
let mainPlanId = null;
let delPlanId = null;

function cleanup() {
  // 先删引用，再删套餐（按前缀精确清理，不动业务数据）
  db.prepare('DELETE FROM membership_orders WHERE order_no = ?').run(ORDER_NO);
  db.prepare("DELETE FROM membership_orders WHERE level_code LIKE 's17t1\\_%'").run();
  db.prepare("DELETE FROM user_memberships WHERE level_code LIKE 's17t1\\_%'").run();
  db.prepare("DELETE FROM membership_plans WHERE level_code LIKE 's17t1\\_%'").run();
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();
});

test.after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

test('S17-T01 [1] 新增充值套餐：字段真实落库', () => {
  const plan = membership.createPlan(db, {
    level_code: CODE_MAIN,
    level_rank: 5,
    name: 'S17测试专业版',
    subtitle: 'Sprint17 充值套餐联调',
    price_monthly: 19.9,
    price_yearly: 199,
    price_lifetime: null,
    quota_config: { max_generations: 300, max_video_minutes: 60 },
    benefits: ['高清无水印导出', '角色一致性增强（IP-Adapter）'],
    badge_color: '#7c3aed',
    sort_order: 99,
    enabled: true,
  });
  mainPlanId = plan.id;
  assert.ok(plan.id > 0, '应返回真实主键');
  assert.equal(plan.level_code, CODE_MAIN);
  assert.equal(plan.name, 'S17测试专业版');
  assert.equal(Number(plan.price_monthly), 19.9);
  assert.equal(Number(plan.price_yearly), 199);
  assert.equal(plan.price_lifetime, null);
  assert.equal(plan.enabled, 1);
  // 配额与权益已解析为对象
  assert.equal(plan.quota.max_generations, 300);
  assert.equal(plan.benefits.length, 2);

  // 直接查库复核（不依赖 service 返回值）
  const row = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(plan.id);
  assert.equal(row.level_code, CODE_MAIN);
  assert.equal(row.sort_order, 99);
  const quota = JSON.parse(row.quota_config);
  assert.equal(quota.max_video_minutes, 60);
});

test('S17-T01 [2] 缺少 level_code → INVALID_ARGS', () => {
  assert.throws(
    () => membership.createPlan(db, { name: '无等级套餐' }),
    (err) => err.code === 'INVALID_ARGS'
  );
});

test('S17-T01 [3] 重复 level_code → DUPLICATE_LEVEL', () => {
  assert.throws(
    () => membership.createPlan(db, { level_code: CODE_MAIN, name: '重复等级' }),
    (err) => err.code === 'DUPLICATE_LEVEL'
  );
});

test('S17-T01 [4] 管理端列表包含新套餐（含下架）', () => {
  const items = membership.listPlans(db, true);
  assert.ok(items.some(p => p.id === mainPlanId && p.level_code === CODE_MAIN), '管理端列表应包含新建套餐');
});

test('S17-T01 [5] 更新套餐：动态字段 + 下架', () => {
  const updated = membership.updatePlan(db, mainPlanId, {
    name: 'S17测试专业版-改名',
    price_monthly: 29.9,
    benefits: ['高清无水印导出'],
    enabled: false,
  });
  assert.equal(updated.name, 'S17测试专业版-改名');
  assert.equal(Number(updated.price_monthly), 29.9);
  assert.equal(updated.enabled, 0);
  // 未传字段保持不变
  assert.equal(Number(updated.price_yearly), 199);
  assert.equal(updated.level_code, CODE_MAIN);
  assert.equal(updated.benefits.length, 1);
});

test('S17-T01 [6] 用户端列表（仅上架）不包含下架套餐', () => {
  const items = membership.listPlans(db, false);
  assert.ok(!items.some(p => p.id === mainPlanId), '下架套餐不应出现在用户端列表');
  // 恢复上架供后续使用
  membership.updatePlan(db, mainPlanId, { enabled: true });
  const items2 = membership.listPlans(db, false);
  assert.ok(items2.some(p => p.id === mainPlanId), '恢复上架后应重新可见');
});

test('S17-T01 [7] 删除无引用套餐 → 物理删除', () => {
  const created = membership.createPlan(db, {
    level_code: CODE_DEL, level_rank: 6, name: '临时套餐', quota_config: {}, benefits: [],
  });
  delPlanId = created.id;
  const r = membership.deletePlan(db, delPlanId);
  assert.equal(r.deleted, true);
  assert.equal(membership.getPlanById(db, delPlanId), null, '物理删除后查不到');
});

test('S17-T01 [8] 删除被订单引用套餐 → 软删除为下架', () => {
  // 构造一个引用了 mainPlanId 的订单（真实落库，模拟用户已购买）
  db.prepare(`INSERT INTO membership_orders
    (order_no, user_id, plan_id, level_code, billing_cycle, order_type, amount, pay_status)
    VALUES (?, ?, ?, ?, 'monthly', 'new', 29.90, 'paid')`)
    .run(ORDER_NO, 900000001, mainPlanId, CODE_MAIN);
  const r = membership.deletePlan(db, mainPlanId);
  assert.equal(r.disabled, true, '有引用时应软删除而非物理删除');
  const plan = membership.getPlanById(db, mainPlanId);
  assert.ok(plan, '软删除后套餐仍在');
  assert.equal(plan.enabled, 0, '软删除后 enabled=0（下架）');
});
