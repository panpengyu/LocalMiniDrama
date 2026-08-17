/**
 * S20-T01 分支叙事服务
 *
 * 分支建模：
 *   - episodes.branch_id 标记归属分支；branch_id IS NULL 表示主线（'main'）
 *   - 分支由「复制源集」创建：新 episode 共享 branch_id，storyboards 一并复制（继承分支列）
 *   - branch_condition 挂在 storyboards 上：JSON { condition, target_scene_id }，表示该镜头按条件跳转到目标镜头（条件连线）
 *   - 按分支导出剧本：拼接该分支下各集的 script_content 与分镜（dialogue/action）
 */

'use strict';

const { snowflakeId } = require('../utils/snowflake');

const MAIN_BRANCH = 'main';

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now','localtime')";
}

/** 分支列表：主线 + 各分支（含集数、创建时间） */
function listBranches(db, dramaId) {
  const rows = db.prepare(
    `SELECT
       COALESCE(branch_id, '') AS branch_id,
       CASE WHEN branch_id IS NULL THEN 'main' ELSE 'branch' END AS branch_type,
       MAX(branch_name) AS branch_name,
       COUNT(*) AS episode_count,
       MIN(created_at) AS created_at
     FROM episodes
     WHERE drama_id = ? AND deleted_at IS NULL
     GROUP BY branch_id
     ORDER BY branch_id IS NOT NULL, branch_id`
  ).all(dramaId) || [];
  return rows.map((r) => ({
    id: r.branch_id === '' ? null : r.branch_id,
    name: r.branch_id === '' ? '主线' : (r.branch_name || `分支 ${String(r.branch_id).slice(-6)}`),
    type: r.branch_type,
    episodeCount: Number(r.episode_count),
    createdAt: r.created_at,
  }));
}

/** 创建分支：复制源集及其分镜，挂到新 branch_id 下 */
function createBranch(db, log, { dramaId, sourceEpisodeId, name }) {
  const source = db.prepare(
    'SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL'
  ).get(sourceEpisodeId, dramaId);
  if (!source) {
    const err = new Error('源剧集不存在');
    err.code = 'EPISODE_NOT_FOUND';
    throw err;
  }

  const branchId = snowflakeId();
  const branchName = String(name || '').trim() || `分支 ${String(branchId).slice(-6)}`;

  // 新集：挂到分支，集号沿用源集（同集不同分支）
  const info = db.prepare(
    `INSERT INTO episodes
       (drama_id, episode_number, title, script_content, description, duration, video_url, thumbnail, status,
        branch_id, branch_type, branch_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'branch', ?, ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(
    dramaId, Number(source.episode_number), source.title || branchName, source.script_content || null,
    source.description || null, Number(source.duration || 0), source.video_url || null, source.thumbnail || null,
    source.status || 'draft', branchId, branchName
  );
  const newEpisodeId = info.lastInsertRowid || info.insertId;

  // 复制源集分镜
  const boards = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ?'
  ).all(sourceEpisodeId) || [];
  let copied = 0;
  for (const b of boards) {
    const bi = db.prepare(
      `INSERT INTO storyboards
         (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, action,
          atmosphere, image_prompt, video_prompt, characters, shot_type, angle, movement, video_url, status,
          branch_id, branch_type, branch_condition, branch_target_scene_id, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'branch', ?, ?, ${nowExpr(db)}, ${nowExpr(db)})`
    ).run(
      newEpisodeId, Number(b.storyboard_number || 0), b.title || null, b.description || null, b.location || null,
      b.time || null, b.duration != null ? Number(b.duration) : null, b.dialogue || null, b.action || null,
      b.atmosphere || null, b.image_prompt || null, b.video_prompt || null, b.characters || null,
      b.shot_type || null, b.angle || null, b.movement || null, b.video_url || null, b.status || 'draft',
      branchId, b.branch_condition || null, b.branch_target_scene_id != null ? Number(b.branch_target_scene_id) : null
    );
    if (bi.changes) copied += 1;
  }

  if (log) log.info('[S20-T01] 创建分支', { dramaId, branchId, sourceEpisodeId, newEpisodeId, copiedBoards: copied });
  return {
    id: branchId,
    name: branchName,
    type: 'branch',
    episode: { id: newEpisodeId, episodeNumber: Number(source.episode_number), title: source.title || branchName },
    copiedStoryboards: copied,
  };
}

/** 重命名分支（写入该分支所有集的 branch_name） */
function renameBranch(db, log, { dramaId, branchId, name }) {
  if (!branchId) {
    const err = new Error('主线不可重命名');
    err.code = 'MAIN_BRANCH_IMMUTABLE';
    throw err;
  }
  const branchName = String(name || '').trim();
  if (!branchName) {
    const err = new Error('分支名称不能为空');
    err.code = 'EMPTY_NAME';
    throw err;
  }
  const info = db.prepare(
    'UPDATE episodes SET branch_name = ? WHERE drama_id = ? AND branch_id = ? AND deleted_at IS NULL'
  ).run(branchName, dramaId, branchId);
  if (info.changes === 0) {
    const err = new Error('分支不存在');
    err.code = 'BRANCH_NOT_FOUND';
    throw err;
  }
  if (log) log.info('[S20-T01] 分支重命名', { dramaId, branchId, branchName });
  return { id: branchId, name: branchName };
}

/** 删除分支：删除其下所有集与分镜 */
function deleteBranch(db, log, { dramaId, branchId }) {
  if (!branchId) {
    const err = new Error('主线不可删除');
    err.code = 'MAIN_BRANCH_IMMUTABLE';
    throw err;
  }
  const eps = db.prepare(
    'SELECT id FROM episodes WHERE drama_id = ? AND branch_id = ? AND deleted_at IS NULL'
  ).all(dramaId, branchId) || [];
  const epIds = eps.map((e) => e.id);
  let storyboards = 0;
  for (const id of epIds) {
    storyboards += db.prepare('DELETE FROM storyboards WHERE episode_id = ?').run(id).changes;
  }
  const deleted = db.prepare(
    'DELETE FROM episodes WHERE drama_id = ? AND branch_id = ? AND deleted_at IS NULL'
  ).run(dramaId, branchId).changes;
  if (log) log.info('[S20-T01] 删除分支', { dramaId, branchId, episodes: deleted, storyboards });
  return { id: branchId, deletedEpisodes: deleted, deletedStoryboards: storyboards };
}

/** 将某集移动到指定分支（branch_id 为空串/null 表示回到主线） */
function moveEpisode(db, log, { episodeId, branchId }) {
  const target = branchId ? String(branchId) : null;
  const info = db.prepare(
    'UPDATE episodes SET branch_id = ?, branch_type = ?, updated_at = ' + nowExpr(db) + ' WHERE id = ?'
  ).run(target, target ? 'branch' : MAIN_BRANCH, episodeId);
  if (info.changes === 0) {
    const err = new Error('剧集不存在');
    err.code = 'EPISODE_NOT_FOUND';
    throw err;
  }
  if (log) log.info('[S20-T01] 剧集移动分支', { episodeId, branchId: target });
  return { episodeId: Number(episodeId), branchId: target, branchType: target ? 'branch' : MAIN_BRANCH };
}

/** 设置分镜的条件连线：该镜头满足 condition 时跳转到 targetSceneId */
function setStoryboardCondition(db, log, { sceneId, condition, targetSceneId }) {
  const scene = db.prepare('SELECT id FROM storyboards WHERE scene_id = ?').get(sceneId);
  if (!scene) {
    const err = new Error('分镜不存在');
    err.code = 'SCENE_NOT_FOUND';
    throw err;
  }
  const cond = String(condition || '').trim();
  const target = targetSceneId != null ? Number(targetSceneId) : null;
  db.prepare(
    `UPDATE storyboards
       SET branch_condition = ?, branch_target_scene_id = ?, updated_at = ${nowExpr(db)}
     WHERE scene_id = ?`
  ).run(cond ? JSON.stringify({ condition: cond, target_scene_id: target }) : null, target, sceneId);
  if (log) log.info('[S20-T01] 条件连线设置', { sceneId, condition: cond, targetSceneId: target });
  return { sceneId: Number(sceneId), condition: cond || null, targetSceneId: target };
}

/** 按分支导出剧本（纯文本）：标题 + 集列表 + 各集分镜台词/动作 + 条件连线标注 */
function exportByBranch(db, log, { dramaId, branchId }) {
  const isMain = !branchId;
  const eps = db.prepare(
    `SELECT * FROM episodes
     WHERE drama_id = ? AND deleted_at IS NULL
       AND (branch_id IS NULL AND ? = 'main' OR branch_id = ?)
     ORDER BY episode_number ASC, id ASC`
  ).all(dramaId, isMain ? 'main' : '', branchId || null) || [];

  const lines = [];
  const branchName = isMain ? '主线' : (eps.find((e) => e.branch_name)?.branch_name || `分支 ${String(branchId).slice(-6)}`);
  lines.push(`【${branchName}】`);
  lines.push('='.repeat(40));

  for (const ep of eps) {
    lines.push('');
    lines.push(`第 ${ep.episode_number} 集 ${ep.title || ''}`);
    if (ep.script_content) lines.push(ep.script_content);
    const boards = db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? ORDER BY storyboard_number ASC, id ASC'
    ).all(ep.id) || [];
    for (const b of boards) {
      const parts = [];
      if (b.shot_type || b.angle) parts.push(`[${b.shot_type || ''}${b.angle ? '·' + b.angle : ''}]`);
      if (b.location) parts.push(`地点：${b.location}`);
      if (b.time) parts.push(`时间：${b.time}`);
      lines.push(parts.length ? parts.join(' ') : '');
      if (b.title) lines.push(`  分镜：${b.title}`);
      if (b.action) lines.push(`  动作：${b.action}`);
      if (b.dialogue) lines.push(`  台词：${b.dialogue}`);
      let condText = null;
      if (b.branch_condition) {
        try {
          const c = JSON.parse(b.branch_condition);
          condText = c.condition;
        } catch (_) { condText = String(b.branch_condition); }
      }
      if (condText) lines.push(`  ◆ 条件分支：${condText}${b.branch_target_scene_id ? ` → 跳转分镜 ${b.branch_target_scene_id}` : ''}`);
    }
  }
  const text = lines.join('\n');
  if (log) log.info('[S20-T01] 按分支导出剧本', { dramaId, branchId: branchId || 'main', episodes: eps.length, chars: text.length });
  return { branchId: branchId || null, branchName, episodes: eps.length, text };
}

module.exports = {
  MAIN_BRANCH,
  listBranches,
  createBranch,
  renameBranch,
  deleteBranch,
  moveEpisode,
  setStoryboardCondition,
  exportByBranch,
};
