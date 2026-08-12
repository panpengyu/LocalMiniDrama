'use strict';

/**
 * Sprint 12 - S12-T08 数据分析平台
 *
 * 基于真实业务数据（users / user_activity_logs / dramas / storyboards /
 * image_generations / video_generations / ai_model_call_logs / point_logs），
 * 提供四大分析能力，全部落地在 MySQL 真实数据，无 mock：
 *
 *   1) 用户行为分析：行为类型分布 + 每日活跃用户(DAU) 趋势
 *   2) 创作漏斗分析：项目→剧本→分镜→图片→视频→成品 各环节转化率
 *   3) 模型效果分析：各 AI 模型调用量/成功率/耗时/成本/质量分对比
 *   4) 留存分析：按注册日分群(cohort)的次日/7日/30日留存率
 *
 * 双库兼容：日期分组用 db.type 分支（MySQL DATE_FORMAT / SQLite strftime）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function dateExpr(db, col = 'created_at') {
  return db.type === 'mysql'
    ? `DATE_FORMAT(${col}, '%Y-%m-%d')`
    : `strftime('%Y-%m-%d', ${col})`;
}

function safeGet(db, sql, ...params) {
  try { return db.prepare(sql).get(...params); } catch (_) { return null; }
}
function safeAll(db, sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch (_) { return []; }
}

// ------------------------------------------------------------
// 1) 用户行为分析
// ------------------------------------------------------------
/**
 * 行为类型分布 + 每日活跃用户趋势（近 days 天）。
 */
function behaviorAnalysis(db, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const de = dateExpr(db);

  // 行为类型分布（Top 20）
  const byAction = safeAll(
    db,
    `SELECT action, COUNT(*) c, COUNT(DISTINCT user_id) u
       FROM user_activity_logs WHERE created_at >= ?
       GROUP BY action ORDER BY c DESC LIMIT 20`,
    since
  ).map((r) => ({ action: r.action, count: Number(r.c) || 0, users: Number(r.u) || 0 }));

  // 每日活跃用户 + 行为数
  const daily = safeAll(
    db,
    `SELECT ${de} d, COUNT(*) c, COUNT(DISTINCT user_id) dau
       FROM user_activity_logs WHERE created_at >= ?
       GROUP BY ${de} ORDER BY d ASC`,
    since
  ).map((r) => ({ date: r.d, actions: Number(r.c) || 0, dau: Number(r.dau) || 0 }));

  const totals = safeGet(
    db,
    `SELECT COUNT(*) total_actions, COUNT(DISTINCT user_id) active_users
       FROM user_activity_logs WHERE created_at >= ?`,
    since
  ) || {};

  return {
    days,
    total_actions: Number(totals.total_actions) || 0,
    active_users: Number(totals.active_users) || 0,
    by_action: byAction,
    daily,
  };
}

// ------------------------------------------------------------
// 2) 创作漏斗分析
// ------------------------------------------------------------
/**
 * 创作漏斗：各环节数量 + 环比转化率 + 整体转化率。
 * 数据来自 dramas / storyboards / image_generations / video_generations。
 */
function creationFunnel(db) {
  const stages = [
    { key: 'created', label: '创建项目', count: 0 },
    { key: 'script', label: '完成剧本', count: 0 },
    { key: 'storyboard', label: '生成分镜', count: 0 },
    { key: 'image', label: '生成图片', count: 0 },
    { key: 'video', label: '生成视频', count: 0 },
    { key: 'exported', label: '导出成品', count: 0 },
  ];

  stages[0].count = (safeGet(db, 'SELECT COUNT(*) c FROM dramas') || {}).c || 0;
  const scriptRow = safeGet(db, "SELECT COUNT(*) c FROM dramas WHERE outline IS NOT NULL AND outline != ''");
  stages[1].count = scriptRow ? scriptRow.c || 0 : stages[0].count;
  stages[2].count = (safeGet(db, 'SELECT COUNT(*) c FROM storyboards WHERE deleted_at IS NULL') || {}).c || 0;
  stages[3].count = (safeGet(db, 'SELECT COUNT(*) c FROM image_generations') || {}).c || 0;
  stages[4].count = (safeGet(db, 'SELECT COUNT(*) c FROM video_generations') || {}).c || 0;
  stages[5].count = (safeGet(db, "SELECT COUNT(*) c FROM dramas WHERE status IN ('published','archived')") || {}).c || 0;

  let prev = stages[0].count;
  stages[0].conversion_rate = 100;
  for (let i = 1; i < stages.length; i++) {
    stages[i].conversion_rate = prev > 0 ? Number(((stages[i].count / prev) * 100).toFixed(2)) : 0;
    prev = stages[i].count;
  }
  const overall = stages[0].count > 0
    ? Number(((stages[stages.length - 1].count / stages[0].count) * 100).toFixed(2))
    : 0;

  return { stages, overall_rate: overall };
}

// ------------------------------------------------------------
// 3) 模型效果分析
// ------------------------------------------------------------
/**
 * 各 AI 模型调用量 / 成功率 / 平均耗时 / 成本 / 质量分对比。
 * 数据来自 ai_model_call_logs（S4-T07 调用日志）。
 */
function modelEffect(db, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const rows = safeAll(
    db,
    `SELECT model, service_type, provider,
            COUNT(*) total_calls,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) success_count,
            SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) failed_count,
            AVG(latency_ms) avg_latency,
            SUM(cost) total_cost,
            AVG(quality_score) avg_quality
       FROM ai_model_call_logs WHERE created_at >= ?
       GROUP BY model, service_type, provider ORDER BY total_calls DESC`,
    since
  );

  const items = rows.map((r) => {
    const total = Number(r.total_calls) || 0;
    const success = Number(r.success_count) || 0;
    return {
      model: r.model,
      service_type: r.service_type,
      provider: r.provider,
      total_calls: total,
      success_count: success,
      failed_count: Number(r.failed_count) || 0,
      success_rate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
      avg_latency: Math.round(Number(r.avg_latency) || 0),
      total_cost: Number(Number(r.total_cost || 0).toFixed(4)),
      avg_quality: r.avg_quality != null ? Number(Number(r.avg_quality).toFixed(2)) : null,
    };
  });

  const summary = {
    total_models: items.length,
    total_calls: items.reduce((s, i) => s + i.total_calls, 0),
    total_cost: Number(items.reduce((s, i) => s + i.total_cost, 0).toFixed(4)),
    avg_success_rate: items.length
      ? Number((items.reduce((s, i) => s + i.success_rate, 0) / items.length).toFixed(2))
      : 0,
  };

  return { days, items, summary };
}

// ------------------------------------------------------------
// 4) 留存分析（Cohort）
// ------------------------------------------------------------
/**
 * 按注册日分群，计算次日 / 7 日 / 30 日留存率。
 * 留存定义：注册后第 N 天（±0，按自然日）在 user_activity_logs 有行为记录。
 * @param {number} cohortDays 统计最近多少天的注册分群
 */
function retentionAnalysis(db, { cohortDays = 14 } = {}) {
  const de = dateExpr(db);
  const since = new Date(Date.now() - cohortDays * DAY_MS).toISOString();

  // 每日注册用户分群
  const cohorts = safeAll(
    db,
    `SELECT ${de} cohort_date, COUNT(*) new_users
       FROM users
       WHERE created_at >= ? AND deleted_at IS NULL AND role != 'super_admin'
       GROUP BY ${de} ORDER BY cohort_date ASC`,
    since
  );

  const result = [];
  for (const c of cohorts) {
    const cohortDate = c.cohort_date;
    const newUsers = Number(c.new_users) || 0;
    if (!cohortDate || newUsers === 0) continue;

    // 该分群的用户 ID
    const ids = safeAll(
      db,
      `SELECT id FROM users
         WHERE ${de} = ? AND deleted_at IS NULL AND role != 'super_admin'`,
      cohortDate
    ).map((r) => r.id);
    if (!ids.length) continue;
    const placeholders = ids.map(() => '?').join(',');

    // 计算第 N 天留存（注册当天为 day0）
    const cohortMs = new Date(String(cohortDate) + 'T00:00:00').getTime();
    const retention = {};
    for (const n of [1, 7, 30]) {
      const dayStart = new Date(cohortMs + n * DAY_MS).toISOString().slice(0, 10);
      // 若该留存日尚未到达，则记为 null（不计入）
      if (new Date(dayStart + 'T00:00:00').getTime() > Date.now()) {
        retention[`d${n}`] = null;
        continue;
      }
      const row = safeGet(
        db,
        `SELECT COUNT(DISTINCT user_id) c FROM user_activity_logs
           WHERE user_id IN (${placeholders}) AND ${de} = ?`,
        ...ids, dayStart
      );
      const retained = row ? Number(row.c) || 0 : 0;
      retention[`d${n}`] = Number(((retained / newUsers) * 100).toFixed(2));
    }

    result.push({
      cohort_date: cohortDate,
      new_users: newUsers,
      d1: retention.d1,
      d7: retention.d7,
      d30: retention.d30,
    });
  }

  // 汇总平均留存（忽略 null）
  const avg = (key) => {
    const vals = result.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : 0;
  };

  return {
    cohort_days: cohortDays,
    cohorts: result,
    summary: { avg_d1: avg('d1'), avg_d7: avg('d7'), avg_d30: avg('d30') },
  };
}

// ------------------------------------------------------------
// 汇总总览（供前端一次拉取）
// ------------------------------------------------------------
function overview(db, { days = 30 } = {}) {
  return {
    behavior: behaviorAnalysis(db, { days }),
    funnel: creationFunnel(db),
    model_effect: modelEffect(db, { days }),
    retention: retentionAnalysis(db, { cohortDays: Math.min(days, 14) }),
  };
}

module.exports = {
  behaviorAnalysis,
  creationFunnel,
  modelEffect,
  retentionAnalysis,
  overview,
};
