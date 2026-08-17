/**
 * Sprint 13 - S13-T06 评论批注 REST 路由
 *
 * 端点（均要求项目协作权限；写操作要求 comment/edit 能力，读要求 view）：
 *   GET    /dramas/:id/comments                    列出评论 ?node_key=&status=  (viewer=当前用户，含 unread 标记)
 *   POST   /dramas/:id/comments                    发表评论/批注 {node_key?, content, timestamp_ms?, parent_id?}
 *   POST   /dramas/:id/comments/batch-reply        批量回复 {comment_ids:[], content}
 *   PUT    /dramas/:id/comments/:commentId         编辑评论 {content}
 *   DELETE /dramas/:id/comments/:commentId         删除评论（作者或 manage）
 *   POST   /dramas/:id/comments/:commentId/status  标记解决/重开 {status: open|resolved}
 *   POST   /dramas/:id/comments/:commentId/read    标记单条已读
 *   POST   /dramas/:id/comments/read-all           标记全部已读 {node_key?}
 *   GET    /dramas/:id/comments/unread             未读数（总数 + 按节点）
 *
 * 权限基于 collaborationService.resolveRole；能力字典沿用 Sprint 11。
 */

'use strict';

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const commentService = require('../services/commentService');
const collaborationService = require('../services/collaborationService');

function commentRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  // 校验协作能力：capability 为 null 表示只需是成员（view）
  function ensureCapability(req, res, dramaId, capability) {
    const roleTag = collaborationService.resolveRole(db, dramaId, req.user);
    if (!roleTag) { response.forbidden(res, '无该项目协作权限'); return null; }
    if (capability
        && !collaborationService.roleHasCapability(roleTag, capability)
        && !collaborationService.roleHasCapability(roleTag, 'manage')) {
      response.forbidden(res, '当前协作角色无此操作权限');
      return null;
    }
    return roleTag;
  }

  function fail(res, err) {
    if (['EMPTY_CONTENT', 'NO_TARGETS'].includes(err.code)) return response.badRequest(res, err.message);
    if (['PARENT_NOT_FOUND'].includes(err.code)) return response.notFound(res, err.message);
    if (err.code === 'NOT_AUTHOR') return response.forbidden(res, err.message);
    log.error('[S13-T06] 评论接口异常', { code: err.code, error: err.message });
    return response.internalError(res, err.message);
  }

  // 列出评论
  router.get('/dramas/:id/comments', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const opts = { viewerId: req.user.id };
      if (req.query.node_key !== undefined) opts.nodeKey = req.query.node_key === '' ? null : req.query.node_key;
      if (req.query.status) opts.status = req.query.status;
      response.success(res, { items: commentService.listComments(db, dramaId, opts) });
    } catch (err) { fail(res, err); }
  });

  // 发表评论/批注
  router.post('/dramas/:id/comments', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'review')) return;
    try {
      const b = req.body || {};
      const comment = commentService.createComment(db, log, {
        dramaId,
        nodeKey: b.node_key != null ? b.node_key : null,
        parentId: b.parent_id != null ? b.parent_id : null,
        authorId: req.user.id,
        authorName: req.user.username || req.user.nickname || null,
        content: b.content,
        timestampMs: b.timestamp_ms != null ? b.timestamp_ms : null,
        voiceUrl: b.voice_url != null ? b.voice_url : null,          // S20-T02 语音评论
        voiceDuration: b.voice_duration != null ? b.voice_duration : null,
      });
      response.created(res, comment);
    } catch (err) { fail(res, err); }
  });

  // 批量回复
  router.post('/dramas/:id/comments/batch-reply', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'review')) return;
    try {
      const b = req.body || {};
      const items = commentService.batchReply(db, log, {
        dramaId,
        commentIds: b.comment_ids,
        authorId: req.user.id,
        authorName: req.user.username || req.user.nickname || null,
        content: b.content,
      });
      response.created(res, { items });
    } catch (err) { fail(res, err); }
  });

  // 标记全部已读（read-all 放在 :commentId 之前，避免被捕获）
  router.post('/dramas/:id/comments/read-all', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const b = req.body || {};
      const nodeKey = b.node_key !== undefined ? (b.node_key === '' ? null : b.node_key) : undefined;
      const n = commentService.markAllRead(db, dramaId, req.user.id, nodeKey);
      response.success(res, { marked: n });
    } catch (err) { fail(res, err); }
  });

  // 未读数
  router.get('/dramas/:id/comments/unread', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      response.success(res, {
        total: commentService.unreadCount(db, dramaId, req.user.id),
        by_node: commentService.unreadByNode(db, dramaId, req.user.id),
      });
    } catch (err) { fail(res, err); }
  });

  // 编辑评论
  router.put('/dramas/:id/comments/:commentId', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'review')) return;
    try {
      const updated = commentService.updateComment(db, req.params.commentId, req.user.id, (req.body || {}).content);
      if (!updated) return response.notFound(res, '评论不存在');
      response.success(res, updated);
    } catch (err) { fail(res, err); }
  });

  // 删除评论（作者本人，或具 manage 能力者）
  router.delete('/dramas/:id/comments/:commentId', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    const roleTag = ensureCapability(req, res, dramaId, 'review');
    if (!roleTag) return;
    try {
      const row = commentService.getComment(db, req.params.commentId);
      if (!row || row.is_deleted) return response.notFound(res, '评论不存在');
      const isAuthor = Number(row.author_id) === Number(req.user.id);
      const canManage = collaborationService.roleHasCapability(roleTag, 'manage');
      if (!isAuthor && !canManage) return response.forbidden(res, '只能删除自己的评论');
      commentService.deleteComment(db, req.params.commentId);
      response.success(res, { deleted: true });
    } catch (err) { fail(res, err); }
  });

  // 标记解决 / 重开
  router.post('/dramas/:id/comments/:commentId/status', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'review')) return;
    try {
      const status = (req.body || {}).status;
      const updated = commentService.setStatus(db, req.params.commentId, status, req.user.id);
      if (!updated) return response.notFound(res, '评论不存在');
      response.success(res, updated);
    } catch (err) { fail(res, err); }
  });

  // 标记单条已读
  router.post('/dramas/:id/comments/:commentId/read', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const ok = commentService.markRead(db, req.params.commentId, req.user.id);
      if (!ok) return response.notFound(res, '评论不存在');
      response.success(res, { read: true });
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = commentRoutes;
