/**
 * Sprint 11 - 团队协作 + 版本管理 REST 路由
 *
 * 提供 HTTP 接口（实时事件走 Socket.io 网关，此处为管理/查询/回退等非实时操作）：
 *
 *   版本管理 (S11-T06 / S11-T07):
 *     GET    /dramas/:id/versions              版本列表(时间/操作者/变更摘要)
 *     GET    /dramas/:id/versions/:versionNo   单个版本完整快照
 *     GET    /dramas/:id/versions/diff         两版本对比 ?from=&to=
 *     POST   /dramas/:id/versions/snapshot     手动创建当前画布快照
 *     POST   /dramas/:id/versions/:versionNo/rollback  一键回退
 *
 *   协作成员 (S11-T02):
 *     GET    /dramas/:id/collaborators         成员列表
 *     POST   /dramas/:id/collaborators         添加/更新成员 {userId, roleTag}
 *     DELETE /dramas/:id/collaborators/:userId 移除成员
 *     GET    /dramas/:id/collaborators/roles   角色分工与能力字典
 *
 *   节点锁 (S11-T04):
 *     GET    /dramas/:id/locks                 当前活跃锁列表
 *
 *   通知 (S11-T05):
 *     GET    /collab/notifications             我的通知 ?unread=1
 *     POST   /collab/notifications/read        标记已读 {id?}
 *
 *   审计 (S11-T08):
 *     GET    /dramas/:id/activities            操作历史 ?userId=&actionType=&startTime=&endTime=
 *
 * 权限：写操作要求 owner/manage 能力；查询要求 view 能力。全部基于 collaborationService.resolveRole。
 */

'use strict';

const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const collaborationService = require('../services/collaborationService');
const versionService = require('../services/versionService');

function collaborationRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  // 统一：校验当前用户对项目具备指定能力，否则 403
  function ensureCapability(req, res, dramaId, capability) {
    const roleTag = collaborationService.resolveRole(db, dramaId, req.user);
    if (!roleTag) {
      response.forbidden(res, '无该项目协作权限');
      return null;
    }
    if (capability && !collaborationService.roleHasCapability(roleTag, capability)
        && !collaborationService.roleHasCapability(roleTag, 'manage')) {
      response.forbidden(res, '当前协作角色无此操作权限');
      return null;
    }
    return roleTag;
  }

  // ===================== 版本管理 (S11-T06 / S11-T07) =====================

  router.get('/dramas/:id/versions', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const list = versionService.listVersions(db, dramaId, Number(req.query.limit) || 100);
      response.success(res, list);
    } catch (err) {
      log.error('[S11-T07] 版本列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 注意：diff 路由须在 :versionNo 之前，避免被参数捕获
  router.get('/dramas/:id/versions/diff', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!from || !to) return response.badRequest(res, '需提供 from 与 to 版本号');
    try {
      const result = versionService.diffVersions(db, dramaId, from, to);
      response.success(res, result);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return response.notFound(res, err.message);
      log.error('[S11-T07] 版本对比失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.get('/dramas/:id/versions/:versionNo', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const v = versionService.getVersion(db, dramaId, Number(req.params.versionNo));
      if (!v) return response.notFound(res, '版本不存在');
      response.success(res, v);
    } catch (err) {
      log.error('[S11-T07] 版本详情失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/dramas/:id/versions/snapshot', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'edit_edit')) return;
    try {
      const created = versionService.createSnapshot(db, log, dramaId, null, {
        operatorId: req.user.id,
        operatorName: req.user.username || req.user.name,
        source: 'manual',
        summary: req.body?.summary,
      });
      if (!created) return response.badRequest(res, '当前项目无可快照的画布布局');
      response.success(res, created);
    } catch (err) {
      log.error('[S11-T06] 手动快照失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/dramas/:id/versions/:versionNo/rollback', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    // 回退是高危操作，要求 manage 能力（owner / super_admin）
    if (!ensureCapability(req, res, dramaId, 'manage')) return;
    try {
      const result = versionService.rollback(db, log, dramaId, Number(req.params.versionNo), {
        operatorId: req.user.id,
        operatorName: req.user.username || req.user.name,
      });
      // 审计
      collaborationService.recordActivity(db, {
        dramaId, userId: req.user.id, userName: req.user.username || req.user.name,
        actionType: 'version_rollback', detail: { restored_version: result.restored_version },
      });
      // 通知全体成员
      collaborationService.notifyMembers(db, dramaId, {
        actorId: req.user.id, actorName: req.user.username || req.user.name, type: 'version',
        title: '画布已回退', content: `${req.user.username || req.user.name} 回退到版本 v${result.restored_version}`,
        payload: { restored_version: result.restored_version, new_version: result.new_version },
      }, req.user.id);
      response.success(res, result);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return response.notFound(res, err.message);
      log.error('[S11-T06] 版本回退失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ===================== 协作成员 (S11-T02) =====================

  router.get('/dramas/:id/collaborators/roles', requireAuth, (req, res) => {
    response.success(res, {
      roles: collaborationService.VALID_ROLE_TAGS,
      capabilities: collaborationService.ROLE_CAPABILITIES,
    });
  });

  router.get('/dramas/:id/collaborators', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      response.success(res, collaborationService.listMembers(db, dramaId, req.query.includeRemoved === '1'));
    } catch (err) {
      log.error('[S11-T02] 成员列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/dramas/:id/collaborators', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'manage')) return;
    const userId = Number(req.body?.userId);
    const roleTag = req.body?.roleTag;
    if (!userId) return response.badRequest(res, '缺少 userId');
    if (roleTag && !collaborationService.VALID_ROLE_TAGS.includes(roleTag)) {
      return response.badRequest(res, `roleTag 非法，应为 ${collaborationService.VALID_ROLE_TAGS.join('/')} 之一`);
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
    if (!target) return response.badRequest(res, '目标用户不存在');
    try {
      const member = collaborationService.addMember(db, dramaId, userId, roleTag || 'viewer', req.user.id);
      collaborationService.recordActivity(db, {
        dramaId, userId: req.user.id, userName: req.user.username || req.user.name,
        actionType: 'member_join', targetKey: `user:${userId}`, detail: { roleTag: roleTag || 'viewer' },
      });
      collaborationService.createNotification(db, {
        dramaId, recipientId: userId, actorId: req.user.id, actorName: req.user.username || req.user.name,
        type: 'member_join', title: '您已被加入项目协作',
        content: `${req.user.username || req.user.name} 邀请您以「${roleTag || 'viewer'}」角色参与协作`,
      });
      response.success(res, member);
    } catch (err) {
      log.error('[S11-T02] 添加成员失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/dramas/:id/collaborators/:userId', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'manage')) return;
    const userId = Number(req.params.userId);
    try {
      const ok = collaborationService.removeMember(db, dramaId, userId);
      if (!ok) return response.notFound(res, '成员不存在');
      collaborationService.recordActivity(db, {
        dramaId, userId: req.user.id, userName: req.user.username || req.user.name,
        actionType: 'member_remove', targetKey: `user:${userId}`,
      });
      response.success(res, { removed: true });
    } catch (err) {
      log.error('[S11-T02] 移除成员失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ===================== 节点锁 (S11-T04) =====================

  router.get('/dramas/:id/locks', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      response.success(res, collaborationService.listLocks(db, dramaId));
    } catch (err) {
      log.error('[S11-T04] 锁列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ===================== 通知 (S11-T05) =====================

  router.get('/collab/notifications', requireAuth, (req, res) => {
    try {
      const list = collaborationService.listNotifications(
        db, req.user.id, req.query.unread === '1', Number(req.query.limit) || 100
      );
      response.success(res, list);
    } catch (err) {
      log.error('[S11-T05] 通知列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/collab/notifications/read', requireAuth, (req, res) => {
    try {
      const changed = collaborationService.markNotificationRead(db, req.user.id, req.body?.id);
      response.success(res, { changed });
    } catch (err) {
      log.error('[S11-T05] 标记已读失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ===================== 审计 (S11-T08) =====================

  router.get('/dramas/:id/activities', requireAuth, (req, res) => {
    const dramaId = Number(req.params.id);
    if (!ensureCapability(req, res, dramaId, 'view')) return;
    try {
      const list = collaborationService.queryActivities(db, {
        dramaId,
        userId: req.query.userId ? Number(req.query.userId) : undefined,
        actionType: req.query.actionType || undefined,
        startTime: req.query.startTime || undefined,
        endTime: req.query.endTime || undefined,
        limit: Number(req.query.limit) || 200,
      });
      response.success(res, list);
    } catch (err) {
      log.error('[S11-T08] 审计查询失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = collaborationRoutes;
