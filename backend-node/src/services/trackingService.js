'use strict';

/**
 * Sprint 18 - S18-T01 事件埋点系统
 *
 * 基于 tracking_events 表（迁移 58_s18_ops.sql）提供：
 *   - track()       单条事件落库（雪花 ID 主键）
 *   - batchTrack()  批量落库（前端 SDK 批量上报，事务包裹）
 *   - rateLimited() 防刷限流（时间窗口内同维度计数，超限拒绝）
 *   - stats()       管理端聚合统计（事件总量 / 独立用户 / 事件分布 / 每日趋势）
 *   - listEvents()  管理端事件明细查询（分页 + 多条件筛选）
 *   - cleanupOld()  过期事件清理（避免表无限膨胀）
 *
 * 无 mock：所有事件真实写入 MySQL localminidrama.tracking_events。
 */

const { snowflakeId } = require('../utils/snowflake');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH = 200; // 单次批量上报上限
const MAX_EVENT_LEN = 64;
const MAX_CATEGORY_LEN = 32;
const MAX_PAGE_LEN = 128;
const MAX_ANON_LEN = 64;
const MAX_IP_LEN = 64;
const MAX_ATTRS_BYTES = 8192;

function dateExpr(db, col = 'created_at') {
  return db.type === 'mysql'
    ? `DATE_FORMAT(${col}, '%Y-%m-%d')`
    : `strftime('%Y-%m-%d', ${col})`;
}

function safeGet(db, sql, ...params) {
  try { return db.prepare(sql).get(...params); } catch (_) { return null; }
}
function safeAll(db, sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch (_) { return []; }
}

function normalizeAttrs(attrs) {
  if (attrs == null) return null;
  let s = typeof attrs === 'string' ? attrs : JSON.stringify(attrs);
  if (!s || s === 'null') return null;
  if (s.length > MAX_ATTRS_BYTES) s = s.slice(0, MAX_ATTRS_BYTES);
  return s;
}

const INSERT_SQL =
  `INSERT INTO tracking_events
     (id, user_id, anonymous_id, event, category, page, attrs, ip, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * 单条事件插入（内部复用）。event 缺失返回 null；成功返回雪花 ID。
 * 说明：MySQL 显式指定主键时 LAST_INSERT_ID() 为 0，故直接返回生成的 id。
 */
function insertOne(db, ev, defaults) {
  const name = ev.event && String(ev.event).trim().slice(0, MAX_EVENT_LEN);
  if (!name) return null;
  const id = snowflakeId();
  const ts = ev.ts ? new Date(Number(ev.ts)).toISOString() : new Date().toISOString();
  db.prepare(INSERT_SQL).run(
    id,
    ev.userId != null && ev.userId !== '' ? Number(ev.userId) : defaults.userId,
    ev.anonymousId ? String(ev.anonymousId).slice(0, MAX_ANON_LEN) : defaults.anonymousId,
    name,
    ev.category ? String(ev.category).slice(0, MAX_CATEGORY_LEN) : defaults.category,
    ev.page ? String(ev.page).slice(0, MAX_PAGE_LEN) : defaults.page,
    normalizeAttrs(ev.attrs),
    ev.ip ? String(ev.ip).slice(0, MAX_IP_LEN) : defaults.ip,
    ts
  );
  return id;
}

/**
 * 单条事件落库。
 * @param {object} ev { userId, anonymousId, event, category, page, attrs, ip, ts }
 * @returns {number|null} 事件 ID；event 缺失时返回 null
 */
function track(db, log, ev = {}) {
  const defaults = {
    userId: null,
    anonymousId: null,
    category: null,
    page: null,
    ip: ev.ip ? String(ev.ip).slice(0, MAX_IP_LEN) : null,
  };
  return insertOne(db, ev, defaults);
}

/**
 * 批量事件落库（事务包裹，数据异常不阻断主流程）。
 * @param {Array} events 事件数组，元素为 track() 入参（可省略 userId/anonymousId 等）
 * @param {object} opts 批量默认值 { userId, anonymousId, category, page, ip }
 * @returns {{received:number, inserted:number}}
 */
function batchTrack(db, log, events = [], opts = {}) {
  const list = Array.isArray(events) ? events.slice(0, MAX_BATCH) : [];
  if (!list.length) return { received: 0, inserted: 0 };
  const defaults = {
    userId: opts.userId != null && opts.userId !== '' ? Number(opts.userId) : null,
    anonymousId: opts.anonymousId ? String(opts.anonymousId).slice(0, MAX_ANON_LEN) : null,
    category: opts.category || null,
    page: opts.page || null,
    ip: opts.ip ? String(opts.ip).slice(0, MAX_IP_LEN) : null,
  };
  let inserted = 0;
  try {
    db.transaction(() => {
      for (const ev of list) {
        if (!ev || typeof ev !== 'object') continue;
        if (insertOne(db, ev, defaults)) inserted++;
      }
    })();
  } catch (err) {
    if (log) log.warn('[S18-T01] 批量埋点落库失败', { error: err.message });
  }
  return { received: list.length, inserted };
}

/**
 * 防刷限流：统计时间窗口内同一维度（user 或 ip + event）的事件数，达到 max 返回 true。
 * @param {object} opts { userId, ip, event, windowMs, max }
 * @returns {boolean}
 */
function rateLimited(db, { userId = null, ip = null, event = null, windowMs = 1000, max = 5 } = {}) {
  if (!event || windowMs <= 0 || max <= 0) return false;
  const since = new Date(Date.now() - windowMs).toISOString();
  const where = [];
  const params = [];
  if (userId != null && userId !== '') {
    where.push('user_id = ?');
    params.push(Number(userId));
  } else if (ip) {
    where.push('ip = ?');
    params.push(String(ip));
  } else {
    return false;
  }
  where.push('event = ?');
  params.push(String(event));
  where.push('created_at >= ?');
  params.push(since);
  const row = safeGet(db, `SELECT COUNT(*) c FROM tracking_events WHERE ${where.join(' AND ')}`, ...params);
  return Number((row && row.c) || 0) >= max;
}

/**
 * 管理端聚合统计：事件总量 / 独立用户 / 事件分布 / 每日趋势。
 */
function stats(db, { days = 30, event = null } = {}) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const de = dateExpr(db);
  const where = ['created_at >= ?'];
  const params = [since];
  if (event) {
    where.push('event = ?');
    params.push(String(event));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totals = safeGet(
    db,
    `SELECT COUNT(*) total_events, COUNT(DISTINCT user_id) users FROM tracking_events ${whereSql}`,
    ...params
  ) || {};

  const byEvent = safeAll(
    db,
    `SELECT event, COUNT(*) c, COUNT(DISTINCT user_id) u
       FROM tracking_events ${whereSql} GROUP BY event ORDER BY c DESC LIMIT 50`,
    ...params
  ).map((r) => ({ event: r.event, count: Number(r.c) || 0, users: Number(r.u) || 0 }));

  const daily = safeAll(
    db,
    `SELECT ${de} d, COUNT(*) c, COUNT(DISTINCT COALESCE(user_id, anonymous_id)) u
       FROM tracking_events ${whereSql} GROUP BY ${de} ORDER BY d ASC`,
    ...params
  ).map((r) => ({ date: r.d, events: Number(r.c) || 0, users: Number(r.u) || 0 }));

  return {
    days,
    total_events: Number(totals.total_events) || 0,
    users: Number(totals.users) || 0,
    by_event: byEvent,
    daily,
  };
}

/**
 * 管理端事件明细查询（分页 + 关键字/事件/用户/时间筛选）。
 */
function listEvents(db, { keyword = null, event = null, userId = null, dateFrom = null, dateTo = null, page = 1, pageSize = 20 } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(event LIKE ? OR page LIKE ? OR anonymous_id LIKE ?)');
    const kw = `%${String(keyword)}%`;
    params.push(kw, kw, kw);
  }
  if (event) {
    where.push('event = ?');
    params.push(String(event));
  }
  if (userId != null && userId !== '') {
    where.push('user_id = ?');
    params.push(Number(userId));
  }
  if (dateFrom) {
    const s = String(dateFrom).includes('T') ? dateFrom : `${dateFrom}T00:00:00`;
    where.push('created_at >= ?');
    params.push(new Date(s).toISOString());
  }
  if (dateTo) {
    const s = String(dateTo).includes('T') ? dateTo : `${dateTo}T23:59:59`;
    where.push('created_at <= ?');
    params.push(new Date(s).toISOString());
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const totalRow = safeGet(db, `SELECT COUNT(*) c FROM tracking_events ${whereSql}`, ...params) || {};
  const rows = safeAll(
    db,
    `SELECT id, user_id, anonymous_id, event, category, page, attrs, ip, created_at
       FROM tracking_events ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, ps, (p - 1) * ps
  ) || [];
  return {
    page: p,
    pageSize: ps,
    total: Number(totalRow.c) || 0,
    items: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      anonymous_id: r.anonymous_id,
      event: r.event,
      category: r.category,
      page: r.page,
      attrs: r.attrs,
      ip: r.ip,
      created_at: r.created_at,
    })),
  };
}

/**
 * 过期事件清理（避免表无限膨胀）。
 */
function cleanupOld(db, log, { days = 180, limit = 50000 } = {}) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const info = db.prepare('DELETE FROM tracking_events WHERE created_at < ? LIMIT ?').run(cutoff, limit);
  const deleted = Number(info.changes || info.affectedRows || 0);
  return { cutoff, deleted };
}

module.exports = {
  track,
  batchTrack,
  rateLimited,
  stats,
  listEvents,
  cleanupOld,
};
