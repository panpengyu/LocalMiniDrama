'use strict';

/**
 * 通用「原子占位」工具（TOCTOU 竞态防护）
 *
 * 背景 / 动机：
 *   典型的「配额/名额」写入常写成三步——读取当前用量 → 校验是否超限 → 插入新行。
 *   在多连接 / 多实例并发下，「读」与「写」之间存在时间窗口（TOCTOU：Time-Of-Check-To-Time-Of-Use），
 *   多个请求都读到「未满」后同时插入 → 超发（used 越过 limit）。
 *
 * 本工具把「读计数 → 校验 → 写行」合并进单个「写序列化事务」，从根上消除该窗口：
 *   - SQLite(better-sqlite3)：transaction(fn).immediate() —— BEGIN IMMEDIATE 立即占据库级写锁，
 *     其它写者在本事务 COMMIT 前无法写入，故 COUNT 与随后 INSERT 之间不会有并发穿插。
 *   - MySQL：事务内先对「必然存在的父级锚点行」加 FOR UPDATE 行锁实现真串行化（见 lockAnchor 说明），
 *     再执行 COUNT 校验 + 写行。
 *
 * ★ 关键陷阱（务必理解）：
 *   不能只对 `SELECT COUNT(*) ... FOR UPDATE` 加锁。当满足条件的子行数为 0（如从空开始新建 /
 *   项目的首个协作者）时，没有任何现有行可被 FOR UPDATE 锁住，并发事务都读到 0 → 全部插入 → 超发。
 *   因此 MySQL 侧必须锁定一条「恒存在的父级锚点行」（如项目→其所有者 users 行；协作→其所属 dramas 行），
 *   使同一配额边界上的并发写入被该行锁串行化，无论子行数是否为 0。SQLite 由 BEGIN IMMEDIATE 天然覆盖。
 *
 * 设计取向：
 *   已用量以「真实业务表行数」为唯一事实来源（不引入影子计数表），避免与真实行数漂移
 *   （软删除 / 成员移除 / 后台修改）。因此本工具面向「COUNT 型累计配额」，不负责周期型计数
 *   （如每月生成次数——那类用条件 UPDATE 计数行更合适，见 quotaService.tryConsumeGenerationBounded）。
 */

/**
 * 在「写序列化事务」中执行回调 fn。
 * @param {object}   db 统一 DB 包装实例（含 type / transaction）
 * @param {function} fn 事务体（同步函数；抛错自动回滚）
 * @returns {*} fn 的返回值
 */
function runWriteSerialized(db, fn) {
  if (!db || typeof db.transaction !== 'function') return fn();
  if (db.type === 'sqlite') {
    const txn = db.transaction(fn);
    return typeof txn.immediate === 'function' ? txn.immediate() : txn();
  }
  return db.transaction(fn)();
}

/**
 * MySQL：对「必然存在的锚点行」加 FOR UPDATE 行锁以实现真串行化（覆盖 used=0 场景）。
 * SQLite 无需锚点（BEGIN IMMEDIATE 已是库级写锁），此函数对 SQLite 为 no-op。
 *
 * @param {object} db    统一 DB 包装实例
 * @param {string} table 锚点表名（调用方保证为可信的固定字面量，不可来自外部输入）
 * @param {number|string} id 锚点行主键 id
 * @param {string} [pk='id'] 锚点主键列名（默认 id）
 */
function lockAnchorMysql(db, table, id, pk = 'id') {
  if (!db || db.type !== 'mysql') return;
  if (id == null) return;
  // table/pk 由调用方以固定字面量传入（非用户输入），此处不做 SQL 拼接来自外部的风险规避交由调用方。
  db.prepare(`SELECT ${pk} FROM ${table} WHERE ${pk} = ? FOR UPDATE`).get(id);
}

/**
 * 通用「原子占位」：在写序列化事务内完成「(可选)锚点锁 → 判定是否占额 → 计数校验 → 执行写入」。
 *
 * @param {object} opts
 * @param {object}   opts.db            统一 DB 包装实例（必填）
 * @param {number}   opts.limit         配额上限；<0 表示无限制（不加守卫直接执行 mutate）
 * @param {function} opts.count         事务内执行，返回当前已用量(number)。必填。
 * @param {function} opts.mutate        事务内执行的实际写入回调，返回值透传到 result。必填。
 * @param {object}   [opts.anchor]      MySQL 锚点行：{ table, id, pk? }。强烈建议提供以覆盖 used=0 并发。
 * @param {function} [opts.consumesSeat] 事务内执行，返回本次操作是否占用一个新名额(boolean)。
 *                                       缺省视为 true（总是占额）。返回 false 时跳过上限校验直接执行 mutate
 *                                       （用于幂等更新：如已存在成员改角色不占新名额）。
 * @returns {{ ok:boolean, used:number, limit:number, result?:any }}
 *          ok=false 表示已达上限（未写入）；ok=true 时 result 为 mutate 返回值。
 *          used=-1 表示无限制或本次不占额（未做精确计数）。
 */
function tryConsumeBounded(opts) {
  const { db, limit, count, mutate, anchor, consumesSeat } = opts || {};
  if (!db) throw new Error('atomicQuota.tryConsumeBounded: 缺少 db');
  if (typeof count !== 'function') throw new Error('atomicQuota.tryConsumeBounded: count 必须为函数');
  if (typeof mutate !== 'function') throw new Error('atomicQuota.tryConsumeBounded: mutate 必须为函数');

  const lim = Number(limit);
  // 无限制：直接执行，无需事务守卫
  if (!Number.isFinite(lim) || lim < 0) {
    return { ok: true, used: -1, limit: -1, result: mutate() };
  }

  return runWriteSerialized(db, () => {
    if (anchor && anchor.table != null && anchor.id != null) {
      lockAnchorMysql(db, anchor.table, anchor.id, anchor.pk || 'id');
    }
    // 本次是否占用新名额（缺省 true）；不占额则跳过上限校验，直接执行 mutate（幂等更新语义）
    const seat = typeof consumesSeat === 'function' ? consumesSeat() : true;
    if (!seat) {
      return { ok: true, used: -1, limit: lim, result: mutate() };
    }
    const used = Number(count()) || 0;
    if (used >= lim) {
      return { ok: false, used, limit: lim };
    }
    const result = mutate();
    return { ok: true, used: used + 1, limit: lim, result };
  });
}

module.exports = {
  runWriteSerialized,
  lockAnchorMysql,
  tryConsumeBounded,
};
