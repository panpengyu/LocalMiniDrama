'use strict';

/**
 * S21-P1 管理页补齐（批 A）：渠道管理 + 作品管理
 *  - GET    /admin/channels       渠道分页列表
 *  - POST   /admin/channels       新建渠道
 *  - PUT    /admin/channels/:id   更新渠道（名称/类型/状态/备注）
 *  - DELETE /admin/channels/:id   删除渠道
 *  - GET    /admin/works          作品分页列表（关键字/状态筛选）
 *  - PUT    /admin/works/:id      作品状态/标题更新
 *  - DELETE /admin/works/:id      作品软删除
 */

function adminExtRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const response = require('../response');
  const { requireAuth, requireRole } = require('../middleware/auth');

  const adminOnly = [requireAuth, requireRole(['admin', 'super_admin'])];

  // ============ 渠道管理 ============
  router.get('/channels', ...adminOnly, (req, res) => {
    try {
      const { page = 1, page_size = 20, keyword, type } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(page_size);
      let where = 'WHERE 1=1';
      const params = [];
      if (keyword) {
        where += ' AND (code LIKE ? OR name LIKE ? OR remark LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      if (type) {
        where += ' AND type = ?';
        params.push(type);
      }
      const items = db.prepare(`SELECT * FROM channels ${where} ORDER BY id DESC LIMIT ${parseInt(page_size)} OFFSET ${offset}`)
        .all(...params);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM channels ${where}`).get(...params).count;
      response.success(res, { items, total, page: parseInt(page), page_size: parseInt(page_size) });
    } catch (err) {
      log.error('adminExt/channels/list', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.post('/channels', ...adminOnly, (req, res) => {
    try {
      const { code, name, type = 'organic', status = 1, remark } = req.body || {};
      if (!code || !name) return response.badRequest(res, 'code 与 name 必填');
      const exists = db.prepare('SELECT id FROM channels WHERE code = ?').get(code);
      if (exists) return response.badRequest(res, `渠道编码 ${code} 已存在`);
      const r = db.prepare(
        'INSERT INTO channels (code, name, type, status, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())'
      ).run(code, name, type, status === 0 ? 0 : 1, remark || '');
      const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(r.lastInsertRowid);
      response.success(res, row, '渠道创建成功');
    } catch (err) {
      log.error('adminExt/channels/create', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/channels/:id', ...adminOnly, (req, res) => {
    try {
      const id = Number(req.params.id);
      const { name, type, status, remark } = req.body || {};
      const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
      if (!row) return response.notFound(res, '渠道不存在');
      db.prepare(
        'UPDATE channels SET name = ?, type = ?, status = ?, remark = ?, updated_at = NOW() WHERE id = ?'
      ).run(name ?? row.name, type ?? row.type, status === undefined ? row.status : (status ? 1 : 0), remark ?? row.remark, id);
      response.success(res, db.prepare('SELECT * FROM channels WHERE id = ?').get(id), '渠道更新成功');
    } catch (err) {
      log.error('adminExt/channels/update', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/channels/:id', ...adminOnly, (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = db.prepare('SELECT id FROM channels WHERE id = ?').get(id);
      if (!row) return response.notFound(res, '渠道不存在');
      db.prepare('DELETE FROM channels WHERE id = ?').run(id);
      response.success(res, { id }, '渠道删除成功');
    } catch (err) {
      log.error('adminExt/channels/delete', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ============ 作品管理（dramas） ============
  router.get('/works', ...adminOnly, (req, res) => {
    try {
      const { page = 1, page_size = 20, keyword, status } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(page_size);
      let where = 'WHERE deleted_at IS NULL';
      const params = [];
      if (keyword) {
        where += ' AND (title LIKE ? OR genre LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      if (status) {
        where += ' AND status = ?';
        params.push(status);
      }
      const items = db.prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id AND e.deleted_at IS NULL) AS episode_count
         FROM dramas d ${where} ORDER BY d.created_at DESC LIMIT ${parseInt(page_size)} OFFSET ${offset}`
      ).all(...params);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM dramas d ${where}`).get(...params).count;
      response.success(res, { items, total, page: parseInt(page), page_size: parseInt(page_size) });
    } catch (err) {
      log.error('adminExt/works/list', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.put('/works/:id', ...adminOnly, (req, res) => {
    try {
      const id = Number(req.params.id);
      const { title, status, genre, tags } = req.body || {};
      const row = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!row) return response.notFound(res, '作品不存在');
      const allowedStatus = ['draft', 'producing', 'published', 'archived', 'failed'];
      if (status !== undefined && !allowedStatus.includes(status)) {
        return response.badRequest(res, `status 仅允许：${allowedStatus.join('/')}`);
      }
      db.prepare(
        'UPDATE dramas SET title = ?, status = ?, genre = ?, tags = ?, updated_at = NOW() WHERE id = ?'
      ).run(title ?? row.title, status ?? row.status, genre ?? row.genre, tags ?? row.tags, id);
      response.success(res, db.prepare('SELECT * FROM dramas WHERE id = ?').get(id), '作品更新成功');
    } catch (err) {
      log.error('adminExt/works/update', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  router.delete('/works/:id', ...adminOnly, (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!row) return response.notFound(res, '作品不存在');
      db.prepare('UPDATE dramas SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?').run(id);
      response.success(res, { id }, '作品已删除');
    } catch (err) {
      log.error('adminExt/works/delete', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = adminExtRoutes;
