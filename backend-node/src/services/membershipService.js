'use strict';

/**
 * Sprint 13 - S13-T01 / S13-T02 会员等级体系 + 计费系统
 *
 * 职责：
 *   S13-T01 会员等级体系：免费/基础/专业/企业 四级套餐读取 + 功能配额定义解析
 *   S13-T02 会员计费系统：月付/年付/终身 计费周期、下单金额计算、开通/续费/升级/降级、
 *           自动续费到期处理。
 *
 * 数据存储：全部落地本地 MySQL（membership_plans / user_memberships / membership_orders，
 *           由 migration 49 创建）。无 mock。
 *
 * 时间基准：会员到期判定统一以「数据库时钟」为准（NOW() / DATE_ADD(NOW(), INTERVAL ...)），
 *           避免 Node 进程与 MySQL 会话时区不一致导致的偏移，沿用 collaborationService 约定。
 *
 * 计费约定：金额单位为「元」（DECIMAL）。升级采用「按剩余价值折抵 + 立即生效」策略：
 *           升级时将当前套餐剩余有效期的价值按日折算抵扣新套餐首期金额；
 *           降级采用「到期后生效」策略（预约降级，不即时退款），符合行业惯例且不涉及退款风控。
 */

const DEFAULT_LEVEL = 'free';

// 计费周期 → 天数（终身为 null，表示永不过期）
const CYCLE_DAYS = { monthly: 30, yearly: 365, lifetime: null };
const VALID_CYCLES = Object.keys(CYCLE_DAYS);

// 双库兼容时间表达式（沿用 collaborationService 的做法）
function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}
function futureDaysExpr(db) {
  return db.type === 'mysql'
    ? 'DATE_ADD(NOW(), INTERVAL ? DAY)'
    : "datetime('now', '+' || ? || ' days')";
}

// ===========================================================================
// S13-T01 套餐与配额读取
// ===========================================================================

/** 列出全部上架套餐（按 level_rank 升序），quota_config/benefits 解析为对象。 */
function listPlans(db, includeDisabled = false) {
  const sql = `SELECT * FROM membership_plans${includeDisabled ? '' : ' WHERE enabled = 1'} ORDER BY sort_order ASC, level_rank ASC`;
  return (db.prepare(sql).all() || []).map(decoratePlan);
}

/** 按等级代码读取套餐。 */
function getPlanByLevel(db, levelCode) {
  const row = db.prepare('SELECT * FROM membership_plans WHERE level_code = ?').get(String(levelCode));
  return row ? decoratePlan(row) : null;
}

/** 按主键读取套餐。 */
function getPlanById(db, id) {
  const row = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(Number(id));
  return row ? decoratePlan(row) : null;
}

/** 解析 JSON 字段，附带便捷读取。 */
function decoratePlan(row) {
  let quota = {};
  let benefits = [];
  try { quota = row.quota_config ? JSON.parse(row.quota_config) : {}; } catch (_) { quota = {}; }
  try { benefits = row.benefits ? JSON.parse(row.benefits) : []; } catch (_) { benefits = []; }
  return { ...row, quota, benefits };
}

/** 取某周期价格（元）。lifetime 只读 price_lifetime；返回 null 表示该周期不售卖。 */
function priceForCycle(plan, cycle) {
  if (!plan) return null;
  if (cycle === 'monthly') return plan.price_monthly != null ? Number(plan.price_monthly) : null;
  if (cycle === 'yearly') return plan.price_yearly != null ? Number(plan.price_yearly) : null;
  if (cycle === 'lifetime') return plan.price_lifetime != null ? Number(plan.price_lifetime) : null;
  return null;
}

// ===========================================================================
// S13-T02 用户会员关系
// ===========================================================================

/**
 * 读取用户当前有效会员（含套餐信息）。
 * 规则：
 *   - 无记录 → 默认免费版（free）
 *   - 有记录但已过期（expires_at < NOW()，终身除外）→ 视为 free，并顺带将 status 落库为 expired
 * @returns {{ membership, plan, levelCode, isActive }}
 */
function getUserMembership(db, userId) {
  const uid = Number(userId);
  const row = db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(uid);
  const freePlan = getPlanByLevel(db, DEFAULT_LEVEL);

  if (!row) {
    return { membership: null, plan: freePlan, levelCode: DEFAULT_LEVEL, isActive: true };
  }

  // 终身会员永不过期；否则按数据库时钟判断是否过期
  const lifetime = row.billing_cycle === 'lifetime';
  let expired = false;
  if (!lifetime && row.expires_at) {
    const chk = db.prepare(`SELECT (expires_at < ${nowExpr(db)}) AS expired FROM user_memberships WHERE id = ?`).get(row.id);
    expired = !!(chk && Number(chk.expired) === 1);
  }

  if (expired) {
    if (row.status !== 'expired') {
      db.prepare("UPDATE user_memberships SET status = 'expired', updated_at = " + nowExpr(db) + ' WHERE id = ?').run(row.id);
    }
    return { membership: { ...row, status: 'expired' }, plan: freePlan, levelCode: DEFAULT_LEVEL, isActive: false };
  }

  const plan = getPlanById(db, row.plan_id) || freePlan;
  return { membership: row, plan, levelCode: row.level_code, isActive: row.status === 'active' };
}

/**
 * 升级/降级/续费判定：给定当前等级与目标套餐，返回订单类型。
 *   new       当前 free（或无有效会员）→ 目标付费
 *   renew     目标等级 == 当前等级
 *   upgrade   目标 level_rank > 当前
 *   downgrade 目标 level_rank < 当前（且当前非 free）
 */
function classifyOrderType(db, userId, targetPlan) {
  const { plan: currentPlan, isActive } = getUserMembership(db, userId);
  const curRank = isActive ? Number(currentPlan.level_rank) : 0;
  const tgtRank = Number(targetPlan.level_rank);
  if (curRank === 0) return 'new';
  if (tgtRank === curRank) return 'renew';
  return tgtRank > curRank ? 'upgrade' : 'downgrade';
}

/**
 * 计算下单应付金额（元）。
 *   - 续费/新购/降级预约：按目标套餐该周期原价
 *   - 升级：目标周期价格 - 当前套餐剩余有效期折抵价值（不为负）
 *
 * 升级折抵：以当前套餐「日单价」× 剩余天数 计算已付未用价值，从新套餐首期扣减。
 * 终身套餐无剩余天数概念，升级至终身不折抵（终身为一次性）。
 *
 * @returns {{ amount, orderType, basePrice, credit }}
 */
function computeOrderAmount(db, userId, targetPlan, cycle) {
  const basePrice = priceForCycle(targetPlan, cycle);
  if (basePrice == null) {
    const err = new Error(`套餐「${targetPlan.name}」不支持 ${cycle} 计费周期`);
    err.code = 'INVALID_CYCLE';
    throw err;
  }
  const orderType = classifyOrderType(db, userId, targetPlan);
  let credit = 0;

  if (orderType === 'upgrade' && cycle !== 'lifetime') {
    const { membership, plan: currentPlan } = getUserMembership(db, userId);
    if (membership && membership.billing_cycle !== 'lifetime' && membership.expires_at) {
      // 剩余天数（数据库时钟，向下取整，最小0）
      const daysRow = db.type === 'mysql'
        ? db.prepare('SELECT GREATEST(TIMESTAMPDIFF(DAY, NOW(), expires_at), 0) AS d FROM user_memberships WHERE id = ?').get(membership.id)
        : db.prepare("SELECT MAX(CAST((julianday(expires_at) - julianday('now')) AS INTEGER), 0) AS d FROM user_memberships WHERE id = ?").get(membership.id);
      const remainDays = daysRow ? Number(daysRow.d) || 0 : 0;
      const curCycleDays = CYCLE_DAYS[membership.billing_cycle] || 30;
      const curPrice = priceForCycle(currentPlan, membership.billing_cycle) || 0;
      const dailyValue = curCycleDays > 0 ? curPrice / curCycleDays : 0;
      credit = Math.min(basePrice, +(dailyValue * remainDays).toFixed(2));
    }
  }

  const amount = +Math.max(0, basePrice - credit).toFixed(2);
  return { amount, orderType, basePrice, credit: +credit.toFixed(2) };
}

/**
 * 开通/续费/升级会员（在支付成功后调用；由 paymentService 在事务内驱动）。
 * 依据订单类型与周期，写入/更新 user_memberships 的等级、到期时间、状态与自动续费。
 *
 * 到期时间计算：
 *   - lifetime：expires_at = NULL（永不过期）
 *   - renew（同级续期，且当前未过期）：在原到期时间基础上顺延 N 天（不损失剩余时长）
 *   - 其它（new/upgrade/降级到期后由定时任务处理，这里 upgrade 立即生效）：从 NOW() 起算 N 天
 *
 * @param {object} opts { userId, plan, cycle, orderType, orderId, autoRenew }
 * @returns {object} 最新 user_memberships 行
 */
function activateMembership(db, { userId, plan, cycle, orderType, orderId, autoRenew }) {
  const uid = Number(userId);
  const levelCode = plan.level_code;
  const days = CYCLE_DAYS[cycle];
  const existing = db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(uid);

  // 是否在原到期时间上顺延（仅同级续费且当前有效且非终身）
  const extend = orderType === 'renew' && existing && existing.status === 'active'
    && existing.billing_cycle !== 'lifetime' && existing.expires_at;

  // 计算到期时间 SQL 片段与参数
  let expiresSql;
  const params = [];
  if (cycle === 'lifetime') {
    expiresSql = 'NULL';
  } else if (extend) {
    expiresSql = db.type === 'mysql'
      ? 'DATE_ADD(GREATEST(expires_at, NOW()), INTERVAL ? DAY)'
      : "datetime(MAX(expires_at, datetime('now')), '+' || ? || ' days')";
    params.push(days);
  } else {
    expiresSql = futureDaysExpr(db);
    params.push(days);
  }

  const auto = autoRenew ? 1 : 0;

  if (existing) {
    // UPDATE：started_at 仅在非顺延续费时刷新
    const startedSql = extend ? 'started_at' : nowExpr(db);
    const sql = `UPDATE user_memberships
      SET plan_id = ?, level_code = ?, billing_cycle = ?, status = 'active',
          auto_renew = ?, started_at = ${startedSql}, expires_at = ${expiresSql},
          last_order_id = ?, updated_at = ${nowExpr(db)}
      WHERE id = ?`;
    // 参数顺序：plan_id, level_code, billing_cycle, auto_renew, [days?], last_order_id, id
    const runParams = [plan.id, levelCode, cycle, auto, ...params, orderId != null ? Number(orderId) : null, existing.id];
    db.prepare(sql).run(...runParams);
  } else {
    const sql = `INSERT INTO user_memberships
      (user_id, plan_id, level_code, billing_cycle, status, auto_renew, started_at, expires_at, last_order_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ${nowExpr(db)}, ${expiresSql}, ?, ${nowExpr(db)}, ${nowExpr(db)})`;
    const runParams = [uid, plan.id, levelCode, cycle, auto, ...params, orderId != null ? Number(orderId) : null];
    db.prepare(sql).run(...runParams);
  }
  return db.prepare('SELECT * FROM user_memberships WHERE user_id = ?').get(uid);
}

/** 开/关自动续费。 */
function setAutoRenew(db, userId, enabled) {
  const res = db.prepare(
    `UPDATE user_memberships SET auto_renew = ?, updated_at = ${nowExpr(db)} WHERE user_id = ?`
  ).run(enabled ? 1 : 0, Number(userId));
  return res.changes > 0;
}

/**
 * 取消会员（关闭自动续费，状态置 cancelled，但保留至到期；到期后由 processExpirations 落为 expired）。
 */
function cancelMembership(db, userId) {
  const res = db.prepare(
    `UPDATE user_memberships SET status = 'cancelled', auto_renew = 0, updated_at = ${nowExpr(db)}
     WHERE user_id = ? AND status = 'active'`
  ).run(Number(userId));
  return res.changes > 0;
}

/**
 * 到期处理（供定时任务调用）：将已过期（非终身）的 active/cancelled 会员落为 expired。
 * 返回处理条数。（自动续费的真实扣款由 paymentService 生成续费订单驱动，此处只做过期落库。）
 */
function processExpirations(db, log) {
  const res = db.prepare(
    `UPDATE user_memberships
     SET status = 'expired', updated_at = ${nowExpr(db)}
     WHERE billing_cycle <> 'lifetime' AND status IN ('active','cancelled')
       AND expires_at IS NOT NULL AND expires_at < ${nowExpr(db)}`
  ).run();
  const n = res.changes || 0;
  if (log && n > 0) log.info('[S13-T02] 会员到期处理', { expired: n });
  return n;
}

module.exports = {
  DEFAULT_LEVEL,
  CYCLE_DAYS,
  VALID_CYCLES,
  // S13-T01
  listPlans,
  getPlanByLevel,
  getPlanById,
  priceForCycle,
  // S13-T02
  getUserMembership,
  classifyOrderType,
  computeOrderAmount,
  activateMembership,
  setAutoRenew,
  cancelMembership,
  processExpirations,
};
