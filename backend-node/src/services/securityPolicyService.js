/**
 * 安全策略服务（S19-T03）
 * - 单一配置行（security_policy.id=1，JSON 存储），默认关闭，开启后强制生效
 * - 密码强度 / 密码有效期 / 连续失败锁定 / IP 白名单 / 2FA-TOTP（otplib）
 */
'use strict';

const { generateSecret: otpGenerateSecret, generateURI, verifySync } = require('otplib');
const { mysqlNow, toMysql } = require('../utils/datetime');

const TOTP_ISSUER = 'LocalMiniDrama';

const DEFAULT_POLICY = {
  enabled: false,
  password: {
    min_length: 8,
    require_upper: true,
    require_lower: true,
    require_digit: true,
    require_symbol: false,
    expire_days: 90,
  },
  lock: { max_attempts: 5, lock_minutes: 30 },
  ip_whitelist: [],
  two_fa: { required: false },
};

let policyCache = null;
let policyCacheAt = 0;
const POLICY_TTL = 10 * 1000;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(patch || {})) {
    const pv = patch[key];
    const bv = out[key];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = deepMerge(bv, pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

/** 读取策略（10s 内存缓存，表不存在时返回默认值） */
function getPolicy(db) {
  if (policyCache && Date.now() - policyCacheAt < POLICY_TTL) return policyCache;
  let base = DEFAULT_POLICY;
  try {
    const row = db.prepare('SELECT policy FROM security_policy WHERE id = 1').get();
    if (row && row.policy) {
      const parsed = typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy;
      base = deepMerge(DEFAULT_POLICY, parsed || {});
    }
  } catch (_) { /* 表未就绪时用默认值 */ }
  policyCache = base;
  policyCacheAt = Date.now();
  return policyCache;
}

/** 合并更新策略（部分更新，返回完整策略） */
function updatePolicy(db, log, patch) {
  const merged = deepMerge(getPolicy(db), patch || {});
  db.prepare('UPDATE security_policy SET policy = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(merged), mysqlNow());
  policyCache = merged;
  policyCacheAt = Date.now();
  if (log) log.info('security/policy-update', { enabled: merged.enabled });
  return merged;
}

/** 重置为默认策略（完整覆盖，避免空 patch 合并导致残留旧值） */
function resetPolicy(db, log) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_POLICY));
  db.prepare('UPDATE security_policy SET policy = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(merged), mysqlNow());
  policyCache = merged;
  policyCacheAt = Date.now();
  if (log) log.info('security/policy-reset');
  return merged;
}

/** 密码强度校验（策略启用时返回不满足项） */
function validatePasswordStrength(db, password) {
  const p = (getPolicy(db).password || {});
  const errors = [];
  const pw = String(password || '');
  const min = p.min_length || 6;
  if (pw.length < min) errors.push(`密码长度至少 ${min} 位`);
  if (p.require_upper && !/[A-Z]/.test(pw)) errors.push('需包含大写字母');
  if (p.require_lower && !/[a-z]/.test(pw)) errors.push('需包含小写字母');
  if (p.require_digit && !/\d/.test(pw)) errors.push('需包含数字');
  if (p.require_symbol && !/[^A-Za-z0-9]/.test(pw)) errors.push('需包含特殊字符');
  return { ok: errors.length === 0, errors };
}

/** 密码是否超过有效期（0/关闭=不过期） */
function isPasswordExpired(db, passwordChangedAt) {
  const days = (getPolicy(db).password || {}).expire_days;
  if (!days || days <= 0 || !passwordChangedAt) return false;
  const changed = new Date(passwordChangedAt);
  if (Number.isNaN(changed.getTime())) return false;
  return Date.now() - changed.getTime() > days * 24 * 3600 * 1000;
}

/** 账户是否被锁定（锁定过期自动解锁）
 *  锁定时间统一用 MySQL NOW() 字符串比较（DATETIME 同格式同语义），
 *  避免驱动时区转换导致 JS 时间判断偏差。 */
function checkLocked(db, userId) {
  const row = db.prepare(
    `SELECT CASE WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN 1 ELSE 0 END AS locked,
            locked_until
     FROM users WHERE id = ?`
  ).get(userId);
  if (!row) return { locked: false };
  if (Number(row.locked) === 1) {
    let minutes = 1;
    try {
      const remain = db.prepare('SELECT TIMESTAMPDIFF(MINUTE, NOW(), locked_until) AS m FROM users WHERE id = ?').get(userId);
      if (remain && remain.m) minutes = Math.max(1, Number(remain.m));
    } catch (_) { /* 容错 */ }
    return { locked: true, reason: `连续登录失败次数过多，账户已锁定，请 ${minutes} 分钟后再试` };
  }
  if (row.locked_until) {
    // 锁定已过期，清理历史锁定状态
    try {
      db.prepare('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(userId);
    } catch (_) { /* 容错 */ }
  }
  return { locked: false };
}

/** 记录一次失败，达到阈值则锁定 */
function recordFailure(db, userId) {
  const policy = getPolicy(db);
  const max = (policy.lock || {}).max_attempts || 5;
  const minutes = (policy.lock || {}).lock_minutes || 30;
  const user = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(userId);
  const attempts = (user && user.failed_attempts ? user.failed_attempts : 0) + 1;
  if (attempts >= max) {
    const until = toMysql(new Date(Date.now() + minutes * 60000));
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, until, userId);
    return { locked: true, attempts };
  }
  db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, userId);
  return { locked: false, attempts };
}

/** 登录成功重置失败计数 */
function resetFailures(db, userId) {
  try {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
  } catch (_) { /* 容错 */ }
}

/** IP 是否在白名单内（白名单为空 = 不限制） */
function isIpAllowed(db, ip) {
  const list = (getPolicy(db).ip_whitelist || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return true;
  const clean = String(ip || '').replace(/^::ffff:/, '').trim();
  return list.includes(clean);
}

/** 生成 TOTP 密钥 */
function generateTotpSecret() {
  return otpGenerateSecret();
}

/** 生成 otpauth URI（用于二维码） */
function totpUri(secret, account) {
  return generateURI({ label: String(account || 'user'), issuer: TOTP_ISSUER, secret });
}

/** 校验 TOTP 动态码（容错 ±1 步）
 *  注意：otplib v13 的 epochTolerance 单位为「秒」（非步数），
 *  且已不识别旧版 window 参数（传了也会被忽略 → 容差为 0，跨 30 秒窗口边界即失败）。
 *  因此显式设 30（= 1 个 30 秒步长）实现对称 ±1 步容差。 */
function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  try {
    const result = verifySync({ token: String(code).replace(/\s/g, ''), secret, epochTolerance: 30 });
    return !!(result && result.valid);
  } catch (_) {
    return false;
  }
}

module.exports = {
  DEFAULT_POLICY,
  getPolicy,
  updatePolicy,
  resetPolicy,
  validatePasswordStrength,
  isPasswordExpired,
  checkLocked,
  recordFailure,
  resetFailures,
  isIpAllowed,
  generateTotpSecret,
  totpUri,
  verifyTotp,
};
