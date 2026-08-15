/**
 * 测试：admin.fixDataAnomaly —— 负余额/mismatch 修复、列缺失、幂等、不支持类型、并发冲突。
 *
 * 数据约束（真实 MySQL，localminidrama）：
 *   - 所有测试数据真实写入 MySQL（configs/config.yaml），不使用 mock / SQLite
 *   - 测试用户使用统一前缀 fix_anom_ 隔离，before 清理残留、after 彻底清理
 *   - 直接调用 adminRoutes.__buildFixDataAnomaly 构造修复器（绕过 Express server）
 *   - 并发冲突用 worker_threads 每个 worker 独立连接真实 MySQL 模拟进程级并发，
 *     事务内 FOR UPDATE 行锁保证只有一个 affected>0
 *
 * 说明：真实 MySQL users 表没有 balance 列（余额以 point_logs.balance_after 为准），
 *       因此 userbalneg / mismatch 命中"列缺失防护"返回 400（而非 500），
 *       neg_bal 只修复日志（affected=1，跳过 users 同步分支）。
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');
const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const { snowflakeId } = require('../src/utils/snowflake');

const TEST_USER_PREFIX = 'fix_anom_';

function makeDb() {
  const db = getDb(loadConfig().database);
  // 清理本测试可能残留的数据（先删日志再删用户）
  db.prepare(`DELETE FROM point_logs WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`).run();
  db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_USER_PREFIX}%'`).run();
  return db;
}

function cleanupDb(db) {
  if (!db) return;
  db.prepare(`DELETE FROM point_logs WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`).run();
  db.prepare(`DELETE FROM users WHERE username LIKE '${TEST_USER_PREFIX}%'`).run();
}

function buildFixer(db, cfg) {
  const mod = require('../src/routes/admin');
  const fake = mod({ type: 'mysql', transaction: () => {} }, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
  return fake.__buildFixDataAnomaly({
    db,
    cfg: Object.assign({ amountThreshold: 2e8, balanceThreshold: 5e8, defaultLimit: 200, logLevel: 'warn' }, cfg || {}),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: (m, d) => process.env.DEBUG ? console.error('[fix-err]', m, d) : undefined }
  });
}

let uidSeq = 0;
function nextUsername(tag) {
  uidSeq += 1;
  return TEST_USER_PREFIX + tag + '_' + Date.now().toString(36) + '_' + uidSeq;
}

function seedUser(db, { username, nickname = '' }) {
  const id = snowflakeId();
  db.prepare(`INSERT INTO users (id, username, password, role, nickname) VALUES (?, ?, ?, ?, ?)`)
    .run(id, username, 'x', 'user', nickname);
  return id;
}

function seedLog(db, { user_id, amount, balance_after, change_type = 'decrease', business_type = 'test', remark = '' }) {
  const id = snowflakeId();
  db.prepare(
    `INSERT INTO point_logs (id, user_id, amount, balance_after, change_type, business_type, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user_id, amount, balance_after, change_type, business_type, remark);
  return id;
}

describe('fixDataAnomaly (真实 MySQL)', () => {
  let db;
  before(() => { db = makeDb(); });
  after(() => { cleanupDb(db); closeDb(); });

  // =============== 0. 格式与不支持类型 ===============
  describe('输入校验与类型不支持', () => {
    it('ID 为空/格式错误时返回 400 BAD_REQUEST', async () => {
      const fix = buildFixer(db);
      assert.equal((await fix('')).status, 400);
      assert.equal((await fix('neg_bal')).status, 400);
      assert.equal((await fix('hello_world')).status, 400); // _world 非纯数字
      assert.equal((await fix('neg_bal_0')).status, 400); // keyId=0 不允许
    });

    it('huge_amount / balance_jump / unknown 前缀都返回 400（需人工处理）', async () => {
      const fix = buildFixer(db);
      const r1 = await fix('huge_amount_1');
      assert.equal(r1.status, 400);
      assert.match(r1.message || '', /不支持的自动修复类型/);

      const r2 = await fix('balance_jump_1');
      assert.equal(r2.status, 400);
      assert.equal(r2.code, 'BAD_REQUEST');

      const r3 = await fix('foobar_123');
      assert.equal(r3.status, 400);
    });
  });

  // =============== 1. 列缺失场景（真实 MySQL：users 无 balance 列） ===============
  describe('列缺失边界（真实 MySQL users 表无 balance 列）', () => {
    it('userbalneg 缺失 users.balance 列：返回 400（不抛 500）', async () => {
      const fix = buildFixer(db);
      const r = await fix('userbalneg_1');
      assert.equal(r.status, 400);
      assert.match(r.message, /没有 balance 列/);
    });

    it('mismatch 缺失 users.balance 列：返回 400', async () => {
      const fix = buildFixer(db);
      const r = await fix('mismatch_1');
      assert.equal(r.status, 400);
      assert.match(r.message, /没有 balance 列/);
    });
  });

  // =============== 2. neg_bal：日志负余额修复 ===============
  describe('neg_bal：日志负余额修复', () => {
    it('目标日志不存在：返回 500（走 throw 分支）', async () => {
      const fix = buildFixer(db);
      const r = await fix('neg_bal_99999999');
      assert.equal(r.status, 500);
      assert.match(r.message, /异常日志不存在/);
    });

    it('修复 balance_after=-123 → 0（MySQL 无 users.balance，仅日志 affected=1）', async () => {
      const uid = seedUser(db, { username: nextUsername('a') });
      seedLog(db, { user_id: uid, amount: 1000, balance_after: 1000, change_type: 'increase' });
      const lid = seedLog(db, { user_id: uid, amount: -1123, balance_after: -123, remark: '故意负值' });

      const fix = buildFixer(db);
      const r = await fix('neg_bal_' + lid);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.status, 200);
      assert.equal(r.data.affected, 1); // MySQL users 无 balance 列 → 只修日志

      const pl = db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      assert.equal(Number(pl.balance_after), 0);
    });

    it('幂等：连续修两次 → 第二次 affected=0 但 ok=true，不报错', async () => {
      const uid = seedUser(db, { username: nextUsername('b') });
      const lid = seedLog(db, { user_id: uid, amount: -42, balance_after: -42 });
      const fix = buildFixer(db);

      const r1 = await fix('neg_bal_' + lid);
      assert.equal(r1.ok, true);
      assert.equal(r1.data.affected, 1);

      const r2 = await fix('neg_bal_' + lid);
      assert.equal(r2.ok, true);
      assert.equal(r2.data.affected, 0);
      assert.match(r2.data.message, /无需修复/);
    });
  });

  // =============== 3. userbalneg：MySQL 下命中列缺失防护 ===============
  describe('userbalneg：users 无 balance 列 → 400 防护', () => {
    it('无论用户是否存在，均返回 400（列缺失优先）', async () => {
      const uid = seedUser(db, { username: nextUsername('neg') });
      const fix = buildFixer(db);
      const r1 = await fix('userbalneg_' + uid);
      assert.equal(r1.status, 400);
      assert.match(r1.message, /没有 balance 列/);

      const r2 = await fix('userbalneg_12345');
      assert.equal(r2.status, 400);
    });
  });

  // =============== 4. mismatch：MySQL 下命中列缺失防护 ===============
  describe('mismatch：users 无 balance 列 → 400 防护', () => {
    it('返回 400 而非 500', async () => {
      const uid = seedUser(db, { username: nextUsername('mm') });
      seedLog(db, { user_id: uid, amount: 12345, balance_after: 12345 });
      const fix = buildFixer(db);
      const r = await fix('mismatch_' + uid);
      assert.equal(r.status, 400);
      assert.match(r.message, /没有 balance 列/);
    });
  });

  // =============== 5. 并发冲突（同一 neg_bal 日志被多 worker 同时修复） ===============
  describe('并发冲突：同一 neg_bal_ID 被多 worker 同时修复（真实 MySQL FOR UPDATE）', { concurrency: 1 }, () => {
    it('12 个并发 worker 同修同一条 neg_bal → 最终数据一致，最多 1 次 affected>0', { timeout: 60000 }, async () => {
      const uid = seedUser(db, { username: nextUsername('victim') });
      const lid = seedLog(db, { user_id: uid, amount: -777, balance_after: -777 });

      const WORKERS = 12;
      const CALLS_PER_WORKER = 8;
      const adminModPath = path.resolve(__dirname, '../src/routes/admin.js');
      const workerCode = `
        const { parentPort, workerData } = require('worker_threads');
        const { getDb, closeDb } = require(${JSON.stringify(path.resolve(__dirname, '../src/db/index.js'))});
        const { loadConfig } = require(${JSON.stringify(path.resolve(__dirname, '../src/config/index.js'))});
        const mod = require(${JSON.stringify(adminModPath)});
        const db = getDb(loadConfig().database);
        const fake = mod({ type: 'mysql', transaction: () => {} }, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
        const fix = fake.__buildFixDataAnomaly({
          db, cfg: { logLevel: 'warn' },
          log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
        });
        (async () => {
          const out = [];
          for (let i = 0; i < workerData.n; i++) {
            try {
              out.push(await fix('neg_bal_' + workerData.lid));
            } catch (e) {
              out.push({ ok: false, status: 500, message: e.message, isThrow: true });
            }
          }
          closeDb();
          parentPort.postMessage(out);
        })();
      `;

      const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
        const w = new Worker(workerCode, { eval: true, workerData: { lid, n: CALLS_PER_WORKER } });
        w.on('message', resolve);
        w.on('error', reject);
        w.on('exit', (c) => c !== 0 && reject(new Error('worker ' + i + ' exit=' + c)));
      })));

      const all = results.flat();
      const realOk = all.filter(x => x.ok);
      const affectedGt0 = realOk.filter(x => (x.data && x.data.affected > 0)).length;
      // FOR UPDATE 行锁保证只有一个 affected>0
      assert.ok(affectedGt0 <= 1, 'expected at most 1 affected>0, got ' + affectedGt0);

      // 最终值一致（关键！）
      const pl = db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      assert.equal(Number(pl.balance_after), 0);
    });
  });

  // =============== 6. 一致性断言（neg_bal 幂等覆盖） ===============
  describe('一致性：修复后日志必为非负', () => {
    it('修复后 balance_after 一定 >= 0（成功路径覆盖）', async () => {
      const uid = seedUser(db, { username: nextUsername('consist') });
      const lid = seedLog(db, { user_id: uid, amount: -5, balance_after: -5 });
      const fix = buildFixer(db);
      const r = await fix('neg_bal_' + lid);
      assert.equal(r.ok, true, JSON.stringify(r));
      const pl = db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      assert.ok(Number(pl.balance_after) >= 0);
    });
  });
});
