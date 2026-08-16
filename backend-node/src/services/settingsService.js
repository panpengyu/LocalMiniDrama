const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let configPath = null;
let configCache = null;

function setConfigPath(cfg) {
  const paths = [
    path.join(process.cwd(), 'configs', 'config.yaml'),
    path.join(process.cwd(), 'config.yaml'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      configPath = p;
      return p;
    }
  }
  return null;
}

function getLanguage(cfg) {
  return cfg?.app?.language || 'zh';
}

function updateLanguage(cfg, log, language) {
  if (language !== 'zh' && language !== 'en') {
    return { ok: false, error: '只支持 zh 或 en' };
  }
  if (!cfg.app) cfg.app = {};
  cfg.app.language = language;
  setConfigPath(cfg);
  if (configPath) {
    try {
      const current = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      if (!current.app) current.app = {};
      current.app.language = language;
      fs.writeFileSync(configPath, yaml.dump(current, { lineWidth: -1 }), 'utf8');
    } catch (err) {
      log.warnw('Failed to write config file', { error: err.message });
    }
  }
  log.infow('System language updated', { language });
  return { ok: true, language };
}

/**
 * 从 global_settings 表读取一个键值，返回解析后的值，不存在时返回 defaultValue。
 */
function getGlobalSetting(db, key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM global_settings WHERE `key` = ?').get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
  } catch (_) { return defaultValue; }
}

/**
 * 向 global_settings 表写入一个键值（value 会被 JSON.stringify）。
 */
function setGlobalSetting(db, key, value) {
  const now = new Date().toISOString();
  const str = JSON.stringify(value);
  if (db.type === 'mysql') {
    // 说明：实测 sync-mysql 对 INSERT ... ON DUPLICATE KEY UPDATE 的参数绑定在
    // 值含 base64 等特殊字符时存在缺陷（changes 误报但行未更新，S17-T03 复现）。
    // 改为「UPDATE 未命中则 INSERT」两步法，语义等价且对任意字符安全。
    const up = db.prepare('UPDATE global_settings SET value = ?, updated_at = ? WHERE `key` = ?').run(str, now, key);
    if (!(up && up.changes)) {
      db.prepare('INSERT INTO global_settings (`key`, value, updated_at) VALUES (?, ?, ?)').run(key, str, now);
    }
  } else {
    db.prepare(
      'INSERT INTO global_settings (`key`, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, str, now);
  }
}

function getUserSetting(db, userId, key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?').get(userId, key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
  } catch (_) { return defaultValue; }
}

function setUserSetting(db, userId, key, value) {
  const now = new Date().toISOString();
  const str = JSON.stringify(value);
  // 双数据库兼容：MySQL 用 ON DUPLICATE KEY UPDATE；SQLite 用 ON CONFLICT DO UPDATE（复合主键 user_id + `key`）
  if (db.type === 'mysql') {
    db.prepare(
      'INSERT INTO user_settings (user_id, `key`, value, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = ?'
    ).run(userId, key, str, now, str, now);
  } else {
    db.prepare(
      'INSERT INTO user_settings (user_id, `key`, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, `key`) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(userId, key, str, now);
  }
}

function getSetting(db, userId, key, defaultValue = null) {
  if (userId) {
    const userValue = getUserSetting(db, userId, key);
    if (userValue !== null && userValue !== undefined) {
      return userValue;
    }
  }
  return getGlobalSetting(db, key, defaultValue);
}

module.exports = {
  setConfigPath,
  getLanguage,
  updateLanguage,
  getGlobalSetting,
  setGlobalSetting,
  getUserSetting,
  setUserSetting,
  getSetting,
};
