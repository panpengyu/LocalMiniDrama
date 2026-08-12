'use strict';

/**
 * S13-T05 会员功能配额守卫中间件
 *
 * 作用：在受配额约束的接口执行前，按用户会员等级校验对应指标额度。
 *   - generation  ：校验并「原子占用」一次本月生成额度（成功后计数自增），超限 403。
 *   - project     ：校验可创建项目数是否已达上限，超限 403（不自增，创建成功由实际行数体现）。
 *   - collaborator：校验目标项目协作人数是否已达上限（需路由含 :id 项目参数），超限 403。
 *
 * 设计：
 *   - 复用 auth 注入的 req.user；未登录不在此拦截（交 requireAuth）。
 *   - super_admin 豁免（便于后台代运营 / 调试）。
 *   - generation 采用「先占额度」策略；若后续业务失败需回补，可调用 quotaService.consumeGeneration(-1)。
 *   - 守卫自身异常 fail-open（记录日志后放行），避免误伤正常创作。
 *
 * 用法：
 *   const quotaGuard = require('../middleware/quotaGuard')(db, log);
 *   r.post('/images', quotaGuard.generation, images.create);
 *   r.post('/dramas', quotaGuard.project, drama.createDrama);
 *   r.post('/dramas/:id/collaborators', quotaGuard.collaborator, ...);
 */

const response = require('../response');
const quotaService = require('../services/quotaService');

function quotaGuard(db, log) {
  function isExempt(req) {
    const user = req.user;
    if (!user || !user.id) return true;         // 未登录：不在此拦截
    if (user.role === 'super_admin') return true; // 超管豁免
    return false;
  }

  // 生成次数：校验 + 原子占用
  function generation(req, res, next) {
    if (isExempt(req)) return next();
    try {
      const r = quotaService.checkAndConsumeGeneration(db, req.user.id);
      // 供后续处理器读取（如需回补）
      req.quota = { generation: r };
      return next();
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED') {
        if (log) log.warn('[S13-T05] 生成配额超限', { user_id: req.user.id, quota: err.quota });
        return response.forbidden(res, err.message);
      }
      if (log) log.error('[S13-T05] 生成配额守卫异常，放行', { error: err.message });
      return next(); // fail-open
    }
  }

  // 项目数：仅校验，不占用
  function project(req, res, next) {
    if (isExempt(req)) return next();
    try {
      const c = quotaService.check(db, req.user.id, 'project');
      if (!c.allowed) {
        if (log) log.warn('[S13-T05] 项目数配额超限', { user_id: req.user.id, quota: c });
        return response.forbidden(res, `项目数已达上限（${c.limit} 个），请升级会员后再创建`);
      }
      return next();
    } catch (err) {
      if (log) log.error('[S13-T05] 项目配额守卫异常，放行', { error: err.message });
      return next();
    }
  }

  // 协作人数：需路由参数 :id 为项目ID
  function collaborator(req, res, next) {
    if (isExempt(req)) return next();
    try {
      const dramaId = Number(req.params.id || req.params.dramaId);
      if (!dramaId) return next();
      const c = quotaService.check(db, req.user.id, 'collaborator', { dramaId });
      if (!c.allowed) {
        if (log) log.warn('[S13-T05] 协作人数配额超限', { user_id: req.user.id, drama_id: dramaId, quota: c });
        return response.forbidden(res, `该项目协作人数已达上限（${c.limit} 人），请升级会员后再邀请`);
      }
      return next();
    } catch (err) {
      if (log) log.error('[S13-T05] 协作配额守卫异常，放行', { error: err.message });
      return next();
    }
  }

  return { generation, project, collaborator };
}

module.exports = quotaGuard;
