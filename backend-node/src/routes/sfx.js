'use strict';

/**
 * S20-T04 音效智能匹配接口（挂载于 /sfx）
 *  - GET /sfx/tags   素材库全部可用音效标签（聚合用户自有素材）
 *  - GET /sfx/match  按描述/标签匹配音效（仅用户自有素材，无第三方版权音效）
 */

const crypto = require('node:crypto');
const sfxService = require('../services/sfxService.js');

function makeReqId() { return 'REQ#SFX' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function maskUser(u) { return u ? { id: u.id, username: u.username || u.name, role: u.role } : null; }

function sfxRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const response = require('../response');
  const { requireAuth } = require('../middleware/auth');

  router.get('/tags', (req, res) => {
    try {
      const tags = sfxService.listTags(db);
      response.success(res, tags);
    } catch (err) {
      log.error('Sfx listTags failed', { error: err.message });
      response.internalError(res, err.message || '音效标签查询失败');
    }
  });

  router.get('/match', requireAuth, (req, res) => {
    const reqId = makeReqId();
    const { query, tags, limit, mode } = req.query || {};
    console.log(`[${reqId}] [ENTER] GET /sfx/match`, { query, tags, limit, mode, user: maskUser(req.user) });
    try {
      const result = sfxService.matchSfx(db, log, { query, tags, limit, mode });
      console.log(`[${reqId}] [DONE] 返回 ${result.length} 条匹配`);
      response.success(res, result);
    } catch (err) {
      log.error('Sfx match failed', { error: err.message });
      response.internalError(res, err.message || '音效匹配失败');
    }
  });

  return router;
}

module.exports = sfxRoutes;
