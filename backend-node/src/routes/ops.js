'use strict';

/**
 * S21-T01/T02 版权检测 + 运维自动化接口（挂载于 /ops）
 *  - POST /ops/copyright/detect   对指定素材（或全部未检素材）执行版权指纹比对
 *  - GET  /ops/copyright/list     版权状态列表
 *  - POST /ops/scripts/:action    触发备份/恢复/回滚脚本（白名单）
 *  - GET  /ops/scaling-advice     扩缩容建议（真实指标）
 */

const crypto = require('node:crypto');
const opsService = require('../services/opsService.js');
const fingerprintService = require('../services/fingerprintService.js');

function makeReqId() { return 'REQ#OPS' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function maskUser(u) { return u ? { id: u.id, username: u.username || u.name, role: u.role } : null; }

function opsRoutes(db, log, cfg) {
  const express = require('express');
  const router = express.Router();
  const response = require('../utils/response');
  const { requireAuth, requireRole } = require('../middleware/auth');

  const adminOnly = [requireAuth, requireRole(['admin'])];

  // ============ 版权检测 ============
  router.post('/copyright/detect', ...adminOnly, (req, res) => {
    const reqId = makeReqId();
    const { asset_id, all } = req.body || {};
    console.log(`[${reqId}] [ENTER] POST /ops/copyright/detect`, { asset_id, all, user: maskUser(req.user) });
    try {
      const results = [];
      if (all) {
        const pending = db.prepare(
          `SELECT id FROM assets WHERE deleted_at IS NULL
           AND (copyright_status IS NULL OR copyright_status IN ('pending','unsupported'))
           ORDER BY id DESC LIMIT 200`
        ).all() || [];
        for (const row of pending) {
          results.push(fingerprintService.detectCopyright(db, log, cfg, { asset_id: row.id }));
        }
      } else if (asset_id != null && asset_id !== '') {
        results.push(fingerprintService.detectCopyright(db, log, cfg, { asset_id: Number(asset_id) }));
      } else {
        return response.badRequest(res, '请指定 asset_id 或 all=true');
      }
      console.log(`[${reqId}] [DONE] 检测 ${results.length} 条`);
      response.success(res, { count: results.length, results });
    } catch (err) {
      log.error('Copyright detect failed', { error: err.message });
      const code = err.code === 'ASSET_NOT_FOUND' ? 404 : 500;
      return response[code === 404 ? 'notFound' : 'internalError'](res, err.message || '版权检测失败');
    }
  });

  router.get('/copyright/list', ...adminOnly, (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] GET /ops/copyright/list`, { query: req.query, user: maskUser(req.user) });
    try {
      const data = fingerprintService.listCopyrightStatus(db, {
        page: req.query.page,
        pageSize: req.query.page_size,
        status: req.query.status,
      });
      response.success(res, data);
    } catch (err) {
      log.error('Copyright list failed', { error: err.message });
      response.internalError(res, err.message || '版权状态查询失败');
    }
  });

  // ============ 运维脚本 ============
  router.post('/scripts/:action', ...adminOnly, async (req, res) => {
    const reqId = makeReqId();
    const { action } = req.params;
    const { backup_dir } = req.body || {};
    const args = [];
    if (action === 'restore') {
      if (!backup_dir) return response.badRequest(res, 'restore 必须指定 backup_dir（备份目录）');
      args.push(String(backup_dir));
    }
    console.log(`[${reqId}] [ENTER] POST /ops/scripts/${action}`, { args, user: maskUser(req.user) });
    try {
      const result = await opsService.runScript(action, { args });
      console.log(`[${reqId}] [DONE] ${action} 执行成功`);
      response.success(res, { action, output: result.output, code: result.code });
    } catch (err) {
      log.error(`Ops script ${action} failed`, { error: err.message, output: err.output });
      const code = err.code === 'BAD_ACTION' ? 400 : 500;
      return response[code === 400 ? 'badRequest' : 'internalError'](res, err.message || '脚本执行失败');
    }
  });

  // ============ 扩缩容建议 ============
  router.get('/scaling-advice', ...adminOnly, async (req, res) => {
    const reqId = makeReqId();
    console.log(`[${reqId}] [ENTER] GET /ops/scaling-advice`, { user: maskUser(req.user) });
    try {
      const advice = await opsService.getScalingAdvice(db, log);
      console.log(`[${reqId}] [DONE] level=${advice.level}`);
      response.success(res, advice);
    } catch (err) {
      log.error('Scaling advice failed', { error: err.message });
      response.internalError(res, err.message || '扩缩容建议获取失败');
    }
  });

  return router;
}

module.exports = opsRoutes;
