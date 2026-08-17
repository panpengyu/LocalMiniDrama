'use strict';

/**
 * S20-T04 音效智能匹配
 *
 * 版权安全约束：
 *   - 只基于「用户自有素材」（assets 表，type ∈ audio/voice/music，且 tags 由用户上传时标注）
 *   - 不预置任何第三方版权音效文件，不内置网络音效源
 *   - 匹配为纯标签/名称打分，无任何素材内容外泄
 */

const SFX_TYPES = ['audio', 'voice', 'music'];

const MODES = ['light', 'normal', 'intense'];

function listTags(db) {
  const rows = db.prepare(
    `SELECT tags FROM assets
     WHERE type IN (${SFX_TYPES.map(() => '?').join(',')})
       AND deleted_at IS NULL AND tags IS NOT NULL AND tags <> ''`
  ).all(...SFX_TYPES);
  const tagSet = new Set();
  for (const r of rows) {
    try {
      for (const t of JSON.parse(r.tags)) {
        const v = String(t).trim();
        if (v) tagSet.add(v);
      }
    } catch (_) { /* 忽略非法 JSON 标签 */ }
  }
  return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/**
 * 按关键词/标签匹配用户自有音效素材。
 * @param {object} params { query, tags, limit, mode }
 * @returns {Array<{id, name, type, url, duration, tags, score, matchReason, suggestedStrength}>}
 */
function matchSfx(db, log, params = {}) {
  const query = String(params.query || '').trim().toLowerCase();
  const tagList = (Array.isArray(params.tags) ? params.tags : String(params.tags || '').split(','))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 50);
  const mode = MODES.includes(params.mode) ? params.mode : 'normal';

  const rows = db.prepare(
    `SELECT id, name, type, url, duration, tags, created_at
     FROM assets
     WHERE type IN (${SFX_TYPES.map(() => '?').join(',')})
       AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 500`
  ).all(...SFX_TYPES);

  const scored = [];
  for (const row of rows) {
    let rowTags = [];
    try {
      rowTags = (JSON.parse(row.tags || '[]') || []).map((t) => String(t).toLowerCase());
    } catch (_) { /* 无标签 */ }
    const name = String(row.name || '').toLowerCase();
    const reasons = [];
    let score = 0;

    // 关键词命中（名称 + 标签）
    if (query) {
      if (name.includes(query)) { score += 6; reasons.push(`名称含「${query}」`); }
      if (rowTags.some((t) => t.includes(query))) { score += 5; reasons.push('标签命中'); }
      if (score === 0) continue; // 关键词未命中直接跳过
    }

    // 标签过滤（用户指定标签集合时，全部命中优先）
    if (tagList.length) {
      const hit = tagList.filter((t) => rowTags.includes(t) || name.includes(t));
      if (hit.length === tagList.length) { score += 4 + hit.length; reasons.push(`标签:${hit.join('/')}`); }
      else if (hit.length === 0) continue; // 一个都没命中则跳过
      else { score += hit.length; reasons.push(`部分命中:${hit.join('/')}`); }
    }

    // 无任何筛选条件时给出基础分（最近素材优先展示）
    if (score === 0) {
      if (!query && tagList.length === 0) { score = 1; reasons.push('最近素材'); }
      else continue;
    }

    scored.push({
      id: row.id,
      name: row.name,
      type: row.type,
      url: row.url,
      duration: row.duration,
      tags: rowTags,
      source: 'user',
      score,
      matchReason: reasons.join('，'),
      suggestedStrength: strengthFor(mode, score),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  log.info('Sfx matched', { query, tagList, mode, total: scored.length });
  return scored.slice(0, limit);
}

/** 按强度模式输出建议音量（0~1），供剪辑引擎混音参考 */
function strengthFor(mode, score) {
  const base = mode === 'light' ? 0.35 : mode === 'intense' ? 0.85 : 0.6;
  return Number(Math.min(1, Math.max(0.1, base + (score - 5) * 0.02)).toFixed(2));
}

module.exports = { listTags, matchSfx, strengthFor };
