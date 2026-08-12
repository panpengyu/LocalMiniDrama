'use strict';

/**
 * Sprint 12 - S12-T03 存储对象元数据与生命周期管理
 *
 * 把每一次落库的存储对象登记到 storage_objects 表（MySQL），用于：
 *   - 跨后端统一检索（不管落在 local 还是 minio）
 *   - 生命周期管理：长期未访问 → 归档(archived) → 逻辑删除(deleted)
 *   - 迁移追踪：本地对象迁移到对象存储时更新 backend/url
 *
 * 所有记录真实写入 MySQL，不使用任何 mock 数据。
 */
const crypto = require('crypto');

function sha256(buffer) {
  try {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (_) {
    return null;
  }
}

/**
 * 登记（或更新）一个存储对象记录。以 (backend, object_key) 唯一。
 * @param {object} meta { backend, bucket, objectKey, url, category, dramaId, sizeBytes, mimeType, buffer }
 */
function registerObject(db, log, meta) {
  const backend = meta.backend || 'local';
  const objectKey = String(meta.objectKey || '').replace(/\\/g, '/');
  if (!objectKey) return null;
  const checksum = meta.checksum || (meta.buffer ? sha256(meta.buffer) : null);
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM storage_objects WHERE backend = ? AND object_key = ?').get(backend, objectKey);
  if (existing) {
    db.prepare(
      `UPDATE storage_objects SET bucket = ?, url = ?, category = ?, drama_id = ?, size_bytes = ?, mime_type = ?, checksum = ?,
       lifecycle = 'active', last_access_at = ?, updated_at = ? WHERE id = ?`
    ).run(
      meta.bucket || null, meta.url || null, meta.category || null,
      meta.dramaId != null ? Number(meta.dramaId) : null,
      Number(meta.sizeBytes) || 0, meta.mimeType || null, checksum, now, now, existing.id
    );
    return existing.id;
  }
  try {
    const info = db.prepare(
      `INSERT INTO storage_objects (backend, bucket, object_key, url, category, drama_id, size_bytes, mime_type, checksum, lifecycle, last_access_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      backend, meta.bucket || null, objectKey, meta.url || null, meta.category || null,
      meta.dramaId != null ? Number(meta.dramaId) : null,
      Number(meta.sizeBytes) || 0, meta.mimeType || null, checksum, now, now, now
    );
    return info.lastInsertRowid || info.insertId;
  } catch (err) {
    // 并发 UNIQUE 冲突 → 回查
    const row = db.prepare('SELECT id FROM storage_objects WHERE backend = ? AND object_key = ?').get(backend, objectKey);
    if (row) return row.id;
    log.warn('[S12-T03] 存储对象登记失败', { error: err.message, objectKey });
    return null;
  }
}

/** 触达访问，刷新 last_access_at（生命周期依据） */
function touch(db, backend, objectKey) {
  const now = new Date().toISOString();
  db.prepare('UPDATE storage_objects SET last_access_at = ? WHERE backend = ? AND object_key = ?')
    .run(now, backend || 'local', String(objectKey).replace(/\\/g, '/'));
}

/** 分页列出存储对象 */
function listObjects(db, { backend = null, lifecycle = null, dramaId = null, page = 1, pageSize = 20 } = {}) {
  let sql = 'FROM storage_objects WHERE 1=1';
  const params = [];
  if (backend) { sql += ' AND backend = ?'; params.push(backend); }
  if (lifecycle) { sql += ' AND lifecycle = ?'; params.push(lifecycle); }
  if (dramaId != null) { sql += ' AND drama_id = ?'; params.push(Number(dramaId)); }
  const total = db.prepare('SELECT COUNT(*) c ' + sql).get(...params).c || 0;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, ps, (p - 1) * ps);
  return { items: rows, total, page: p, pageSize: ps };
}

/** 统计：各后端对象数量与占用空间 */
function storageStats(db) {
  const byBackend = db.prepare(
    `SELECT backend, COUNT(*) as objects, COALESCE(SUM(size_bytes),0) as bytes
     FROM storage_objects WHERE lifecycle != 'deleted' GROUP BY backend`
  ).all();
  const byLifecycle = db.prepare(
    `SELECT lifecycle, COUNT(*) as objects, COALESCE(SUM(size_bytes),0) as bytes
     FROM storage_objects GROUP BY lifecycle`
  ).all();
  const totalRow = db.prepare(
    `SELECT COUNT(*) as objects, COALESCE(SUM(size_bytes),0) as bytes FROM storage_objects WHERE lifecycle != 'deleted'`
  ).get();
  return {
    total: { objects: totalRow.objects || 0, bytes: Number(totalRow.bytes) || 0 },
    by_backend: byBackend.map((r) => ({ backend: r.backend, objects: r.objects, bytes: Number(r.bytes) || 0 })),
    by_lifecycle: byLifecycle.map((r) => ({ lifecycle: r.lifecycle, objects: r.objects, bytes: Number(r.bytes) || 0 })),
  };
}

/**
 * 生命周期扫描：把超过 archiveDays 未访问的活跃对象标记为归档。
 * 仅更新元数据状态，不物理删除文件（安全）。
 */
function runLifecycleScan(db, log, { archiveDays = 90 } = {}) {
  const rows = db.prepare(
    `SELECT id, backend, object_key, last_access_at, created_at FROM storage_objects WHERE lifecycle = 'active'`
  ).all();
  const nowMs = Date.now();
  const thresholdMs = archiveDays * 24 * 60 * 60 * 1000;
  let archived = 0;
  for (const row of rows) {
    const ref = row.last_access_at || row.created_at;
    const refMs = ref ? new Date(String(ref).replace(' ', 'T')).getTime() : nowMs;
    if (Number.isFinite(refMs) && nowMs - refMs > thresholdMs) {
      db.prepare("UPDATE storage_objects SET lifecycle = 'archived', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
      archived += 1;
    }
  }
  log.info('[S12-T03] 生命周期扫描完成', { scanned: rows.length, archived, archive_days: archiveDays });
  return { ok: true, scanned: rows.length, archived, archive_days: archiveDays };
}

/** 标记对象为逻辑删除 */
function markDeleted(db, id) {
  const result = db.prepare("UPDATE storage_objects SET lifecycle = 'deleted', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), Number(id));
  return (result.changes || 0) > 0;
}

module.exports = {
  registerObject,
  touch,
  listObjects,
  storageStats,
  runLifecycleScan,
  markDeleted,
  sha256,
};
