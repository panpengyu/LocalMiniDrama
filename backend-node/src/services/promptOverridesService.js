/**
 * 提示词覆盖：DB CRUD + 内存缓存同步
 */
function listOverrides(db, userId = null) {
  if (userId) {
    return db.prepare('SELECT `key`, content, updated_at FROM prompt_overrides WHERE user_id IS NULL OR user_id = ? ORDER BY `key`').all(userId);
  }
  return db.prepare('SELECT `key`, content, updated_at FROM prompt_overrides ORDER BY `key`').all();
}

function getOverride(db, key, userId = null) {
  if (userId) {
    const row = db.prepare('SELECT content FROM prompt_overrides WHERE `key` = ? AND (user_id IS NULL OR user_id = ?) ORDER BY user_id IS NOT NULL DESC LIMIT 1').get(key, userId);
    return row ? row.content : null;
  }
  const row = db.prepare('SELECT content FROM prompt_overrides WHERE `key` = ?').get(key);
  return row ? row.content : null;
}

function setOverride(db, key, content, userId = null) {
  const now = new Date().toISOString();
  // 双数据库兼容：MySQL 用 ON DUPLICATE KEY UPDATE；SQLite 用 ON CONFLICT DO UPDATE。
  // 注意：prompt_overrides 的唯一约束仅为 `key` 单列（无 key+user_id 复合唯一键），故 ON CONFLICT 指向 `key`。
  const isMysql = db.type === 'mysql';
  if (userId) {
    const sql = isMysql
      ? 'INSERT INTO prompt_overrides (`key`, content, user_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE content = ?, updated_at = ?'
      : 'INSERT INTO prompt_overrides (`key`, content, user_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at';
    const params = isMysql ? [key, content, userId, now, content, now] : [key, content, userId, now];
    db.prepare(sql).run(...params);
  } else {
    const sql = isMysql
      ? 'INSERT INTO prompt_overrides (`key`, content, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = ?, updated_at = ?'
      : 'INSERT INTO prompt_overrides (`key`, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at';
    const params = isMysql ? [key, content, now, content, now] : [key, content, now];
    db.prepare(sql).run(...params);
  }
}

function deleteOverride(db, key, userId = null) {
  if (userId) {
    db.prepare('DELETE FROM prompt_overrides WHERE `key` = ? AND user_id = ?').run(key, userId);
  } else {
    db.prepare('DELETE FROM prompt_overrides WHERE `key` = ?').run(key);
  }
}

module.exports = { listOverrides, getOverride, setOverride, deleteOverride };
