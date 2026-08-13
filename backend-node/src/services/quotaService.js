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
const atomicQuota = require('../utils/atomicQuota');

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
 * 原子「占用一次生成额度（仅当未超限）」。将「校验 used<limit」与「used+1」合并为
 * 单条带前置条件的写，避免 check→consume 两步之间的 TOCTOU 窗口导致并发超发。
 *
 * 分两步原子写（均以 limit 为前置条件）：
 *   1) 尝试对已存在的当月计数行做条件自增：UPDATE ... SET used=used+1 WHERE used < limit；
 *      changes===1 表示抢到额度。
 *   2) 若无既有行（changes===0 且当月尚无计数），尝试首次插入 used=1（仅当 limit>=1）；
 *      并发下靠 (user_id,metric,period_key) 唯一键：赢家 INSERT 成功，输家转回第 1 步条件自增。
 * @returns {boolean} 是否成功占用（false = 已达上限）
 */
function tryConsumeGenerationBounded(db, uid, period, limit) {
  const bump = () => db.prepare(
    `UPDATE membership_quota_usage SET used = used + 1, updated_at = ${nowExpr(db)}
     WHERE user_id = ? AND metric = 'generation' AND period_key = ? AND used < ?`
  ).run(uid, period, limit).changes;

  if (bump() === 1) return true;

  // 无既有行则首次插入（limit>=1 时）；已存在行时唯一键冲突 → 回退条件自增
  if (limit >= 1) {
    try {
      const r = db.prepare(
        `INSERT INTO membership_quota_usage (user_id, metric, period_key, used, updated_at)
         VALUES (?, 'generation', ?, 1, ${nowExpr(db)})`
      ).run(uid, period);
      if (r.changes === 1) return true;
    } catch (_) { /* 唯一键冲突：并发下他人已插入，转条件自增 */ }
    if (bump() === 1) return true;
  }
  return false;
}

/**
 * 校验并占用一次生成额度（原子）。超限抛 QUOTA_EXCEEDED。
 * 返回 { used, limit, remaining }。
 */
function checkAndConsumeGeneration(db, userId) {
  const uid = Number(userId);
  const runTx = () => {
    const { plan } = membershipService.getUserMembership(db, uid);
    const limit = quotaLimit(plan, 'generation');
    // 无限制套餐：直接原子自增，无需上限守卫
    if (limit < 0) {
      const used = consumeGeneration(db, uid, 1);
      return { used, limit: -1, remaining: -1 };
    }
    const period = currentPeriodKey();
    const ok = tryConsumeGenerationBounded(db, uid, period, limit);
    if (!ok) {
      const err = new Error(`本月 AI 生成次数已达上限（${limit} 次），请升级会员或次月再试`);
      err.code = 'QUOTA_EXCEEDED';
      err.quota = { allowed: false, unlimited: false, limit, used: usedGeneration(db, uid), remaining: 0, metric: 'generation' };
      throw err;
    }
    const used = usedGeneration(db, uid);
    return { used, limit, remaining: Math.max(0, limit - used) };
  };
  return db.transaction ? db.transaction(runTx)() : runTx();
}

/**
 * 原子占位统一实现见 utils/atomicQuota（runWriteSerialized + 锚点行锁 + tryConsumeBounded）。
 * 本文件下述两函数只是「配额语义（用哪张表计数、锁哪个锚点行、幂等规则）」的薄封装，
 * 竞态防护的通用机制全部下沉到工具层，供其它模块直接复用。
 */

/**
 * H7 项目数配额：原子占位创建项目。
 *
 * 将「COUNT(dramas) < limit 校验」与「INSERT dramas」放进同一写序列化事务，
 * 消除 quotaGuard.project(check) → createDrama(insert) 之间的 TOCTOU 超发窗口。
 * 锚点：锁定所有者 users 行，串行化同一用户的并发项目创建（覆盖 used=0 场景）。
 *
 * @param {function} insertFn 事务内执行的实际插入回调（返回值原样透传给调用方）
 * @param {number}   limit    项目数上限；<0 表示无限制（不加守卫直接执行）
 * @returns {{ ok:boolean, used:number, limit:number, result?:any }}
 *          ok=false 表示已达上限（未插入）；ok=true 时 result 为 insertFn 返回值
 */
function tryConsumeProjectBounded(db, userId, limit, insertFn) {
  const uid = Number(userId);
  return atomicQuota.tryConsumeBounded({
    db,
    limit,
    anchor: { table: 'users', id: uid },
    count: () => usedProjects(db, uid),
    mutate: insertFn,
  });
}

/**
 * H6 协作人数配额：原子占位新增协作成员。
 *
 * 将「判断是否占用新名额 → COUNT(active) < limit 校验 → 新增/更新成员」放进同一写序列化事务，
 * 消除并发邀请下多个请求各自读到「未满」而同时插入导致超发的 TOCTOU 窗口。
 * 锚点：锁定所属 dramas 行，串行化同一项目的并发协作者加入（覆盖 used=0 场景）。
 *
 * 幂等语义：仅「新增有效(active)成员」占用名额；已是 active 成员的改角色不占新名额，
 * 故传入 seatCheckFn 在事务内判定；返回 false 时跳过上限校验直接执行 addFn。
 *
 * @param {number}   limit       单项目协作人数上限；<0 表示无限制
 * @param {function} seatCheckFn 事务内执行，返回本次操作是否占用一个新名额(boolean)
 * @param {function} addFn       事务内执行的实际新增/更新回调（返回成员行）
 * @returns {{ ok:boolean, used:number, limit:number, result?:any }}
 */
function tryConsumeCollaboratorBounded(db, dramaId, limit, seatCheckFn, addFn) {
  const id = Number(dramaId);
  return atomicQuota.tryConsumeBounded({
    db,
    limit,
    anchor: { table: 'dramas', id },
    consumesSeat: seatCheckFn,
    count: () => usedCollaborators(db, id),
    mutate: addFn,
  });
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
  tryConsumeProjectBounded,
  tryConsumeCollaboratorBounded,
  summary,
};
