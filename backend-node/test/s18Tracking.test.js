'use strict';

/**
 * Sprint 18 - S18-T01 事件埋点系统集成测试
 *
 * 约束：连接本地真实 MySQL（configs/config.yaml），无 mock；
 * 数据真实落库 tracking_events；独立 ID 区间（9000003xx）+ s18t1_ 事件/匿名前缀隔离，
 * after 精确清理，与其它测试文件并行跑不冲突。
 *
 * 覆盖：
 *   [1] track 单条事件落库（event/page/category/attrs 字段完整）
 *   [2] track 事件名为空返回 null 且不入库
 *   [3] batchTrack 批量落库（事务，空事件跳过）
 *   [4] rateLimited 防刷：窗口内超阈值返回 true
 *   [5] stats 聚合：事件总量/独立用户/事件分布/每日趋势
 *   [6] listEvents 分页 + 事件/关键字/用户筛选
 *   [7] analyticsService.eventFunnel 事件转化漏斗（严格逐步交集）
 *   [8] cleanupOld 过期清理只删超期数据
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const tracking = require(path.resolve(__dirname, '..', 'src', 'services', 'trackingService.js'));
const analytics = require(path.resolve(__dirname, '..', 'src', 'services', 'analyticsService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);
const USER_A = 900000301;
const USER_B = 900000302;
const ANON_A = `s18t1_anon_a_${TAG}`;
const ANON_B = `s18t1_anon_b_${TAG}`;

function cleanup() {
  // tracking_events 无外键，无需清理 users；按事件/匿名前缀 + 用户 ID 区间精确清理
  db.prepare(
    `DELETE FROM tracking_events
      WHERE event LIKE 's18t1\\_%' OR anonymous_id LIKE 's18t1\\_%' OR user_id IN (?, ?)`
  ).run(USER_A, USER_B);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', 'S18-T01 集成测试要求 MySQL');
  db = getDb(cfg.database);
  cleanup();
});

test.after(() => {
  cleanup();
  closeDb(db);
});

test('S18-T01 [1] track 单条事件落库', () => {
  const id = tracking.track(db, log, {
    userId: USER_A,
    event: 's18t1_view',
    category: 'navigation',
    page: '/workbench',
    attrs: { drama_id: 1001 },
    ip: '127.0.0.1',
  });
  assert.ok(id, '应返回事件 ID');
  const row = db.prepare('SELECT * FROM tracking_events WHERE id = ?').get(id);
  assert.ok(row, '事件应真实落库');
  assert.equal(row.event, 's18t1_view');
  assert.equal(row.user_id, USER_A);
  assert.equal(row.page, '/workbench');
  assert.equal(row.category, 'navigation');
});

test('S18-T01 [2] 空事件不入库', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM tracking_events WHERE event LIKE ?').get('s18t1\\_%').c;
  const id = tracking.track(db, log, { event: '', anonymousId: ANON_B });
  assert.equal(id, null);
  const after = db.prepare('SELECT COUNT(*) c FROM tracking_events WHERE event LIKE ?').get('s18t1\\_%').c;
  assert.equal(after, before, '空事件不应写入');
});

test('S18-T01 [3] batchTrack 批量落库（事务）', () => {
  const events = [
    { event: 's18t1_click', page: '/home', attrs: { btn: 'a' } },
    { event: 's18t1_click', page: '/home', attrs: { btn: 'b' } },
    { event: 's18t1_click', page: '/home', attrs: { btn: 'c' } },
    { event: '' },
  ];
  const out = tracking.batchTrack(db, log, events, { userId: USER_B });
  assert.equal(out.received, 4);
  assert.equal(out.inserted, 3, '空事件应跳过');
  const rows = db.prepare('SELECT * FROM tracking_events WHERE user_id = ? AND event = ?').all(USER_B, 's18t1_click');
  assert.equal(rows.length, 3);
});

test('S18-T01 [4] rateLimited 防刷限流', () => {
  // 上一用例已为 USER_B + s18t1_click 写入 3 条（60s 窗口内）→ 阈值 max=3 应触发
  assert.equal(tracking.rateLimited(db, { userId: USER_B, event: 's18t1_click', windowMs: 60000, max: 3 }), true);
  assert.equal(tracking.rateLimited(db, { userId: USER_B, event: 's18t1_click', windowMs: 60000, max: 100 }), false);
  // 无 userId/ip 维度时不限流
  assert.equal(tracking.rateLimited(db, { event: 's18t1_click', windowMs: 60000, max: 3 }), false);
});

test('S18-T01 [5] stats 聚合统计', () => {
  const s = tracking.stats(db, { days: 30 });
  assert.ok(s.total_events >= 4, '事件总量应 >= 4');
  assert.ok(s.users >= 2, '独立用户应 >= 2');
  assert.ok(Array.isArray(s.by_event), '事件分布应为数组');
  const click = s.by_event.find((e) => e.event === 's18t1_click');
  assert.ok(click && click.count >= 3, 's18t1_click 计数应 >= 3');
  assert.ok(Array.isArray(s.daily) && s.daily.length >= 1, '每日趋势应非空');
});

test('S18-T01 [6] listEvents 分页与筛选', () => {
  const byEvent = tracking.listEvents(db, { event: 's18t1_view', page: 1, pageSize: 10 });
  assert.ok(byEvent.total >= 1);
  assert.equal(byEvent.items[0].event, 's18t1_view');

  const byKw = tracking.listEvents(db, { keyword: 's18t1_click', pageSize: 5 });
  assert.ok(byKw.total >= 3);

  const byUser = tracking.listEvents(db, { userId: USER_A, pageSize: 20 });
  assert.ok(byUser.items.length > 0);
  assert.ok(byUser.items.every((r) => r.user_id === USER_A), '应只返回指定用户事件');
});

test('S18-T01 [7] eventFunnel 事件转化漏斗（严格逐步交集）', () => {
  // 造漏斗数据：USER_A 触发 f1+f2；USER_B 仅 f1；ANON_A 触发 f1+f2
  tracking.track(db, log, { userId: USER_A, event: 's18t1_f1', ts: Date.now() });
  tracking.track(db, log, { userId: USER_A, event: 's18t1_f2', ts: Date.now() });
  tracking.track(db, log, { userId: USER_B, event: 's18t1_f1', ts: Date.now() });
  tracking.track(db, log, { anonymousId: ANON_A, event: 's18t1_f1', ts: Date.now() });
  tracking.track(db, log, { anonymousId: ANON_A, event: 's18t1_f2', ts: Date.now() });

  const funnel = analytics.eventFunnel(db, {
    days: 30,
    steps: [
      { event: 's18t1_f1', label: '第一步' },
      { event: 's18t1_f2', label: '第二步' },
    ],
  });
  assert.equal(funnel.steps.length, 2);
  assert.equal(funnel.steps[0].users, 3, '第一步：USER_A + USER_B + ANON_A');
  assert.equal(funnel.steps[0].conversion_rate, 100);
  assert.equal(funnel.steps[1].users, 2, '第二步：仅 USER_A + ANON_A（严格交集）');
  assert.equal(funnel.steps[1].conversion_rate, Number(((2 / 3) * 100).toFixed(2)));
  assert.equal(funnel.overall_rate, Number(((2 / 3) * 100).toFixed(2)));
});

test('S18-T01 [8] cleanupOld 过期清理', () => {
  const oldTs = Date.now() - 400 * 24 * 60 * 60 * 1000; // 400 天前
  tracking.track(db, log, { anonymousId: `s18t1_old_${TAG}`, event: 's18t1_old_event', ts: oldTs });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracking_events WHERE event = ?').get('s18t1_old_event').c, 1);
  const res = tracking.cleanupOld(db, log, { days: 180, limit: 1000 });
  assert.ok(res.deleted >= 1, '应删除过期数据');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracking_events WHERE event = ?').get('s18t1_old_event').c, 0);
});
