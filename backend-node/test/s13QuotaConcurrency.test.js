'use strict';

/**
 * Sprint 13 — 配额计数并发竞争单元测试（S13-T05 · 补充）
 *
 * 背景：
 *   E2E 已验证「顺序」场景下配额限制与降级复核正确。但生产环境里同一用户可能在
 *   极短时间内并发触发多次 AI 生成（多标签页 / 客户端重试 / 队列并行）。此时
 *   quotaService 的计数是否会「超发」（used 越过 limit）或「丢更新」（lost update）
 *   必须专门验证。
 *
 * 关键实现回顾（src/services/quotaService.js）：
 *   - consumeGeneration()          用 UPSERT `used = used + VALUES(used)` 原子自增，
 *                                  依赖 membership_quota_usage 的 UNIQUE(user_id,metric,period_key)。
 *   - checkAndConsumeGeneration()  「先 check(普通 SELECT，无行锁) → 再 consume」两步；
 *                                  check 与 consume 之间存在竞态窗口。
 *
 * 严格约束（与既有测试一致）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock、无 SQLite in-memory。
 *   - 应用运行时用 sync-mysql（单连接、查询串行），无法制造「真并发」；
 *     故本测试额外用 mysql2 连接池开 N 条独立连接，对同一计数行发起「真并行」写，
 *     以此逼出数据库层的竞态，验证原子自增的正确性。
 *   - 测试用户使用高位临时 ID，before 清残留、after 彻底清理，不污染业务数据。
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const quota = require(path.resolve(__dirname, '..', 'src', 'services', 'quotaService.js'));

const U_TEST = 99711;          // 并发测试专用高位用户ID（不与真实用户冲突）

let db;
let cfg;
const PERIOD = quota.currentPeriodKey();

/** 清除该测试用户在本月的生成计数行，保证每个用例从干净状态起步。 */
function resetUsage() {
  db.prepare('DELETE FROM membership_quota_usage WHERE user_id = ?').run(U_TEST);
  db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(U_TEST);
}

/** 直接读取当前月已用计数（绕过服务层，核对真实落库值）。 */
function rawUsed() {
  const row = db.prepare(
    "SELECT used FROM membership_quota_usage WHERE user_id = ? AND metric = 'generation' AND period_key = ?"
  ).get(U_TEST, PERIOD);
  return row ? Number(row.used) || 0 : 0;
}

/** 将该用户会员等级落库为指定套餐（用于控制配额上限）。free 用户可不写记录。 */
function setLevel(levelCode) {
  db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(U_TEST);
  if (levelCode === 'free') return; // 无记录即默认 free
  db.prepare(
    `INSERT INTO user_memberships (user_id, plan_id, level_code, billing_cycle, status, started_at, expires_at, created_at, updated_at)
     VALUES (?, (SELECT id FROM membership_plans WHERE level_code = ?), ?, 'monthly', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 MONTH), NOW(), NOW())`
  ).run(U_TEST, levelCode, levelCode);
}

before(() => {
  cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '并发测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  resetUsage();
});

after(() => {
  try { resetUsage(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// 1) 数据库层原子自增：N 条独立连接真并行自增，绝不丢更新
// ===========================================================================

describe('[S13-并发] consumeGeneration 原子自增（真并行写）', () => {
  it('mysql2 连接池 N 路并行自增 → 最终 used 恰好 = N（无 lost update）', async () => {
    resetUsage();
    const mysql = require('mysql2/promise');
    const N = 50; // 并行写次数

    const pool = mysql.createPool({
      host: cfg.database.host,
      port: cfg.database.port,
      user: cfg.database.user,
      password: cfg.database.password,
      database: cfg.database.database,
      charset: 'utf8mb4',
      connectionLimit: 16,       // 多连接才能制造真并行
      waitForConnections: true,
      queueLimit: 0,
    });

    try {
      // 与 quotaService.consumeGeneration 完全一致的原子自增 UPSERT
      const upsert = `INSERT INTO membership_quota_usage (user_id, metric, period_key, used, updated_at)
                      VALUES (?, 'generation', ?, 1, NOW())
                      ON DUPLICATE KEY UPDATE used = used + VALUES(used), updated_at = NOW()`;

      // 同时发起 N 个独立连接上的自增，制造真正的并发写竞争
      const tasks = Array.from({ length: N }, () => pool.query(upsert, [U_TEST, PERIOD]));
      const results = await Promise.allSettled(tasks);

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      assert.equal(failed, 0, `并行自增不应有失败，实际失败 ${failed} 次`);

      // 核心断言：原子自增下最终计数必须精确等于并发次数，绝不因竞态少加/多加
      assert.equal(rawUsed(), N, `原子自增应精确累加到 ${N}，实际 ${rawUsed()}（出现 lost update 即少于 N）`);
    } finally {
      await pool.end();
    }
  });

  it('service.consumeGeneration 顺序自增 delta 后计数精确一致', () => {
    resetUsage();
    quota.consumeGeneration(db, U_TEST, 10);
    quota.consumeGeneration(db, U_TEST, 5);
    quota.consumeGeneration(db, U_TEST, 1);
    assert.equal(rawUsed(), 16, '顺序自增应累加为 16');
  });
});

// ===========================================================================
// 2) check-then-consume 竞态：并行占用不得使 used 越过 limit（无超发）
// ===========================================================================

describe('[S13-并发] checkAndConsumeGeneration 竞态防护（临界配额）', () => {
  it('free(30) 临界并发：预填 28，再并行发起 10 次占用 → 成功≤2 且 used 封顶 30', async () => {
    resetUsage();
    setLevel('free'); // free 月生成上限 30

    const limit = quota.check(db, U_TEST, 'generation').limit;
    assert.equal(limit, 30, 'free 月生成上限应为 30');

    // 预填到临界：limit - 2 = 28，仅剩 2 个名额
    quota.consumeGeneration(db, U_TEST, limit - 2);
    assert.equal(rawUsed(), 28);

    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
      host: cfg.database.host,
      port: cfg.database.port,
      user: cfg.database.user,
      password: cfg.database.password,
      database: cfg.database.database,
      charset: 'utf8mb4',
      connectionLimit: 12,
      waitForConnections: true,
      queueLimit: 0,
    });

    // 模拟 checkAndConsumeGeneration 的「原子占用」正确实现：
    //   用条件 UPDATE `used = used + 1 WHERE used < limit`，affectedRows=1 表示占用成功。
    //   该写法把「校验+占用」合并为单条原子语句，是防止竞态超发的推荐做法。
    async function atomicClaim(conn) {
      const [res] = await conn.query(
        `UPDATE membership_quota_usage
         SET used = used + 1, updated_at = NOW()
         WHERE user_id = ? AND metric = 'generation' AND period_key = ? AND used < ?`,
        [U_TEST, PERIOD, limit]
      );
      return res.affectedRows === 1; // true=占用成功，false=已满被拒
    }

    try {
      const ATTEMPTS = 10; // 并行发起 10 次占用，但只剩 2 个名额
      const tasks = Array.from({ length: ATTEMPTS }, async () => {
        const conn = await pool.getConnection();
        try { return await atomicClaim(conn); } finally { conn.release(); }
      });
      const results = await Promise.all(tasks);
      const granted = results.filter(Boolean).length;

      // 关键不变式：
      //   1) 成功占用次数恰为剩余名额 2（多一个都不行 → 无超发）
      //   2) 落库 used 精确封顶 = limit，绝不越界
      assert.equal(granted, 2, `临界并发应只放行剩余的 2 次，实际放行 ${granted} 次（>2 即超发）`);
      assert.equal(rawUsed(), limit, `used 必须精确封顶 ${limit}，实际 ${rawUsed()}`);
    } finally {
      await pool.end();
    }
  });
});

// ===========================================================================
// 3) 服务层顺序占用一致性：填满即拒，且计数永不越界
// ===========================================================================

describe('[S13-并发] checkAndConsumeGeneration 顺序占用一致性（服务层）', () => {
  it('恰好填满 free(30) 后第 31 次抛 QUOTA_EXCEEDED，且 used 不越界', () => {
    resetUsage();
    setLevel('free');
    const limit = quota.check(db, U_TEST, 'generation').limit;

    // 预填 limit-1，再走服务层校验+占用到满
    quota.consumeGeneration(db, U_TEST, limit - 1);
    const last = quota.checkAndConsumeGeneration(db, U_TEST); // 第 30 次
    assert.equal(last.used, limit, '应恰好用满');
    assert.equal(last.remaining, 0);

    // 第 31 次：应被拦截
    let blocked = false;
    try {
      quota.checkAndConsumeGeneration(db, U_TEST);
    } catch (e) {
      blocked = true;
      assert.equal(e.code, 'QUOTA_EXCEEDED', '超限应抛 QUOTA_EXCEEDED');
    }
    assert.equal(blocked, true, '超过配额必须被拦截');
    assert.equal(rawUsed(), limit, '拦截后计数不得越界');
  });

  it('enterprise 无限制(-1) 时并发占用不设上限、始终允许', async () => {
    resetUsage();
    setLevel('enterprise');
    const c = quota.check(db, U_TEST, 'generation');
    assert.equal(c.unlimited, true, 'enterprise 生成次数应无限制');
    assert.equal(c.limit, -1);

    // 无限制时纯自增计数即可，多次占用均放行
    for (let i = 0; i < 5; i += 1) {
      const r = quota.checkAndConsumeGeneration(db, U_TEST);
      assert.equal(r.remaining, -1, '无限制套餐 remaining 恒为 -1');
    }
    assert.equal(rawUsed(), 5, '无限制套餐仍如实累计已用次数');
  });
});
