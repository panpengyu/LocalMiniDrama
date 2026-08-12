'use strict';

/**
 * Sprint 13 - S13-T05 功能配额限制
 *
 * 依据用户当前会员等级（membershipService.getUserMembership → plan.quota_config）对四类资源限额：
 *   - generation   每月 AI 生成次数（自然月周期，period_key=yyyymm）
 *   - project      可创建项目数（累计型，实时统计 dramas）
 *   - storage      存储空间 MB（累计型，实时统计 storage_objects + assets）
 *   - collaborator 单项目最大协作人数（实时统计 collaboration_members）
 *
 * 配额值约定：-1 表示无限制；数值表示上限。免费用户（无会员记录）取 free 套餐配额。
 *
 * 用量来源（全部真实 MySQL 聚合，无 mock）：
 *   generation   —— membership_quota_usage(metric='generation', period_key=当前月) 的原子计数；
 *                    该计数由 consumeGeneration() 在每次成功生成后自增，杜绝并发下的超发。
 *   project      —— SELECT COUNT(*) FROM dramas WHERE created_by=? AND deleted_at IS NULL
 *   storage      —— storage_objects.size_bytes 之和（按 owner）+ 未纳管 assets.file_size 之和
 *   collaborator —— SELECT COUNT(*) FROM collaboration_members WHERE drama_id=? AND status='active'
 *
 * 与积分体系关系：积分（point_logs）为「按量计费」的消耗货币，会员配额为「周期内额度」上限；
 * 两者并存——先校验会员配额是否超限，再由既有积分守卫扣费，互不冲突。
 */

const membershipService = require('./membershipService');

const METRICS = ['generation', 'project', 'storage', 'collaborator'];

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

/** 当前自然月周期键 yyyymm（以数据库无关的进程时间，够用；月度粒度不受时区秒级偏移影响）。 */
function currentPeriodKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 读取套餐某指标的配额上限；缺省视为无限制(-1)。 */
function quotaLimit(plan, metric) {
  const q = plan && plan.quota ? plan.quota : {};
  const map = {
    generation: 'monthly_generations',
    project: 'max_projects',
    storage: 'storage_mb',
    collaborator: 'max_collaborators',
  };
  const key = map[metric];
  const v = key && q[key] != null ? Number(q[key]) : -1;
  return Number.isFinite(v) ? v : -1;
}

// ===========================================================================
// 实时用量统计
// ===========================================================================

/** 本月已用生成次数（membership_quota_usage 计数）。 */
function usedGeneration(db, userId) {
  const row = db.prepare(
    "SELECT used FROM membership_quota_usage WHERE user_id = ? AND metric = 'generation' AND period_key = ?"
  ).get(Number(userId), currentPeriodKey());
  return row ? Number(row.used) || 0 : 0;
}

/** 已创建项目数（未删除）。 */
function usedProjects(db, userId) {
  const row = db.prepare(
    'SELECT COUNT(*) c FROM dramas WHERE created_by = ? AND deleted_at IS NULL'
  ).get(Number(userId));
  return row ? Number(row.c) || 0 : 0;
}

/** 已用存储（MB）：storage_objects.size_bytes（active）之和 + assets.file_size 之和。 */
function usedStorageMb(db, userId) {
  let bytes = 0;
  try {
    const r = db.prepare(
      `SELECT COALESCE(SUM(so.size_bytes),0) s
       FROM storage_objects so
       JOIN dramas d ON d.id = so.drama_id
       WHERE d.created_by = ? AND so.lifecycle = 'active'`
    ).get(Number(userId));
    bytes += r ? Number(r.s) || 0 : 0;
  } catch (_) { /* 表缺失时忽略 */ }
  try {
    const r = db.prepare(
      `SELECT COALESCE(SUM(a.file_size),0) s
       FROM assets a
       JOIN dramas d ON d.id = a.drama_id
       WHERE d.created_by = ?`
    ).get(Number(userId));
    bytes += r ? Number(r.s) || 0 : 0;
  } catch (_) { /* assets 无 drama_id/ file_size 时忽略 */ }
  return +(bytes / (1024 * 1024)).toFixed(2);
}

/** 项目当前活跃协作人数（含创建者视角由调用方决定是否 +1）。 */
function usedCollaborators(db, dramaId) {
  const row = db.prepare(
    "SELECT COUNT(*) c FROM collaboration_members WHERE drama_id = ? AND status = 'active'"
  ).get(Number(dramaId));
  return row ? Number(row.c) || 0 : 0;
}

// ===========================================================================
// 配额校验 + 计数
// ===========================================================================

/**
 * 校验某指标是否还有可用额度。
 * @param {string} metric generation/project/storage/collaborator
 * @param {object} ctx    { dramaId?, need? } —— storage 的 need 为本次拟增 MB；collaborator 需 dramaId
 * @returns {{ allowed, limit, used, remaining, unlimited, metric }}
 */
function check(db, userId, metric, ctx = {}) {
  if (!METRICS.includes(metric)) {
    const err = new Error(`未知配额指标：${metric}`);
    err.code = 'INVALID_METRIC';
    throw err;
  }
  const { plan } = membershipService.getUserMembership(db, userId);
  const limit = quotaLimit(plan, metric);

  let used = 0;
  if (metric === 'generation') used = usedGeneration(db, userId);
  else if (metric === 'project') used = usedProjects(db, userId);
  else if (metric === 'storage') used = usedStorageMb(db, userId);
  else if (metric === 'collaborator') used = usedCollaborators(db, ctx.dramaId);

  if (limit < 0) {
    return { allowed: true, unlimited: true, limit: -1, used, remaining: -1, metric };
  }

  const need = metric === 'storage'
    ? Number(ctx.need) || 0
    : 1; // 生成/项目/协作 每次占用 1
  const remaining = Math.max(0, limit - used);
  const allowed = used + need <= limit;
  return { allowed, unlimited: false, limit, used, remaining, need, metric };
}

/**
 * 原子自增本月生成计数（在生成成功后调用）。使用 UPSERT + 原子自增避免并发超发。
 * @returns {number} 自增后的用量
 */
function consumeGeneration(db, userId, delta = 1) {
  const uid = Number(userId);
  const period = currentPeriodKey();
  const inc = Number(delta) || 1;
  if (db.type === 'mysql') {
    db.prepare(
      `INSERT INTO membership_quota_usage (user_id, metric, period_key, used, updated_at)
       VALUES (?, 'generation', ?, ?, ${nowExpr(db)})
       ON DUPLICATE KEY UPDATE used = used + VALUES(used), updated_at = ${nowExpr(db)}`
    ).run(uid, period, inc);
  } else {
    db.prepare(
      `INSERT INTO membership_quota_usage (user_id, metric, period_key, used, updated_at)
       VALUES (?, 'generation', ?, ?, ${nowExpr(db)})
       ON CONFLICT(user_id, metric, period_key)
       DO UPDATE SET used = used + excluded.used, updated_at = ${nowExpr(db)}`
    ).run(uid, period, inc);
  }
  return usedGeneration(db, uid);
}

/**
 * 校验并占用一次生成额度（原子）。超限抛 QUOTA_EXCEEDED。
 * 返回 { used, limit, remaining }。
 */
function checkAndConsumeGeneration(db, userId) {
  const runTx = () => {
    const c = check(db, userId, 'generation');
    if (!c.allowed) {
      const err = new Error(`本月 AI 生成次数已达上限（${c.limit} 次），请升级会员或次月再试`);
      err.code = 'QUOTA_EXCEEDED';
      err.quota = c;
      throw err;
    }
    const used = consumeGeneration(db, userId, 1);
    return { used, limit: c.limit, remaining: c.unlimited ? -1 : Math.max(0, c.limit - used) };
  };
  return db.transaction ? db.transaction(runTx)() : runTx();
}

/** 用户配额总览（会员中心/前端展示用）。 */
function summary(db, userId, opts = {}) {
  const { plan, levelCode, isActive, membership } = membershipService.getUserMembership(db, userId);
  const metrics = {
    generation: check(db, userId, 'generation'),
    project: check(db, userId, 'project'),
    storage: check(db, userId, 'storage', { need: 0 }),
  };
  if (opts.dramaId) {
    metrics.collaborator = check(db, userId, 'collaborator', { dramaId: opts.dramaId });
  }
  return {
    level_code: levelCode,
    plan_name: plan ? plan.name : levelCode,
    is_active: isActive,
    period_key: currentPeriodKey(),
    membership: membership || null,
    metrics,
  };
}

module.exports = {
  METRICS,
  currentPeriodKey,
  quotaLimit,
  usedGeneration,
  usedProjects,
  usedStorageMb,
  usedCollaborators,
  check,
  consumeGeneration,
  checkAndConsumeGeneration,
  summary,
};
