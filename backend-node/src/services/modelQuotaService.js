'use strict';

/**
 * modelQuotaService.js
 * Sprint 19 - S19-T02 模型用量配额
 *
 * 功能：
 *   1. 配额规则 CRUD（scope: account 按用户 / model 按模型 / global 全局限额）
 *   2. 周期键生成（daily/weekly/monthly）
 *   3. 原子防超发校验：参照 quotaService 既有模式，行锁 + 条件自增，
 *      同一 (scope, period) 仅一行，并发下 UPDATE ... WHERE used_value < quota_value
 *      保证不超发。
 *
 * 校验链路（路由前轻量拦截）：
 *   quotaService.checkQuota(db, { userId, model, periodType })
 *   → 遍历命中规则 → 任一不满足立即拒绝
 *   → 调用完成后 quotaService.consume(db, { userId, model }) 原子占用
 */

const { snowflakeId } = require('../utils/snowflake');

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- 周期键 ----------

function periodKey(type, date = new Date()) {
  const y = date.getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  if (type === 'daily') return `${y}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (type === 'monthly') return `${y}-${pad(date.getMonth() + 1)}`;
  if (type === 'weekly') {
    // ISO 周编号
    const d = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${y}-W${pad(week)}`;
  }
  return periodKey('daily', date);
}

// ---------- CRUD ----------

function toQuota(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    periodType: row.period_type,
    periodKey: row.period_key,
    quotaValue: Number(row.quota_value),
    usedValue: Number(row.used_value),
    isActive: !!row.is_active,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listQuotas(db, params = {}) {
  const w = [];
  const p = [];
  if (params.scopeType) { w.push('scope_type = ?'); p.push(params.scopeType); }
  if (params.isActive !== undefined) { w.push('is_active = ?'); p.push(params.isActive ? 1 : 0); }
  const sql = `SELECT * FROM model_usage_quota ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(toQuota);
}

function getQuota(db, id) {
  const row = db.prepare('SELECT * FROM model_usage_quota WHERE id = ?').get(id);
  return row ? toQuota(row) : null;
}

function createQuota(db, log, params) {
  log = log || console;
  const { scopeType = 'account', scopeValue, periodType = 'daily', quotaValue, remark } = params;
  if (!['account', 'model', 'global'].includes(scopeType)) throw new Error('scopeType 非法');
  if (!['daily', 'weekly', 'monthly'].includes(periodType)) throw new Error('periodType 非法');
  const sv = scopeType === 'global' ? '*' : (scopeValue == null || scopeValue === '' ? '*' : String(scopeValue));
  const qv = Number(quotaValue);
  if (!Number.isFinite(qv) || qv <= 0) throw new Error('quotaValue 必须为正整数');

  const key = periodKey(periodType);
  const existing = db.prepare(
    'SELECT * FROM model_usage_quota WHERE scope_type = ? AND scope_value = ? AND period_type = ? AND period_key = ?'
  ).get(scopeType, sv, periodType, key);
  if (existing) {
    db.prepare('UPDATE model_usage_quota SET quota_value = ?, remark = ?, is_active = 1, updated_at = ? WHERE id = ?')
      .run(qv, remark || null, nowStr(), existing.id);
    log.info('[QUOTA] 更新周期内规则', { id: existing.id, scopeType, sv, periodType, quotaValue: qv });
    return getQuota(db, existing.id);
  }

  const id = snowflakeId();
  const now = nowStr();
  db.prepare(
    `INSERT INTO model_usage_quota
      (id, scope_type, scope_value, period_type, period_key, quota_value, used_value, is_active, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
  ).run(id, scopeType, sv, periodType, key, qv, remark || null, now, now);
  log.info('[QUOTA] 创建配额规则', { id, scopeType, sv, periodType, quotaValue: qv });
  return getQuota(db, id);
}

function updateQuota(db, log, id, params) {
  log = log || console;
  const existing = getQuota(db, id);
  if (!existing) throw new Error('配额规则不存在');
  const sets = [];
  const p = [];
  if (params.quotaValue != null) {
    const qv = Number(params.quotaValue);
    if (!Number.isFinite(qv) || qv <= 0) throw new Error('quotaValue 必须为正整数');
    sets.push('quota_value = ?');
    p.push(qv);
  }
  if (params.isActive !== undefined) { sets.push('is_active = ?'); p.push(params.isActive ? 1 : 0); }
  if (params.remark != null) { sets.push('remark = ?'); p.push(params.remark); }
  if (!sets.length) return existing;
  sets.push('updated_at = ?');
  p.push(nowStr());
  p.push(id);
  db.prepare(`UPDATE model_usage_quota SET ${sets.join(', ')} WHERE id = ?`).run(...p);
  log.info('[QUOTA] 更新配额规则', { id });
  return getQuota(db, id);
}

function deleteQuota(db, log, id) {
  db.prepare('DELETE FROM model_usage_quota WHERE id = ?').run(id);
  log.info('[QUOTA] 删除配额规则', { id });
  return { deleted: true, id };
}

// ---------- 校验与占用 ----------

function resolveRules(db, { userId, model, periodType = 'daily' }) {
  const key = periodKey(periodType);
  const sql = `SELECT * FROM model_usage_quota
    WHERE is_active = 1 AND period_type = ? AND period_key = ?
      AND (scope_type = 'global'
        OR (scope_type = 'account' AND scope_value = ?)
        OR (scope_type = 'model' AND scope_value = ?))
    ORDER BY scope_type`;
  const rows = db.prepare(sql).all(periodType, key, String(userId ?? 'anon'), model || '');
  return rows.map(toQuota);
}

/**
 * 校验当前是否可用（不占用）。命中任一规则且已用 >= 上限 → 拒绝。
 * @returns {{ allowed: boolean, rules: Array, remaining: number }}
 */
function checkQuota(db, { userId, model, periodType = 'daily' }) {
  const rules = resolveRules(db, { userId, model, periodType });
  let remaining = Infinity;
  let hit = false;
  for (const r of rules) {
    hit = true;
    const left = Math.max(0, r.quotaValue - r.usedValue);
    remaining = Math.min(remaining, left);
    if (left <= 0) {
      return {
        allowed: false,
        rules,
        remaining: 0,
        blockedBy: { scopeType: r.scopeType, scopeValue: r.scopeValue, periodType, periodKey: r.periodKey },
      };
    }
  }
  return { allowed: true, rules, remaining: hit ? remaining : Infinity };
}

/**
 * 原子占用一次调用额度（防超发）。
 * 事务：行锁（SELECT ... FOR UPDATE）→ 校验余量 → 条件自增。
 * @returns {{ ok: boolean, used: number, quota: number, blockedBy?: object }}
 */
function consume(db, { userId, model, periodType = 'daily' }) {
  const rules = resolveRules(db, { userId, model, periodType });
  if (!rules.length) return { ok: true, used: 0, quota: 0 }; // 未配置规则不限制

  const tx = db.transaction(() => {
    for (const r of rules) {
      // 行锁读取当前值
      const locked = db.prepare(
        'SELECT used_value, quota_value FROM model_usage_quota WHERE id = ? FOR UPDATE'
      ).get(r.id);
      const used = Number(locked ? locked.used_value : r.usedValue);
      const quota = Number(locked ? locked.quota_value : r.quotaValue);
      if (used >= quota) {
        return { ok: false, used, quota, blockedBy: { scopeType: r.scopeType, scopeValue: r.scopeValue } };
      }
      const res = db.prepare(
        'UPDATE model_usage_quota SET used_value = used_value + 1, updated_at = ? WHERE id = ? AND used_value < quota_value'
      ).run(nowStr(), r.id);
      if (res.changes === 0) {
        return { ok: false, used, quota, blockedBy: { scopeType: r.scopeType, scopeValue: r.scopeValue } };
      }
    }
    return { ok: true, used: rules[0].usedValue + 1, quota: rules[0].quotaValue };
  });
  return tx();
}

/**
 * 用量汇总（管理端看板）
 */
function usageSummary(db, params = {}) {
  const w = [];
  const p = [];
  if (params.scopeType) { w.push('scope_type = ?'); p.push(params.scopeType); }
  if (params.periodType) { w.push('period_type = ?'); p.push(params.periodType); }
  const sql = `SELECT scope_type, scope_value, period_type, period_key,
      SUM(quota_value) AS total_quota, SUM(used_value) AS total_used
    FROM model_usage_quota
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
    GROUP BY scope_type, scope_value, period_type, period_key
    ORDER BY period_key DESC`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map((r) => ({
    scopeType: r.scope_type,
    scopeValue: r.scope_value,
    periodType: r.period_type,
    periodKey: r.period_key,
    quota: Number(r.total_quota),
    used: Number(r.total_used),
    remaining: Math.max(0, Number(r.total_quota) - Number(r.total_used)),
  }));
}

module.exports = {
  periodKey,
  listQuotas,
  getQuota,
  createQuota,
  updateQuota,
  deleteQuota,
  resolveRules,
  checkQuota,
  consume,
  usageSummary,
};
