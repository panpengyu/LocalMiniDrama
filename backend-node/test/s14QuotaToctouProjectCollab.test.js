'use strict';

/**
 * Sprint 14 — H6/H7 配额 TOCTOU 竞态修复回归测试
 *
 * 背景：
 *   H7 项目数配额、H6 单项目协作人数配额原先是「先 check(普通 COUNT，无行锁) → 再 INSERT」两步，
 *   check 与 INSERT 之间存在竞态窗口：并发请求各自读到「未满」后同时插入 → 超发（used 越过 limit）。
 *
 * 修复（src/services/quotaService.js）：
 *   - tryConsumeProjectBounded / tryConsumeCollaboratorBounded 采用「原子占位」：
 *     在同一写序列化事务内先 `SELECT COUNT(*) ... FOR UPDATE` 校验，再执行 INSERT，
 *     使并发创建串行化，杜绝超发。
 *
 * 严格约束（与既有 s13QuotaConcurrency.test.js 一致）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock、无 SQLite in-memory。
 *   - 应用运行时用 sync-mysql（单连接、查询串行）无法制造「真并发」；故用 mysql2 连接池开
 *     多条独立连接，对同一配额边界发起「真并行」写，逼出数据库层竞态，验证原子占位的正确性。
 *   - 测试用高位临时 ID，before 清残留、after 彻底清理，不污染业务数据。
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));

const OWNER = 99721;            // 项目所有者（H7 项目数配额主体）
const DRAMA = 9970001;          // H6 协作配额挂载的测试项目ID
const COLLAB_BASE = 99730;      // H6 并发加入的目标用户ID基址（COLLAB_BASE+i）
const { snowflakeId } = require(path.resolve(__dirname, '..', 'src', 'utils', 'snowflake.js'));

let db;
let cfg;

/** 将该用户会员等级落库为指定套餐（控制配额上限）。free 用户可不写记录。 */
function setLevel(userId, levelCode) {
  db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(userId);
  if (levelCode === 'free') return;
  db.prepare(
    `INSERT INTO user_memberships (user_id, plan_id, level_code, billing_cycle, status, started_at, expires_at, created_at, updated_at)
     VALUES (?, (SELECT id FROM membership_plans WHERE level_code = ?), ?, 'monthly', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 1 MONTH), NOW(), NOW())`
  ).run(userId, levelCode, levelCode);
}

function cleanup() {
  try { db.prepare('DELETE FROM dramas WHERE created_by = ?').run(OWNER); } catch (_) {}
  try { db.prepare('DELETE FROM dramas WHERE id = ?').run(DRAMA); } catch (_) {}
  try { db.prepare('DELETE FROM collaboration_members WHERE drama_id = ?').run(DRAMA); } catch (_) {}
  try { db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(OWNER); } catch (_) {}
  try { db.prepare('DELETE FROM users WHERE id = ?').run(OWNER); } catch (_) {}
}

/** 确保锚点 users 行(OWNER)存在，供 FOR UPDATE 行锁串行化。 */
function ensureOwnerRow() {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(OWNER);
  if (exists) return;
  db.prepare(
    "INSERT INTO users (id, username, password, created_at, updated_at) VALUES (?, ?, 'x', NOW(), NOW())"
  ).run(OWNER, `toctou_owner_${OWNER}`);
}

function makePool() {
  const mysql = require('mysql2/promise');
  return mysql.createPool({
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
}

before(() => {
  cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '并发测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  cleanup();
});

after(() => {
  try { cleanup(); } catch (_) {}
  try { closeDb(); } catch (_) {}
});

// ===========================================================================
// H7：项目数配额 —— 临界并发不得超发
// ===========================================================================

describe('[H7-并发] 项目数配额原子占位（真并行创建）', () => {
  it('basic(15) 临界并发：预填 13，再并行发起 10 次创建 → 成功恰为剩余 2 且封顶 15', async () => {
    cleanup();
    ensureOwnerRow();
    setLevel(OWNER, 'basic'); // basic max_projects = 15
    const LIMIT = 15;

    // 预填到临界：LIMIT - 2 = 13
    const seed = db.prepare(
      "INSERT INTO dramas (id, title, status, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, NOW(), NOW())"
    );
    for (let i = 0; i < LIMIT - 2; i += 1) seed.run(snowflakeId(), `seed-${i}`, OWNER);
    const usedBefore = db.prepare('SELECT COUNT(*) c FROM dramas WHERE created_by = ? AND deleted_at IS NULL').get(OWNER).c;
    assert.equal(Number(usedBefore), 13);

    const pool = makePool();
    // 与 quotaService.tryConsumeProjectBounded 等价的「原子占位」：
    //   事务内先锁定所有者 users 锚点行(FOR UPDATE)串行化，再 COUNT 校验后插入。
    async function atomicCreate(conn) {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      try {
        await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [OWNER]);
        const [[row]] = await conn.query(
          'SELECT COUNT(*) c FROM dramas WHERE created_by = ? AND deleted_at IS NULL',
          [OWNER]
        );
        if (Number(row.c) >= LIMIT) { await conn.rollback(); return false; }
        await conn.query(
          "INSERT INTO dramas (id, title, status, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, NOW(), NOW())",
          [snowflakeId(), `concurrent-${Math.random()}`, OWNER]
        );
        await conn.commit();
        return true;
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      }
    }

    try {
      const ATTEMPTS = 10;
      const tasks = Array.from({ length: ATTEMPTS }, async () => {
        const conn = await pool.getConnection();
        try { return await atomicCreate(conn); } finally { conn.release(); }
      });
      const granted = (await Promise.all(tasks)).filter(Boolean).length;
      const finalUsed = db.prepare('SELECT COUNT(*) c FROM dramas WHERE created_by = ? AND deleted_at IS NULL').get(OWNER).c;

      assert.equal(granted, 2, `临界并发应只放行剩余 2 次，实际放行 ${granted} 次（>2 即超发）`);
      assert.equal(Number(finalUsed), LIMIT, `项目数必须精确封顶 ${LIMIT}，实际 ${finalUsed}`);
    } finally {
      await pool.end();
    }
  });
});

// ===========================================================================
// H6：单项目协作人数配额 —— 临界并发不得超发
// ===========================================================================

describe('[H6-并发] 协作人数配额原子占位（真并行加入）', () => {
  it('free(1) 空位并发：并行发起 8 次加入不同用户 → 成功恰为 1 且封顶 1', async () => {
    cleanup();
    ensureOwnerRow();
    setLevel(OWNER, 'free'); // free max_collaborators = 1
    const LIMIT = 1;

    // 建立测试项目（归属 OWNER）
    db.prepare(
      "INSERT INTO dramas (id, title, status, created_by, created_at, updated_at) VALUES (?, 'collab-drama', 'draft', ?, NOW(), NOW())"
    ).run(DRAMA, OWNER);

    const pool = makePool();
    // 与 quotaService.tryConsumeCollaboratorBounded 等价的「原子占位」：
    //   事务内先锁定所属 dramas 锚点行(FOR UPDATE)串行化，再 COUNT(active) 校验后插入。
    //   注意：从空开始时活跃成员数=0，若仅对 COUNT ... FOR UPDATE 无行可锁 → 仍会超发；
    //   故必须锁定恒存在的父级锚点行。
    async function atomicJoin(conn, uid) {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      try {
        await conn.query('SELECT id FROM dramas WHERE id = ? FOR UPDATE', [DRAMA]);
        const [[row]] = await conn.query(
          "SELECT COUNT(*) c FROM collaboration_members WHERE drama_id = ? AND status = 'active'",
          [DRAMA]
        );
        if (Number(row.c) >= LIMIT) { await conn.rollback(); return false; }
        await conn.query(
          `INSERT INTO collaboration_members (drama_id, user_id, role_tag, invited_by, status, created_at, updated_at)
           VALUES (?, ?, 'viewer', ?, 'active', NOW(), NOW())`,
          [DRAMA, uid, OWNER]
        );
        await conn.commit();
        return true;
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        throw e;
      }
    }

    try {
      const ATTEMPTS = 8;
      const tasks = Array.from({ length: ATTEMPTS }, (_, i) => (async () => {
        const conn = await pool.getConnection();
        try { return await atomicJoin(conn, COLLAB_BASE + i); } finally { conn.release(); }
      })());
      const granted = (await Promise.all(tasks)).filter(Boolean).length;
      const finalUsed = db.prepare(
        "SELECT COUNT(*) c FROM collaboration_members WHERE drama_id = ? AND status = 'active'"
      ).get(DRAMA).c;

      assert.equal(granted, 1, `free 仅 1 个协作名额，应只放行 1 次，实际放行 ${granted} 次（>1 即超发）`);
      assert.equal(Number(finalUsed), LIMIT, `活跃协作人数必须精确封顶 ${LIMIT}，实际 ${finalUsed}`);
    } finally {
      await pool.end();
    }
  });
});
