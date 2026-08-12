/**
 * Sprint 12 - S12-T03 存储管理 REST 路由（超级管理员）
 *
 * 端点（均需 super_admin）：
 *   GET    /admin/storage/objects        分页列出存储对象 ?backend=&lifecycle=&drama_id=&page=&page_size=
 *   GET    /admin/storage/stats          存储统计（按后端 / 按生命周期 / 总计）
 *   GET    /admin/storage/health         当前后端健康检查（local 检查可写 / minio 检查 bucket）
 *   POST   /admin/storage/lifecycle-scan 生命周期扫描（超期未访问 active→archived）{ archive_days }
 *   DELETE /admin/storage/objects/:id    逻辑删除某对象记录（lifecycle→deleted，不删物理文件）
 *
 * 所有数据来自 MySQL storage_objects 表，无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const storageObjectService = require('../services/storageObjectService');
const { getAdapter } = require('../services/storage');

function storageRoutes(cfg, db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // 分页列出存储对象
  router.get('/admin/storage/objects', ...superAdmin, (req, res) => {
    try {
      const result = storageObjectService.listObjects(db, {
        backend: req.query.backend || null,
        lifecycle: req.query.lifecycle || null,
        dramaId: req.query.drama_id != null && String(req.query.drama_id).trim() !== '' ? Number(req.query.drama_id) : null,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.page_size) || 20,
      });
      response.successWithPagination(res, result.items, result.total, result.page, result.pageSize);
    } catch (err) {
      log.error('[S12-T03] 列出存储对象失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 存储统计
  router.get('/admin/storage/stats', ...superAdmin, (req, res) => {
    try {
      response.success(res, storageObjectService.storageStats(db));
    } catch (err) {
      log.error('[S12-T03] 存储统计失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 当前后端健康检查
  router.get('/admin/storage/health', ...superAdmin, async (req, res) => {
    try {
      const adapter = getAdapter(cfg);
      const health = await adapter.healthCheck();
      response.success(res, { type: cfg?.storage?.type || 'local', ...health });
    } catch (err) {
      // 对象存储 SDK 未安装等情况给出清晰提示，而非 500
      response.success(res, { type: cfg?.storage?.type || 'local', ok: false, detail: err.message });
    }
  });

  // 生命周期扫描
  router.post('/admin/storage/lifecycle-scan', ...superAdmin, (req, res) => {
    try {
      const archiveDays = Number(req.body?.archive_days) || 90;
      const result = storageObjectService.runLifecycleScan(db, log, { archiveDays });
      response.success(res, result);
    } catch (err) {
      log.error('[S12-T03] 生命周期扫描失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // 逻辑删除对象记录
  router.delete('/admin/storage/objects/:id', ...superAdmin, (req, res) => {
    try {
      const ok = storageObjectService.markDeleted(db, req.params.id);
      if (!ok) return response.notFound(res, '对象不存在');
      response.success(res, { id: Number(req.params.id), lifecycle: 'deleted' });
    } catch (err) {
      log.error('[S12-T03] 删除对象记录失败', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  return router;
}

module.exports = storageRoutes;
