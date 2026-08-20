/**
 * Sprint 11 - S11-T01 / S11-T03 / S11-T04 / S11-T05 / S11-T08
 * 协作实时通信网关（Socket.io）
 *
 * 职责：
 *   S11-T01 WebSocket 服务：Socket.io 服务器初始化 + JWT 握手鉴权 + 房间管理 + 心跳
 *   S11-T03 画布操作实时同步：节点增删改/拖拽/连线 事件广播到同房间所有协作者
 *   S11-T04 操作锁定与冲突解决：lock/unlock/renew + 基于版本号的冲突判定
 *   S11-T05 协作通知：成员加入/修改/评论 实时下发
 *   S11-T08 审计：所有画布变更事件落库 collaboration_activities
 *
 * 房间约定：每个项目一个房间，房间名 = `drama:{dramaId}`。
 *
 * 依赖：socket.io（已加入 package.json）。JWT 复用 middleware/auth 的 JWT_SECRET。
 */

'use strict';

const jwt = require('jsonwebtoken');
const { loadConfig } = require('../config');

// JWT 签名密钥：环境变量 > config.yaml(app.jwt_secret) > 开发默认值
const JWT_SECRET = process.env.JWT_SECRET || loadConfig().app?.jwt_secret || 'localminidrama_jwt_secret_key_2026';

// 心跳：客户端应每 25s ping，服务端 60s 无 pong 判定断连（Socket.io 内置 pingInterval/pingTimeout）
const PING_INTERVAL = 25000;
const PING_TIMEOUT = 60000;

function roomOf(dramaId) {
  return `drama:${dramaId}`;
}

/**
 * 初始化协作网关。
 * @param {object} httpServer  Node http.Server（app.listen 的返回值）
 * @param {object} db          数据库连接
 * @param {object} log         日志
 * @param {object} [options]   { corsOrigins }
 * @returns {object} io 实例（挂载后可用于关闭）
 */
function initCollaborationGateway(httpServer, db, log, options = {}) {
  const { Server } = require('socket.io');
  const collaborationService = require('../services/collaborationService');

  const io = new Server(httpServer, {
    path: '/socket.io',
    pingInterval: PING_INTERVAL,
    pingTimeout: PING_TIMEOUT,
    cors: {
      origin: options.corsOrigins && options.corsOrigins.length ? options.corsOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ---- S11-T01: JWT 握手鉴权中间件 ----
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('未提供认证令牌'));
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare(
        'SELECT id, username, nickname, role FROM users WHERE id = ? AND status = 1 AND deleted_at IS NULL'
      ).get(decoded.id);
      if (!user) return next(new Error('用户不存在或已禁用'));
      socket.user = user;
      next();
    } catch (err) {
      log && log.warn && log.warn('[S11-T01] socket 握手鉴权失败', { error: err.message });
      next(new Error('认证失败'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    log && log.info && log.info('[S11-T01] 协作连接建立', { socketId: socket.id, userId: user.id, username: user.username });

    // ---- S11-T01: 加入项目房间 ----
    socket.on('collab:join', (payload = {}, ack) => {
      try {
        const dramaId = Number(payload.dramaId);
        if (!dramaId) return typeof ack === 'function' && ack({ ok: false, error: '缺少 dramaId' });

        // 校验协作权限：必须是创建者/协作成员/super_admin
        const roleTag = collaborationService.resolveRole(db, dramaId, user);
        if (!roleTag) return typeof ack === 'function' && ack({ ok: false, error: '无项目协作权限' });

        socket.join(roomOf(dramaId));
        socket.data.dramaId = dramaId;
        socket.data.roleTag = roleTag;

        // 广播「成员加入」+ 落库通知（S11-T05）
        socket.to(roomOf(dramaId)).emit('collab:member_joined', {
          userId: user.id, username: user.username, roleTag, at: Date.now(),
        });
        try {
          collaborationService.notifyMembers(db, dramaId, {
            actorId: user.id, actorName: user.username, type: 'member_join',
            title: '成员加入协作', content: `${user.username} 加入了协作`,
          }, user.id);
        } catch (e) { log && log.warn && log.warn('[S11-T05] 加入通知失败', { error: e.message }); }

        // 落审计（S11-T08）
        try {
          collaborationService.recordActivity(db, {
            dramaId, userId: user.id, userName: user.username,
            actionType: 'member_join', socketId: socket.id,
          });
        } catch (e) { /* 非致命 */ }

        // 回传当前在线成员与锁快照
        const online = onlineMembers(io, dramaId);
        const locks = collaborationService.listLocks(db, dramaId);
        typeof ack === 'function' && ack({ ok: true, roleTag, online, locks });
      } catch (err) {
        log && log.error && log.error('[S11-T01] collab:join 失败', { error: err.message });
        typeof ack === 'function' && ack({ ok: false, error: err.message });
      }
    });

    // ---- S11-T01: 离开房间 ----
    socket.on('collab:leave', (payload = {}) => {
      const dramaId = Number(payload.dramaId) || socket.data.dramaId;
      if (!dramaId) return;
      socket.leave(roomOf(dramaId));
      socket.to(roomOf(dramaId)).emit('collab:member_left', { userId: user.id, username: user.username });
    });

    // ---- S11-T04: 加锁 ----
    socket.on('collab:lock', (payload = {}, ack) => {
      const dramaId = Number(payload.dramaId) || socket.data.dramaId;
      const nodeKey = String(payload.nodeKey || '');
      if (!dramaId || !nodeKey) return typeof ack === 'function' && ack({ ok: false, error: '参数缺失' });
      // 权限：需具备编辑该节点的能力
      if (!collaborationService.canEditNode(db, dramaId, user, nodeKey)) {
        return typeof ack === 'function' && ack({ ok: false, error: '无编辑该节点的权限' });
      }
      const result = collaborationService.acquireLock(db, dramaId, nodeKey, user, socket.id);
      if (result.ok) {
        socket.to(roomOf(dramaId)).emit('collab:node_locked', {
          nodeKey, lockedBy: user.id, lockedByName: user.username,
        });
        collaborationService.recordActivity(db, {
          dramaId, userId: user.id, userName: user.username,
          actionType: 'lock', targetKey: nodeKey, socketId: socket.id,
        });
      }
      typeof ack === 'function' && ack(result);
    });

    // ---- S11-T04: 心跳续约 ----
    socket.on('collab:lock_renew', (payload = {}, ack) => {
      const dramaId = Number(payload.dramaId) || socket.data.dramaId;
      const nodeKey = String(payload.nodeKey || '');
      const ok = collaborationService.renewLock(db, dramaId, nodeKey, user);
      typeof ack === 'function' && ack({ ok });
    });

    // ---- S11-T04: 解锁 ----
    socket.on('collab:unlock', (payload = {}, ack) => {
      const dramaId = Number(payload.dramaId) || socket.data.dramaId;
      const nodeKey = String(payload.nodeKey || '');
      const isOwner = socket.data.roleTag === 'owner' || user.role === 'super_admin';
      const ok = collaborationService.releaseLock(db, dramaId, nodeKey, user, !!payload.force && isOwner);
      if (ok) {
        socket.to(roomOf(dramaId)).emit('collab:node_unlocked', { nodeKey, by: user.id });
        collaborationService.recordActivity(db, {
          dramaId, userId: user.id, userName: user.username,
          actionType: 'unlock', targetKey: nodeKey, socketId: socket.id,
        });
      }
      typeof ack === 'function' && ack({ ok });
    });

    // ---- S11-T03: 画布操作实时同步 ----
    // op: { action: 'node_create'|'node_update'|'node_delete'|'node_move'|'edge_create'|'edge_delete',
    //       nodeKey, data, baseVersion }
    socket.on('collab:canvas_op', (payload = {}, ack) => {
      try {
        const dramaId = Number(payload.dramaId) || socket.data.dramaId;
        const op = payload.op || {};
        if (!dramaId || !op.action) {
          return typeof ack === 'function' && ack({ ok: false, error: '参数缺失' });
        }
        // 权限校验（按节点类型映射能力）
        if (op.nodeKey && !collaborationService.canEditNode(db, dramaId, user, op.nodeKey)) {
          return typeof ack === 'function' && ack({ ok: false, error: '无编辑权限' });
        }

        // S11-T04: 冲突解决（对带 nodeKey 的修改类操作做版本判定）
        let versionResult = null;
        if (op.nodeKey && ['node_update', 'node_move'].includes(op.action)) {
          versionResult = collaborationService.resolveConflict(
            db, dramaId, op.nodeKey, op.baseVersion, user
          );
          if (!versionResult.accepted) {
            // 冲突：回执带最新版本，令提交方 rebase，不广播
            return typeof ack === 'function' && ack({
              ok: false, conflict: true, serverVersion: versionResult.serverVersion,
            });
          }
        }

        // 广播给同房间其他协作者（S11-T03）
        socket.to(roomOf(dramaId)).emit('collab:canvas_op', {
          op, actorId: user.id, actorName: user.username,
          version: versionResult ? versionResult.version : undefined, at: Date.now(),
        });

        // 审计落库（S11-T08）
        collaborationService.recordActivity(db, {
          dramaId, userId: user.id, userName: user.username,
          actionType: op.action, targetKey: op.nodeKey || null,
          detail: op.data != null ? op.data : null, socketId: socket.id,
        });

        // 通知（S11-T05，节点修改类）—— 仅落库，避免刷屏由前端节流展示
        try {
          collaborationService.notifyMembers(db, dramaId, {
            actorId: user.id, actorName: user.username, type: 'node_change',
            title: '画布已更新', content: `${user.username} ${describeAction(op.action)}${op.nodeKey ? ' ' + op.nodeKey : ''}`,
            payload: { action: op.action, nodeKey: op.nodeKey },
          }, user.id);
        } catch (e) { /* 非致命 */ }

        typeof ack === 'function' && ack({ ok: true, version: versionResult ? versionResult.version : undefined });
      } catch (err) {
        log && log.error && log.error('[S11-T03] canvas_op 失败', { error: err.message });
        typeof ack === 'function' && ack({ ok: false, error: err.message });
      }
    });

    // ---- S11-T05: 评论（协作沟通） ----
    socket.on('collab:comment', (payload = {}, ack) => {
      const dramaId = Number(payload.dramaId) || socket.data.dramaId;
      const text = String(payload.text || '').slice(0, 1000);
      const nodeKey = payload.nodeKey || null;
      if (!dramaId || !text) return typeof ack === 'function' && ack({ ok: false, error: '参数缺失' });
      socket.to(roomOf(dramaId)).emit('collab:comment', {
        actorId: user.id, actorName: user.username, text, nodeKey, at: Date.now(),
      });
      try {
        collaborationService.notifyMembers(db, dramaId, {
          actorId: user.id, actorName: user.username, type: 'comment',
          title: '新评论', content: `${user.username}: ${text.slice(0, 60)}`,
          payload: { nodeKey },
        }, user.id);
        collaborationService.recordActivity(db, {
          dramaId, userId: user.id, userName: user.username,
          actionType: 'comment', targetKey: nodeKey, detail: { text }, socketId: socket.id,
        });
      } catch (e) { /* 非致命 */ }
      typeof ack === 'function' && ack({ ok: true });
    });

    // ---- S11-T01: 断开清理 ----
    socket.on('disconnect', (reason) => {
      try {
        const released = collaborationService.releaseLocksBySocket(db, socket.id);
        const dramaId = socket.data.dramaId;
        if (dramaId) {
          socket.to(roomOf(dramaId)).emit('collab:member_left', { userId: user.id, username: user.username });
          if (released > 0) {
            socket.to(roomOf(dramaId)).emit('collab:locks_released', { by: user.id, count: released });
          }
        }
        log && log.info && log.info('[S11-T01] 协作连接断开', { socketId: socket.id, userId: user.id, reason, releasedLocks: released });
      } catch (err) {
        log && log.warn && log.warn('[S11-T01] disconnect 清理失败', { error: err.message });
      }
    });
  });

  log && log.info && log.info('[S11-T01] 协作实时网关已启动 (Socket.io path=/socket.io)');
  return io;
}

/** 汇总某房间当前在线成员（去重）。 */
function onlineMembers(io, dramaId) {
  const room = io.sockets.adapter.rooms.get(roomOf(dramaId));
  if (!room) return [];
  const seen = new Map();
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.user) seen.set(s.user.id, { userId: s.user.id, username: s.user.username });
  }
  return Array.from(seen.values());
}

/** 操作类型 → 中文描述（用于通知文案）。 */
function describeAction(action) {
  const map = {
    node_create: '新增了节点', node_update: '修改了节点', node_delete: '删除了节点',
    node_move: '移动了节点', edge_create: '新增了连线', edge_delete: '删除了连线',
    layout_save: '保存了画布布局',
  };
  return map[action] || '操作了';
}

module.exports = {
  initCollaborationGateway,
  roomOf,
  onlineMembers,
  describeAction,
  PING_INTERVAL,
  PING_TIMEOUT,
};
