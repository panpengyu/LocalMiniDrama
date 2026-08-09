/**
 * 模板路由模块
 *
 * 提供模板的 CRUD 与应用接口：
 *   GET    /api/v1/templates            列表（支持 category/genre_type/is_active/keyword 筛选 + 分页）
 *   GET    /api/v1/templates/:id        详情（id 可为数字主键或 template_id 字符串）
 *   POST   /api/v1/templates            创建（需管理员权限）
 *   PUT    /api/v1/templates/:id        更新（需管理员权限）
 *   DELETE /api/v1/templates/:id        软删除（需管理员权限）
 *   POST   /api/v1/templates/:id/apply  应用模板创建新项目
 */
const templateService = require('../services/templateService');
const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');

function templateRoutes(db, log) {
  const express = require('express');
  const router = express.Router();

  // GET / - 列表（支持筛选）
  router.get('/', (req, res) => {
    try {
      const { templates, total, page, pageSize } = templateService.listTemplates(db, {
        category: req.query.category,
        genreType: req.query.genre_type || req.query.genreType,
        isActive: req.query.is_active,
        keyword: req.query.keyword,
        page: req.query.page,
        pageSize: req.query.page_size || req.query.pageSize,
      });
      response.successWithPagination(res, templates, total, page, pageSize);
    } catch (err) {
      log.error('List templates failed', { error: err.message });
      response.internalError(res, '获取模板列表失败');
    }
  });

  // GET /:id - 详情（兼容数字 id 与 template_id 字符串）
  router.get('/:id', (req, res) => {
    const idParam = req.params.id;
    let template;
    if (/^\d+$/.test(idParam)) {
      template = templateService.getTemplateById(db, idParam);
    } else {
      template = templateService.getTemplateByTemplateId(db, idParam);
    }
    if (!template) return response.notFound(res, '模板不存在');
    response.success(res, template);
  });

  // POST / - 创建（需要管理员权限）
  router.post('/', requireAuth, requireRole(['super_admin', 'enterprise_admin']), (req, res) => {
    const body = req.body || {};
    if (!body.name || String(body.name).trim() === '') {
      return response.badRequest(res, 'name 必填');
    }
    try {
      const template = templateService.createTemplate(db, body);
      response.created(res, template);
    } catch (err) {
      log.error('Create template failed', { error: err.message });
      response.internalError(res, err.message || '创建模板失败');
    }
  });

  // PUT /:id - 更新
  router.put('/:id', requireAuth, requireRole(['super_admin', 'enterprise_admin']), (req, res) => {
    try {
      const template = templateService.updateTemplate(db, req.params.id, req.body || {});
      if (!template) return response.notFound(res, '模板不存在');
      response.success(res, template);
    } catch (err) {
      log.error('Update template failed', { error: err.message });
      response.internalError(res, err.message || '更新模板失败');
    }
  });

  // DELETE /:id - 软删除
  router.delete('/:id', requireAuth, requireRole(['super_admin', 'enterprise_admin']), (req, res) => {
    const ok = templateService.deleteTemplate(db, req.params.id);
    if (!ok) return response.notFound(res, '模板不存在');
    response.success(res, { message: '删除成功' });
  });

  // POST /:id/apply - 应用模板创建项目
  router.post('/:id/apply', (req, res) => {
    const body = req.body || {};
    const idParam = req.params.id;
    let templateId = idParam;
    // 若传入数字主键，先解析出 template_id 字符串
    if (/^\d+$/.test(idParam)) {
      const t = templateService.getTemplateById(db, idParam);
      if (!t) return response.notFound(res, '模板不存在');
      templateId = t.template_id;
    }
    try {
      const drama = templateService.applyTemplate(db, log, templateId, {
        title: body.title,
        userId: body.user_id || (req.user ? req.user.id : null),
        enterpriseId: body.enterprise_id || (req.user ? req.user.enterprise_id : null),
        teamId: body.team_id || (req.user ? req.user.team_id : null),
      });
      if (!drama) return response.notFound(res, '模板不存在');
      response.created(res, drama);
    } catch (err) {
      log.error('Apply template failed', { error: err.message, stack: err.stack });
      response.internalError(res, err.message || '应用模板失败');
    }
  });

  return router;
}

module.exports = templateRoutes;
