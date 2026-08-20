/**
 * 会话管理服务（S19-T04）
 * - 登录成功登记 user_sessions，JWT 携带 sid 关联会话
 * - 强制下线：revoke 单个会话或该用户全部会话（token_version+1 兜底）
 */
'use strict';

const { DEFAULT_PAGE_SIZE } = require('../constants/pagination');

const { snowflakeId } = require('../utils/snowflake');
const { mysqlNow, toMysql } = require('../utils/datetime');

const DEFAULT_TTL_DAYS = 7;

function normalizeDate(v) {
  return v ? new Date(v) : null;
}

/** 创建会话，返回 { id } */
function createSession(db, { userId, ip, userAgent, expiresAt }) {
  const id = snowflakeId();
  const now = mysqlNow();
  const expires = expiresAt || toMysql(new Date(Date.now() + DEFAULT_TTL_DAYS * 864e5));
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, ip, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, ip || null, userAgent ? String(userAgent).slice(0, 255) : null, expires, now);
  return { id };
}

function getSession(db, sid, userId) {
  return db.prepare('SELECT * FROM user_sessions WHERE id = ? AND user_id = ?').get(sid, userId);
}

/** 会话是否有效（存在、未 revoke、未过期） */
function isSessionValid(db, sid, userId) {
  if (!sid) return true; // 无 sid（历史 Token）默认放行，交由 token_version 兜底
  const row = getSession(db, sid, userId);
  if (!row) return false;
  if (row.revoked_at) return false;
  // 字符串比较（DATETIME 同格式同语义），避免驱动时区转换偏差
  if (row.expires_at && row.expires_at <= mysqlNow()) return false;
  return true;
}

/** 踢下线单个会话 */
function revokeSession(db, sid, userId) {
  const info = db.prepare(
    'UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
  ).run(mysqlNow(), sid, userId);
  return info.changes > 0;
}

/** 强制下线某用户全部会话（同时提升 token_version 使已签发 Token 失效） */
function revokeAllForUser(db, userId) {
  const now = mysqlNow();
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId);
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

/** 分页查询会话列表（支持按用户名/ID 关键字与是否在线筛选） */
function listSessions(db, { keyword, onlyActive, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(s.id LIKE ? OR u.username LIKE ? OR u.phone LIKE ? OR s.ip LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw);
  }
  if (onlyActive) {
    where.push('s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)');
    params.push(mysqlNow());
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id ${whereSql}`
  ).get(...params).c;
  const limit = Math.min(Number(pageSize) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const rows = db.prepare(
    `SELECT s.id, s.user_id, s.ip, s.user_agent, s.expires_at, s.revoked_at, s.created_at,
            u.username, u.phone, u.role, u.nickname
     FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id
     ${whereSql} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const nowSql = mysqlNow();
  return {
    total,
    page: Number(page) || 1,
    pageSize: limit,
    items: rows.map((r) => {
      const expires = normalizeDate(r.expires_at);
      const revoked = r.revoked_at ? normalizeDate(r.revoked_at) : null;
      // 字符串比较（DATETIME 同格式同语义），避免驱动时区转换偏差
      const online = !r.revoked_at && (!r.expires_at || r.expires_at > nowSql);
      return {
        id: String(r.id),
        userId: r.user_id,
        username: r.username,
        phone: r.phone,
        nickname: r.nickname,
        role: r.role,
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        online,
        duration: revoked ? Math.max(0, Math.floor((revoked.getTime() - new Date(r.created_at).getTime()) / 60000)) : null,
      };
    }),
  };
}

/** 清理过期/已下线会话，返回删除行数 */
function pruneExpired(db) {
  const info = db.prepare(
    'DELETE FROM user_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL'
  ).run(mysqlNow());
  return info.changes;
}

module.exports = {
  createSession,
  getSession,
  isSessionValid,
  revokeSession,
  revokeAllForUser,
  listSessions,
  pruneExpired,
};
