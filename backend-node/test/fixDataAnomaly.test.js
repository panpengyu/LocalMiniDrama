/**
 * 测试：admin.fixDataAnomaly —— 负余额/mismatch 修复、列缺失、幂等、不支持类型、并发冲突。
 *
 * 设计要点：
 *   - 使用 better-sqlite3 :memory:（零外部依赖、秒级启动，符合现有 test 目录风格）
 *   - 直接调用 adminRoutes.__buildFixDataAnomaly 构造修复器（绕过 Express server）
 *   - 并发冲突用 Promise.all + 多事务模拟，better-sqlite3 是同步串行，所以用 p-threads
 *     WorkerThreads 模拟真正并发进程级冲突（SQLite immediate事务会 SQLITE_BUSY）
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const { Worker } = require('worker_threads');

function createDb(withUserBalance = true) {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.type = 'sqlite'; // 让 buildFixDataAnomaly 认
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status INTEGER NOT NULL DEFAULT 1,
      nickname TEXT,
      ${withUserBalance ? 'balance BIGINT NOT NULL DEFAULT 0,' : ''}
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount BIGINT NOT NULL DEFAULT 0,
      balance_after BIGINT DEFAULT 0,
      change_type TEXT NOT NULL,
      business_type TEXT,
      remark TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function buildFixer(db, cfg) {
  const mod = require('../src/routes/admin');
  const fake = mod({ type:'sqlite', transaction:()=>{} }, { info:()=>{}, warn:()=>{}, error:()=>{}, debug:()=>{} });
  return fake.__buildFixDataAnomaly({
    db,
    cfg: Object.assign({ amountThreshold:2e8, balanceThreshold:5e8, defaultLimit:200, logLevel:'warn' }, cfg || {}),
    log: { debug:()=>{}, info:()=>{}, warn:()=>{}, error:(m,d) => process.env.DEBUG ? console.error('[fix-err]', m, d) : undefined }
  });
}

function seedUser(db, { username='u', balance=0, nickname='' }) {
  const r = db.prepare(`INSERT INTO users (username, nickname, balance) VALUES (?,?,?)`).run(username, nickname, balance);
  return Number(r.lastInsertRowid);
}
function seedUserNoBal(db, { username='u', nickname='' }) {
  const r = db.prepare(`INSERT INTO users (username, nickname) VALUES (?,?)`).run(username, nickname);
  return Number(r.lastInsertRowid);
}
function seedLog(db, { user_id, amount, balance_after, change_type='decrease', business_type='test', remark='', reason='' }) {
  const r = db.prepare(
    `INSERT INTO point_logs (user_id,amount,balance_after,change_type,business_type,remark,reason)
     VALUES (?,?,?,?,?,?,?)`
  ).run(user_id, amount, balance_after, change_type, business_type, remark, reason);
  return Number(r.lastInsertRowid);
}

describe('fixDataAnomaly', () => {

  // =============== 0. 格式与不支持类型 ===============
  describe('输入校验与类型不支持', () => {
    it('ID 为空/格式错误时返回 400 BAD_REQUEST', async () => {
      const db = createDb();
      const fix = buildFixer(db);
      assert.equal((await fix('')).status, 400);
      assert.equal((await fix('neg_bal')).status, 400);
      assert.equal((await fix('hello_world')).status, 400); // _world 非纯数字
      assert.equal((await fix('neg_bal_0')).status, 400); // keyId=0 不允许
    });

    it('huge_amount / balance_jump / unknown 前缀都返回 400（需人工处理）', async () => {
      const db = createDb();
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

  // =============== 1. 列缺失场景 ===============
  describe('列缺失边界', () => {
    it('neg_bal 缺失 point_logs.balance_after 列：返回 400（不抛 500）', async () => {
      const db = new Database(':memory:');
      db.type = 'sqlite';
      db.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY);
        CREATE TABLE point_logs (id INTEGER PRIMARY KEY, user_id INTEGER, amount BIGINT);
      `);
      // 造一条假"日志"（没有 balance_after）
      db.prepare('INSERT INTO point_logs (id,user_id,amount) VALUES (?,?,?)').run(1, 1, -100);
      const fix = buildFixer(db);
      const r = await fix('neg_bal_1');
      assert.equal(r.status, 400);
      assert.match(r.message, /balance_after 列/);
    });

    it('userbalneg 缺失 users.balance 列：返回 400', async () => {
      const db = createDb(false); // withUserBalance=false
      seedUserNoBal(db, { username:'u1' });
      const fix = buildFixer(db);
      const r = await fix('userbalneg_1');
      assert.equal(r.status, 400);
      assert.match(r.message, /没有 balance 列/);
    });

    it('mismatch 缺失 users.balance 列：返回 400', async () => {
      const db = createDb(false);
      const uid = seedUserNoBal(db, { username:'u2' });
      seedLog(db, { user_id:uid, amount:100, balance_after:100 });
      const fix = buildFixer(db);
      const r = await fix('mismatch_' + uid);
      assert.equal(r.status, 400);
    });
  });

  // =============== 2. neg_bal：日志负余额修复 ===============
  describe('neg_bal：日志负余额修复', () => {
    it('目标日志不存在：返回 500（走 throw 分支）', async () => {
      const db = createDb();
      const fix = buildFixer(db);
      const r = await fix('neg_bal_99999');
      assert.equal(r.status, 500);
      assert.match(r.message, /异常日志不存在/);
    });

    it('修复 balance_after=-123 → 0，用户余额同步（users.balance 存在时）', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'a', balance:-123 });
      // 先写条旧日志 1000，再写条最新的 -123
      seedLog(db, { user_id:uid, amount:1000, balance_after:1000, change_type:'increase' });
      const lid = seedLog(db, { user_id:uid, amount:-1123, balance_after:-123, remark:'故意负值' });

      const fix = buildFixer(db);
      const r = await fix('neg_bal_' + lid);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.status, 200);
      assert.equal(r.data.affected, 2); // 1 条日志 + 1 条用户

      const pl = db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      assert.equal(Number(pl.balance_after), 0);

      const u = db.prepare('SELECT balance FROM users WHERE id=?').get(uid);
      // 最近日志的 balance_after 是 0（被我们刚置零），所以 users.balance 应该同步为 0
      assert.equal(Number(u.balance), 0);
    });

    it('幂等：连续修两次 → 第二次 affected=0 但 ok=true，不报错', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'b', balance:-42 });
      const lid = seedLog(db, { user_id:uid, amount:-42, balance_after:-42 });
      const fix = buildFixer(db);

      const r1 = await fix('neg_bal_' + lid);
      assert.equal(r1.ok, true);
      assert.equal(r1.data.affected, 2);

      const r2 = await fix('neg_bal_' + lid);
      assert.equal(r2.ok, true);
      assert.equal(r2.data.affected, 0);
      assert.match(r2.data.message, /无需修复/);
    });

    it('users.balance 列不存在时：只修 point_logs，affected=1', async () => {
      const db = createDb(false);
      const uid = seedUserNoBal(db, { username:'c' });
      const lid = seedLog(db, { user_id:uid, amount:-9, balance_after:-9 });
      const fix = buildFixer(db);
      const r = await fix('neg_bal_' + lid);
      assert.equal(r.ok, true);
      assert.equal(r.data.affected, 1);
      assert.equal(Number(db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid).balance_after), 0);
    });
  });

  // =============== 3. userbalneg：用户负余额修复 ===============
  describe('userbalneg：用户负余额修复', () => {
    it('users 表里找不到该用户 → 500（用户不存在）', async () => {
      const db = createDb();
      const r = await buildFixer(db)('userbalneg_12345');
      assert.equal(r.status, 500);
      assert.match(r.message, /用户不存在/);
    });

    it('修复 users.balance=-55666777 → 0，并保持幂等', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'neg', balance:-55666777 });
      const fix = buildFixer(db);

      const r1 = await fix('userbalneg_' + uid);
      assert.equal(r1.ok, true);
      assert.equal(r1.data.affected, 1);
      assert.equal(Number(db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance), 0);

      const r2 = await fix('userbalneg_' + uid);
      assert.equal(r2.ok, true);
      assert.equal(r2.data.affected, 0);
      assert.match(r2.data.message, /无需修复/);
    });
  });

  // =============== 4. mismatch：用户-日志不一致修复 ===============
  describe('mismatch：余额同步', () => {
    it('users.balance(9e8) ≠ 最近 point_logs(12345) → 同步成 12345', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'mm', balance:987654321 });
      seedLog(db, { user_id:uid, amount:12345, balance_after:12345 });
      const fix = buildFixer(db);
      const r = await fix('mismatch_' + uid);
      assert.equal(r.ok, true);
      assert.equal(r.data.affected, 1);
      assert.equal(Number(db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance), 12345);
    });

    it('该用户无 point_logs 时抛 500（提示人工核查）', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'empty_logs', balance:100 });
      const r = await buildFixer(db)('mismatch_' + uid);
      assert.equal(r.status, 500);
      assert.match(r.message, /无 point_logs/);
    });

    it('幂等：同步后再修一次 → 仍 ok，affected=1 或 0 都可接受（但最终值一致）', async () => {
      const db = createDb();
      const uid = seedUser(db, { username:'mm2', balance:100 });
      seedLog(db, { user_id:uid, amount:42, balance_after:42 });
      const fix = buildFixer(db);
      const r1 = await fix('mismatch_' + uid);
      const r2 = await fix('mismatch_' + uid);
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      assert.equal(Number(db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance), 42);
    });
  });

  // =============== 5. 并发冲突（负余额同一日志被多线程同时修）===============
  describe('并发冲突：同一 neg_bal_ID 被多 worker 同时修复', { concurrency: 1 }, () => {
    // 用 worker_threads 每个线程开自己的 better-sqlite3 句柄连接同一份磁盘临时 DB 文件
    it('12 个并发 worker 同修同一条 neg_bal → 最终数据一致，最多有 1 次 affected>0', { timeout: 30000 }, async () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = path.join(os.tmpdir(), 'fix-stress-' + Date.now() + '.db');
      // 初始化 DB
      const db0 = new Database(tmp);
      db0.pragma('journal_mode = WAL');
      db0.type = 'sqlite';
      db0.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE,
          balance BIGINT NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE point_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          amount BIGINT NOT NULL DEFAULT 0,
          balance_after BIGINT DEFAULT 0,
          change_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const uid = db0.prepare('INSERT INTO users (username,balance) VALUES (?,?)').run('victim',-777).lastInsertRowid;
      const lid = db0.prepare('INSERT INTO point_logs (user_id,amount,balance_after,change_type) VALUES (?,?,?,?)').run(uid,-777,-777,'decrease').lastInsertRowid;
      db0.close();

      const WORKERS = 12;
      const CALLS_PER_WORKER = 8;
      const workerCode = `
        const { parentPort, workerData } = require('worker_threads');
        const Database = require('better-sqlite3');
        const mod = require(${JSON.stringify(path.resolve(__dirname, '../src/routes/admin.js'))});
        const db = new Database(workerData.tmp, { timeout: 5000 });
        db.pragma('journal_mode = WAL');
        db.type = 'sqlite';
        const fake = mod(db, { info:()=>{}, warn:()=>{}, error:()=>{}, debug:()=>{} });
        const fix = fake.__buildFixDataAnomaly({
          db, cfg:{ logLevel:'warn' },
          log:{ debug:()=>{}, info:()=>{}, warn:()=>{}, error:()=>{} }
        });
        (async () => {
          const out = [];
          for (let i = 0; i < workerData.n; i++) {
            try {
              out.push(await fix('neg_bal_' + workerData.lid));
            } catch (e) {
              out.push({ ok:false, status:500, message:e.message, isThrow:true });
            }
          }
          db.close();
          parentPort.postMessage(out);
        })();
      `;

      const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
        const w = new Worker(workerCode, { eval:true, workerData:{ tmp, n:CALLS_PER_WORKER, lid } });
        w.on('message', resolve);
        w.on('error', reject);
        w.on('exit', (c) => c !== 0 && reject(new Error('worker '+i+' exit=' + c)));
      })));

      const all = results.flat();
      // 断言 1: 没抛 500（SQLITE_BUSY 会走 catch 标 isThrow，但 affected>0 的只可能有 1 次）
      const throws = all.filter(x => x.isThrow);
      if (throws.length) {
        console.warn('[warn] 并发 throw 数量 =', throws.length, '/', all.length,
          '(SQLite BUSY 属预期，只要最终数据一致就 OK)');
      }

      const realOk = all.filter(x => x.ok);
      const affectedGt0 = realOk.filter(x => (x.data && x.data.affected > 0)).length;
      // 真实的 affected>0 只能 <=1（WAL 下可能 0 或 1 个成功，其它幂等返回 0）
      assert.ok(affectedGt0 <= 1, 'expected at most 1 affected>0, got ' + affectedGt0);

      // 断言 2: 最终值一致（关键！）
      const check = new Database(tmp);
      const pl = check.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      const us = check.prepare('SELECT balance FROM users WHERE id=?').get(uid);
      assert.equal(Number(pl.balance_after), 0);
      assert.equal(Number(us.balance), 0);
      check.close();
      fs.unlinkSync(tmp);
      try { fs.unlinkSync(tmp + '-wal'); } catch {}
      try { fs.unlinkSync(tmp + '-shm'); } catch {}
    });
  });

  // =============== 6. 一致性断言触发 ROLLBACK ===============
  describe('一致性断言失败会回滚', () => {
    it('注入错误数据库：在更新后"偷偷"把值写回负数 —— 将触发 CONSISTENCY throw 并回滚', async () => {
      // 做法：我们不用 hook，而是直接把 neg_bal 的场景改成："修复 UPDATE balance_after = 0"
      // 但故意让"锁用户行后同步"这一步里 users.balance 有个 BEFORE UPDATE trigger 改为 -1，
      // 这样 our consistency 断言就会失败并回滚（point_logs 也回滚）。
      const db = createDb();
      db.exec(`
        CREATE TRIGGER trg_break_user_bal AFTER UPDATE ON users
        FOR EACH ROW WHEN NEW.balance = 0
        BEGIN
          UPDATE users SET balance = -1 WHERE id = OLD.id;
        END;
      `);
      const uid = seedUser(db, { username:'brk', balance:-5 });
      const lid = seedLog(db, { user_id:uid, amount:-5, balance_after:-5 });
      const fix = buildFixer(db);
      const r = await fix('neg_bal_' + lid);
      assert.equal(r.status, 500, 'expect CONSISTENCY check to throw: ' + JSON.stringify(r));
      assert.match(r.message, /CONSISTENCY/);
      // 验证事务回滚：point_logs 仍然是 -5（因为断言失败会抛 → runWriteTx 内部回滚）
      const pl = db.prepare('SELECT balance_after FROM point_logs WHERE id=?').get(lid);
      assert.equal(Number(pl.balance_after), -5);
    });
  });
});
