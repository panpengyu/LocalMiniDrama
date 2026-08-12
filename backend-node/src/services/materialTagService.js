'use strict';

/**
 * Sprint 12 - S12-T01 素材智能标签系统
 *
 * 目标：为素材库条目（角色库/场景库/道具库）自动生成多维度标签，并支持按标签检索。
 *
 * 生成策略（"AI优先 + 确定性降级"）：
 *   1) 若配置了文本/视觉模型，调用 AI 分析素材（图片 + 描述文本）产出五维度标签；
 *   2) 无 AI 配置或 AI 调用失败时，使用基于素材元数据（描述/分类/来源/文件名）的
 *      确定性规则生成标签，保证无 Key 也能跑通、且结果稳定可测。
 *
 * 标签维度（dimension）：
 *   content(内容主体) / style(画面风格) / emotion(情绪基调) / color(色彩倾向) / usage(用途场景)
 *
 * 存储：
 *   material_tags(dimension, name) 为标签词典，UNIQUE(dimension, name) 去重；
 *   material_tag_relations(material_table, material_id, tag_id, source, confidence)
 *   记录素材与标签的关联，UNIQUE 保证同一素材同一标签只存一条（幂等）。
 */

const aiClient = require('./aiClient');

const DIMENSIONS = ['content', 'style', 'emotion', 'color', 'usage'];
const LIBRARY_TABLES = new Set(['character_libraries', 'scene_libraries', 'prop_libraries']);
const VALID_SOURCES = new Set(['ai', 'rule', 'manual']);

function assertLibraryTable(table) {
  if (!LIBRARY_TABLES.has(table)) {
    throw new Error(`不支持的素材库表: ${table}`);
  }
}

// ------------------------------------------------------------
// 规则降级：确定性关键词词典（不依赖任何第三方 IP / 商标，纯通用美术描述词）
// ------------------------------------------------------------
const RULE_KEYWORDS = {
  content: [
    { name: '人物', kw: ['人物', '角色', '男', '女', '主角', '配角', 'character', 'person', 'man', 'woman', 'girl', 'boy'] },
    { name: '场景', kw: ['场景', '室内', '室外', '街道', '房间', '城市', '森林', '山', '海', 'scene', 'room', 'city', 'street', 'forest'] },
    { name: '道具', kw: ['道具', '物品', '武器', '工具', '家具', '装饰', 'prop', 'item', 'weapon', 'tool', 'furniture'] },
    { name: '建筑', kw: ['建筑', '楼', '宫殿', '城堡', '桥', 'building', 'palace', 'castle', 'bridge'] },
    { name: '自然', kw: ['天空', '云', '树', '花', '草', '水', '火', 'sky', 'cloud', 'tree', 'flower', 'water', 'fire'] },
  ],
  style: [
    { name: '动漫', kw: ['动漫', '二次元', '漫画', 'anime', 'manga', 'cartoon'] },
    { name: '写实', kw: ['写实', '真实', '照片', 'realistic', 'photo', 'photorealistic'] },
    { name: '水彩', kw: ['水彩', '手绘', 'watercolor', 'hand-drawn'] },
    { name: '国风', kw: ['国风', '古风', '水墨', '中式', 'chinese', 'ink', 'oriental'] },
    { name: '赛博朋克', kw: ['赛博', '科幻', '未来', 'cyberpunk', 'sci-fi', 'futuristic', 'neon'] },
    { name: '3D', kw: ['3d', '三维', '建模', 'render', 'cgi'] },
  ],
  emotion: [
    { name: '温馨', kw: ['温馨', '温暖', '治愈', '柔和', 'warm', 'cozy', 'gentle', 'heal'] },
    { name: '紧张', kw: ['紧张', '激烈', '战斗', '冲突', '危险', 'tense', 'battle', 'conflict', 'danger'] },
    { name: '悲伤', kw: ['悲伤', '忧郁', '孤独', '哀', 'sad', 'melancholy', 'lonely'] },
    { name: '欢快', kw: ['欢快', '开心', '喜悦', '活泼', 'happy', 'joyful', 'cheerful', 'lively'] },
    { name: '神秘', kw: ['神秘', '诡异', '悬疑', '黑暗', 'mysterious', 'dark', 'eerie', 'suspense'] },
  ],
  color: [
    { name: '暖色', kw: ['暖色', '橙', '红', '黄', '金', 'warm color', 'orange', 'red', 'yellow', 'gold'] },
    { name: '冷色', kw: ['冷色', '蓝', '青', '紫', '绿', 'cool color', 'blue', 'cyan', 'purple', 'green'] },
    { name: '高对比', kw: ['高对比', '强光', '明暗', 'high contrast', 'dramatic light'] },
    { name: '低饱和', kw: ['低饱和', '灰', '素雅', '莫兰迪', 'desaturated', 'muted', 'pastel'] },
    { name: '黑白', kw: ['黑白', '单色', 'monochrome', 'black and white', 'grayscale'] },
  ],
  usage: [
    { name: '主体形象', kw: ['主角', '立绘', '形象', '肖像', 'portrait', 'main', 'hero'] },
    { name: '背景', kw: ['背景', '环境', '底图', 'background', 'environment', 'backdrop'] },
    { name: '封面', kw: ['封面', '海报', '宣传', 'cover', 'poster', 'promo'] },
    { name: '分镜', kw: ['分镜', '镜头', '画面', 'storyboard', 'shot', 'frame'] },
    { name: '细节', kw: ['细节', '特写', '局部', 'detail', 'closeup', 'macro'] },
  ],
};

// 按素材库表推断默认「内容/用途」标签，保证无任何文本描述时也能给出有意义标签
const TABLE_DEFAULT_TAGS = {
  character_libraries: { content: '人物', usage: '主体形象' },
  scene_libraries: { content: '场景', usage: '背景' },
  prop_libraries: { content: '道具', usage: '细节' },
};

function normalizeName(name) {
  return String(name || '').trim().slice(0, 64);
}

/**
 * 确定性规则打标签：根据素材文本 + 库表推断五维度标签。
 * @returns {Array<{dimension, name, confidence}>}
 */
function ruleTags(table, material) {
  const text = [
    material.name,
    material.description,
    material.category,
    material.source_type,
    material.image_url,
    material.local_path,
    material.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const picked = [];
  const seen = new Set();
  const add = (dimension, name, confidence) => {
    const key = `${dimension}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ dimension, name, confidence });
  };

  for (const dimension of DIMENSIONS) {
    for (const entry of RULE_KEYWORDS[dimension]) {
      if (entry.kw.some((k) => text.includes(k.toLowerCase()))) {
        add(dimension, entry.name, 0.6);
      }
    }
  }

  // 库表兜底：确保 content/usage 至少各有一个标签
  const defaults = TABLE_DEFAULT_TAGS[table] || {};
  if (!picked.some((t) => t.dimension === 'content') && defaults.content) {
    add('content', defaults.content, 0.5);
  }
  if (!picked.some((t) => t.dimension === 'usage') && defaults.usage) {
    add('usage', defaults.usage, 0.5);
  }

  return picked.map((t) => ({ ...t, source: 'rule' }));
}

function buildAiSystemPrompt() {
  return [
    '你是一名专业的美术素材标注助手。请分析给定的素材（图片与文字描述），',
    '从五个维度输出标签，帮助创作者检索与复用：',
    'content(内容主体，如 人物/场景/道具/建筑/自然)、',
    'style(画面风格，如 动漫/写实/国风/赛博朋克)、',
    'emotion(情绪基调，如 温馨/紧张/悲伤/欢快/神秘)、',
    'color(色彩倾向，如 暖色/冷色/高对比/黑白)、',
    'usage(用途场景，如 主体形象/背景/封面/分镜)。',
    '每个维度最多输出 2 个中文标签，标签需简洁通用，不得包含任何品牌名、作品名或人物专有名词。',
    '仅输出 JSON，格式：{"content":[..],"style":[..],"emotion":[..],"color":[..],"usage":[..]}。',
  ].join('');
}

function parseAiTagJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  // 去除 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    const out = [];
    for (const dimension of DIMENSIONS) {
      const arr = obj[dimension];
      if (!Array.isArray(arr)) continue;
      for (const name of arr.slice(0, 2)) {
        const n = normalizeName(name);
        if (n) out.push({ dimension, name: n, confidence: 0.9, source: 'ai' });
      }
    }
    return out.length ? out : null;
  } catch (_) {
    return null;
  }
}

/**
 * AI 打标签：优先视觉模型（有图片时），否则文本模型。失败返回 null 由调用方降级。
 */
async function aiTags(db, log, material) {
  const desc = [material.name, material.description, material.category]
    .filter(Boolean)
    .join('，');
  const userPrompt = `素材描述：${desc || '（无文字描述）'}。请按要求输出五维度标签 JSON。`;
  const systemPrompt = buildAiSystemPrompt();
  const imageSource = material.image_url && !String(material.image_url).startsWith('data:')
    ? material.image_url
    : (material.local_path ? `/static/${material.local_path}` : null);

  try {
    let raw;
    if (imageSource) {
      raw = await aiClient.generateTextWithVision(
        db, log, 'text', userPrompt, systemPrompt, imageSource, { json_mode: true, temperature: 0.3 }
      );
    } else {
      raw = await aiClient.generateText(
        db, log, 'text', userPrompt, systemPrompt, { json_mode: true, temperature: 0.3 }
      );
    }
    const content = typeof raw === 'string' ? raw : (raw?.content || raw?.text || '');
    const parsed = parseAiTagJson(content);
    if (parsed && parsed.length) {
      log.info('[S12-T01] AI 标签生成成功', { table: material._table, count: parsed.length });
      return parsed;
    }
    log.warn('[S12-T01] AI 标签解析为空，降级规则', { table: material._table });
    return null;
  } catch (err) {
    log.warn('[S12-T01] AI 标签生成失败，降级规则', { error: err.message });
    return null;
  }
}

// ------------------------------------------------------------
// 标签持久化
// ------------------------------------------------------------

/** 获取或创建标签，返回标签 id */
function upsertTag(db, dimension, name) {
  const dim = String(dimension || '').trim();
  const nm = normalizeName(name);
  if (!DIMENSIONS.includes(dim) || !nm) return null;
  const existing = db.prepare('SELECT id FROM material_tags WHERE dimension = ? AND name = ?').get(dim, nm);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  try {
    const info = db.prepare('INSERT INTO material_tags (dimension, name, created_at) VALUES (?, ?, ?)').run(dim, nm, now);
    return info.lastInsertRowid || info.insertId;
  } catch (err) {
    // 并发下 UNIQUE 冲突：回查
    const row = db.prepare('SELECT id FROM material_tags WHERE dimension = ? AND name = ?').get(dim, nm);
    if (row) return row.id;
    throw err;
  }
}

/** 关联素材与标签（幂等）。返回是否新增 */
function relateTag(db, table, materialId, tagId, source, confidence) {
  const src = VALID_SOURCES.has(source) ? source : 'ai';
  const conf = Math.max(0, Math.min(1, Number(confidence) || 0));
  const existing = db
    .prepare('SELECT id FROM material_tag_relations WHERE material_table = ? AND material_id = ? AND tag_id = ?')
    .get(table, Number(materialId), Number(tagId));
  if (existing) {
    db.prepare('UPDATE material_tag_relations SET source = ?, confidence = ? WHERE id = ?').run(src, conf, existing.id);
    return false;
  }
  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO material_tag_relations (material_table, material_id, tag_id, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(table, Number(materialId), Number(tagId), src, conf, now);
    return true;
  } catch (err) {
    // 并发 UNIQUE 冲突视作已存在
    return false;
  }
}

/**
 * 为一个素材生成并保存标签。
 * @param {object} opts { table, materialId, replace }
 * @returns {Promise<{ ok, source, tags: Array<{dimension,name,confidence}> }>}
 */
async function tagMaterial(db, log, { table, materialId, replace = false }) {
  assertLibraryTable(table);
  const material = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(materialId));
  if (!material) return { ok: false, error: '素材不存在' };
  material._table = table;

  let tags = await aiTags(db, log, material);
  let usedSource = 'ai';
  if (!tags || !tags.length) {
    tags = ruleTags(table, material);
    usedSource = 'rule';
  }

  if (replace) {
    db.prepare('DELETE FROM material_tag_relations WHERE material_table = ? AND material_id = ?').run(table, Number(materialId));
  }

  const saved = [];
  for (const t of tags) {
    const tagId = upsertTag(db, t.dimension, t.name);
    if (!tagId) continue;
    relateTag(db, table, materialId, tagId, t.source || usedSource, t.confidence);
    saved.push({ dimension: t.dimension, name: t.name, confidence: t.confidence, source: t.source || usedSource });
  }

  // 同步写回 *_libraries.tags 冗余字段（逗号分隔，便于旧列表展示与兼容）
  try {
    const flat = Array.from(new Set(saved.map((t) => t.name))).join(',');
    db.prepare(`UPDATE ${table} SET tags = ?, updated_at = ? WHERE id = ?`).run(flat, new Date().toISOString(), Number(materialId));
  } catch (_) {}

  log.info('[S12-T01] 素材标签已保存', { table, materialId, source: usedSource, count: saved.length });
  return { ok: true, source: usedSource, tags: saved };
}

/** 列出某素材的全部标签 */
function listMaterialTags(db, table, materialId) {
  assertLibraryTable(table);
  return db
    .prepare(
      `SELECT t.id as tag_id, t.dimension, t.name, r.source, r.confidence
       FROM material_tag_relations r JOIN material_tags t ON t.id = r.tag_id
       WHERE r.material_table = ? AND r.material_id = ?
       ORDER BY t.dimension, r.confidence DESC`
    )
    .all(table, Number(materialId));
}

/** 手动为素材添加一个标签 */
function addManualTag(db, table, materialId, dimension, name) {
  assertLibraryTable(table);
  const tagId = upsertTag(db, dimension, name);
  if (!tagId) return { ok: false, error: '维度或标签名无效' };
  const added = relateTag(db, table, materialId, tagId, 'manual', 1);
  return { ok: true, tag_id: tagId, added };
}

/** 移除素材的一个标签关联 */
function removeMaterialTag(db, table, materialId, tagId) {
  assertLibraryTable(table);
  const result = db
    .prepare('DELETE FROM material_tag_relations WHERE material_table = ? AND material_id = ? AND tag_id = ?')
    .run(table, Number(materialId), Number(tagId));
  return { ok: true, removed: (result.changes || 0) > 0 };
}

/**
 * 标签词云 / 词典：按维度返回标签及使用次数，用于前端标签筛选面板。
 */
function listTagDictionary(db, { table = null, dimension = null } = {}) {
  let sql = `SELECT t.id as tag_id, t.dimension, t.name, COUNT(r.id) as usage_count
             FROM material_tags t
             LEFT JOIN material_tag_relations r ON r.tag_id = t.id`;
  const where = [];
  const params = [];
  if (table) {
    assertLibraryTable(table);
    where.push('(r.material_table = ? OR r.id IS NULL)');
    params.push(table);
  }
  if (dimension && DIMENSIONS.includes(dimension)) {
    where.push('t.dimension = ?');
    params.push(dimension);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' GROUP BY t.id, t.dimension, t.name ORDER BY t.dimension, usage_count DESC';
  return db.prepare(sql).all(...params);
}

/**
 * 按标签检索素材 id 列表（供 characterLibraryService.listLibraryItems 等复用）。
 * @param {object} opts { table, tags: string[]|string, dimension, matchAll }
 * @returns {number[]} 命中的 material_id 列表
 */
function searchMaterialIdsByTags(db, { table, tags, matchAll = false }) {
  assertLibraryTable(table);
  const names = Array.isArray(tags)
    ? tags.map(normalizeName).filter(Boolean)
    : String(tags || '').split(',').map(normalizeName).filter(Boolean);
  if (!names.length) return [];
  const placeholders = names.map(() => '?').join(', ');
  if (matchAll) {
    // 需要命中全部标签
    const rows = db
      .prepare(
        `SELECT r.material_id, COUNT(DISTINCT t.name) as hit
         FROM material_tag_relations r JOIN material_tags t ON t.id = r.tag_id
         WHERE r.material_table = ? AND t.name IN (${placeholders})
         GROUP BY r.material_id HAVING hit >= ?`
      )
      .all(table, ...names, names.length);
    return rows.map((r) => Number(r.material_id));
  }
  const rows = db
    .prepare(
      `SELECT DISTINCT r.material_id
       FROM material_tag_relations r JOIN material_tags t ON t.id = r.tag_id
       WHERE r.material_table = ? AND t.name IN (${placeholders})`
    )
    .all(table, ...names);
  return rows.map((r) => Number(r.material_id));
}

/**
 * 批量为库表中尚未打标签的素材补标签（限量，避免长任务阻塞）。
 */
async function batchTagUntagged(db, log, { table, limit = 20 }) {
  assertLibraryTable(table);
  const rows = db
    .prepare(
      `SELECT l.id FROM ${table} l
       WHERE l.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM material_tag_relations r
           WHERE r.material_table = ? AND r.material_id = l.id
         )
       ORDER BY l.id DESC LIMIT ?`
    )
    .all(table, Math.min(200, Math.max(1, Number(limit) || 20)));
  let done = 0;
  for (const row of rows) {
    const res = await tagMaterial(db, log, { table, materialId: row.id });
    if (res.ok) done += 1;
  }
  return { ok: true, table, processed: done, total: rows.length };
}

module.exports = {
  DIMENSIONS,
  LIBRARY_TABLES,
  tagMaterial,
  listMaterialTags,
  addManualTag,
  removeMaterialTag,
  listTagDictionary,
  searchMaterialIdsByTags,
  batchTagUntagged,
  // 内部函数导出便于单测
  ruleTags,
  parseAiTagJson,
  upsertTag,
};
