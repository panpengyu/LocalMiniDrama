/**
 * Sprint 16 - S16-T06 用户文档与帮助中心 REST 路由
 *
 * 公开端点（登录用户）：
 *   GET  /help/docs                帮助文档列表 ?category=manual|faq|video|best_practice
 *   GET  /help/docs/:id            帮助文档详情
 *   GET  /help/overview            帮助中心总览（分类统计 + 各分类首篇）
 * 管理端点（super_admin）：
 *   GET    /admin/help-docs        帮助文档管理列表 ?category=&keyword=&page=&page_size=
 *   POST   /admin/help-docs        创建帮助文档
 *   PUT    /admin/help-docs/:id    更新帮助文档
 *   DELETE /admin/help-docs/:id    删除帮助文档
 *
 * 文档内容全部存于真实 MySQL 的 help_docs 表（含种子数据），无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');

const HELP_CATEGORIES = ['manual', 'faq', 'video', 'best_practice'];

function helpRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const auth = requireAuth;
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // ---------- 公开：分类浏览（S16-T02：列表接口挂 300s 缓存） ----------
  router.get('/help/docs', auth, require('../services/cacheService').cacheMiddleware('help:docs', 300), (req, res) => {
    try {
      const category = String(req.query.category || '').trim();
      const where = ['is_published = 1'];
      const params = [];
      if (category && HELP_CATEGORIES.includes(category)) {
        where.push('category = ?'); params.push(category);
      }
      const rows = db.prepare(
        `SELECT id, category, doc_key, title, summary, sort_order, updated_at
         FROM help_docs WHERE ${where.join(' AND ')}
         ORDER BY sort_order ASC, id ASC`
      ).all(...params) || [];
      response.success(res, { items: rows, total: rows.length, categories: HELP_CATEGORIES });
    } catch (err) {
      log.error('[S16-T06] 帮助文档列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 公开：文章详情 ----------
  router.get('/help/docs/:id', auth, (req, res) => {
    try {
      const row = db.prepare(
        `SELECT id, category, doc_key, title, summary, content, sort_order, updated_at
         FROM help_docs WHERE id = ? AND is_published = 1`
      ).get(Number(req.params.id));
      if (!row) return response.notFound(res, '帮助文档不存在');
      response.success(res, row);
    } catch (err) {
      log.error('[S16-T06] 帮助文档详情失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 公开：帮助中心总览 ----------
  router.get('/help/overview', auth, (req, res) => {
    try {
      const rows = db.prepare(
        `SELECT category, COUNT(*) AS c FROM help_docs WHERE is_published = 1 GROUP BY category`
      ).all() || [];
      const stats = {};
      for (const r of rows) stats[r.category] = Number(r.c || 0);
      const featured = db.prepare(
        `SELECT id, category, doc_key, title, summary, sort_order
         FROM help_docs WHERE is_published = 1
         ORDER BY sort_order ASC, id ASC LIMIT 6`
      ).all() || [];
      response.success(res, { categories: HELP_CATEGORIES, stats, featured });
    } catch (err) {
      log.error('[S16-T06] 帮助中心总览失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 管理端：列表 ----------
  router.get('/admin/help-docs', ...superAdmin, (req, res) => {
    try {
      const where = ['1=1'];
      const params = [];
      const category = String(req.query.category || '').trim();
      const keyword = String(req.query.keyword || '').trim();
      if (category && HELP_CATEGORIES.includes(category)) {
        where.push('category = ?'); params.push(category);
      }
      if (keyword) {
        where.push('(title LIKE ? OR doc_key LIKE ? OR content LIKE ?)');
        const kw = `%${keyword}%`; params.push(kw, kw, kw);
      }
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.page_size) || 20, 1), 100);
      const offset = (page - 1) * pageSize;
      const total = db.prepare(`SELECT COUNT(*) AS c FROM help_docs WHERE ${where.join(' AND ')}`).get(...params).c;
      const items = db.prepare(
        `SELECT id, category, doc_key, title, summary, sort_order, is_published, created_at, updated_at
         FROM help_docs WHERE ${where.join(' AND ')}
         ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`
      ).all(...params, pageSize, offset) || [];
      response.success(res, { total, page, pageSize, items });
    } catch (err) {
      log.error('[S16-T06] 帮助文档管理列表失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 管理端：创建 ----------
  router.post('/admin/help-docs', ...superAdmin, (req, res) => {
    try {
      const { category, docKey, title, summary, content, sortOrder = 0, isPublished = 1 } = req.body || {};
      if (!category || !HELP_CATEGORIES.includes(String(category))) {
        return response.badRequest(res, 'category 必须为 manual/faq/video/best_practice 之一');
      }
      if (!docKey || !title) return response.badRequest(res, 'doc_key 与 title 必填');
      const info = db.prepare(
        `INSERT INTO help_docs (category, doc_key, title, summary, content, sort_order, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(String(category), String(docKey), String(title), summary || null,
        content || null, Number(sortOrder) || 0, isPublished ? 1 : 0);
      response.created(res, { id: info.insertId || info.lastInsertRowid });
    } catch (err) {
      if (/Duplicate|ER_DUP_ENTRY/i.test(err.message || '')) {
        return response.conflict(res, 'doc_key 已存在');
      }
      log.error('[S16-T06] 帮助文档创建失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 管理端：更新 ----------
  router.put('/admin/help-docs/:id', ...superAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const { category, title, summary, content, sortOrder, isPublished } = req.body || {};
      const current = db.prepare(`SELECT * FROM help_docs WHERE id = ?`).get(id);
      if (!current) return response.notFound(res, '帮助文档不存在');
      const next = {
        category: category && HELP_CATEGORIES.includes(String(category)) ? String(category) : current.category,
        title: title != null ? String(title) : current.title,
        summary: summary != null ? String(summary) : current.summary,
        content: content != null ? String(content) : current.content,
        sort_order: sortOrder != null ? Number(sortOrder) : current.sort_order,
        is_published: isPublished != null ? (isPublished ? 1 : 0) : current.is_published
      };
      db.prepare(
        `UPDATE help_docs SET category=?, title=?, summary=?, content=?, sort_order=?, is_published=? WHERE id=?`
      ).run(next.category, next.title, next.summary, next.content, next.sort_order, next.is_published, id);
      response.success(res, { id });
    } catch (err) {
      log.error('[S16-T06] 帮助文档更新失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- 管理端：删除 ----------
  router.delete('/admin/help-docs/:id', ...superAdmin, (req, res) => {
    try {
      const info = db.prepare(`DELETE FROM help_docs WHERE id = ?`).run(Number(req.params.id));
      if (!info.changes) return response.notFound(res, '帮助文档不存在');
      response.success(res, { deleted: info.changes });
    } catch (err) {
      log.error('[S16-T06] 帮助文档删除失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = { helpRoutes, HELP_CATEGORIES };
