'use strict';

/**
 * s9LiteAndMergeQueue.test.js
 * Sprint 9 - 新增两项修复的单元测试：
 *   A. listDramasLite（N+1 修复后边界用例）—— 真实 MySQL（localminidrama），高位测试 ID 隔离
 *   B. MergeAsyncQueue 并发控制 & 队列满 & 异常隔离
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

/* =======================================================
 * A. listDramasLite 测试：真实 MySQL 建数据，造场景后跑函数
 *    覆盖：空结果 / 分页 / keyword筛选 / status+genre筛选 / 权限过滤 /
 *          episodes_count预聚合正确性 / users LEFT JOIN creator对象
 *    使用高位测试 ID（drama 99701-99705 / user 99801-99803）+ 统一 [S9A] 前缀
 *    隔离业务数据；所有 total 断言均带 keyword 过滤避免受业务数据影响
 * ======================================================= */
const T_DRAMA_IDS = [99701, 99702, 99703, 99704, 99705];
const T_USER_IDS = [99801, 99802, 99803];

function makeDb() {
  const db = getDb(loadConfig().database);
  // 清理本测试可能残留的数据
  const dIn = T_DRAMA_IDS.map(() => '?').join(',');
  const uIn = T_USER_IDS.map(() => '?').join(',');
  db.prepare(`DELETE FROM episodes WHERE drama_id IN (${dIn})`).run(...T_DRAMA_IDS);
  db.prepare(`DELETE FROM dramas WHERE id IN (${dIn})`).run(...T_DRAMA_IDS);
  db.prepare(`DELETE FROM users WHERE id IN (${uIn})`).run(...T_USER_IDS);

  // 种子用户（password/role 为 NOT NULL 列，测试给占位值）
  db.prepare(
    'INSERT INTO users (id, username, password, role, nickname, user_type, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(99801, 'admin', 'x', 'admin', '超管', 'individual', null);
  db.prepare(
    'INSERT INTO users (id, username, password, role, nickname, user_type, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(99802, 'ent_a_admin', 'x', 'admin', '企业A管理员', 'enterprise', 1001);
  db.prepare(
    'INSERT INTO users (id, username, password, role, nickname, user_type, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(99803, 't1_u', 'x', 'user', '团队成员', 'individual', null);

  const insDrama = db.prepare(
    'INSERT INTO dramas (id, title, description, genre, style, status, created_by, enterprise_id, team_id, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insDrama.run(99701, '[S9A]D1-都市爱情-上线', 'keyword_drama_alpha [S9A]', 'romance', 'cartoon', 'published', 99801, null, null, null, '2026-01-01 00:00:00', '2026-01-10 00:00:00');
  insDrama.run(99702, '[S9A]D2-都市悬疑-草稿', 'keyword_drama_beta [S9A]', 'suspense', 'realistic', 'draft', 99801, null, null, null, '2026-01-02 00:00:00', '2026-01-09 00:00:00');
  insDrama.run(99703, '[S9A]D3-企业剧-上线', 'ent_drama [S9A]', 'drama', 'realistic', 'published', 99802, 1001, null, null, '2026-01-03 00:00:00', '2026-01-08 00:00:00');
  insDrama.run(99704, '[S9A]D4-企业剧-软删除', 'ent_deleted [S9A]', 'drama', 'realistic', 'draft', 99802, 1001, null, '2026-01-04 00:00:00', '2026-01-03 00:00:00', '2026-01-04 00:00:00');
  insDrama.run(99705, '[S9A]D5-团队-草稿', 'team_drama [S9A]', 'fantasy', 'realistic', 'draft', 99803, 2002, 5001, null, '2026-01-04 00:00:00', '2026-01-07 00:00:00');

  // D1 有2集，D2 有3集，D3 有1集，D5 有0集
  const insEp = db.prepare(
    'INSERT INTO episodes (drama_id, title, episode_number, deleted_at) VALUES (?, ?, ?, ?)'
  );
  insEp.run(99701, 'E1-1', 1, null);
  insEp.run(99701, 'E1-2', 2, null);
  insEp.run(99702, 'E2-1', 1, null);
  insEp.run(99702, 'E2-2', 2, null);
  insEp.run(99702, 'E2-3', 3, null);
  insEp.run(99703, 'E3-1', 1, null);

  return db;
}

function cleanupDb(db) {
  const dIn = T_DRAMA_IDS.map(() => '?').join(',');
  const uIn = T_USER_IDS.map(() => '?').join(',');
  db.prepare(`DELETE FROM episodes WHERE drama_id IN (${dIn})`).run(...T_DRAMA_IDS);
  db.prepare(`DELETE FROM dramas WHERE id IN (${dIn})`).run(...T_DRAMA_IDS);
  db.prepare(`DELETE FROM users WHERE id IN (${uIn})`).run(...T_USER_IDS);
}

describe('A. listDramasLite 单元测试', () => {
  const dramaService = require('../src/services/dramaService');
  let db;

  before(() => { db = makeDb(); });
  after(() => { cleanupDb(db); closeDb(); });

  test('A1. 空结果（status=不可能值）→ total=0, dramas=[], 分页正确', () => {
    const { dramas, total, page, pageSize } = dramaService.listDramasLite(
      db, { page: 1, page_size: 10, status: 'fictional_status_xxx' }, null
    );
    assert.deepStrictEqual(dramas, []);
    assert.strictEqual(total, 0);
    assert.strictEqual(page, 1);
    assert.strictEqual(pageSize, 10);
  });

  test('A2. 分页边界：默认 page=1, page_size=20 → 最大 page_size=100，超限页=空结果', () => {
    // 实际未删除：D1 D2 D3 D5 = 4条（带 keyword 过滤隔离业务数据）
    let r = dramaService.listDramasLite(db, { page: 99, page_size: 20, keyword: '[S9A]' }, null);
    assert.strictEqual(r.dramas.length, 0);
    assert.strictEqual(r.total, 4);
    assert.strictEqual(r.page, 99);
    assert.strictEqual(r.pageSize, 20);
    // page_size=500 → 被钳制到100
    r = dramaService.listDramasLite(db, { page: 1, page_size: 500, keyword: '[S9A]' }, null);
    assert.strictEqual(r.pageSize, 100);
    // page/page_size 非法字符串→ 默认值
    r = dramaService.listDramasLite(db, { page: 'abc', page_size: 'xyz', keyword: '[S9A]' }, null);
    assert.strictEqual(r.page, 1);
    assert.strictEqual(r.pageSize, 20);
  });

  test('A3. keyword模糊筛选：title+description 任意匹配', () => {
    // 搜 keyword_drama → D1 + D2（都含 description）
    let r = dramaService.listDramasLite(db, { page: 1, page_size: 10, keyword: 'keyword_drama' }, null);
    assert.strictEqual(r.total, 2);
    // 搜 都市爱情 → 只D1
    r = dramaService.listDramasLite(db, { page: 1, page_size: 10, keyword: '都市爱情' }, null);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.dramas[0].id, 99701);
  });

  test('A4. status+genre 组合筛选', () => {
    // romance + published → D1
    let r = dramaService.listDramasLite(db, { status: 'published', genre: 'romance', keyword: '[S9A]' }, null);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.dramas[0].id, 99701);
    // draft → D2+D5
    r = dramaService.listDramasLite(db, { status: 'draft', keyword: '[S9A]' }, null);
    assert.strictEqual(r.total, 2);
  });

  test('A5. 权限过滤：super_admin/enterprise_admin/team/普通用户 4档', () => {
    // 超管：未删除 D1+D2+D3+D5=4（keyword 隔离业务数据）
    let r = dramaService.listDramasLite(db, { keyword: '[S9A]' }, { id: 99801, role: 'super_admin' });
    assert.strictEqual(r.total, 4, `super_admin 期望4条，实际=${r.total}  ids=${r.dramas.map(d=>d.id).join(',')}`);
    // 企业管理员 enterprise_id=1001 → 只 drama.enterprise_id=1001 且未删除 → D3
    r = dramaService.listDramasLite(db, { keyword: '[S9A]' }, { id: 99802, role: 'enterprise_admin', enterprise_id: 1001 });
    const entIds = r.dramas.map(d => d.id).join(',');
    assert.strictEqual(r.total, 1, `enterprise_admin 期望1条(D3)，实际=${r.total}  ids=${entIds}`);
    assert.strictEqual(r.dramas[0].id, 99703, `enterprise_admin 应只返回D3，实际返回 ids=${entIds}`);
    // 团队 team_id=5001 → D5
    r = dramaService.listDramasLite(db, { keyword: '[S9A]' }, { id: 99803, role: 'team_member', team_id: 5001 });
    assert.strictEqual(r.total, 1, `team_member 期望1条(D5)，实际=${r.total}  ids=${r.dramas.map(d=>d.id).join(',')}`);
    assert.strictEqual(r.dramas[0].id, 99705);
    // 普通用户 id=99801 → 自己创建的 D1+D2
    r = dramaService.listDramasLite(db, { keyword: '[S9A]' }, { id: 99801, role: 'normal_user' });
    const ids = r.dramas.map(d => d.id).sort((a,b)=>a-b);
    assert.deepStrictEqual(ids, [99701,99702], `普通用户id=99801应看到自己创建的D1+D2，实际 ids=${JSON.stringify(ids)}`);
  });

  test('A6. 关键字段齐全：id/title/style/status/metadata/created_at/updated_at/creator/episodes_count/episodes[]', () => {
    const { dramas } = dramaService.listDramasLite(db, { keyword: '[S9A]', page_size: 10 }, { role: 'super_admin' });
    const d1 = dramas.find(d => d.id === 99701);
    assert.ok(d1, 'D1应能找到');
    const keys = ['id','title','style','status','metadata','created_at','updated_at','creator','episodes_count','episodes'];
    for (const k of keys) assert.ok(k in d1, `D1缺字段: ${k}`);
    assert.ok(Array.isArray(d1.episodes), 'episodes应为数组（兜底兼容）');
  });

  test('A7. episodes_count 预聚合正确性（D1=2集, D2=3集, D3=1集, D5=0集）', () => {
    const { dramas } = dramaService.listDramasLite(db, { keyword: '[S9A]', page_size: 10 }, { role: 'super_admin' });
    const byId = Object.fromEntries(dramas.map(d => [d.id, d]));
    assert.strictEqual(byId[99701].episodes_count, 2, 'D1应为2集');
    assert.strictEqual(byId[99702].episodes_count, 3, 'D2应为3集');
    assert.strictEqual(byId[99703].episodes_count, 1, 'D3应为1集');
    assert.strictEqual(byId[99705].episodes_count, 0, 'D5应为0集');
  });

  test('A8. users LEFT JOIN creator对象正确（D1 creator=99801→超管，D3 creator=99802→企业管理员）', () => {
    const { dramas } = dramaService.listDramasLite(db, { keyword: '[S9A]', page_size: 10 }, { role: 'super_admin' });
    const byId = Object.fromEntries(dramas.map(d => [d.id, d]));
    assert.deepStrictEqual(byId[99701].creator, {
      id: 99801, nickname: '超管', username: 'admin', user_type: 'individual', enterprise_id: null,
    });
    assert.deepStrictEqual(byId[99703].creator, {
      id: 99802, nickname: '企业A管理员', username: 'ent_a_admin', user_type: 'enterprise', enterprise_id: 1001,
    });
  });
});

/* =======================================================
 * B. MergeAsyncQueue 单元测试（基于通用 AsyncQueue 类）
 *    覆盖：并发上限严格限制 / 队列满时waiters排队不超阈值 /
 *          单个任务异常被隔离不影响其他任务 / 120s兜底语义可由drain验证 /
 *          stats 字段实时更新
 * ======================================================= */
describe('B. MergeAsyncQueue 并发控制 单元测试', () => {
  const { AsyncQueue } = require('../src/utils/concurrency');

  test('B1. 并发上限严格=2：10任务每个40ms，峰值running绝不超过2', async () => {
    const q = new AsyncQueue(2, 'test-merge-2');
    let peakRunning = 0;
    const makeTask = () => {
      return q.add(async () => {
        const { running } = q.stats;
        if (running > peakRunning) peakRunning = running;
        await new Promise(r => setTimeout(r, 40));
      });
    };
    const ps = [];
    for (let i = 0; i < 10; i++) ps.push(makeTask());
    await Promise.all(ps);
    await q._drain();
    assert.strictEqual(q.stats.submitted, 10, '应提交10个任务');
    assert.strictEqual(q.stats.completed, 10, `应完成10个任务，实际=${q.stats.completed}（_drain后仍缺说明running/queued未清空）`);
    assert.ok(peakRunning <= 2, `并发峰值=${peakRunning} 不应超过上限2`);
    assert.strictEqual(q.stats.queued, 0);
    assert.strictEqual(q.stats.running, 0);
  });

  test('B2. concurrency=1 → 严格串行（执行时间 ≈ N×每个耗时）', async () => {
    const q = new AsyncQueue(1, 'test-serial');
    const t0 = Date.now();
    const ps = [];
    for (let i = 0; i < 4; i++) {
      ps.push(q.add(async () => { await new Promise(r => setTimeout(r, 20)); }));
    }
    await Promise.all(ps);
    const el = Date.now() - t0;
    assert.ok(el >= 70, `串行4×20ms 需≥70ms，实际=${el}ms`);
  });

  test('B3. 单个任务抛错不影响后续任务（异常隔离）', async () => {
    const q = new AsyncQueue(1, 'test-err-isolate');
    const events = [];
    // 串行=1 保证顺序稳定（concurrency=1时任务按提交顺序执行）
    const ps = [
      q.add(async () => { events.push('ok-1'); return 1; })
        .catch((e) => events.push('unexpected-1:' + e.message)),
      q.add(async () => { throw new Error('boom-task-2'); })
        .then(() => { events.push('unexpected-2-no-throw'); })
        .catch((e) => events.push('caught:' + e.message)),
      q.add(async () => { events.push('ok-3'); return 3; })
        .catch((e) => events.push('unexpected-3:' + e.message)),
    ];
    await Promise.all(ps);
    assert.deepStrictEqual(events, ['ok-1', 'caught:boom-task-2', 'ok-3'],
      `事件顺序应为 ok-1 → 2被捕获 → ok-3，实际=${JSON.stringify(events)}`);
    assert.strictEqual(q.stats.completed, 3, '3个任务均应计为完成（不论成功/抛错）');
    assert.strictEqual(q.stats.running, 0, '抛错任务也必须正确递减running');
    assert.strictEqual(q.stats.queued, 0);
  });

  test('B4. 队列满&峰值验证：先提交5个，2个执行中，3个必须排队（queued=3 running=2）', async () => {
    const q = new AsyncQueue(2, 'test-queued');
    // 用 setTimeout 自解析任务，避免 release 模式的竞态条件
    // （release 模式中，释放任务后微任务启动新任务会push新resolve，但while循环已结束）
    const ps = [];
    for (let i = 0; i < 5; i++) {
      ps.push(q.add(() => new Promise(r => setTimeout(r, 50))));
    }
    // 让事件循环切一轮，让 _runNext 执行
    await new Promise(setImmediate);
    const s1 = q.stats;
    assert.strictEqual(s1.running, 2, `前2个应正在运行 running=${s1.running}`);
    assert.strictEqual(s1.queued,  3, `后3个应排队 queued=${s1.queued}`);
    assert.strictEqual(s1.submitted, 5);
    // 等待全部完成
    await Promise.all(ps);
    await q._drain();
    assert.deepStrictEqual(q.stats, {
      name: 'test-queued', concurrency: 2, running: 0, queued: 0, submitted: 5, completed: 5,
    });
  });

  test('B5. dramaService._MergeAsyncQueue 实例：concurrency=2（与 config.yaml 一致）', () => {
    const ds = require('../src/services/dramaService');
    assert.ok(ds._MergeAsyncQueue, '应导出 _MergeAsyncQueue');
    const s = ds._mergeQueueStats();
    assert.strictEqual(s.concurrency, 2, `应读自 config merge_concurrency=2，实际=${s.concurrency}`);
    assert.strictEqual(s.name, 'video-merge');
    assert.strictEqual(s.running, 0);
  });
});
