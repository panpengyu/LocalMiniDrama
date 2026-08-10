/**
 * 画布标注 + 书签路由模块
 *
 * 标注 CRUD（canvas_annotations 表）：
 *   GET    /api/v1/dramas/:dramaId/annotations
 *   POST   /api/v1/dramas/:dramaId/annotations
 *   PUT    /api/v1/annotations/:id
 *   DELETE /api/v1/annotations/:id
 *
 * 书签 CRUD（canvas_bookmarks 表）：
 *   GET    /api/v1/dramas/:dramaId/bookmarks
 *   POST   /api/v1/dramas/:dramaId/bookmarks
 *   DELETE /api/v1/bookmarks/:id
 *
 * 挂载于 /api/v1，SQL 使用标准语法兼容 MySQL 与 SQLite。
 */
const express = require('express');
const response = require('../response');
const { requireAuth } = require('../middleware/auth');
const permissionService = require('../services/permissionService');

const now = () => new Date().toISOString();

/**
 * S7-F05: 项目级权限校验
 * 验证当前用户是否有权操作该 drama 的标注/书签
 * 超级管理员 / 项目创建者 / 同企业 / 同团队 可操作；否则返回 403
 */
function checkDramaPermission(db, user, dramaId) {
  if (!user) return false;
  if (permissionService.isSuperAdmin(user)) return true;
  const drama = db.prepare('SELECT id, created_by, enterprise_id, team_id FROM dramas WHERE id = ?').get(Number(dramaId));
  if (!drama) return false;
  return permissionService.canViewDrama(user, drama);
}

function ensureDramaAccess(db, req, res, dramaId) {
  if (!checkDramaPermission(db, req.user, dramaId)) {
    response.forbidden(res, '无权操作该项目的资源');
    return false;
  }
  return true;
}

function rowToAnnotation(r) {
  if (!r) return null;
  return {
    id: r.id,
    drama_id: r.drama_id,
    annotation_type: r.annotation_type,
    world_x: r.world_x,
    world_y: r.world_y,
    world_x2: r.world_x2,
    world_y2: r.world_y2,
    content: r.content,
    color: r.color,
    font_size: r.font_size,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToBookmark(r) {
  if (!r) return null;
  return {
    id: r.id,
    drama_id: r.drama_id,
    user_id: r.user_id,
    name: r.name,
    viewport_x: r.viewport_x,
    viewport_y: r.viewport_y,
    viewport_zoom: r.viewport_zoom,
    zone_key: r.zone_key,
    color: r.color,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function canvasExtrasRoutes(db, log) {
  const router = express.Router();

  // ================= 标注 CRUD =================

  // GET /dramas/:dramaId/annotations - 列表
  router.get('/dramas/:dramaId/annotations', (req, res) => {
    try {
      const rows = db
        .prepare('SELECT * FROM canvas_annotations WHERE drama_id = ? ORDER BY id ASC')
        .all(Number(req.params.dramaId));
      response.success(res, rows.map(rowToAnnotation));
    } catch (err) {
      log.error('List annotations failed', { error: err.message });
      response.internalError(res, '获取标注失败');
    }
  });

  // POST /dramas/:dramaId/annotations - 创建
  router.post('/dramas/:dramaId/annotations', requireAuth, (req, res) => {
    if (!ensureDramaAccess(db, req, res, req.params.dramaId)) return;
    const raw = req.body || {};
    // 字段兼容：前端可能发送 camelCase（worldX/worldY/worldX2/worldY2/fontSize），
    // 后端统一按 snake_case 处理，避免坐标丢失。
    const body = {
      ...raw,
      world_x: raw.world_x != null ? raw.world_x : raw.worldX,
      world_y: raw.world_y != null ? raw.world_y : raw.worldY,
      world_x2: raw.world_x2 != null ? raw.world_x2 : raw.worldX2,
      world_y2: raw.world_y2 != null ? raw.world_y2 : raw.worldY2,
      font_size: raw.font_size != null ? raw.font_size : raw.fontSize,
    };
    if (!body.annotation_type) return response.badRequest(res, 'annotation_type 必填');
    if (body.world_x == null || body.world_y == null) {
      return response.badRequest(res, 'world_x / world_y 必填');
    }
    try {
      const info = db
        .prepare(
          `INSERT INTO canvas_annotations
            (drama_id, annotation_type, world_x, world_y, world_x2, world_y2,
             content, color, font_size, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          Number(req.params.dramaId),
          body.annotation_type,
          Number(body.world_x),
          Number(body.world_y),
          body.world_x2 == null ? null : Number(body.world_x2),
          body.world_y2 == null ? null : Number(body.world_y2),
          body.content || null,
          body.color || '#3b82f6',
          body.font_size == null ? 14 : Number(body.font_size),
          req.user ? req.user.id : null,
          now(),
          now()
        );
      const row = db
        .prepare('SELECT * FROM canvas_annotations WHERE id = ?')
        .get(info.lastInsertRowid);
      response.created(res, rowToAnnotation(row));
    } catch (err) {
      log.error('Create annotation failed', { error: err.message });
      response.internalError(res, err.message || '创建标注失败');
    }
  });

  // PUT /annotations/:id - 更新
  router.put('/annotations/:id', requireAuth, (req, res) => {
    const body = req.body || {};
    const existing = db
      .prepare('SELECT * FROM canvas_annotations WHERE id = ?')
      .get(Number(req.params.id));
    if (!existing) return response.notFound(res, '标注不存在');
    // S7-F05: 校验项目级权限
    if (!ensureDramaAccess(db, req, res, existing.drama_id)) return;

    const updates = [];
    const params = [];
    if ('annotation_type' in body) { updates.push('annotation_type = ?'); params.push(body.annotation_type); }
    if ('world_x' in body) { updates.push('world_x = ?'); params.push(body.world_x == null ? null : Number(body.world_x)); }
    if ('world_y' in body) { updates.push('world_y = ?'); params.push(body.world_y == null ? null : Number(body.world_y)); }
    if ('world_x2' in body) { updates.push('world_x2 = ?'); params.push(body.world_x2 == null ? null : Number(body.world_x2)); }
    if ('world_y2' in body) { updates.push('world_y2 = ?'); params.push(body.world_y2 == null ? null : Number(body.world_y2)); }
    if ('content' in body) { updates.push('content = ?'); params.push(body.content || null); }
    if ('color' in body) { updates.push('color = ?'); params.push(body.color || '#3b82f6'); }
    if ('font_size' in body) { updates.push('font_size = ?'); params.push(body.font_size == null ? 14 : Number(body.font_size)); }

    if (updates.length === 0) return response.success(res, rowToAnnotation(existing));

    updates.push('updated_at = ?');
    params.push(now());
    params.push(Number(req.params.id));

    db.prepare(
      'UPDATE canvas_annotations SET ' + updates.join(', ') + ' WHERE id = ?'
    ).run(...params);

    const row = db
      .prepare('SELECT * FROM canvas_annotations WHERE id = ?')
      .get(Number(req.params.id));
    response.success(res, rowToAnnotation(row));
  });

  // DELETE /annotations/:id - 删除
  router.delete('/annotations/:id', requireAuth, (req, res) => {
    const existing = db
      .prepare('SELECT id, drama_id FROM canvas_annotations WHERE id = ?')
      .get(Number(req.params.id));
    if (!existing) return response.notFound(res, '标注不存在');
    // S7-F05: 校验项目级权限
    if (!ensureDramaAccess(db, req, res, existing.drama_id)) return;
    db.prepare('DELETE FROM canvas_annotations WHERE id = ?').run(Number(req.params.id));
    response.success(res, { message: '删除成功' });
  });

  // ================= 书签 CRUD =================

  // GET /dramas/:dramaId/bookmarks - 列表
  router.get('/dramas/:dramaId/bookmarks', (req, res) => {
    try {
      const rows = db
        .prepare(
          'SELECT * FROM canvas_bookmarks WHERE drama_id = ? ORDER BY sort_order ASC, id ASC'
        )
        .all(Number(req.params.dramaId));
      response.success(res, rows.map(rowToBookmark));
    } catch (err) {
      log.error('List bookmarks failed', { error: err.message });
      response.internalError(res, '获取书签失败');
    }
  });

  // POST /dramas/:dramaId/bookmarks - 创建
  router.post('/dramas/:dramaId/bookmarks', requireAuth, (req, res) => {
    if (!ensureDramaAccess(db, req, res, req.params.dramaId)) return;
    const raw = req.body || {};
    // 字段兼容：前端 useCanvasBookmarks 发送 camelCase（viewportX/viewportY/viewportZoom/sortOrder/zoneKey），
    // 后端统一按 snake_case 处理，避免视口坐标丢失导致跳转回 (0,0,0.5) 默认位置。
    const body = {
      ...raw,
      viewport_x: raw.viewport_x != null ? raw.viewport_x : raw.viewportX,
      viewport_y: raw.viewport_y != null ? raw.viewport_y : raw.viewportY,
      viewport_zoom: raw.viewport_zoom != null ? raw.viewport_zoom : raw.viewportZoom,
      zone_key: raw.zone_key != null ? raw.zone_key : raw.zoneKey,
      sort_order: raw.sort_order != null ? raw.sort_order : raw.sortOrder,
      user_id: raw.user_id != null ? raw.user_id : raw.userId,
    };
    if (!body.name || String(body.name).trim() === '') {
      return response.badRequest(res, 'name 必填');
    }
    try {
      const info = db
        .prepare(
          `INSERT INTO canvas_bookmarks
            (drama_id, user_id, name, viewport_x, viewport_y, viewport_zoom,
             zone_key, color, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          Number(req.params.dramaId),
          req.user ? req.user.id : (body.user_id || null),
          body.name,
          body.viewport_x == null ? 0 : Number(body.viewport_x),
          body.viewport_y == null ? 0 : Number(body.viewport_y),
          body.viewport_zoom == null ? 0.5 : Number(body.viewport_zoom),
          body.zone_key || null,
          body.color || '#60a5fa',
          body.sort_order == null ? 0 : Number(body.sort_order),
          now(),
          now()
        );
      const row = db
        .prepare('SELECT * FROM canvas_bookmarks WHERE id = ?')
        .get(info.lastInsertRowid);
      response.created(res, rowToBookmark(row));
    } catch (err) {
      log.error('Create bookmark failed', { error: err.message });
      response.internalError(res, err.message || '创建书签失败');
    }
  });

  // DELETE /bookmarks/:id - 删除
  router.delete('/bookmarks/:id', requireAuth, (req, res) => {
    const existing = db
      .prepare('SELECT id, drama_id FROM canvas_bookmarks WHERE id = ?')
      .get(Number(req.params.id));
    if (!existing) return response.notFound(res, '书签不存在');
    // S7-F05: 校验项目级权限
    if (!ensureDramaAccess(db, req, res, existing.drama_id)) return;
    db.prepare('DELETE FROM canvas_bookmarks WHERE id = ?').run(Number(req.params.id));
    response.success(res, { message: '删除成功' });
  });

  return router;
}

module.exports = canvasExtrasRoutes;
