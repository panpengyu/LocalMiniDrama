'use strict';
/**
 * adminSite.js  Sprint 21 - 站点配置（批 B）与系统管理（批 C）管理端接口
 * 批 B：站点品牌 / 短信配置 / TOS 配置 / 协议管理 / 版本日志 / 通知公告
 * 批 C：管理员 / 角色 / 菜单 / 字典 / 参数 / 日志检索 / 问题排查
 * 挂载前缀：/admin（见 routes/index.js）
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const response = require('../response');
const { requireRole } = require('../middleware/auth');
const { snowflakeId } = require('../utils/snowflake');
const { mysqlNow } = require('../utils/datetime');
const { getGlobalSetting, setGlobalSetting } = require('../services/settingsService');

const now = (db) => (db.type === 'mysql' ? 'NOW()' : "datetime('now','localtime')");

/* ---------- 工具 ---------- */

function getSetting(db, key, def = null) {
  return getGlobalSetting(db, key, def);
}

function setSetting(db, key, value) {
  setGlobalSetting(db, key, value);
}

/** 密钥脱敏：仅保留后 4 位 */
function maskSecret(str) {
  if (str == null || str === '') return '';
  const s = String(str);
  if (s.length <= 4) return '****';
  return '****' + s.slice(-4);
}

/** 确保企业存在（roles 外键），不存在则兜底创建平台默认企业 */
function ensureEnterprise(db, id, name) {
  const eid = id || 0;
  const row = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(eid);
  if (!row) {
    db.prepare('INSERT INTO enterprises (id, name, status, created_at, updated_at) VALUES (?, ?, 1, ' + now(db) + ', ' + now(db) + ')')
      .run(eid, name || '平台默认企业');
  }
  return eid;
}

function pageInfo(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function listRows(db, table, where, orderBy, params, page, pageSize) {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(...params).c;
  // LIMIT/OFFSET 内联数字（parseInt 后拼接），规避 sync-mysql 对 ? 绑定 LIMIT 的语法问题
  const offset = (page - 1) * pageSize;
  const items = db.prepare(
    `SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`
  ).all(...params);
  return { items, total };
}

/* ---------- 批 B：站点配置（global_settings KV） ---------- */

function siteRoutes(db, log) {
  const router = express.Router();

  /* 站点品牌 */
  router.get('/site/brand', requireRole(['admin', 'super_admin']), (req, res) => {
    const d = getSetting(db, 'site_brand', {
      name: 'LocalMiniDrama', logo: '', slogan: '本地短剧智能创作助手',
      icp: '', copyright: '© 2026 LocalMiniDrama 团队', contact_email: '', service_phone: '', footer_text: ''
    });
    response.success(res, d);
  });

  router.put('/site/brand', requireRole(['admin', 'super_admin']), (req, res) => {
    const { name, logo, slogan, icp, copyright, contact_email, service_phone, footer_text } = req.body || {};
    if (!name || !String(name).trim()) return response.badRequest(res, '站点名称不能为空');
    setSetting(db, 'site_brand', {
      name: String(name).trim(), logo: logo || '', slogan: slogan || '',
      icp: icp || '', copyright: copyright || '', contact_email: contact_email || '',
      service_phone: service_phone || '', footer_text: footer_text || ''
    });
    log.info('admin/site/brand/update', { operator: req.user && req.user.id, name });
    response.success(res, { message: '站点品牌已保存' });
  });

  /* 短信配置（密钥脱敏） */
  router.get('/site/sms', requireRole(['admin', 'super_admin']), (req, res) => {
    const d = getSetting(db, 'sms_config', { provider: 'none', enabled: false, sign: '', template_id: '', access_key: '', access_secret: '' });
    if (d.access_secret) d.access_secret = maskSecret(d.access_secret);
    if (d.access_key) d.access_key = maskSecret(d.access_key);
    response.success(res, d);
  });

  router.put('/site/sms', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    const old = getSetting(db, 'sms_config', {});
    const access_secret = b.access_secret && String(b.access_secret).startsWith('****')
      ? (old.access_secret || '') : (b.access_secret || '');
    const access_key = b.access_key && String(b.access_key).startsWith('****')
      ? (old.access_key || '') : (b.access_key || '');
    setSetting(db, 'sms_config', {
      provider: b.provider || 'none', enabled: !!b.enabled,
      sign: b.sign || '', template_id: b.template_id || '',
      access_key, access_secret, verify_code_expire_sec: b.verify_code_expire_sec || 300
    });
    log.info('admin/site/sms/update', { operator: req.user && req.user.id, provider: b.provider });
    response.success(res, { message: '短信配置已保存' });
  });

  /* TOS 配置 */
  router.get('/site/tos', requireRole(['admin', 'super_admin']), (req, res) => {
    const d = getSetting(db, 'tos_config', { title: '服务条款', version: 'v1.0', content: '', effective_at: '', force_accept: false });
    response.success(res, d);
  });

  router.put('/site/tos', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.title) return response.badRequest(res, '条款标题不能为空');
    setSetting(db, 'tos_config', {
      title: b.title, version: b.version || 'v1.0', content: b.content || '',
      effective_at: b.effective_at || '', force_accept: !!b.force_accept
    });
    log.info('admin/site/tos/update', { operator: req.user && req.user.id, version: b.version });
    response.success(res, { message: '服务条款已保存' });
  });

  /* 协议管理（多协议数组） */
  router.get('/site/agreements', requireRole(['admin', 'super_admin']), (req, res) => {
    const d = getSetting(db, 'agreements', []);
    response.success(res, Array.isArray(d) ? d : []);
  });

  router.put('/site/agreements', requireRole(['admin', 'super_admin']), (req, res) => {
    const list = Array.isArray(req.body) ? req.body
      : Array.isArray(req.body && req.body.items) ? req.body.items : [];
    setSetting(db, 'agreements', list.map((it, i) => ({
      id: it.id || snowflakeId(), key: it.key || `agreement_${i + 1}`,
      title: it.title || '', version: it.version || 'v1.0', content: it.content || '',
      enabled: it.enabled !== false, effective_at: it.effective_at || ''
    })));
    log.info('admin/site/agreements/update', { operator: req.user && req.user.id, count: list.length });
    response.success(res, { message: `已保存 ${list.length} 条协议` });
  });

  /* 版本日志（读取仓库 CHANGELOG.md） */
  router.get('/site/changelog', requireRole(['admin', 'super_admin']), (req, res) => {
    const changelogPath = path.resolve(__dirname, '..', '..', '..', 'CHANGELOG.md');
    try {
      const content = fs.readFileSync(changelogPath, 'utf8');
      response.success(res, { path: changelogPath, content });
    } catch (err) {
      log.error('admin/site/changelog/read', { error: err.message });
      response.internalError(res, 'CHANGELOG.md 读取失败');
    }
  });

  /* 通知公告 CRUD */
  router.get('/notices', requireRole(['admin', 'super_admin']), (req, res) => {
    const { page, pageSize, offset } = pageInfo(req);
    const conds = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.status !== undefined && req.query.status !== '') { conds.push('status = ?'); params.push(Number(req.query.status)); }
    if (req.query.type) { conds.push('type = ?'); params.push(req.query.type); }
    if (req.query.keyword) { conds.push('(title LIKE ? OR content LIKE ?)'); params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`); }
    const where = conds.join(' AND ');
    const { items, total } = listRows(db, 'notices', where, 'is_top DESC, publish_at DESC, id DESC', params, page, pageSize);
    response.successWithPagination(res, items, total, page, pageSize);
  });

  router.post('/notices', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return response.badRequest(res, '公告标题不能为空');
    const id = snowflakeId();
    const t = mysqlNow();
    db.prepare(
      `INSERT INTO notices (id, title, content, type, level, status, is_top, publisher, publish_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, String(b.title).trim(), b.content || '', b.type || 'notice', b.level || 'info',
      b.status !== undefined ? Number(b.status) : 1, b.is_top ? 1 : 0,
      (req.user && (req.user.nickname || req.user.username)) || '',
      b.publish_at || t, t, t
    );
    log.info('admin/notices/create', { operator: req.user && req.user.id, id, title: b.title });
    response.created(res, { id, message: '公告已发布' });
  });

  router.put('/notices/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM notices WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '公告不存在');
    const b = req.body || {};
    const t = mysqlNow();
    db.prepare(
      `UPDATE notices SET title = ?, content = ?, type = ?, level = ?, status = ?, is_top = ?, publish_at = ?, updated_at = ? WHERE id = ?`
    ).run(
      b.title !== undefined ? String(b.title).trim() : exist.title, b.content !== undefined ? (b.content || '') : exist.content,
      b.type || 'notice', b.level || 'info',
      b.status !== undefined ? Number(b.status) : 1, b.is_top ? 1 : 0,
      b.publish_at || exist.publish_at || t, t, id
    );
    log.info('admin/notices/update', { operator: req.user && req.user.id, id });
    response.success(res, { message: '公告已更新' });
  });

  router.delete('/notices/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT id FROM notices WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '公告不存在');
    db.prepare('UPDATE notices SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    log.info('admin/notices/delete', { operator: req.user && req.user.id, id });
    response.success(res, { message: '公告已删除' });
  });

  return router;
}

/* ---------- 批 C：系统管理 ---------- */

function systemRoutes(db, log) {
  const router = express.Router();

  /* 管理员（基于 users 表 role IN admin/super_admin） */
  router.get('/admins', requireRole(['admin', 'super_admin']), (req, res) => {
    const { page, pageSize, offset } = pageInfo(req);
    const conds = ['deleted_at IS NULL', 'role IN (?, ?)'];
    const params = ['admin', 'super_admin'];
    if (req.query.keyword) { conds.push('(username LIKE ? OR nickname LIKE ? OR phone LIKE ?)'); params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`, `%${req.query.keyword}%`); }
    if (req.query.status !== undefined && req.query.status !== '') { conds.push('status = ?'); params.push(Number(req.query.status)); }
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${where}`).get(...params).c;
    const items = db.prepare(
      `SELECT id, username, nickname, phone, email, avatar, role, status, last_login_at, created_at, updated_at
       FROM users WHERE ${where} ORDER BY id DESC LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`
    ).all(...params);
    response.successWithPagination(res, items, total, page, pageSize);
  });

  router.post('/admins', requireRole(['super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.username || !b.password) return response.badRequest(res, '用户名与初始密码必填');
    const uname = String(b.username).trim();
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL').get(uname);
    if (dup) return response.conflict(res, '用户名已存在');
    const bcrypt = require('bcrypt');
    const id = snowflakeId();
    const t = mysqlNow();
    const role = b.role === 'super_admin' ? 'super_admin' : 'admin';
    db.prepare(
      `INSERT INTO users (id, username, password, role, nickname, status, email, user_type, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)`
    ).run(id, uname, bcrypt.hashSync(String(b.password), 10), role, b.nickname || uname,
      b.status !== undefined ? Number(b.status) : 1, b.email || '', t, t, t);
    log.info('admin/admins/create', { operator: req.user && req.user.id, id, username: uname, role });
    response.created(res, { id, message: '管理员已创建' });
  });

  router.put('/admins/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '管理员不存在');
    const b = req.body || {};
    const t = mysqlNow();
    const sets = [];
    const params = [];
    if (b.nickname !== undefined) { sets.push('nickname = ?'); params.push(String(b.nickname)); }
    if (b.email !== undefined) { sets.push('email = ?'); params.push(b.email || ''); }
    if (b.status !== undefined) { sets.push('status = ?'); params.push(Number(b.status)); }
    if (b.role && req.user && req.user.role === 'super_admin' && ['admin', 'super_admin'].includes(b.role)) { sets.push('role = ?'); params.push(b.role); }
    if (b.password) { sets.push('password = ?', 'token_version = token_version + 1', 'password_changed_at = ?'); params.push(require('bcrypt').hashSync(String(b.password), 10), t); }
    if (!sets.length) return response.badRequest(res, '无更新内容');
    sets.push('updated_at = ?');
    params.push(t, id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    log.info('admin/admins/update', { operator: req.user && req.user.id, id });
    response.success(res, { message: '管理员已更新' });
  });

  router.delete('/admins/:id', requireRole(['super_admin']), (req, res) => {
    const id = Number(req.params.id);
    if (req.user && req.user.id === id) return response.badRequest(res, '不能删除当前登录账号');
    const exist = db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '管理员不存在');
    db.prepare('UPDATE users SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    log.info('admin/admins/delete', { operator: req.user && req.user.id, id });
    response.success(res, { message: '管理员已删除' });
  });

  /* 角色 CRUD（roles 表） */
  router.get('/roles', requireRole(['admin', 'super_admin']), (req, res) => {
    const { page, pageSize, offset } = pageInfo(req);
    const conds = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.keyword) { conds.push('name LIKE ? OR code LIKE ?'); params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`); }
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM roles WHERE ${where}`).get(...params).c;
    const items = db.prepare(
      `SELECT id, enterprise_id, name, code, description, permissions, status, created_at, updated_at
       FROM roles WHERE ${where} ORDER BY id DESC LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`
    ).all(...params);
    response.successWithPagination(res, items, total, page, pageSize);
  });

  router.post('/roles', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.code) return response.badRequest(res, '角色名称与编码必填');
    const eid = ensureEnterprise(db, b.enterprise_id || (req.user && req.user.enterprise_id) || 0, b.enterprise_name);
    const dup = db.prepare('SELECT id FROM roles WHERE code = ? AND deleted_at IS NULL').get(String(b.code).trim());
    if (dup) return response.conflict(res, '角色编码已存在');
    const id = snowflakeId();
    const t = mysqlNow();
    db.prepare(
      `INSERT INTO roles (id, enterprise_id, name, code, description, permissions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, eid, String(b.name).trim(), String(b.code).trim(), b.description || '',
      JSON.stringify(b.permissions || []), b.status !== undefined ? Number(b.status) : 1, t, t);
    log.info('admin/roles/create', { operator: req.user && req.user.id, id, code: b.code });
    response.created(res, { id, message: '角色已创建' });
  });

  router.put('/roles/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '角色不存在');
    const b = req.body || {};
    const t = mysqlNow();
    db.prepare(
      `UPDATE roles SET name = ?, description = ?, permissions = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(b.name !== undefined ? String(b.name).trim() : exist.name, b.description !== undefined ? (b.description || '') : exist.description,
      JSON.stringify(b.permissions || []), b.status !== undefined ? Number(b.status) : 1, t, id);
    log.info('admin/roles/update', { operator: req.user && req.user.id, id });
    response.success(res, { message: '角色已更新' });
  });

  router.delete('/roles/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT id FROM roles WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '角色不存在');
    db.prepare('UPDATE roles SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    log.info('admin/roles/delete', { operator: req.user && req.user.id, id });
    response.success(res, { message: '角色已删除' });
  });

  /* 菜单 CRUD（menus 表） */
  router.get('/menus', requireRole(['admin', 'super_admin']), (req, res) => {
    const rows = db.prepare('SELECT * FROM menus WHERE deleted_at IS NULL ORDER BY parent_id, sort_order, id').all();
    response.success(res, rows);
  });

  router.post('/menus', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.name) return response.badRequest(res, '菜单名称必填');
    const id = snowflakeId();
    const t = mysqlNow();
    db.prepare(
      `INSERT INTO menus (id, parent_id, name, path, icon, sort_order, visible, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, Number(b.parent_id) || 0, String(b.name).trim(), b.path || '', b.icon || '',
      Number(b.sort_order) || 0, b.visible !== false ? 1 : 0, b.status !== undefined ? Number(b.status) : 1, t, t);
    response.created(res, { id, message: '菜单已创建' });
  });

  router.put('/menus/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '菜单不存在');
    const b = req.body || {};
    const t = mysqlNow();
    db.prepare(
      `UPDATE menus SET name = ?, path = ?, icon = ?, sort_order = ?, visible = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(b.name !== undefined ? String(b.name).trim() : exist.name, b.path !== undefined ? (b.path || '') : exist.path,
      b.icon !== undefined ? (b.icon || '') : exist.icon, Number(b.sort_order) || 0,
      b.visible !== false ? 1 : 0, b.status !== undefined ? Number(b.status) : 1, t, id);
    response.success(res, { message: '菜单已更新' });
  });

  router.delete('/menus/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE menus SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    response.success(res, { message: '菜单已删除' });
  });

  /* 字典 CRUD（dict_items 表） */
  router.get('/dict', requireRole(['admin', 'super_admin']), (req, res) => {
    const conds = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.dict_type) { conds.push('dict_type = ?'); params.push(req.query.dict_type); }
    const where = conds.join(' AND ');
    const rows = db.prepare(`SELECT * FROM dict_items WHERE ${where} ORDER BY dict_type, sort_order, id`).all(...params);
    const types = db.prepare('SELECT DISTINCT dict_type FROM dict_items WHERE deleted_at IS NULL ORDER BY dict_type').all().map(r => r.dict_type);
    response.success(res, { items: rows, types });
  });

  router.post('/dict', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.dict_type || !b.label || !b.value) return response.badRequest(res, '字典类型/标签/值必填');
    const id = snowflakeId();
    const t = mysqlNow();
    db.prepare(
      `INSERT INTO dict_items (id, dict_type, label, value, sort_order, status, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, String(b.dict_type).trim(), String(b.label).trim(), String(b.value).trim(),
      Number(b.sort_order) || 0, b.status !== undefined ? Number(b.status) : 1, b.remark || '', t, t);
    response.created(res, { id, message: '字典项已创建' });
  });

  router.put('/dict/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM dict_items WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '字典项不存在');
    const b = req.body || {};
    const t = mysqlNow();
    db.prepare(
      `UPDATE dict_items SET label = ?, value = ?, sort_order = ?, status = ?, remark = ?, updated_at = ? WHERE id = ?`
    ).run(b.label !== undefined ? String(b.label).trim() : exist.label, b.value !== undefined ? String(b.value).trim() : exist.value,
      Number(b.sort_order) || 0, b.status !== undefined ? Number(b.status) : 1, b.remark !== undefined ? (b.remark || '') : exist.remark, t, id);
    response.success(res, { message: '字典项已更新' });
  });

  router.delete('/dict/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE dict_items SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    response.success(res, { message: '字典项已删除' });
  });

  /* 参数 CRUD（system_params 表） */
  router.get('/params', requireRole(['admin', 'super_admin']), (req, res) => {
    const { page, pageSize, offset } = pageInfo(req);
    const conds = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.keyword) { conds.push('param_key LIKE ? OR description LIKE ?'); params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`); }
    const where = conds.join(' AND ');
    const { items, total } = listRows(db, 'system_params', where, 'id DESC', params, page, pageSize);
    response.successWithPagination(res, items, total, page, pageSize);
  });

  router.post('/params', requireRole(['admin', 'super_admin']), (req, res) => {
    const b = req.body || {};
    if (!b.param_key) return response.badRequest(res, '参数键必填');
    const key = String(b.param_key).trim();
    const dup = db.prepare('SELECT id FROM system_params WHERE param_key = ? AND deleted_at IS NULL').get(key);
    if (dup) return response.conflict(res, '参数键已存在');
    const id = snowflakeId();
    const t = mysqlNow();
    db.prepare(
      `INSERT INTO system_params (id, param_key, param_value, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, key, b.param_value !== undefined ? String(b.param_value) : '', b.description || '',
      b.status !== undefined ? Number(b.status) : 1, t, t);
    response.created(res, { id, message: '参数已创建' });
  });

  router.put('/params/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    const exist = db.prepare('SELECT * FROM system_params WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!exist) return response.notFound(res, '参数不存在');
    const b = req.body || {};
    if (b.param_key && String(b.param_key).trim() !== exist.param_key) {
      const dup = db.prepare('SELECT id FROM system_params WHERE param_key = ? AND deleted_at IS NULL AND id != ?').get(String(b.param_key).trim(), id);
      if (dup) return response.conflict(res, '参数键已存在');
    }
    const t = mysqlNow();
    db.prepare(
      `UPDATE system_params SET param_key = ?, param_value = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(b.param_key !== undefined ? String(b.param_key).trim() : exist.param_key,
      b.param_value !== undefined ? String(b.param_value) : exist.param_value,
      b.description !== undefined ? (b.description || '') : exist.description,
      b.status !== undefined ? Number(b.status) : 1, t, id);
    response.success(res, { message: '参数已更新' });
  });

  router.delete('/params/:id', requireRole(['admin', 'super_admin']), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE system_params SET deleted_at = ?, status = 0, updated_at = ? WHERE id = ?').run(mysqlNow(), mysqlNow(), id);
    response.success(res, { message: '参数已删除' });
  });

  /* 日志检索（登录日志 + 操作审计） */
  router.get('/logs/search', requireRole(['admin', 'super_admin']), (req, res) => {
    const { page, pageSize, offset } = pageInfo(req);
    const type = req.query.type === 'audit' ? 'audit' : 'login';
    const conds = [];
    const params = [];
    if (req.query.keyword) {
      conds.push(type === 'audit' ? '(actor_name LIKE ? OR action LIKE ? OR target_id LIKE ?)' : '(username LIKE ? OR reason LIKE ?)');
      params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`, `%${req.query.keyword}%`);
    }
    if (req.query.start) { conds.push('created_at >= ?'); params.push(req.query.start); }
    if (req.query.end) { conds.push('created_at <= ?'); params.push(req.query.end); }
    if (req.query.success !== undefined && req.query.success !== '' && type === 'login') { conds.push('success = ?'); params.push(Number(req.query.success)); }
    const table = type === 'audit' ? 'operation_audit_logs' : 'login_logs';
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params).c;
    const items = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`).all(...params);
    response.successWithPagination(res, items, total, page, pageSize);
  });

  /* 问题排查：用户聚合诊断 */
  router.get('/troubleshoot/diagnose', requireRole(['admin', 'super_admin']), (req, res) => {
    const kw = String(req.query.keyword || '').trim();
    if (!kw) return response.badRequest(res, '请输入用户ID/手机号/用户名');
    const user = db.prepare(
      'SELECT id, username, nickname, phone, email, role, status, user_type, enterprise_id, team_id, last_login_at, created_at FROM users WHERE (id = ? OR phone = ? OR username = ?) AND deleted_at IS NULL'
    ).get(/^\d+$/.test(kw) ? Number(kw) : 0, kw, kw);
    if (!user) return response.notFound(res, '未找到该用户');
    const uid = user.id;
    const pointRow = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
    user.point_balance = pointRow ? pointRow.balance_after : 0;
    const orders = db.prepare('SELECT id, order_no, level_code, billing_cycle, amount, pay_status, pay_method, created_at FROM membership_orders WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(uid);
    const dramas = db.prepare('SELECT id, title, genre, status, total_episodes, created_at FROM dramas WHERE created_by = ? ORDER BY id DESC LIMIT 20').all(uid);
    const loginLogs = db.prepare('SELECT id, username, success, ip, reason, created_at FROM login_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(uid);
    const sessions = db.prepare('SELECT id, user_agent, ip, created_at, expires_at, revoked_at FROM user_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(uid);
    const recharges = db.prepare('SELECT id, order_no, amount, points, pay_status, created_at FROM recharges WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(uid);
    response.success(res, { user, orders, dramas, login_logs: loginLogs, sessions, recharges });
  });

  return router;
}

module.exports = function adminSiteRoutes(db, log) {
  const router = express.Router();
  router.use(siteRoutes(db, log));
  router.use(systemRoutes(db, log));
  return router;
};
