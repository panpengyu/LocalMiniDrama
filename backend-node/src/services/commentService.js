'use strict';

/**
 * Sprint 13 - S13-T06 评论批注系统（后端）
 *
 * 能力：
 *   - 画布节点评论：针对画布节点（node_key = type:id，如 character:12 / storyboard:88）或项目级（node_key=NULL）发表评论
 *   - 时间戳批注：timestamp_ms 记录分镜/时间轴上的毫秒定位，用于「按时间点」的批注
 *   - 线程回复：parent_id / root_id 支持多级回复聚合为一个讨论线程
 *   - @提及：解析正文中的 @username → comment_mentions；给被提及者定向通知（复用协作通知系统）
 *   - 已读未读：comment_reads 记录用户已读评论，计算项目/节点未读数
 *   - 批量回复：对多条评论一次性回复相同内容（如「已处理」），逐条建线程回复
 *   - 已解决状态：open / resolved，支持标记解决与重开
 *
 * 权限：评论读写基于 collaborationService 的项目协作角色（view 可读，comment/edit 可写）。
 * 依赖 Sprint 11 协作基础（成员、通知）。全部数据落地本地 MySQL，无 mock。
 */

const collaborationService = require('./collaborationService');

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

// ===========================================================================
// @提及解析
// ===========================================================================

/**
 * 从正文中解析 @提及的用户名，映射为项目内可见用户（协作成员 + 创建者）。
 * 仅接受确实存在且与该项目相关的用户，避免误 @ 无关账号。
 * @returns {Array<{id, username}>}
 */
function resolveMentions(db, dramaId, content) {
  const names = new Set();
  const re = /@([A-Za-z0-9_\u4e00-\u9fa5]{1,32})/g;
  let m;
  while ((m = re.exec(String(content || ''))) !== null) names.add(m[1]);
  if (names.size === 0) return [];

  // 项目相关用户集合：活跃协作成员 + 创建者
  const members = collaborationService.listMembers(db, dramaId) || [];
  const drama = db.prepare('SELECT created_by FROM dramas WHERE id = ?').get(Number(dramaId));
  const relatedIds = new Set(members.map((x) => Number(x.user_id)));
  if (drama && drama.created_by != null) relatedIds.add(Number(drama.created_by));
  if (relatedIds.size === 0) return [];

  const placeholders = Array.from(relatedIds).map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, username FROM users WHERE username IN (${Array.from(names).map(() => '?').join(',')})
       AND id IN (${placeholders})`
  ).all(...Array.from(names), ...Array.from(relatedIds));
  return rows || [];
}

// ===========================================================================
// 评论 CRUD
// ===========================================================================

/**
 * 发表评论 / 回复。
 * @param {object} opts { dramaId, nodeKey?, parentId?, authorId, authorName, content, timestampMs? }
 * @returns {object} 新评论行（含 mentions）
 */
function createComment(db, log, opts) {
  const dramaId = Number(opts.dramaId);
  const content = String(opts.content || '').trim();
  if (!content) {
    const err = new Error('评论内容不能为空');
    err.code = 'EMPTY_CONTENT';
    throw err;
  }

  let parentId = opts.parentId != null ? Number(opts.parentId) : null;
  let rootId = null;
  let nodeKey = opts.nodeKey != null ? String(opts.nodeKey) : null;
  let timestampMs = opts.timestampMs != null ? Number(opts.timestampMs) : null;

  if (parentId) {
    const parent = db.prepare('SELECT * FROM canvas_comments WHERE id = ? AND is_deleted = 0').get(parentId);
    if (!parent || Number(parent.drama_id) !== dramaId) {
      const err = new Error('父评论不存在');
      err.code = 'PARENT_NOT_FOUND';
      throw err;
    }
    // 回复继承线程根、节点定位；时间戳批注沿用父级（除非显式覆盖）
    rootId = parent.root_id || parent.id;
    nodeKey = parent.node_key;
    if (timestampMs == null) timestampMs = parent.timestamp_ms;
  }

  const res = db.prepare(
    `INSERT INTO canvas_comments
       (drama_id, node_key, parent_id, root_id, author_id, author_name, content, timestamp_ms, status, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(
    dramaId, nodeKey, parentId, rootId,
    Number(opts.authorId), opts.authorName || null, content, timestampMs
  );
  const id = res.lastInsertRowid || res.insertId;

  // 顶层评论：root_id = 自身
  if (!parentId) {
    db.prepare('UPDATE canvas_comments SET root_id = ? WHERE id = ?').run(id, id);
    rootId = id;
  }

  // 作者默认已读自己的评论
  markRead(db, id, Number(opts.authorId));

  // @提及处理 + 定向通知
  const mentions = resolveMentions(db, dramaId, content);
  for (const u of mentions) {
    if (Number(u.id) === Number(opts.authorId)) continue; // 不通知自己
    try {
      db.prepare(
        `INSERT INTO comment_mentions (comment_id, drama_id, mentioned_user_id, created_at)
         VALUES (?, ?, ?, ${nowExpr(db)})`
      ).run(id, dramaId, Number(u.id));
    } catch (e) {
      if (!/duplicate|unique/i.test(e.message || '')) throw e;
    }
    // 复用协作通知系统给被提及者
    collaborationService.createNotification(db, {
      dramaId,
      recipientId: Number(u.id),
      actorId: Number(opts.authorId),
      actorName: opts.authorName || null,
      type: 'comment_mention',
      title: '有人在评论中@了你',
      content: content.slice(0, 120),
      payload: { comment_id: id, node_key: nodeKey, root_id: rootId },
    });
  }

  // 回复：通知线程内其他参与者（排除作者与已 @ 的人，避免重复打扰）
  if (parentId) {
    const mentionedIds = new Set(mentions.map((u) => Number(u.id)));
    const participants = db.prepare(
      'SELECT DISTINCT author_id FROM canvas_comments WHERE root_id = ? AND is_deleted = 0'
    ).all(rootId) || [];
    for (const p of participants) {
      const rid = Number(p.author_id);
      if (rid === Number(opts.authorId) || mentionedIds.has(rid)) continue;
      collaborationService.createNotification(db, {
        dramaId,
        recipientId: rid,
        actorId: Number(opts.authorId),
        actorName: opts.authorName || null,
        type: 'comment_reply',
        title: '你参与的讨论有新回复',
        content: content.slice(0, 120),
        payload: { comment_id: id, root_id: rootId, node_key: nodeKey },
      });
    }
  }

  if (log) log.info('[S13-T06] 评论已发表', { id, dramaId, nodeKey, parentId, mentions: mentions.length });
  return getComment(db, id);
}

/** 批量回复：对多条评论发表相同内容的回复（如统一「已处理」）。返回新建回复列表。 */
function batchReply(db, log, { dramaId, commentIds, authorId, authorName, content }) {
  const ids = Array.isArray(commentIds) ? commentIds.map(Number).filter(Boolean) : [];
  if (ids.length === 0) {
    const err = new Error('未指定要回复的评论');
    err.code = 'NO_TARGETS';
    throw err;
  }
  const created = [];
  const runTx = () => {
    for (const cid of ids) {
      created.push(createComment(db, log, {
        dramaId, parentId: cid, authorId, authorName, content,
      }));
    }
    return created;
  };
  const out = db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S13-T06] 批量回复完成', { dramaId, count: out.length });
  return out;
}

/** 读取单条评论（含 mentions 用户名）。 */
function getComment(db, id) {
  const row = db.prepare('SELECT * FROM canvas_comments WHERE id = ?').get(Number(id));
  if (!row) return null;
  const mentions = db.prepare(
    `SELECT m.mentioned_user_id AS user_id, u.username
     FROM comment_mentions m LEFT JOIN users u ON u.id = m.mentioned_user_id
     WHERE m.comment_id = ?`
  ).all(Number(id)) || [];
  return { ...row, mentions };
}

/**
 * 列出项目评论（可按节点过滤），组织为线程结构（顶层 + replies）。
 * @param {object} opts { nodeKey?, status?, viewerId? }
 * @returns {Array} 线程数组，每项含 replies 与 unread 标记
 */
function listComments(db, dramaId, opts = {}) {
  const conds = ['drama_id = ?', 'is_deleted = 0'];
  const params = [Number(dramaId)];
  if (opts.nodeKey !== undefined) {
    if (opts.nodeKey === null) { conds.push('node_key IS NULL'); }
    else { conds.push('node_key = ?'); params.push(String(opts.nodeKey)); }
  }
  if (opts.status) { conds.push('status = ?'); params.push(String(opts.status)); }

  const rows = db.prepare(
    `SELECT * FROM canvas_comments WHERE ${conds.join(' AND ')} ORDER BY created_at ASC, id ASC`
  ).all(...params) || [];

  // 已读集合（用于标记 unread）
  let readSet = new Set();
  if (opts.viewerId) {
    const reads = db.prepare(
      'SELECT comment_id FROM comment_reads WHERE drama_id = ? AND user_id = ?'
    ).all(Number(dramaId), Number(opts.viewerId)) || [];
    readSet = new Set(reads.map((r) => Number(r.comment_id)));
  }

  const decorate = (r) => ({
    ...r,
    unread: opts.viewerId ? !readSet.has(Number(r.id)) : false,
  });

  // 组线程：root_id 分组
  const roots = [];
  const byRoot = new Map();
  for (const r of rows) {
    if (Number(r.id) === Number(r.root_id) || r.parent_id == null) {
      const node = { ...decorate(r), replies: [] };
      roots.push(node);
      byRoot.set(Number(r.id), node);
    }
  }
  for (const r of rows) {
    if (r.parent_id != null && Number(r.id) !== Number(r.root_id)) {
      const root = byRoot.get(Number(r.root_id));
      if (root) root.replies.push(decorate(r));
      else roots.push({ ...decorate(r), replies: [] }); // 容错：根缺失时平铺
    }
  }
  return roots;
}

/** 更新评论正文（仅作者）。 */
function updateComment(db, id, authorId, content) {
  const row = db.prepare('SELECT * FROM canvas_comments WHERE id = ? AND is_deleted = 0').get(Number(id));
  if (!row) return null;
  if (Number(row.author_id) !== Number(authorId)) {
    const err = new Error('只能编辑自己的评论');
    err.code = 'NOT_AUTHOR';
    throw err;
  }
  const text = String(content || '').trim();
  if (!text) { const err = new Error('评论内容不能为空'); err.code = 'EMPTY_CONTENT'; throw err; }
  db.prepare(
    `UPDATE canvas_comments SET content = ?, updated_at = ${nowExpr(db)} WHERE id = ?`
  ).run(text, Number(id));
  return getComment(db, id);
}

/** 软删除评论（作者或具备 manage 能力者，由路由层校验）。 */
function deleteComment(db, id) {
  const res = db.prepare(
    `UPDATE canvas_comments SET is_deleted = 1, updated_at = ${nowExpr(db)} WHERE id = ? AND is_deleted = 0`
  ).run(Number(id));
  return (res.changes || 0) > 0;
}

/** 标记评论为已解决 / 重开。 */
function setStatus(db, id, status, actorId) {
  const s = status === 'resolved' ? 'resolved' : 'open';
  if (s === 'resolved') {
    db.prepare(
      `UPDATE canvas_comments SET status = 'resolved', resolved_by = ?, resolved_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)} WHERE id = ?`
    ).run(Number(actorId), Number(id));
  } else {
    db.prepare(
      `UPDATE canvas_comments SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = ${nowExpr(db)} WHERE id = ?`
    ).run(Number(id));
  }
  return getComment(db, id);
}

// ===========================================================================
// 已读 / 未读
// ===========================================================================

/** 标记单条评论已读（幂等）。 */
function markRead(db, commentId, userId) {
  const row = db.prepare('SELECT drama_id FROM canvas_comments WHERE id = ?').get(Number(commentId));
  if (!row) return false;
  try {
    db.prepare(
      `INSERT INTO comment_reads (comment_id, drama_id, user_id, read_at)
       VALUES (?, ?, ?, ${nowExpr(db)})`
    ).run(Number(commentId), Number(row.drama_id), Number(userId));
  } catch (e) {
    if (!/duplicate|unique/i.test(e.message || '')) throw e; // 已读记录已存在：幂等
  }
  return true;
}

/** 标记项目（或指定节点）下全部评论已读。返回新增已读条数。 */
function markAllRead(db, dramaId, userId, nodeKey) {
  const conds = ['drama_id = ?', 'is_deleted = 0'];
  const params = [Number(dramaId)];
  if (nodeKey !== undefined) {
    if (nodeKey === null) conds.push('node_key IS NULL');
    else { conds.push('node_key = ?'); params.push(String(nodeKey)); }
  }
  const rows = db.prepare(
    `SELECT id FROM canvas_comments WHERE ${conds.join(' AND ')}`
  ).all(...params) || [];
  let n = 0;
  for (const r of rows) {
    const before = db.prepare(
      'SELECT id FROM comment_reads WHERE comment_id = ? AND user_id = ?'
    ).get(Number(r.id), Number(userId));
    if (!before) { markRead(db, r.id, userId); n += 1; }
  }
  return n;
}

/** 未读评论数（项目级；排除自己发的评论）。 */
function unreadCount(db, dramaId, userId) {
  const row = db.prepare(
    `SELECT COUNT(*) c FROM canvas_comments cc
     WHERE cc.drama_id = ? AND cc.is_deleted = 0 AND cc.author_id <> ?
       AND NOT EXISTS (
         SELECT 1 FROM comment_reads cr
         WHERE cr.comment_id = cc.id AND cr.user_id = ?
       )`
  ).get(Number(dramaId), Number(userId), Number(userId));
  return row ? Number(row.c) || 0 : 0;
}

/** 按节点聚合未读数（画布上给有未读评论的节点加红点）。 */
function unreadByNode(db, dramaId, userId) {
  const rows = db.prepare(
    `SELECT cc.node_key, COUNT(*) c FROM canvas_comments cc
     WHERE cc.drama_id = ? AND cc.is_deleted = 0 AND cc.author_id <> ?
       AND cc.node_key IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM comment_reads cr WHERE cr.comment_id = cc.id AND cr.user_id = ?
       )
     GROUP BY cc.node_key`
  ).all(Number(dramaId), Number(userId), Number(userId)) || [];
  const map = {};
  for (const r of rows) map[r.node_key] = Number(r.c) || 0;
  return map;
}

module.exports = {
  resolveMentions,
  createComment,
  batchReply,
  getComment,
  listComments,
  updateComment,
  deleteComment,
  setStatus,
  markRead,
  markAllRead,
  unreadCount,
  unreadByNode,
};
