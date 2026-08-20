'use strict';

const { DEFAULT_PAGE_SIZE } = require('../constants/pagination');

/**
 * Sprint 12 - S12-T04 用户生命周期管理
 *
 * 基于真实业务数据（users / point_logs / user_activity_logs）计算：
 *   - 用户画像标签（profile_tags）
 *   - 行为活跃度（active_days_30 / total_actions）
 *   - 生命周期阶段（stage：new / active / paying / at_risk / churned）
 *   - 流失风险（churn_risk：low / medium / high）
 *   - 健康分（health_score：0-100，综合活跃、消费、充值、最近登录）
 *
 * 计算结果持久化到 user_lifecycle 表（MySQL），无 mock。
 * 行为埋点写入 user_activity_logs 表。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(v) {
  if (!v) return null;
  const ms = new Date(String(v).replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 记录一条用户行为埋点（供前后端各处调用）。
 * @param {object} meta { userId, action, targetType, targetId, meta }
 */
function trackActivity(db, log, { userId, action, targetType = null, targetId = null, meta = null }) {
  if (!userId || !action) return null;
  const now = new Date().toISOString();
  try {
    const info = db.prepare(
      `INSERT INTO user_activity_logs (user_id, action, target_type, target_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      Number(userId), String(action), targetType, targetId != null ? String(targetId) : null,
      meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null, now
    );
    return info.lastInsertRowid || info.insertId;
  } catch (e) {
    if (log) log.warn('[S12-T04] 行为埋点失败', { error: e.message, action });
    return null;
  }
}

/**
 * 聚合单个用户的真实行为/消费数据。
 */
function gatherUserFacts(db, user) {
  const uid = user.id;
  const nowMs = Date.now();

  // 30 天内活跃天数（按行为日志的独立日期数）
  const actRows = db.prepare(
    `SELECT created_at FROM user_activity_logs WHERE user_id = ?`
  ).all(uid);
  const totalActions = actRows.length;
  const daySet = new Set();
  let lastActivityMs = null;
  for (const r of actRows) {
    const ms = toMs(r.created_at);
    if (ms == null) continue;
    if (nowMs - ms <= 30 * DAY_MS) daySet.add(new Date(ms).toISOString().slice(0, 10));
    if (lastActivityMs == null || ms > lastActivityMs) lastActivityMs = ms;
  }
  const activeDays30 = daySet.size;

  // 充值与消费（真实 point_logs）
  const recharge = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM point_logs WHERE user_id = ? AND change_type = 'recharge' AND amount > 0`
  ).get(uid).s || 0;
  const consume = db.prepare(
    `SELECT COALESCE(SUM(ABS(amount)),0) s FROM point_logs WHERE user_id = ? AND change_type = 'consume'`
  ).get(uid).s || 0;
  const logCount = db.prepare(`SELECT COUNT(*) c FROM point_logs WHERE user_id = ?`).get(uid).c || 0;

  // 最近活跃时间：行为日志 / 最近登录 / 最近积分变动 取最大
  const lastLoginMs = toMs(user.last_login_at);
  const lastPointRow = db.prepare(
    `SELECT created_at FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(uid);
  const lastPointMs = lastPointRow ? toMs(lastPointRow.created_at) : null;
  const createdMs = toMs(user.created_at) || nowMs;
  const lastActiveMs = Math.max(lastActivityMs || 0, lastLoginMs || 0, lastPointMs || 0, 0) || createdMs;

  return {
    uid, nowMs, createdMs, totalActions, activeDays30,
    recharge: Number(recharge), consume: Number(consume), logCount,
    lastActiveMs, daysSinceActive: Math.floor((nowMs - lastActiveMs) / DAY_MS),
    daysSinceRegister: Math.floor((nowMs - createdMs) / DAY_MS),
  };
}

/**
 * 依据事实计算健康分 / 阶段 / 流失风险 / 画像标签。
 */
function computeLifecycle(facts) {
  const tags = [];

  // 健康分（0-100）：活跃(40) + 充值(25) + 消费(20) + 登录新鲜度(15)
  const activeScore = Math.min(40, facts.activeDays30 * 4); // 每活跃天 4 分，封顶 40
  const rechargeScore = facts.recharge > 0 ? Math.min(25, 10 + Math.log10(facts.recharge + 1) * 5) : 0;
  const consumeScore = facts.consume > 0 ? Math.min(20, Math.log10(facts.consume + 1) * 5) : 0;
  const freshnessScore = facts.daysSinceActive <= 3 ? 15
    : facts.daysSinceActive <= 7 ? 10
    : facts.daysSinceActive <= 14 ? 6
    : facts.daysSinceActive <= 30 ? 3 : 0;
  const healthScore = Math.round(activeScore + rechargeScore + consumeScore + freshnessScore);

  // 阶段
  let stage;
  if (facts.daysSinceActive > 30) stage = 'churned';
  else if (facts.daysSinceActive > 14) stage = 'at_risk';
  else if (facts.recharge > 0) stage = 'paying';
  else if (facts.daysSinceRegister <= 7) stage = 'new';
  else stage = 'active';

  // 流失风险
  let churnRisk;
  if (facts.daysSinceActive > 21 || healthScore < 25) churnRisk = 'high';
  else if (facts.daysSinceActive > 10 || healthScore < 50) churnRisk = 'medium';
  else churnRisk = 'low';

  // 画像标签
  if (facts.recharge > 0) tags.push('付费用户');
  if (facts.recharge >= 50000) tags.push('高价值');
  if (facts.activeDays30 >= 15) tags.push('高活跃');
  else if (facts.activeDays30 >= 5) tags.push('中活跃');
  else if (facts.activeDays30 > 0) tags.push('低活跃');
  if (facts.daysSinceRegister <= 7) tags.push('新注册');
  if (stage === 'churned') tags.push('已流失');
  else if (stage === 'at_risk') tags.push('流失预警');
  if (facts.consume > 0 && facts.recharge === 0) tags.push('仅体验(未付费)');

  return {
    stage,
    churn_risk: churnRisk,
    health_score: Math.max(0, Math.min(100, healthScore)),
    active_days_30: facts.activeDays30,
    total_actions: facts.totalActions,
    total_recharge: facts.recharge,
    profile_tags: tags.join(','),
    last_active_at: new Date(facts.lastActiveMs).toISOString(),
  };
}

/** 计算并落库单个用户的生命周期画像 */
function computeAndSave(db, log, user) {
  const facts = gatherUserFacts(db, user);
  const lc = computeLifecycle(facts);
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT user_id FROM user_lifecycle WHERE user_id = ?').get(user.id);
  if (existing) {
    db.prepare(
      `UPDATE user_lifecycle SET stage = ?, health_score = ?, churn_risk = ?, active_days_30 = ?,
       total_actions = ?, total_recharge = ?, profile_tags = ?, last_active_at = ?, computed_at = ? WHERE user_id = ?`
    ).run(
      lc.stage, lc.health_score, lc.churn_risk, lc.active_days_30, lc.total_actions,
      lc.total_recharge, lc.profile_tags, lc.last_active_at, now, user.id
    );
  } else {
    db.prepare(
      `INSERT INTO user_lifecycle (user_id, stage, health_score, churn_risk, active_days_30,
       total_actions, total_recharge, profile_tags, last_active_at, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.id, lc.stage, lc.health_score, lc.churn_risk, lc.active_days_30,
      lc.total_actions, lc.total_recharge, lc.profile_tags, lc.last_active_at, now
    );
  }
  return { user_id: user.id, ...lc };
}

/** 全量重算（管理端手动触发 / 定时任务） */
function recomputeAll(db, log) {
  const users = db.prepare("SELECT * FROM users WHERE deleted_at IS NULL AND role != 'super_admin'").all();
  let done = 0;
  for (const u of users) {
    try { computeAndSave(db, log, u); done += 1; } catch (e) {
      if (log) log.warn('[S12-T04] 用户生命周期计算失败', { user_id: u.id, error: e.message });
    }
  }
  if (log) log.info('[S12-T04] 生命周期全量重算完成', { users: users.length, done });
  return { ok: true, total: users.length, computed: done };
}

/** 生命周期概览（各阶段 / 各风险等级人数 + 健康分分布） */
function overview(db) {
  const byStage = db.prepare(
    `SELECT stage, COUNT(*) c FROM user_lifecycle GROUP BY stage`
  ).all();
  const byRisk = db.prepare(
    `SELECT churn_risk, COUNT(*) c FROM user_lifecycle GROUP BY churn_risk`
  ).all();
  const health = db.prepare(
    `SELECT
        SUM(CASE WHEN health_score >= 75 THEN 1 ELSE 0 END) as healthy,
        SUM(CASE WHEN health_score >= 50 AND health_score < 75 THEN 1 ELSE 0 END) as normal,
        SUM(CASE WHEN health_score >= 25 AND health_score < 50 THEN 1 ELSE 0 END) as weak,
        SUM(CASE WHEN health_score < 25 THEN 1 ELSE 0 END) as danger,
        COALESCE(AVG(health_score),0) as avg_score,
        COALESCE(SUM(total_recharge),0) as total_recharge
     FROM user_lifecycle`
  ).get();
  const total = db.prepare('SELECT COUNT(*) c FROM user_lifecycle').get().c || 0;
  return {
    total,
    by_stage: byStage.map((r) => ({ stage: r.stage, count: r.c })),
    by_risk: byRisk.map((r) => ({ churn_risk: r.churn_risk, count: r.c })),
    health: {
      healthy: Number(health.healthy) || 0,
      normal: Number(health.normal) || 0,
      weak: Number(health.weak) || 0,
      danger: Number(health.danger) || 0,
      avg_score: Math.round(Number(health.avg_score) || 0),
      total_recharge: Number(health.total_recharge) || 0,
    },
  };
}

/** 分页列出用户生命周期画像（join 用户名） */
function listProfiles(db, { stage = null, churnRisk = null, keyword = null, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  let sql = `FROM user_lifecycle lc JOIN users u ON u.id = lc.user_id WHERE u.deleted_at IS NULL`;
  const params = [];
  if (stage) { sql += ' AND lc.stage = ?'; params.push(stage); }
  if (churnRisk) { sql += ' AND lc.churn_risk = ?'; params.push(churnRisk); }
  if (keyword) { sql += ' AND (u.username LIKE ? OR u.nickname LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%'); }
  const total = db.prepare('SELECT COUNT(*) c ' + sql).get(...params).c || 0;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const rows = db.prepare(
    `SELECT lc.*, u.username, u.nickname, u.user_type, u.last_login_at ` + sql +
    ` ORDER BY lc.health_score ASC, lc.last_active_at ASC LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps);
  return { items: rows, total, page: p, pageSize: ps };
}

/** 流失预警列表（高风险优先） */
function churnWarnings(db, limit = 50) {
  return db.prepare(
    `SELECT lc.*, u.username, u.nickname FROM user_lifecycle lc JOIN users u ON u.id = lc.user_id
     WHERE u.deleted_at IS NULL AND lc.churn_risk IN ('high','medium')
     ORDER BY FIELD(lc.churn_risk,'high','medium'), lc.health_score ASC LIMIT ?`
  ).all(Math.min(200, Math.max(1, Number(limit) || 50)));
}

module.exports = {
  trackActivity,
  gatherUserFacts,
  computeLifecycle,
  computeAndSave,
  recomputeAll,
  overview,
  listProfiles,
  churnWarnings,
};
