const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { snowflakeId } = require('../utils/snowflake');

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

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, phone: user.phone },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
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

function register(db, { phone, password, nickname }) {
  if (!phone || !validatePhone(phone)) {
    throw new Error('请输入有效的手机号');
  }
  
  if (!password || !validatePassword(password)) {
    throw new Error('密码至少6位');
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
    'INSERT INTO users (id, username, phone, password, role, nickname, status, user_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = insertStmt.run([userId, username, phone, hashedPassword, 'user', nickname || '', 1, 'individual']);
  
  const newStmt = db.prepare('SELECT id, username, phone, role, nickname, status FROM users WHERE id = ?');
  const user = newStmt.get([userId]);
  
  const token = generateToken(user);
  return { user, token };
}

function login(db, { username, password }) {
  if (!username || !password) {
    throw new Error('请输入用户名/手机号和密码');
  }

  const stmt = db.prepare('SELECT id, username, phone, password, role, nickname, status FROM users WHERE username = ? OR phone = ?');
  const user = stmt.get([username, username]);
  
  if (!user) {
    throw new Error('用户不存在');
  }
  
  if (user.status !== 1) {
    throw new Error('用户已禁用');
  }
  
  const isValid = comparePassword(password, user.password);
  
  if (!isValid) {
    throw new Error('密码错误');
  }
  
  const token = generateToken(user);
  return { user, token };
}

function getUserById(db, userId) {
  const stmt = db.prepare('SELECT id, username, phone, role, nickname, status FROM users WHERE id = ? AND deleted_at IS NULL');
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
  initAdmin,
  register,
  login,
  getUserById,
  JWT_SECRET
};