/**
 * Sprint 11 - 协作核心服务
 *
 * 汇集以下任务的服务端逻辑：
 *   S11-T02 协作权限管理：项目共享 + 角色分工(编剧/美术/剪辑/审核) + 操作能力判定
 *   S11-T04 操作锁定与冲突解决：节点级编辑锁(互斥 + 心跳续约 + 过期回收 + 乐观版本号)
 *   S11-T05 协作通知系统：成员加入/修改/评论 通知落库
 *   S11-T08 协作记录审计：操作历史落库 + 多维查询
 *
 * 所有数据落地本地 MySQL（node_locks / collaboration_members / collaboration_notifications /
 * collaboration_activities 五张表由 migration 44 创建）。无任何 mock 数据。
 */

'use strict';

// ---------------------------------------------------------------------------
// 协作角色分工定义（S11-T02）
// ---------------------------------------------------------------------------

/**
 * 协作角色 → 可操作能力集合。
 * 能力粒度：
 *   view      查看画布
 *   edit_script   编辑剧本/大纲/分集
 *   edit_art      编辑角色/场景/道具(美术资产)
 *   edit_edit     编辑分镜/时间轴/剪辑
 *   review        审核/评论
 *   manage        管理协作成员/版本回退(仅所有者)
 */
const ROLE_CAPABILITIES = {
  owner: ['view', 'edit_script', 'edit_art', 'edit_edit', 'review', 'manage'],
  screenwriter: ['view', 'edit_script', 'review'],
  artist: ['view', 'edit_art', 'review'],
  editor: ['view', 'edit_edit', 'review'],
  reviewer: ['view', 'review'],
  viewer: ['view'],
};

const VALID_ROLE_TAGS = Object.keys(ROLE_CAPABILITIES);

/** 节点键(type:id) → 编辑该节点所需能力 */
const NODE_TYPE_CAPABILITY = {
  character: 'edit_art',
  scene: 'edit_art',
  prop: 'edit_art',
  script: 'edit_script',
  episode: 'edit_script',
  outline: 'edit_script',
  storyboard: 'edit_edit',
  timeline: 'edit_edit',
  audio: 'edit_edit',
};

// 锁默认存活时长（毫秒）：心跳续约周期建议 30s，过期时长设为 90s 容错
const LOCK_TTL_MS = 90 * 1000;
// 锁过期时长（秒），用于 MySQL DATE_ADD(NOW(), INTERVAL ? SECOND) 表达式
const LOCK_TTL_SECONDS = Math.round(LOCK_TTL_MS / 1000);

// 说明：锁的过期判定完全交给数据库时钟处理（NOW() / DATE_ADD(NOW(), INTERVAL ...)），
// 避免 Node 进程 UTC 时间与 MySQL 会话时区(SYSTEM/本地时区)不一致导致的时间偏移。

// ===========================================================================
// S11-T02 协作成员管理
// ===========================================================================

/**
 * 添加/更新协作成员（幂等：已存在则更新角色与状态）。
 * @returns {object} 成员行
 */
function addMember(db, dramaId, userId, roleTag, invitedBy) {
  const id = Number(dramaId);
  const uid = Number(userId);
  const tag = VALID_ROLE_TAGS.includes(roleTag) ? roleTag : 'viewer';
  const existing = db.prepare(
    'SELECT * FROM collaboration_members WHERE drama_id = ? AND user_id = ?'
  ).get(id, uid);
  if (existing) {
    db.prepare(
      'UPDATE collaboration_members SET role_tag = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(tag, 'active', existing.id);
    return getMember(db, id, uid);
  }
  db.prepare(`
    INSERT INTO collaboration_members (drama_id, user_id, role_tag, invited_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, uid, tag, invitedBy != null ? Number(invitedBy) : null);
  return getMember(db, id, uid);
}

/** 移除协作成员（软移除：status=removed，同时释放其持有的锁）。 */
function removeMember(db, dramaId, userId) {
  const id = Number(dramaId);
  const uid = Number(userId);
  const res = db.prepare(
    "UPDATE collaboration_members SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE drama_id = ? AND user_id = ?"
  ).run(id, uid);
  // 释放该成员在此项目的全部锁
  db.prepare('DELETE FROM node_locks WHERE drama_id = ? AND locked_by = ?').run(id, uid);
  return res.changes > 0;
}

/** 获取单个成员（含关联用户名）。 */
function getMember(db, dramaId, userId) {
  return db.prepare(`
    SELECT cm.*, u.username AS user_name
    FROM collaboration_members cm
    LEFT JOIN users u ON u.id = cm.user_id
    WHERE cm.drama_id = ? AND cm.user_id = ?
  `).get(Number(dramaId), Number(userId));
}

/** 列出项目协作成员（默认仅 active）。 */
function listMembers(db, dramaId, includeRemoved = false) {
  const sql = `
    SELECT cm.*, u.username AS user_name
    FROM collaboration_members cm
    LEFT JOIN users u ON u.id = cm.user_id
    WHERE cm.drama_id = ?${includeRemoved ? '' : " AND cm.status = 'active'"}
    ORDER BY cm.created_at ASC
  `;
  return db.prepare(sql).all(Number(dramaId)) || [];
}

/**
 * 判断用户对项目的有效协作角色。
 * 优先级：项目创建者(created_by) → owner；显式协作成员 → 其 role_tag；否则 null。
 */
function resolveRole(db, dramaId, user) {
  if (!user) return null;
  const drama = db.prepare('SELECT created_by FROM dramas WHERE id = ?').get(Number(dramaId));
  if (drama && Number(drama.created_by) === Number(user.id)) return 'owner';
  if (user.role === 'super_admin') return 'owner';
  const member = db.prepare(
    "SELECT role_tag FROM collaboration_members WHERE drama_id = ? AND user_id = ? AND status = 'active'"
  ).get(Number(dramaId), Number(user.id));
  return member ? member.role_tag : null;
}

/** 判断某角色是否具备指定能力。 */
function roleHasCapability(roleTag, capability) {
  const caps = ROLE_CAPABILITIES[roleTag];
  return !!caps && caps.includes(capability);
}

/** 判断用户能否编辑指定节点（结合角色分工 + 节点类型）。 */
function canEditNode(db, dramaId, user, nodeKey) {
  const roleTag = resolveRole(db, dramaId, user);
  if (!roleTag) return false;
  const nodeType = String(nodeKey || '').split(':')[0];
  const needed = NODE_TYPE_CAPABILITY[nodeType] || 'edit_edit';
  return roleHasCapability(roleTag, needed) || roleHasCapability(roleTag, 'manage');
}

// ===========================================================================
// S11-T04 节点锁 + 冲突解决
// ===========================================================================

/** 清理过期锁（懒回收：任何加锁/查询前调用）。使用数据库时钟避免时区偏移。 */
function reapExpiredLocks(db, dramaId) {
  db.prepare('DELETE FROM node_locks WHERE drama_id = ? AND expires_at < NOW()')
    .run(Number(dramaId));
}

/**
 * 尝试对节点加锁（互斥）。
 * @returns {object} { ok, lock, conflict } —— ok=false 时 conflict 为当前持有者信息
 */
function acquireLock(db, dramaId, nodeKey, user, socketId) {
  const id = Number(dramaId);
  reapExpiredLocks(db, id);
  const uid = Number(user.id);
  const existing = db.prepare(
    'SELECT * FROM node_locks WHERE drama_id = ? AND node_key = ?'
  ).get(id, nodeKey);

  if (existing) {
    if (Number(existing.locked_by) === uid) {
      // 重入：续约（过期时间以数据库时钟为准）
      db.prepare('UPDATE node_locks SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), socket_id = ? WHERE id = ?')
        .run(LOCK_TTL_SECONDS, socketId || existing.socket_id, existing.id);
      const renewed = db.prepare('SELECT * FROM node_locks WHERE id = ?').get(existing.id);
      return { ok: true, lock: renewed || existing, reentrant: true };
    }
    return { ok: false, conflict: { locked_by: existing.locked_by, locked_by_name: existing.locked_by_name, expires_at: existing.expires_at } };
  }

  try {
    const res = db.prepare(`
      INSERT INTO node_locks (drama_id, node_key, locked_by, locked_by_name, socket_id, version, acquired_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 0, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
    `).run(id, nodeKey, uid, user.username || user.name || null, socketId || null, LOCK_TTL_SECONDS);
    return { ok: true, lock: { id: res.lastInsertRowid, drama_id: id, node_key: nodeKey, locked_by: uid } };
  } catch (err) {
    // 并发下 UNIQUE 冲突 → 视为已被他人锁定
    const conflict = db.prepare('SELECT * FROM node_locks WHERE drama_id = ? AND node_key = ?').get(id, nodeKey);
    return { ok: false, conflict: conflict ? { locked_by: conflict.locked_by, locked_by_name: conflict.locked_by_name } : null };
  }
}

/** 心跳续约（延长锁过期时间，以数据库时钟为准）。 */
function renewLock(db, dramaId, nodeKey, user) {
  const res = db.prepare(
    'UPDATE node_locks SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE drama_id = ? AND node_key = ? AND locked_by = ?'
  ).run(LOCK_TTL_SECONDS, Number(dramaId), nodeKey, Number(user.id));
  return res.changes > 0;
}

/** 释放锁（仅持有者可释放；super_admin/owner 可强制释放）。 */
function releaseLock(db, dramaId, nodeKey, user, force = false) {
  const id = Number(dramaId);
  if (force) {
    const res = db.prepare('DELETE FROM node_locks WHERE drama_id = ? AND node_key = ?').run(id, nodeKey);
    return res.changes > 0;
  }
  const res = db.prepare(
    'DELETE FROM node_locks WHERE drama_id = ? AND node_key = ? AND locked_by = ?'
  ).run(id, nodeKey, Number(user.id));
  return res.changes > 0;
}

/** 释放某 socket 断连时持有的全部锁（连接断开清理）。 */
function releaseLocksBySocket(db, socketId) {
  if (!socketId) return 0;
  const res = db.prepare('DELETE FROM node_locks WHERE socket_id = ?').run(socketId);
  return res.changes || 0;
}

/** 列出项目当前活跃锁。 */
function listLocks(db, dramaId) {
  reapExpiredLocks(db, Number(dramaId));
  return db.prepare('SELECT * FROM node_locks WHERE drama_id = ? ORDER BY acquired_at ASC').all(Number(dramaId)) || [];
}

/**
 * S11-T04 冲突解决（CRDT / 乐观版本号 LWW 策略）。
 *
 * 采用「基于逻辑版本号 + 最后写入者胜出(Last-Writer-Wins)」的收敛策略：
 *   - 每次成功变更使节点 version 单调递增
 *   - 客户端提交变更时携带其 baseVersion（读到的版本）
 *   - 若 baseVersion == 当前 version → 无冲突，接受并 version+1
 *   - 若 baseVersion <  当前 version → 存在并发写，按 LWW：以服务端较新版本为准，
 *     返回 conflict + 最新版本，令客户端 rebase（前端合并非冲突字段）
 *
 * 此策略与 CRDT 的收敛性一致：所有副本最终收敛到相同的最高版本状态。
 *
 * @returns {object} { accepted, version, conflict, serverVersion }
 */
function resolveConflict(db, dramaId, nodeKey, baseVersion, user) {
  const id = Number(dramaId);
  const lock = db.prepare('SELECT * FROM node_locks WHERE drama_id = ? AND node_key = ?').get(id, nodeKey);
  const serverVersion = lock ? Number(lock.version) : 0;
  const base = Number(baseVersion) || 0;

  if (base >= serverVersion) {
    const nextVersion = serverVersion + 1;
    if (lock) {
      db.prepare('UPDATE node_locks SET version = ? WHERE id = ?').run(nextVersion, lock.id);
    }
    return { accepted: true, version: nextVersion, serverVersion };
  }
  // 落后于服务端 → 冲突，令客户端 rebase 到 serverVersion
  return { accepted: false, conflict: true, serverVersion, version: serverVersion };
}

// ===========================================================================
// S11-T08 协作审计
// ===========================================================================

/**
 * 记录一条协作操作审计。
 * @param {object} entry { dramaId, userId, userName, actionType, targetKey, detail, socketId }
 */
function recordActivity(db, entry) {
  const detailStr = entry.detail != null
    ? (typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail))
    : null;
  const res = db.prepare(`
    INSERT INTO collaboration_activities
      (drama_id, user_id, user_name, action_type, target_key, detail, socket_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    Number(entry.dramaId), Number(entry.userId), entry.userName || null,
    entry.actionType, entry.targetKey || null, detailStr, entry.socketId || null
  );
  return res.lastInsertRowid;
}

/**
 * 查询审计记录，支持按 时间区间 / 成员 / 操作类型 过滤。
 * @param {object} filter { dramaId, userId, actionType, startTime, endTime, limit }
 */
function queryActivities(db, filter = {}) {
  const clauses = ['drama_id = ?'];
  const params = [Number(filter.dramaId)];
  if (filter.userId != null) { clauses.push('user_id = ?'); params.push(Number(filter.userId)); }
  if (filter.actionType) { clauses.push('action_type = ?'); params.push(filter.actionType); }
  if (filter.startTime) { clauses.push('created_at >= ?'); params.push(filter.startTime); }
  if (filter.endTime) { clauses.push('created_at <= ?'); params.push(filter.endTime); }
  const limit = Number(filter.limit) || 200;
  params.push(limit);
  const sql = `
    SELECT * FROM collaboration_activities
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params) || [];
}

// ===========================================================================
// S11-T05 协作通知
// ===========================================================================

/**
 * 向指定接收者创建一条通知。
 * @param {object} n { dramaId, recipientId, actorId, actorName, type, title, content, payload }
 */
function createNotification(db, n) {
  const payloadStr = n.payload != null
    ? (typeof n.payload === 'string' ? n.payload : JSON.stringify(n.payload))
    : null;
  const res = db.prepare(`
    INSERT INTO collaboration_notifications
      (drama_id, recipient_id, actor_id, actor_name, type, title, content, payload, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
  `).run(
    Number(n.dramaId), Number(n.recipientId),
    n.actorId != null ? Number(n.actorId) : null, n.actorName || null,
    n.type || 'node_change', n.title || null, n.content || null, payloadStr
  );
  return res.lastInsertRowid;
}

/**
 * 向项目全体活跃协作成员广播通知（可排除某个 actor 自己）。
 * @returns {number[]} 生成的通知ID列表
 */
function notifyMembers(db, dramaId, n, excludeUserId) {
  const members = listMembers(db, dramaId);
  // 项目创建者也应收到（若不在成员表）
  const drama = db.prepare('SELECT created_by FROM dramas WHERE id = ?').get(Number(dramaId));
  const recipientIds = new Set(members.map((m) => Number(m.user_id)));
  if (drama && drama.created_by != null) recipientIds.add(Number(drama.created_by));
  if (excludeUserId != null) recipientIds.delete(Number(excludeUserId));

  const ids = [];
  for (const rid of recipientIds) {
    ids.push(createNotification(db, { ...n, dramaId, recipientId: rid }));
  }
  return ids;
}

/** 列出用户通知（可仅未读）。 */
function listNotifications(db, recipientId, onlyUnread = false, limit = 100) {
  const sql = `
    SELECT * FROM collaboration_notifications
    WHERE recipient_id = ?${onlyUnread ? ' AND is_read = 0' : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(Number(recipientId), Number(limit) || 100) || [];
}

/** 标记通知已读（单条或全部）。 */
function markNotificationRead(db, recipientId, notificationId) {
  if (notificationId != null) {
    const res = db.prepare(
      'UPDATE collaboration_notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?'
    ).run(Number(notificationId), Number(recipientId));
    return res.changes;
  }
  const res = db.prepare(
    'UPDATE collaboration_notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0'
  ).run(Number(recipientId));
  return res.changes;
}

module.exports = {
  // 常量
  ROLE_CAPABILITIES,
  VALID_ROLE_TAGS,
  NODE_TYPE_CAPABILITY,
  LOCK_TTL_MS,
  // S11-T02
  addMember,
  removeMember,
  getMember,
  listMembers,
  resolveRole,
  roleHasCapability,
  canEditNode,
  // S11-T04
  reapExpiredLocks,
  acquireLock,
  renewLock,
  releaseLock,
  releaseLocksBySocket,
  listLocks,
  resolveConflict,
  // S11-T08
  recordActivity,
  queryActivities,
  // S11-T05
  createNotification,
  notifyMembers,
  listNotifications,
  markNotificationRead,
};
