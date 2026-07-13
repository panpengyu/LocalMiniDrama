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
  if (userId) {
    db.prepare('INSERT INTO prompt_overrides (`key`, content, user_id, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE content = ?, updated_at = ?').run(key, content, userId, now, content, now);
  } else {
    db.prepare('INSERT INTO prompt_overrides (`key`, content, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = ?, updated_at = ?').run(key, content, now, content, now);
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
