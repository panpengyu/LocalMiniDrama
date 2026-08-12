'use strict';

/**
 * S12-T05 欠费闭环 —— 创作权限余额守卫中间件
 *
 * 作用：在 AI 创作类接口（图片/视频/角色/场景/道具/分镜生成等）执行前，
 *       检查当前登录用户的积分余额（point_logs 最新 balance_after）。
 *       若余额为负（欠费）则拦截，返回 403 + "积分不足" 提示，阻止继续创作。
 *
 * 设计要点：
 *   - 复用 auth 中间件注入的 req.user；未登录（req.user 为空）时不拦截，
 *     交由后续 requireAuth（若有）处理，避免与鉴权职责重叠。
 *   - 余额判定统一走 financeService.getUserBalance，口径与欠费预警一致。
 *   - 超级管理员（super_admin）不受创作余额限制，便于后台调试/代运营。
 *   - 阈值可配：默认 < 0（欠费）才拦截；传入 minBalance 可提高门槛。
 *
 * 用法：
 *   const requireSufficientBalance = require('../middleware/balanceGuard')(db, log);
 *   r.post('/images', requireSufficientBalance, images.create);
 */

const response = require('../response');
const financeService = require('../services/financeService');

/**
 * 生成余额守卫中间件工厂。
 * @param {object} db  数据库连接
 * @param {object} log 日志
 * @param {object} [opts] { minBalance=0 } —— 余额低于该值即拦截（默认 0，即余额为负才拦）
 */
function balanceGuard(db, log, opts = {}) {
  const minBalance = Number(opts.minBalance) || 0;

  return function requireSufficientBalance(req, res, next) {
    try {
      const user = req.user;
      // 未登录：不在此处拦截（鉴权由 requireAuth 负责）
      if (!user || !user.id) return next();
      // 超级管理员豁免
      if (user.role === 'super_admin') return next();

      const balance = financeService.getUserBalance(db, user.id);
      if (balance < minBalance) {
        if (log) {
          log.warn('[S12-T05] 余额不足，创作请求被拦截', {
            user_id: user.id, balance, minBalance, path: req.originalUrl,
          });
        }
        return response.forbidden(
          res,
          `积分不足（当前余额 ${balance}），已暂停 AI 创作功能，请充值后重试。`
        );
      }
      return next();
    } catch (err) {
      // 守卫自身异常不应阻断正常创作，记录后放行（fail-open，避免误伤）
      if (log) log.error('[S12-T05] 余额守卫执行异常，放行', { error: err.message });
      return next();
    }
  };
}

module.exports = balanceGuard;
