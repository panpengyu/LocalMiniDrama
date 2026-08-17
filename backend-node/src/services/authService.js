const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { snowflakeId } = require('../utils/snowflake');
const { mysqlNow } = require('../utils/datetime');
const securityPolicy = require('./securityPolicyService');
const sessionService = require('./sessionService');

const JWT_SECRET = 'localminidrama_jwt_secret_key_2026';
const JWT_EXPIRES_IN = '7d';

function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

function validateUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function validatePassword(password) {
  return password.length >= 6;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

/** 生成 JWT；opts.sid 关联会话，opts.v 为令牌版本（强制下线/改密后旧令牌失效） */
function generateToken(user, opts = {}) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      phone: user.phone,
      sid: opts.sid,
      v: opts.v !== undefined ? opts.v : user.token_version,
    },
    JWT_SECRET,
    { expiresIn: opts.expiresIn || JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/** 脱敏用户信息（不含密码/2FA 密钥） */
function toSafeUser(user) {
  const { password, totp_secret, ...safe } = user;
  return safe;
}

function initAdmin(db) {
  try {
    const hashedPassword = hashPassword('admin123');
    const checkStmt = db.prepare('SELECT id FROM users WHERE username = ?');
    const existing = checkStmt.get(['admin']);

    if (!existing) {
      const insertStmt = db.prepare(
        'INSERT INTO users (id, username, password, role, nickname, status, user_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      insertStmt.run([snowflakeId(), 'admin', hashedPassword, 'super_admin', '系统管理员', 1, 'individual']);
      console.log('Admin created: admin/admin123');
    } else {
      const updateStmt = db.prepare('UPDATE users SET password = ?, role = ? WHERE username = ?');
      updateStmt.run([hashedPassword, 'super_admin', 'admin']);
      console.log('Admin updated: admin/admin123, role: super_admin');
    }
  } catch (err) {
    console.warn('Failed to init admin:', err.message);
  }
}

function register(db, { phone, password, nickname, ip, userAgent }) {
  if (!phone || !validatePhone(phone)) {
    throw new Error('请输入有效的手机号');
  }

  if (!password || !validatePassword(password)) {
    throw new Error('密码至少6位');
  }

  // S19-T03: 策略启用时强制密码强度
  if (securityPolicy.getPolicy(db).enabled) {
    const strength = securityPolicy.validatePasswordStrength(db, password);
    if (!strength.ok) {
      throw new Error(`密码强度不足：${strength.errors.join('；')}`);
    }
  }

  const stmt = db.prepare('SELECT id FROM users WHERE phone = ?');
  const existing = stmt.get([phone]);

  if (existing) {
    throw new Error('该手机号已注册');
  }

  const hashedPassword = hashPassword(password);
  const username = phone;

  const userId = snowflakeId();
  const insertStmt = db.prepare(
    'INSERT INTO users (id, username, phone, password, role, nickname, status, user_type, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertStmt.run([userId, username, phone, hashedPassword, 'user', nickname || '', 1, 'individual', new Date().toISOString()]);

  const newStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const user = newStmt.get([userId]);

  // 注册即登录：创建会话并签发带 sid/v 的令牌
  const session = sessionService.createSession(db, { userId, ip, userAgent });
  const token = generateToken(user, { sid: session.id, v: user.token_version });
  return { user: toSafeUser(user), token };
}

/**
 * 登录（S19-T03/T04 增强）
 * - 策略启用时：IP 白名单 → 锁定检查 → 密码校验（失败计数）→ 重置失败计数
 * - 用户启用 2FA：返回 needTwoFa + 5 分钟临时凭证，需走 /auth/login/2fa
 * - 成功：登记会话，签发带 sid/v 的令牌
 */
function login(db, { username, password, ip, userAgent }) {
  if (!username || !password) {
    throw new Error('请输入用户名/手机号和密码');
  }

  const stmt = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?');
  const user = stmt.get([username, username]);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (user.status !== 1) {
    throw new Error('用户已禁用');
  }

  const policyEnabled = securityPolicy.getPolicy(db).enabled;

  if (policyEnabled) {
    if (!securityPolicy.isIpAllowed(db, ip)) {
      throw new Error('当前 IP 不在访问白名单内');
    }
    const locked = securityPolicy.checkLocked(db, user.id);
    if (locked.locked) {
      throw new Error(locked.reason);
    }
  }

  const isValid = comparePassword(password, user.password);

  if (!isValid) {
    if (policyEnabled) {
      const failed = securityPolicy.recordFailure(db, user.id);
      if (failed.locked) {
        throw new Error(`密码错误，连续失败次数过多，账户已被锁定`);
      }
    }
    throw new Error('密码错误');
  }

  if (policyEnabled) {
    securityPolicy.resetFailures(db, user.id);
  }

  // 用户已启用 2FA → 两步登录
  if (user.two_fa_enabled === 1) {
    const tempToken = jwt.sign({ purpose: '2fa', uid: user.id }, JWT_SECRET, { expiresIn: '5m' });
    return { user: toSafeUser(user), needTwoFa: true, tempToken };
  }

  const session = sessionService.createSession(db, { userId: user.id, ip, userAgent });
  const token = generateToken(user, { sid: session.id, v: user.token_version });
  return { user: toSafeUser(user), token, needTwoFa: false };
}

/** 2FA 第二步登录：校验动态码后正式签发令牌 */
function verifyTwoFaLogin(db, { tempToken, code, ip, userAgent }) {
  const decoded = verifyToken(tempToken);
  if (!decoded || decoded.purpose !== '2fa' || !decoded.uid) {
    throw new Error('临时凭证无效或已过期，请重新登录');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.uid);
  if (!user) {
    throw new Error('用户不存在');
  }
  if (user.status !== 1) {
    throw new Error('用户已禁用');
  }
  if (user.two_fa_enabled !== 1) {
    throw new Error('该用户未启用两步验证');
  }
  if (!securityPolicy.verifyTotp(user.totp_secret, code)) {
    throw new Error('验证码错误');
  }
  const session = sessionService.createSession(db, { userId: user.id, ip, userAgent });
  const token = generateToken(user, { sid: session.id, v: user.token_version });
  return { user: toSafeUser(user), token };
}

/** 生成 2FA 绑定密钥（写入 users.totp_secret，verify 后启用） */
function setupTwoFa(db, userId) {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  const secret = securityPolicy.generateTotpSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, userId);
  return { secret, uri: securityPolicy.totpUri(secret, user.username) };
}

/** 校验动态码并启用 2FA */
function enableTwoFa(db, userId, code) {
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (!user.totp_secret) throw new Error('请先获取绑定密钥');
  if (!securityPolicy.verifyTotp(user.totp_secret, code)) throw new Error('验证码错误');
  db.prepare('UPDATE users SET two_fa_enabled = 1 WHERE id = ?').run(userId);
  return { enabled: true };
}

/** 校验动态码并关闭 2FA */
function disableTwoFa(db, userId, code) {
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (!securityPolicy.verifyTotp(user.totp_secret, code)) throw new Error('验证码错误');
  db.prepare('UPDATE users SET two_fa_enabled = 0, totp_secret = NULL WHERE id = ?').run(userId);
  return { enabled: false };
}

/** 修改密码：校验旧密码 + 策略强度，改后所有旧会话失效 */
function changePassword(db, userId, { oldPassword, newPassword }) {
  if (!oldPassword || !newPassword) throw new Error('请输入当前密码和新密码');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (!comparePassword(oldPassword, user.password)) throw new Error('当前密码错误');

  if (securityPolicy.getPolicy(db).enabled) {
    const strength = securityPolicy.validatePasswordStrength(db, newPassword);
    if (!strength.ok) throw new Error(`密码强度不足：${strength.errors.join('；')}`);
  }

  const hash = hashPassword(newPassword);
  db.prepare(
    'UPDATE users SET password = ?, password_changed_at = ?, token_version = token_version + 1 WHERE id = ?'
  ).run(hash, mysqlNow(), userId);
  sessionService.revokeAllForUser(db, userId);
  return { changed: true };
}

function getUserById(db, userId) {
  const stmt = db.prepare('SELECT id, username, phone, role, nickname, status, two_fa_enabled FROM users WHERE id = ? AND deleted_at IS NULL');
  return stmt.get([userId]);
}

module.exports = {
  validatePhone,
  validateUsername,
  validatePassword,
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  toSafeUser,
  initAdmin,
  register,
  login,
  verifyTwoFaLogin,
  setupTwoFa,
  enableTwoFa,
  disableTwoFa,
  changePassword,
  getUserById,
  JWT_SECRET
};
