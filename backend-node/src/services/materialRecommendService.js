'use strict';

/**
 * S16-T01 素材推荐引擎
 *
 * 全部基于真实 MySQL 数据（dramas / user_activity_logs / recommend_logs /
 * character_libraries / scene_libraries / prop_libraries / marketplace_templates），
 * 无任何 mock。推荐算法为原创实现：
 *
 *   1) 用户偏好画像（增量快照 → user_preference_profiles）
 *      - 题材偏好：用户 dramas.genre 出现频次加权
 *      - 风格偏好：用户 dramas.style 出现频次加权
 *      - 标签偏好：用户素材行为（user_activity_logs）+ 推荐采纳（recommend_logs action in click/apply）
 *        对应素材的 tags 聚合加权
 *   2) 素材推荐：标签协同匹配(0.65) + 热门度(0.35)
 *      - tagMatch = 素材 tags 与用户标签偏好重合权重比（归一 0~1）
 *      - popularity = 素材全局行为/采纳热度（log1p 归一 0~1）
 *   3) 模板推荐：题材匹配(0.60) + 下载热门(0.40)
 *      - genreMatch = 模板 genre_type 与用户题材偏好匹配权重比（归一 0~1）
 *      - popularity = download_count 归一（log1p）
 *   4) 冷启动：画像为空时退化为全站热门（source = cold_start / trending）
 *
 * 所有推荐行为（曝光/点击/采纳）通过 logFeedback 写入 recommend_logs，
 * 供效果评估与画像迭代（真实数据闭环，无 mock）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000; // 画像缓存 6 小时

/** 素材维度 → 库表映射 */
const MATERIAL_DIMS = {
  character: { table: 'character_libraries', nameCol: 'name' },
  scene: { table: 'scene_libraries', nameCol: 'location' },
  prop: { table: 'prop_libraries', nameCol: 'name' }
};

/** 模板题材关键词（用于把中文题材/风格归一化到 genre_type 枚举） */
const GENRE_KEYWORDS = {
  urban_romance: ['都市', '言情', '现代', '爱情', '甜宠', '霸总', '总裁'],
  ancient_fantasy: ['古装', '玄幻', '仙侠', '古风', '穿越', '宫斗', '权谋', '武侠'],
  mystery: ['悬疑', '推理', '探案', '惊悚', '刑侦', '破案'],
  scifi: ['科幻', '未来', '星际', '赛博', '末日'],
  campus: ['校园', '学生', '学堂', '高中'],
  youth: ['青春', '成长', '治愈', '励志'],
  structure: ['结构', '套路', '模板']
};

/** 画像重建/读取 */
function buildUserProfile(db, log, userId) {
  const uid = Number(userId);
  const now = new Date().toISOString();
  const genreW = {};  // { 题材原文: 权重 }
  const styleW = {};  // { 风格: 权重 }
  const tagW = {};    // { tag: 权重 }

  // 1) 用户创作项目的题材/风格偏好
  try {
    const dramas = db.prepare(
      `SELECT genre, style FROM dramas
       WHERE user_id = ? AND deleted_at IS NULL AND (genre IS NOT NULL OR style IS NOT NULL)`
    ).all(uid);
    for (const d of dramas || []) {
      if (d.genre) genreW[String(d.genre)] = (genreW[String(d.genre)] || 0) + 1;
      if (d.style) styleW[String(d.style)] = (styleW[String(d.style)] || 0) + 1;
    }
  } catch (e) { log?.warn?.('推荐画像-题材聚合失败:', e.message); }

  // 2) 用户素材行为（浏览/收藏/引用）对应素材的标签聚合
  try {
    const dimTables = Object.values(MATERIAL_DIMS);
    const actions = db.prepare(
      `SELECT target_type, target_id FROM user_activity_logs
       WHERE user_id = ? AND target_type IN (${dimTables.map(() => '?').join(',')})
         AND target_id IS NOT NULL ORDER BY id DESC LIMIT 500`
    ).all(uid, ...dimTables.map((d) => d.table));
    const tagRows = [];
    for (const a of actions || []) {
      const row = db.prepare(
        `SELECT tags FROM ${a.target_type} WHERE id = ? AND deleted_at IS NULL`
      ).get(Number(a.target_id));
      if (row && row.tags) tagRows.push(row.tags);
    }
    for (const tags of tagRows) {
      for (const t of String(tags).split(/[,，;；]/)) {
        const tag = t.trim();
        if (tag) tagW[tag] = (tagW[tag] || 0) + 1;
      }
    }
  } catch (e) { log?.warn?.('推荐画像-素材标签聚合失败:', e.message); }

  // 3) 用户对推荐内容的点击/采纳反馈 → 强化对应素材标签
  try {
    const feedbacks = db.prepare(
      `SELECT item_type, dimension, item_id FROM recommend_logs
       WHERE user_id = ? AND action IN ('click', 'apply', 'collect')
       ORDER BY id DESC LIMIT 200`
    ).all(uid);
    for (const f of feedbacks || []) {
      if (f.item_type === 'material' && MATERIAL_DIMS[f.dimension]) {
        const dim = MATERIAL_DIMS[f.dimension];
        const row = db.prepare(`SELECT tags FROM ${dim.table} WHERE id = ?`).get(Number(f.item_id));
        if (row && row.tags) {
          for (const t of String(row.tags).split(/[,，;；]/)) {
            const tag = t.trim();
            if (tag) tagW[tag] = (tagW[tag] || 0) + 1.5;
          }
        }
      }
    }
  } catch (e) { log?.warn?.('推荐画像-反馈聚合失败:', e.message); }

  // 4) 素材维度活跃度（该用户在各维度素材的行为数）
  const materialDims = {};
  try {
    for (const dim of Object.keys(MATERIAL_DIMS)) {
      const c = db.prepare(
        `SELECT COUNT(*) AS c FROM user_activity_logs
         WHERE user_id = ? AND target_type = ?`
      ).get(uid, MATERIAL_DIMS[dim].table);
      materialDims[dim] = Number(c?.c || 0);
    }
  } catch (e) { log?.warn?.('推荐画像-维度统计失败:', e.message); }

  const totalActions =
    Object.values(genreW).reduce((a, b) => a + b, 0) +
    Object.values(tagW).reduce((a, b) => a + b, 0);

  const profile = {
    genre_weights: JSON.stringify(genreW),
    style_weights: JSON.stringify(styleW),
    tag_weights: JSON.stringify(tagW),
    material_dims: JSON.stringify(materialDims),
    total_actions: totalActions,
    computed_at: now
  };

  db.prepare(
    `INSERT INTO user_preference_profiles (user_id, genre_weights, style_weights, tag_weights, material_dims, total_actions, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       genre_weights=VALUES(genre_weights), style_weights=VALUES(style_weights),
       tag_weights=VALUES(tag_weights), material_dims=VALUES(material_dims),
       total_actions=VALUES(total_actions), computed_at=VALUES(computed_at)`
  ).run(uid, profile.genre_weights, profile.style_weights, profile.tag_weights, profile.material_dims, totalActions, now);

  return { user_id: uid, ...profile };
}

/** 读取用户画像（带 TTL 重建） */
function getUserProfile(db, log, userId) {
  const uid = Number(userId);
  try {
    const row = db.prepare(
      `SELECT * FROM user_preference_profiles WHERE user_id = ?`
    ).get(uid);
    if (row) {
      const ageMs = Date.now() - new Date(row.computed_at || 0).getTime();
      if (ageMs < PROFILE_TTL_MS) return row;
    }
  } catch (e) { /* 表不存在等场景直接重建 */ }
  return buildUserProfile(db, log, uid);
}

/** 记录推荐曝光/反馈（真实数据落 recommend_logs） */
function logFeedback(db, log, { userId, itemType, dimension, itemId, action = 'impression', source = 'personalized', score = null, rank = null, meta = null }) {
  if (!userId || !itemType || !itemId) return { ok: false, error: '参数缺失' };
  const uid = Number(userId);
  const info = db.prepare(
    `INSERT INTO recommend_logs (user_id, item_type, dimension, item_id, action, source, score, rank_pos, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, String(itemType), String(dimension || itemType), Number(itemId),
    String(action), String(source || 'personalized'),
    score != null ? Number(score) : null,
    rank != null ? Number(rank) : null,
    meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
    new Date().toISOString());
  return { ok: true, id: info.insertId || info.lastInsertRowid };
}

/** 素材热门度：行为数(0.6) + 推荐采纳数(0.4)，log1p 归一 0~1 */
function materialPopularity(db, table) {
  let score = 0;
  try {
    const r = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_activity_logs WHERE target_type = ?) AS acts,
         (SELECT COUNT(*) FROM recommend_logs WHERE item_type = 'material' AND dimension = ? AND action IN ('click', 'apply')) AS adopts`
    ).get(table, table === 'character_libraries' ? 'character' : (table === 'scene_libraries' ? 'scene' : 'prop'));
    const acts = Number(r?.acts || 0);
    const adopts = Number(r?.adopts || 0);
    score = Math.min(1, Math.log1p(acts * 0.6 + adopts) / Math.log1p(100));
  } catch (e) { /* 忽略统计异常 */ }
  return score;
}

/** 获取素材热门度 TOP（全站热门，供冷启动/热门榜） */
function getTrendingMaterials(db, dimension, limit) {
  const dim = MATERIAL_DIMS[dimension];
  if (!dim) return [];
  // 行为热度一次性聚合（避免 N+1：单条 GROUP BY 查询替代逐素材计数）
  const heatMap = {};
  try {
    const heatRows = db.prepare(
      `SELECT target_id, COUNT(*) AS c FROM user_activity_logs
       WHERE target_type = ? AND target_id IS NOT NULL GROUP BY target_id`
    ).all(dim.table) || [];
    for (const h of heatRows) heatMap[Number(h.target_id)] = Number(h.c);
  } catch (e) { /* 行为统计失败则热门度退化为 0 */ }
  const rows = db.prepare(
    `SELECT t.id, t.${dim.nameCol} AS name, t.category, t.tags, t.image_url, t.local_path, t.description
     FROM ${dim.table} t
     WHERE t.deleted_at IS NULL
     ORDER BY t.id DESC LIMIT 300`
  ).all() || [];
  // 行为热度排序（无 mock：用行为日志真实聚合）
  const scored = (rows || []).map((r) => {
    const acts = heatMap[Number(r.id)] || 0;
    return { ...r, score: Math.min(1, Math.log1p(acts) / Math.log1p(50)), source: 'trending' };
  });
  scored.sort((a, b) => (b.score - a.score) || (b.id - a.id));
  return scored.slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50));
}

/**
 * 素材推荐：标签协同(0.65) + 热门(0.35)
 * @returns {{items: Array}}
 */
function recommendMaterials(db, log, { userId, dimension, limit = 20, excludeIds = [] } = {}) {
  const dim = MATERIAL_DIMS[dimension];
  if (!dim) return { items: [], error: `不支持的素材维度: ${dimension}` };

  let profile = null;
  try { profile = getUserProfile(db, log, userId); } catch (e) { /* 画像失败退热门 */ }

  let tagW = {};
  try { tagW = profile?.tag_weights ? JSON.parse(profile.tag_weights) : {}; } catch (e) { tagW = {}; }
  const topTags = Object.entries(tagW).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const hasProfile = Boolean(profile && Number(profile.total_actions || 0) > 0);

  const limitN = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const exclude = new Set((Array.isArray(excludeIds) ? excludeIds : String(excludeIds || '').split(','))
    .map((x) => Number(x)).filter((x) => x > 0));

  // 素材列表（单次查询，避免 N+1）
  const rows = db.prepare(
    `SELECT id, ${dim.nameCol} AS name, category, tags, image_url, local_path, description
     FROM ${dim.table}
     WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 300`
  ).all() || [];

  // 热门度一次性聚合（避免每素材一次 COUNT）
  const heatMap = {};
  try {
    const heatRows = db.prepare(
      `SELECT target_id, COUNT(*) AS c FROM user_activity_logs
       WHERE target_type = ? AND target_id IS NOT NULL GROUP BY target_id`
    ).all(dim.table) || [];
    for (const h of heatRows) heatMap[Number(h.target_id)] = Number(h.c);
  } catch (e) { /* 热门度退化 */ }
  const popAll = materialPopularity(db, dim.table); // 全局热门归一基数

  const scored = [];
  for (const r of rows) {
    if (exclude.has(Number(r.id))) continue;
    // 标签协同得分
    let tagMatch = 0;
    let hitWeight = 0;
    let totalWeight = 0;
    const itemTags = new Set(String(r.tags || '').split(/[,，;；]/).map((t) => t.trim()).filter(Boolean));
    for (const [tag, w] of topTags) {
      totalWeight += Number(w);
      if (itemTags.has(tag)) hitWeight += Number(w);
    }
    tagMatch = totalWeight > 0 ? hitWeight / totalWeight : 0;
    // 素材个体热门度：行为量 + 推荐采纳，log1p 归一（上限与全局一致）
    const adopts = heatMap[Number(r.id)] || 0;
    const pop = Math.min(1, Math.log1p(adopts) / Math.log1p(50)) * Math.max(popAll, 0.01);
    const score = hasProfile ? 0.65 * tagMatch + 0.35 * pop : pop;
    const source = !hasProfile ? 'cold_start' : (tagMatch > 0 ? 'personalized' : 'trending');
    if (hasProfile && tagMatch <= 0) continue; // 有画像但零匹配时由热门兜底
    scored.push({
      id: Number(r.id),
      dimension,
      name: r.name,
      category: r.category || '',
      tags: String(r.tags || '').split(/[,，;；]/).map((t) => t.trim()).filter(Boolean),
      imageUrl: r.image_url || r.local_path || '',
      description: r.description || '',
      score: Number(score.toFixed(4)),
      source
    });
  }

  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const items = scored.slice(0, limitN);

  // 冷启动/画像零匹配时：用热门补足
  if (items.length < limitN && !hasProfile) {
    const trend = getTrendingMaterials(db, dimension, limitN * 2);
    for (const t of trend) {
      if (items.length >= limitN) break;
      if (exclude.has(Number(t.id)) || items.some((i) => i.id === Number(t.id))) continue;
      items.push({
        id: Number(t.id), dimension, name: t.name, category: t.category || '',
        tags: String(t.tags || '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean),
        imageUrl: t.image_url || t.local_path || '', description: t.description || '',
        score: Number(t.score.toFixed(4)), source: t.source || 'trending'
      });
    }
  }

  return { items, total: items.length, profileFound: hasProfile };
}

/**
 * 模板推荐：题材匹配(0.60) + 下载热门(0.40)
 */
function recommendTemplates(db, log, { userId, limit = 20 } = {}) {
  let profile = null;
  try { profile = getUserProfile(db, log, userId); } catch (e) { /* ignore */ }

  let genreW = {};
  try { genreW = profile?.genre_weights ? JSON.parse(profile.genre_weights) : {}; } catch (e) { genreW = {}; }
  const hasProfile = Object.keys(genreW).length > 0;

  // genre 中文原文 → genre_type 归一匹配
  const genreTypeWeight = {};
  for (const [raw, w] of Object.entries(genreW)) {
    for (const [gt, kws] of Object.entries(GENRE_KEYWORDS)) {
      if (kws.some((k) => String(raw).includes(k))) {
        genreTypeWeight[gt] = (genreTypeWeight[gt] || 0) + Number(w);
      }
    }
  }
  const totalGenreWeight = Object.values(genreTypeWeight).reduce((a, b) => a + b, 0);

  const limitN = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = db.prepare(
    `SELECT id, template_no, title, summary, category, genre_type, tags, cover_image, download_count
     FROM marketplace_templates
     WHERE status = 'listed' AND is_deleted = 0
     ORDER BY download_count DESC LIMIT 300`
  ).all() || [];

  const scored = [];
  for (const r of rows) {
    const gt = r.genre_type;
    const w = gt && genreTypeWeight[gt] ? Number(genreTypeWeight[gt]) : 0;
    const genreMatch = totalGenreWeight > 0 ? w / totalGenreWeight : 0;
    const pop = Math.min(1, Math.log1p(Number(r.download_count || 0)) / Math.log1p(200));
    const score = hasProfile ? 0.6 * genreMatch + 0.4 * pop : pop;
    const source = !hasProfile ? 'cold_start' : (genreMatch > 0 ? 'personalized' : 'trending');
    scored.push({
      id: Number(r.id), templateNo: r.template_no, title: r.title,
      summary: r.summary || '', category: r.category || '', genreType: gt || '',
      tags: Array.isArray(r.tags) ? r.tags : safeParseJson(r.tags),
      coverImage: r.cover_image || '',
      downloadCount: Number(r.download_count || 0),
      score: Number(score.toFixed(4)), source
    });
  }

  scored.sort((a, b) => b.score - a.score || b.downloadCount - a.downloadCount);
  return { items: scored.slice(0, limitN), total: scored.length, profileFound: hasProfile };
}

/** 全站热门（素材按维度 + 模板） */
function getTrending(db, log, { dimension = null, limit = 20 } = {}) {
  const limitN = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const result = {};
  if (dimension && MATERIAL_DIMS[dimension]) {
    result[dimension] = getTrendingMaterials(db, dimension, limitN);
  } else {
    for (const dim of Object.keys(MATERIAL_DIMS)) {
      result[dim] = getTrendingMaterials(db, dim, Math.max(4, Math.floor(limitN / 3)));
    }
  }
  const tplRows = db.prepare(
    `SELECT id, template_no, title, summary, category, genre_type, cover_image, download_count
     FROM marketplace_templates
     WHERE status = 'listed' AND is_deleted = 0
     ORDER BY download_count DESC LIMIT ${limitN}`
  ).all() || [];
  result.templates = tplRows.map((r) => ({
    id: Number(r.id), templateNo: r.template_no, title: r.title, summary: r.summary || '',
    category: r.category || '', genreType: r.genre_type || '', coverImage: r.cover_image || '',
    downloadCount: Number(r.download_count || 0), score: 1, source: 'trending'
  }));
  return result;
}

/** 首页个性化推荐组合 */
function homeRecommend(db, log, { userId, materialLimit = 6, templateLimit = 8 } = {}) {
  const materials = {};
  for (const dim of Object.keys(MATERIAL_DIMS)) {
    const r = recommendMaterials(db, log, { userId, dimension: dim, limit: materialLimit });
    materials[dim] = r.items;
  }
  const tpl = recommendTemplates(db, log, { userId, limit: templateLimit });
  return {
    materials,
    templates: tpl.items,
    profileFound: tpl.profileFound,
    generated_at: new Date().toISOString()
  };
}

function safeParseJson(s) {
  if (Array.isArray(s)) return s;
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

module.exports = {
  MATERIAL_DIMS,
  GENRE_KEYWORDS,
  buildUserProfile,
  getUserProfile,
  logFeedback,
  recommendMaterials,
  recommendTemplates,
  getTrending,
  getTrendingMaterials,
  homeRecommend
};
