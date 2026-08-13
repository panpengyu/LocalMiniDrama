'use strict';

/**
 * 通用「原子配额占位」守卫（多实例 / 多连接并发安全）
 *
 * 目的：把 H6/H7 修复中验证过的「原子占位」范式沉淀为可复用组件，供任意「累计型配额 / 名额」
 *       写入路径直接套用，避免各模块各写一遍「读→校验→写」而重新引入 TOCTOU 超发。
 *
 * 与既有 quotaGuard 的区别：
 *   - quotaGuard.project/collaborator 是「仅校验、不占位」的 before 中间件，校验与随后的 INSERT
 *     分属两步，存在竞态窗口（正是 H6/H7 的成因）。
 *   - 本守卫把「校验 + 写入」合并进单个写序列化事务（底层复用 utils/atomicQuota），从根上消除窗口。
 *
 * ★ 为何不是纯 before 中间件：
 *   真正的写入（INSERT）通常发生在路由处理器内部，纯 before 中间件无法把「校验」和「那条 INSERT」
 *   包进同一事务。因此本组件的主入口是 guardAndConsume(req, res, spec)——由处理器在「即将写入」处调用，
 *   把实际写入以 spec.mutate 回调交进来，在事务内一起原子执行。
 *
 * 典型用法（在路由处理器里）：
 *   const atomicQuotaGuard = require('../middleware/atomicQuotaGuard')(db, log);
 *   router.post('/things', requireAuth, (req, res) => {
 *     const out = atomicQuotaGuard.guardAndConsume(req, res, {
 *       // 上限：数值 / 函数(req)=>number；<0 表示无限制
 *       limit: (r) => resolveLimitFor(r.user.id),
 *       // MySQL 锚点行（强烈建议）：恒存在的父级行，覆盖 used=0 并发
 *       anchor: (r) => ({ table: 'users', id: r.user.id }),
 *       // 当前已用量（事务内执行）
 *       count: () => countThings(db, req.user.id),
 *       // 实际写入（事务内执行），返回值挂到 outcome.result
 *       mutate: () => insertThing(db, req.user.id, req.body),
 *       // 可选：本次是否占用新名额（幂等更新场景返回 false 跳过上限校验）
 *       consumesSeat: () => true,
 *       // 可选：超限时的 403 文案
 *       message: (limit) => `已达上限（${limit}）`,
 *     });
 *     if (!out) return;              // 已被守卫直接响应（403 / fail-closed 500）
 *     if (out.exempt) { ...直接放行的免检路径... }
 *     return response.created(res, out.result);
 *   });
 *
 * 设计要点：
 *   - 复用 auth 注入的 req.user；未登录不在此拦截（交 requireAuth）。
 *   - super_admin 豁免（与 quotaGuard/balanceGuard 口径一致），返回 { exempt:true, result }。
 *   - 「限额解析」阶段异常 fail-open（放行，避免误伤正常业务）；
 *     「事务写入」阶段异常 fail-closed（回滚并返回 500），保证不写坏数据。
 */

const response = require('../response');
const atomicQuota = require('../utils/atomicQuota');

/**
 * @param {object} db  数据库连接
 * @param {object} log 日志
 * @param {object} [factoryOpts] { exempt?(req):boolean } —— 自定义豁免判定（默认未登录/超管豁免）
 */
function atomicQuotaGuard(db, log, factoryOpts = {}) {
  const isExempt = typeof factoryOpts.exempt === 'function'
    ? factoryOpts.exempt
    : (req) => {
        const user = req && req.user;
        if (!user || !user.id) return true;          // 未登录：不在此拦截
        if (user.role === 'super_admin') return true; // 超管豁免
        return false;
      };

  /** 解析可能是「值 / 函数(req)」的配置项。 */
  function resolve(val, req) {
    return typeof val === 'function' ? val(req) : val;
  }

  /**
   * 核心：原子校验 + 占位写入。
   * @returns {object|null}
   *   - null                         已由本函数直接响应（403 或 fail-closed 500），调用方应 return。
   *   - { exempt:true, result }       命中豁免，已执行 mutate（未做上限校验）。
   *   - { ok:true, used, limit, result } 成功占位并写入。
   *   （ok:false 的超限情况不会返回给调用方——已在内部发 403 并返回 null。）
   */
  function guardAndConsume(req, res, spec) {
    const {
      limit,
      count,
      mutate,
      anchor,
      consumesSeat,
      message,
      tag = '[ATOMIC-QUOTA]',
    } = spec || {};

    if (typeof mutate !== 'function') {
      throw new Error('atomicQuotaGuard.guardAndConsume: spec.mutate 必须为函数');
    }

    // 豁免：直接执行写入，不做配额校验
    if (isExempt(req)) {
      return { exempt: true, result: mutate() };
    }

    // 1) 限额解析阶段：fail-open（异常按无限制放行，避免误伤）
    let lim;
    try {
      lim = Number(resolve(limit, req));
      if (!Number.isFinite(lim)) lim = -1;
    } catch (err) {
      if (log) log.warn(`${tag} 限额解析异常，放行`, { error: err.message, path: req.originalUrl });
      return { exempt: true, result: mutate() };
    }

    // 2) 事务写入阶段：fail-closed（异常回滚 + 500，绝不写坏数据）
    try {
      const outcome = atomicQuota.tryConsumeBounded({
        db,
        limit: lim,
        anchor: anchor ? resolve(anchor, req) : undefined,
        consumesSeat: typeof consumesSeat === 'function' ? consumesSeat : undefined,
        count: typeof count === 'function' ? count : () => 0,
        mutate,
      });

      if (!outcome.ok) {
        const msg = typeof message === 'function'
          ? message(outcome.limit, outcome.used)
          : (message || `配额已达上限（${outcome.limit}）`);
        if (log) log.warn(`${tag} 配额超限，已拦截`, { used: outcome.used, limit: outcome.limit, path: req.originalUrl });
        response.forbidden(res, msg);
        return null;
      }
      return outcome; // { ok:true, used, limit, result }
    } catch (err) {
      if (log) log.error(`${tag} 原子占位写入异常`, { error: err.message, path: req.originalUrl });
      response.internalError(res, err.message || '操作失败');
      return null;
    }
  }

  return { guardAndConsume };
}

module.exports = atomicQuotaGuard;
