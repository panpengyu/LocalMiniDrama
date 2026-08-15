'use strict';

const { snowflakeId } = require('../utils/snowflake');

/**
 * Sprint 12 - S12-T05 财务与计费增强
 *
 * 基于真实业务数据计算：
 *   - 实时成本核算：AI 模型调用成本（ai_model_call_logs.cost）
 *   - 收入：充值订单（recharges，pay_status='paid'）
 *   - 积分收支：point_logs（recharge / consume）
 *   - 利润分析：毛利 = 收入(元) - 模型成本(元)
 *   - 智能计费规则：billing_rules（按业务类型 / 用户等级配置单价与折扣）
 *   - 欠费预警：积分余额（point_logs 最新 balance_after）为负或过低的用户
 *   - 财务日报：finance_daily_reports（可持久化每日汇总）
 *
 * 全部数据来自 MySQL，无 mock。
 * 说明：积分与人民币换算沿用系统既有约定 100 积分 = 1 元（recharges.amount 为元，points 为积分）。
 */

const POINTS_PER_YUAN = 100;

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

function toYuan(points) {
  return +((Number(points) || 0) / POINTS_PER_YUAN).toFixed(2);
}

/** 财务总览：收入 / 成本 / 毛利 / 付费用户 / ARPU */
function overview(db, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const revenueRow = db.prepare(
    `SELECT COALESCE(SUM(amount),0) amount, COALESCE(SUM(points),0) points, COUNT(*) orders
     FROM recharges WHERE pay_status = 'paid'`
  ).get();
  const revenueRecent = db.prepare(
    `SELECT COALESCE(SUM(amount),0) amount FROM recharges WHERE pay_status = 'paid' AND created_at >= ?`
  ).get(since).amount || 0;

  const modelCostRow = db.prepare(
    `SELECT COALESCE(SUM(cost),0) cost, COUNT(*) calls FROM ai_model_call_logs`
  ).get();
  const modelCost = Number(modelCostRow.cost) || 0;

  const consumedPoints = db.prepare(
    `SELECT COALESCE(SUM(ABS(amount)),0) s FROM point_logs WHERE change_type = 'consume'`
  ).get().s || 0;

  const payingUsers = db.prepare(
    `SELECT COUNT(DISTINCT user_id) c FROM recharges WHERE pay_status = 'paid'`
  ).get().c || 0;

  const totalRevenue = Number(revenueRow.amount) || 0;
  const grossProfit = +(totalRevenue - modelCost).toFixed(2);
  const grossMargin = totalRevenue > 0 ? +((grossProfit / totalRevenue) * 100).toFixed(2) : 0;
  const arpu = payingUsers > 0 ? +(totalRevenue / payingUsers).toFixed(2) : 0;

  return {
    revenue: { total: totalRevenue, recent: Number(revenueRecent), orders: revenueRow.orders || 0, recharge_points: Number(revenueRow.points) || 0 },
    cost: { model_cost: +modelCost.toFixed(4), model_calls: modelCostRow.calls || 0 },
    profit: { gross_profit: grossProfit, gross_margin: grossMargin },
    consumed_points: Number(consumedPoints),
    consumed_value: toYuan(consumedPoints),
    paying_users: payingUsers,
    arpu,
    days,
  };
}

/** 成本构成：按 service_type 汇总模型成本与调用量 */
function costBreakdown(db) {
  const rows = db.prepare(
    `SELECT service_type, COUNT(*) calls, COALESCE(SUM(cost),0) cost,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success
     FROM ai_model_call_logs GROUP BY service_type ORDER BY cost DESC`
  ).all();
  return rows.map((r) => ({
    service_type: r.service_type,
    calls: r.calls,
    success: r.success,
    cost: +(Number(r.cost) || 0).toFixed(4),
  }));
}

/** 收入/成本按日趋势（近 N 天，全部真实数据） */
function dailyTrend(db, { days = 14 } = {}) {
  const dateExpr = db.type === 'mysql' ? "DATE_FORMAT(created_at, '%Y-%m-%d')" : "strftime('%Y-%m-%d', created_at)";
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const revRows = db.prepare(
    `SELECT ${dateExpr} d, COALESCE(SUM(amount),0) v FROM recharges
     WHERE pay_status='paid' AND created_at >= ? GROUP BY ${dateExpr}`
  ).all(since);
  const costRows = db.prepare(
    `SELECT ${dateExpr} d, COALESCE(SUM(cost),0) v FROM ai_model_call_logs
     WHERE created_at >= ? GROUP BY ${dateExpr}`
  ).all(since);

  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const revMap = Object.fromEntries(revRows.map((r) => [r.d, Number(r.v) || 0]));
  const costMap = Object.fromEntries(costRows.map((r) => [r.d, Number(r.v) || 0]));
  return {
    dates,
    revenue: dates.map((d) => +(revMap[d] || 0).toFixed(2)),
    cost: dates.map((d) => +(costMap[d] || 0).toFixed(4)),
    profit: dates.map((d) => +((revMap[d] || 0) - (costMap[d] || 0)).toFixed(2)),
  };
}

/**
 * 欠费/低额预警：取每个用户最新一条 point_logs 的 balance_after，
 * 余额 < threshold 的用户列入预警（余额为负=欠费）。
 */
function arrearsWarnings(db, { threshold = 0, limit = 50 } = {}) {
  // 每个用户最新余额：子查询取最大 id
  const rows = db.prepare(
    `SELECT p.user_id, p.balance_after, u.username, u.nickname
     FROM point_logs p
     JOIN (SELECT user_id, MAX(id) mid FROM point_logs GROUP BY user_id) latest
       ON p.user_id = latest.user_id AND p.id = latest.mid
     JOIN users u ON u.id = p.user_id
     WHERE u.deleted_at IS NULL AND p.balance_after < ?
     ORDER BY p.balance_after ASC LIMIT ?`
  ).all(Number(threshold), Math.min(200, Math.max(1, Number(limit) || 50)));
  return rows.map((r) => ({
    user_id: r.user_id,
    username: r.username,
    nickname: r.nickname,
    balance: Number(r.balance_after) || 0,
    level: (Number(r.balance_after) || 0) < 0 ? 'arrears' : 'low',
  }));
}

/**
 * 读取单个用户当前积分余额：取该用户最新一条 point_logs 的 balance_after。
 * 无任何流水时视为 0（新用户）。返回整数积分。
 */
function getUserBalance(db, userId) {
  const uid = Number(userId);
  if (!uid) return 0;
  const row = db.prepare(
    'SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(uid);
  // MySQL 包装层无行返回 null，SQLite 返回 undefined
  if (row == null) return 0;
  return Number(row.balance_after) || 0;
}

/**
 * 原子扣减用户积分（防并发 lost update / 余额变负）。
 *
 * point_logs 为「仅追加」账本，余额由最新一行 balance_after 派生，无 users.balance 单行可原子自增。
 * 因此这里在用户锚点行（users）上加行锁使同一用户的余额变更串行化：
 *   MySQL：SELECT ... FOR UPDATE 锁 users 行；SQLite：由 immediate 写事务串行化。
 * 锁定后再读取最新余额、校验充足、写入 consume 流水，杜绝「读余额→写扣减」之间的 TOCTOU 窗口。
 *
 * 必须在事务内调用（调用方用 db.transaction 包裹）。
 * @param {object} opts { userId, points(正整数，需扣减的积分), businessType, relatedId, remark }
 * @returns {{ needPoints, balanceBefore, balanceAfter }}
 */
function deductPointsAtomic(db, { userId, points, businessType, relatedId, remark }) {
  const uid = Number(userId);
  const need = Math.round(Number(points) || 0);
  if (!uid) { const e = new Error('无效用户'); e.code = 'INVALID_USER'; throw e; }
  if (need <= 0) { const e = new Error('扣减积分必须为正'); e.code = 'INVALID_AMOUNT'; throw e; }

  // 锁定用户锚点行，串行化该用户的余额变更（MySQL 行锁 / SQLite 写事务）
  if (db.type === 'mysql') {
    db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(uid);
  }
  const balanceBefore = getUserBalance(db, uid);
  if (balanceBefore < need) {
    const e = new Error(`积分不足：需 ${need} 积分，当前 ${balanceBefore}`);
    e.code = 'INSUFFICIENT_POINTS';
    throw e;
  }
  const balanceAfter = balanceBefore - need;
  db.prepare(
    `INSERT INTO point_logs (id, user_id, change_type, business_type, amount, balance_after, related_id, remark, created_at)
     VALUES (?, ?, 'consume', ?, ?, ?, ?, ?, ${nowExpr(db)})`
  ).run(snowflakeId(), uid, businessType || 'consume', -need, balanceAfter, relatedId || null, remark || null);
  return { needPoints: need, balanceBefore, balanceAfter };
}

/**
 * S12-T05 欠费闭环 —— 触发欠费预警通知（写入 platform_notifications）。
 *
 * 对每个被 arrearsWarnings 命中的用户创建一条站内通知；通过 dedup_key
 * （arrears:userId:yyyymmdd）+ 唯一索引保证同一用户同一天只推送一次，幂等安全。
 *
 * @returns {{ scanned:number, notified:number, items:Array }}
 */
function notifyArrears(db, log, { threshold = 0, limit = 200 } = {}) {
  const warnings = arrearsWarnings(db, { threshold, limit });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // yyyymmdd
  let notified = 0;
  const items = [];

  for (const w of warnings) {
    const isArrears = w.level === 'arrears';
    const dedupKey = `arrears:${w.user_id}:${today}`;
    // 幂等：同一用户同一天已有欠费通知则跳过
    const exists = db.prepare(
      'SELECT id FROM platform_notifications WHERE dedup_key = ? LIMIT 1'
    ).get(dedupKey);
    if (exists != null) continue;

    const title = isArrears ? '积分已欠费，创作功能已受限' : '积分余额偏低提醒';
    const content = isArrears
      ? `您的积分余额为 ${w.balance}（已为负），当前无法继续使用 AI 创作功能，请尽快充值后恢复。`
      : `您的积分余额为 ${w.balance}，偏低，建议及时充值以免影响创作。`;
    const payload = JSON.stringify({ balance: w.balance, level: w.level, threshold });
    try {
      db.prepare(
        `INSERT INTO platform_notifications
           (user_id, category, level, title, content, payload, dedup_key, is_read, created_at)
         VALUES (?, 'arrears', ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
      ).run(
        Number(w.user_id),
        isArrears ? 'critical' : 'warning',
        title, content, payload, dedupKey
      );
      notified += 1;
      items.push({ user_id: w.user_id, level: w.level, dedup_key: dedupKey });
    } catch (e) {
      // 并发下唯一键冲突（同日重复）：视为已通知，静默跳过
      if (!/duplicate|unique/i.test(e.message || '')) {
        if (log) log.warn('[S12-T05] 欠费通知写入失败', { user_id: w.user_id, error: e.message });
      }
    }
  }
  if (log) log.info('[S12-T05] 欠费预警通知完成', { scanned: warnings.length, notified });
  return { scanned: warnings.length, notified, items };
}

// ==================== 计费规则 CRUD ====================

function listBillingRules(db) {
  return db.prepare(
    `SELECT * FROM billing_rules ORDER BY priority DESC, id ASC`
  ).all();
}

function createBillingRule(db, log, r) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO billing_rules (name, business_type, user_level, unit_points, discount, enabled, priority, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    r.name || '', r.business_type || 'text', r.user_level || 'all',
    Number(r.unit_points) || 0, Number(r.discount) != null ? Number(r.discount) : 1,
    r.enabled === false ? 0 : 1, Number(r.priority) || 0, r.remark || null, now, now
  );
  const id = info.lastInsertRowid || info.insertId;
  if (log) log.info('[S12-T05] 计费规则创建', { id, name: r.name });
  return db.prepare('SELECT * FROM billing_rules WHERE id = ?').get(id);
}

function updateBillingRule(db, log, id, r) {
  const exist = db.prepare('SELECT id FROM billing_rules WHERE id = ?').get(Number(id));
  if (!exist) return null;
  const updates = [];
  const params = [];
  const map = { name: 'name', business_type: 'business_type', user_level: 'user_level', unit_points: 'unit_points', discount: 'discount', priority: 'priority', remark: 'remark' };
  for (const [k, col] of Object.entries(map)) {
    if (r[k] !== undefined) { updates.push(`${col} = ?`); params.push(r[k]); }
  }
  if (r.enabled !== undefined) { updates.push('enabled = ?'); params.push(r.enabled ? 1 : 0); }
  if (!updates.length) return db.prepare('SELECT * FROM billing_rules WHERE id = ?').get(Number(id));
  params.push(new Date().toISOString(), Number(id));
  db.prepare(`UPDATE billing_rules SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  if (log) log.info('[S12-T05] 计费规则更新', { id });
  return db.prepare('SELECT * FROM billing_rules WHERE id = ?').get(Number(id));
}

function deleteBillingRule(db, log, id) {
  const result = db.prepare('DELETE FROM billing_rules WHERE id = ?').run(Number(id));
  if (log) log.info('[S12-T05] 计费规则删除', { id });
  return (result.changes || 0) > 0;
}

/**
 * 智能计费：根据业务类型 + 用户等级匹配最高优先级启用规则，计算应扣积分。
 * 命中不到规则时返回 baseUnitPoints（保持系统既有计费不变）。
 */
function computeCharge(db, { businessType, userLevel = 'all', quantity = 1, baseUnitPoints = 0 }) {
  const rules = db.prepare(
    `SELECT * FROM billing_rules WHERE enabled = 1 AND business_type = ?
       AND (user_level = ? OR user_level = 'all')
     ORDER BY (user_level = ?) DESC, priority DESC LIMIT 1`
  ).all(businessType, userLevel, userLevel);
  const rule = rules[0];
  const unit = rule ? rule.unit_points : baseUnitPoints;
  const discount = rule && rule.discount != null ? Number(rule.discount) : 1;
  const points = Math.round(unit * Number(quantity) * discount);
  return { points, unit_points: unit, discount, rule_id: rule ? rule.id : null, matched: !!rule };
}

// ==================== 财务日报 ====================

/** 生成/更新某日财务日报（真实汇总，落库 finance_daily_reports） */
function computeDailyReport(db, log, dateStr = null) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  const dateExpr = db.type === 'mysql' ? "DATE_FORMAT(created_at, '%Y-%m-%d')" : "strftime('%Y-%m-%d', created_at)";

  const rev = db.prepare(`SELECT COALESCE(SUM(amount),0) v, COALESCE(SUM(points),0) p FROM recharges WHERE pay_status='paid' AND ${dateExpr} = ?`).get(day);
  const consumed = db.prepare(`SELECT COALESCE(SUM(ABS(amount)),0) v FROM point_logs WHERE change_type='consume' AND ${dateExpr} = ?`).get(day).v || 0;
  const cost = db.prepare(`SELECT COALESCE(SUM(cost),0) v FROM ai_model_call_logs WHERE ${dateExpr} = ?`).get(day).v || 0;
  const paying = db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM recharges WHERE pay_status='paid' AND ${dateExpr} = ?`).get(day).c || 0;

  const revenue = Number(rev.v) || 0;
  const modelCost = Number(cost) || 0;
  const grossProfit = +(revenue - modelCost).toFixed(2);
  const arpu = paying > 0 ? +(revenue / paying).toFixed(4) : 0;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM finance_daily_reports WHERE report_date = ?').get(day);
  if (existing) {
    db.prepare(
      `UPDATE finance_daily_reports SET revenue=?, recharge_points=?, consumed_points=?, model_cost=?, gross_profit=?, paying_users=?, arpu=? WHERE id=?`
    ).run(revenue, Number(rev.p) || 0, Number(consumed), modelCost, grossProfit, paying, arpu, existing.id);
  } else {
    db.prepare(
      `INSERT INTO finance_daily_reports (report_date, revenue, recharge_points, consumed_points, model_cost, gross_profit, paying_users, arpu, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(day, revenue, Number(rev.p) || 0, Number(consumed), modelCost, grossProfit, paying, arpu, now);
  }
  if (log) log.info('[S12-T05] 财务日报已生成', { date: day, revenue, model_cost: modelCost, gross_profit: grossProfit });
  return db.prepare('SELECT * FROM finance_daily_reports WHERE report_date = ?').get(day);
}

/** 查询财务日报（近 N 天） */
function listDailyReports(db, { days = 30 } = {}) {
  return db.prepare(
    `SELECT * FROM finance_daily_reports ORDER BY report_date DESC LIMIT ?`
  ).all(Math.min(365, Math.max(1, Number(days) || 30)));
}

module.exports = {
  POINTS_PER_YUAN,
  toYuan,
  overview,
  costBreakdown,
  dailyTrend,
  arrearsWarnings,
  getUserBalance,
  deductPointsAtomic,
  notifyArrears,
  listBillingRules,
  createBillingRule,
  updateBillingRule,
  deleteBillingRule,
  computeCharge,
  computeDailyReport,
  listDailyReports,
};
