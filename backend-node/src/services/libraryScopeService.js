'use strict';

/**
 * Sprint 12 - S12-T02 三级素材库（项目级 / 个人级 / 团队级 / 公共级）
 *
 * 在既有二级库（项目库 drama_id / 全局库 drama_id IS NULL）之上，为三张库表
 * (character_libraries / scene_libraries / prop_libraries) 增加作用域归属，
 * 使素材可以跨项目、跨成员复用：
 *
 *   project  → 项目内可见（drama_id 绑定，兼容旧数据）
 *   personal → 收藏到"我的个人库"，仅本人可见/复用
 *   team     → 发布到"团队库"，团队成员可见/复用
 *   public   → 发布到"公共库"，全平台可见/复用
 *
 * 复用方式：把某作用域的素材"另存"为目标项目的项目级素材（复制一行，保留来源信息），
 * 从而实现跨项目复用而不破坏原素材。
 */

const LIBRARY_TABLES = {
  character: 'character_libraries',
  scene: 'scene_libraries',
  prop: 'prop_libraries',
};
const VALID_SCOPES = ['project', 'personal', 'team', 'public'];

function resolveTable(kind) {
  const table = LIBRARY_TABLES[kind] || (Object.values(LIBRARY_TABLES).includes(kind) ? kind : null);
  if (!table) throw new Error(`不支持的素材类型: ${kind}（应为 character/scene/prop）`);
  return table;
}

function getItem(db, table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
}

/**
 * 变更素材作用域（收藏到个人库 / 发布到团队库 / 发布到公共库 / 收回项目库）。
 * @param {object} opts { kind, id, scope, ownerId, teamId, enterpriseId, visibility }
 */
function setScope(db, log, { kind, id, scope, ownerId = null, teamId = null, enterpriseId = null, visibility = null }) {
  const table = resolveTable(kind);
  if (!VALID_SCOPES.includes(scope)) {
    return { ok: false, error: `scope 非法，应为 ${VALID_SCOPES.join('/')} 之一` };
  }
  const item = getItem(db, table, id);
  if (!item) return { ok: false, error: '素材不存在' };

  const vis = visibility || (scope === 'personal' ? 'private' : scope === 'team' ? 'team' : scope === 'public' ? 'public' : 'private');
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${table} SET scope = ?, owner_id = ?, team_id = ?, enterprise_id = ?, visibility = ?, updated_at = ? WHERE id = ?`
  ).run(
    scope,
    scope === 'personal' ? (ownerId != null ? Number(ownerId) : item.owner_id) : (scope === 'project' ? null : ownerId != null ? Number(ownerId) : item.owner_id),
    scope === 'team' ? (teamId != null ? Number(teamId) : item.team_id) : null,
    enterpriseId != null ? Number(enterpriseId) : item.enterprise_id,
    vis,
    now,
    Number(id)
  );
  log.info('[S12-T02] 素材作用域已更新', { table, id, scope, owner_id: ownerId, team_id: teamId });
  return { ok: true, item: getItem(db, table, id) };
}

/** 收藏到个人库 */
function collectToPersonal(db, log, { kind, id, userId }) {
  if (!userId) return { ok: false, error: '缺少用户身份' };
  return setScope(db, log, { kind, id, scope: 'personal', ownerId: userId, visibility: 'private' });
}

/** 发布到团队库 */
function publishToTeam(db, log, { kind, id, teamId, enterpriseId = null }) {
  if (!teamId) return { ok: false, error: '当前用户未归属团队，无法发布到团队库' };
  return setScope(db, log, { kind, id, scope: 'team', teamId, enterpriseId, visibility: 'team' });
}

/** 发布到公共库 */
function publishToPublic(db, log, { kind, id }) {
  return setScope(db, log, { kind, id, scope: 'public', visibility: 'public' });
}

/**
 * 跨项目复用：把源素材复制为目标项目的项目级素材（复制新行，保留来源信息）。
 * @param {object} opts { kind, id, targetDramaId }
 */
function reuseToProject(db, log, { kind, id, targetDramaId }) {
  const table = resolveTable(kind);
  if (!targetDramaId) return { ok: false, error: '缺少目标项目 drama_id' };
  const src = getItem(db, table, id);
  if (!src) return { ok: false, error: '源素材不存在' };
  const drama = db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(targetDramaId));
  if (!drama) return { ok: false, error: '目标项目不存在' };

  const now = new Date().toISOString();
  // 复制通用列（三表共有），差异列（location/prompt/name 等）按存在与否动态取
  const commonFields = {
    drama_id: Number(targetDramaId),
    scope: 'project',
    owner_id: null,
    team_id: null,
    enterprise_id: null,
    visibility: 'private',
    image_url: src.image_url || '',
    local_path: src.local_path || null,
    description: src.description || null,
    category: src.category || null,
    tags: src.tags || null,
    source_type: 'reuse',
    source_id: src.source_id != null ? String(src.source_id) : String(src.id),
    created_at: now,
    updated_at: now,
  };
  // 各表特有列
  if (table === 'character_libraries') {
    commonFields.name = src.name || '';
  } else if (table === 'scene_libraries') {
    commonFields.location = src.location || '';
    commonFields.time = src.time || null;
    commonFields.prompt = src.prompt || null;
  } else if (table === 'prop_libraries') {
    commonFields.name = src.name || '';
    commonFields.prompt = src.prompt || null;
  }

  const names = Object.keys(commonFields);
  const placeholders = names.map(() => '?').join(', ');
  const values = names.map((n) => commonFields[n]);
  const info = db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`).run(...values);
  const newId = info.lastInsertRowid || info.insertId;

  // 复制标签关联（若源素材已有标签）
  try {
    db.prepare(
      `INSERT INTO material_tag_relations (material_table, material_id, tag_id, source, confidence, created_at)
       SELECT ?, ?, tag_id, 'manual', confidence, ? FROM material_tag_relations
       WHERE material_table = ? AND material_id = ?`
    ).run(table, Number(newId), now, table, Number(id));
  } catch (_) {}

  log.info('[S12-T02] 素材跨项目复用', { table, src_id: id, new_id: newId, target_drama: targetDramaId });
  return { ok: true, id: newId, item: getItem(db, table, newId) };
}

/**
 * 三级库聚合统计：各作用域素材数量，用于前端库切换概览。
 */
function scopeSummary(db, { userId = null, teamId = null } = {}) {
  const summary = {};
  for (const [kind, table] of Object.entries(LIBRARY_TABLES)) {
    const project = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE deleted_at IS NULL AND drama_id IS NOT NULL AND (scope = 'project' OR scope IS NULL)`).get().c || 0;
    const personal = userId
      ? (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE deleted_at IS NULL AND scope = 'personal' AND owner_id = ?`).get(Number(userId)).c || 0)
      : 0;
    const team = teamId
      ? (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE deleted_at IS NULL AND scope = 'team' AND team_id = ?`).get(Number(teamId)).c || 0)
      : 0;
    const publicCount = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE deleted_at IS NULL AND (scope = 'public' OR drama_id IS NULL)`).get().c || 0;
    summary[kind] = { project, personal, team, public: publicCount };
  }
  return summary;
}

module.exports = {
  LIBRARY_TABLES,
  VALID_SCOPES,
  resolveTable,
  setScope,
  collectToPersonal,
  publishToTeam,
  publishToPublic,
  reuseToProject,
  scopeSummary,
};
