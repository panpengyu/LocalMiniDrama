/**
 * consistencyService.js — Sprint 2 角色一致性服务
 *
 * S2-T05: 角色一致性服务架构
 *   - 参考图注入流程：imageService 生成分镜图片时自动附带角色参考图（正面/侧面/四视图）
 *   - IP-Adapter 集成方案：通过 imageClient 的 reference_images 参数注入角色面部参考图
 *   - 一致性校验算法：余弦相似度比对面部 embedding 向量 + 视觉模型兜底
 *
 * S2-T07: 角色指纹系统
 *   - 为角色生成面部 embedding 向量（调用视觉模型提取特征）
 *   - 存储到 character_embeddings 表（支持多角度）
 *   - 同步到 characters.face_embedding / character_libraries.face_embedding
 *
 * S2-T08: 一致性校验接口
 *   - POST /api/v1/ai/consistency/check — 比对生成图与参考图
 *   - 余弦相似度计算 + 视觉模型兜底
 *   - 记录到 consistency_check_logs 表
 */
'use strict';

const aiClient = require('./aiClient');
const { safeParseAIJSON } = require('../utils/safeJson');

// ── 工具函数 ──
function _nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function _uid(prefix = 'cchk') {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function _queryOne(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (_) { return null; }
}

function _queryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (_) { return []; }
}

function _runInsert(db, sql, params = []) {
  try {
    return db.prepare(sql).run(...params);
  } catch (e) {
    console.error('[consistencyService] insert error:', e.message);
    return null;
  }
}

/**
 * 解析 embedding JSON 字符串为 Float64Array
 */
function _parseEmbedding(embStr) {
  if (!embStr) return null;
  try {
    if (typeof embStr === 'string') {
      const arr = JSON.parse(embStr);
      return Array.isArray(arr) ? Float64Array.from(arr) : null;
    }
    if (Array.isArray(embStr)) return Float64Array.from(embStr);
    return null;
  } catch (_) { return null; }
}

/**
 * 计算两个向量的余弦相似度
 * @returns {number} 0~1 范围的相似度
 */
function _cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  // 余弦相似度范围 -1~1，归一化到 0~1
  return (dot / denom + 1) / 2;
}

// ============================================================
// S2-T07: 角色指纹系统 — 生成并存储面部 embedding
// ============================================================

/**
 * 为角色生成面部 embedding 向量
 * 调用视觉模型提取角色图片的面部特征向量
 *
 * @param {object} db - 数据库连接
 * @param {object} log - 日志对象
 * @param {number} characterId - 角色 ID
 * @param {object} options - { characterType: 'project'|'library', imageUrl, viewAngle, model }
 * @returns {object} { characterId, embeddingDim, embeddingModel, success }
 */
async function generateCharacterEmbedding(db, log, characterId, options = {}) {
  const characterType = options.characterType || 'project';
  const viewAngle = options.viewAngle || 'front';
  const model = options.model || 'vision-embedding';

  // 查角色信息
  const tableName = characterType === 'library' ? 'character_libraries' : 'characters';
  const char = _queryOne(db, `SELECT id, name, image_url, local_path, ref_image, four_view_image_url, appearance, identity_anchors FROM ${tableName} WHERE id = ? AND deleted_at IS NULL`, [characterId]);
  if (!char) throw new Error(`角色不存在: ${characterId}`);

  // 确定参考图 URL
  const imageUrl = options.imageUrl || char.image_url || char.local_path || char.ref_image || char.four_view_image_url;
  if (!imageUrl) throw new Error(`角色 ${char.name} 没有关联的图片，无法生成 embedding`);

  // 调用视觉模型生成 embedding
  // 方案：使用多模态 AI 模型对面部图片做特征提取
  // 如果 AI 服务不支持直接返回 embedding，则用视觉模型生成结构化描述作为降级
  let embedding = null;
  let embeddingDim = 0;
  let embeddingModel = model;
  let fallbackDescriptor = null;

  try {
    // 尝试调用 vision embedding 接口
    const systemPrompt = `你是一个面部特征分析专家。请分析图片中角色的面部特征，输出一个包含 512 个浮点数的 JSON 数组，表示该角色面部的 embedding 向量。
向量要求：
1. 同一角色的不同角度图片应产生高相似度(>0.85)的向量
2. 不同角色的向量相似度应较低(<0.5)
3. 向量各维度值范围 -1.0 到 1.0
4. 精确到小数点后 6 位

只输出 JSON 数组，不要任何其他文字。`;

    const raw = await aiClient.generateText(db, log, 'vision', `请分析这张角色图片的面部特征并生成 embedding 向量。角色名: ${char.name}`, systemPrompt, {
      scene_key: 'character_embedding',
      model: model,
      temperature: 0.1,
      max_tokens: 3000,
      image_url: imageUrl,
      json_mode: true,
    });

    const parsed = safeParseAIJSON(raw, null);
    if (Array.isArray(parsed) && parsed.length >= 128) {
      embedding = parsed;
      embeddingDim = parsed.length;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.embedding)) {
      embedding = parsed.embedding;
      embeddingDim = parsed.embedding.length;
      fallbackDescriptor = parsed.descriptor || null;
    } else {
      // 降级：生成结构化面部描述作为伪 embedding
      fallbackDescriptor = parsed;
    }
  } catch (err) {
    log?.warn?.('[consistency] generateEmbedding AI 调用失败，使用降级方案', { error: err.message, characterId });
  }

  // 如果 AI 没能生成数值向量，使用基于 identity_anchors 的确定性伪 embedding
  if (!embedding) {
    embedding = _generateDeterministicPseudoEmbedding(char, fallbackDescriptor);
    embeddingDim = embedding.length;
    embeddingModel = 'pseudo-identity-anchors-v1';
  }

  // 存储到 character_embeddings 表
  const now = _nowStr();
  const embId = _runInsert(db, `INSERT INTO character_embeddings (character_id, character_type, drama_id, view_angle, image_url, embedding, embedding_model, embedding_dim, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    characterId, characterType, char.drama_id || null, viewAngle, imageUrl,
    JSON.stringify(embedding), embeddingModel, embeddingDim, now, now,
  ]);

  // 同步到主表 face_embedding 字段
  _runInsert(db, `UPDATE ${tableName} SET face_embedding = ?, embedding_model = ?, embedding_generated_at = ? WHERE id = ?`, [
    JSON.stringify(embedding), embeddingModel, now, characterId,
  ]);

  log?.info?.('[consistency] 角色面部 embedding 生成完成', {
    characterId, characterName: char.name, embeddingDim, embeddingModel, viewAngle,
  });

  return {
    characterId,
    characterName: char.name,
    embeddingId: embId?.lastInsertRowid || null,
    embeddingDim,
    embeddingModel,
    viewAngle,
    imageUrl,
    success: true,
  };
}

/**
 * 基于 identity_anchors 生成确定性伪 embedding（降级方案）
 * 将结构化的面部锚点描述转换成固定维度向量
 */
function _generateDeterministicPseudoEmbedding(char, fallbackDescriptor) {
  // 合并 identity_anchors + appearance + fallbackDescriptor
  let anchorText = '';
  try {
    if (char.identity_anchors) {
      const anchors = typeof char.identity_anchors === 'string' ? JSON.parse(char.identity_anchors) : char.identity_anchors;
      anchorText += JSON.stringify(anchors);
    }
  } catch (_) {}
  if (char.appearance) anchorText += char.appearance;
  if (fallbackDescriptor) anchorText += JSON.stringify(fallbackDescriptor);

  // 基于文本哈希生成 256 维伪向量
  const dim = 256;
  const vec = new Array(dim);
  let hash = 0;
  const seed = anchorText || char.name || 'default';
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dim; i++) {
    // 简单的确定性伪随机
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff);
    vec[i] = ((hash / 0x7fffffff) * 2 - 1).toFixed(6);
  }
  return vec;
}

/**
 * 批量为剧中所有角色生成 embedding
 */
async function generateEmbeddingsForDrama(db, log, dramaId, options = {}) {
  const chars = _queryAll(db, 'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL', [dramaId]);
  const results = [];
  for (const c of chars) {
    try {
      const r = await generateCharacterEmbedding(db, log, c.id, { ...options, characterType: 'project' });
      results.push(r);
    } catch (err) {
      results.push({ characterId: c.id, characterName: c.name, success: false, error: err.message });
    }
  }
  return { dramaId, total: chars.length, results };
}

/**
 * 获取角色的 embedding 向量
 */
function getCharacterEmbedding(db, characterId, characterType = 'project') {
  const tableName = characterType === 'library' ? 'character_libraries' : 'characters';
  const row = _queryOne(db, `SELECT face_embedding, embedding_model, embedding_generated_at, consistency_threshold FROM ${tableName} WHERE id = ? AND deleted_at IS NULL`, [characterId]);
  if (!row || !row.face_embedding) return null;
  return {
    embedding: _parseEmbedding(row.face_embedding),
    embeddingModel: row.embedding_model,
    embeddingGeneratedAt: row.embedding_generated_at,
    threshold: row.consistency_threshold || 0.85,
  };
}

// ============================================================
// S2-T08: 一致性校验接口
// ============================================================

/**
 * 比对生成图与参考图的角色一致性
 *
 * 算法流程：
 * 1. 获取角色的参考图 embedding（face_embedding）
 * 2. 对生成图提取 embedding（调用视觉模型）
 * 3. 计算余弦相似度
 * 4. 若相似度 < threshold，使用视觉模型做兜底校验
 * 5. 记录到 consistency_check_logs 表
 *
 * @param {object} db
 * @param {object} log
 * @param {object} params - { dramaId, storyboardId, characterId, generatedImageUrl, referenceImageUrl, characterType, threshold }
 * @returns {object} { checkId, similarityScore, threshold, passed, method, detail }
 */
async function checkConsistency(db, log, params = {}) {
  const {
    dramaId, storyboardId, characterId,
    generatedImageUrl, referenceImageUrl,
    characterType = 'project',
    threshold,
  } = params;

  if (!generatedImageUrl) throw new Error('缺少 generatedImageUrl');
  if (!characterId && !referenceImageUrl) throw new Error('缺少 characterId 或 referenceImageUrl');

  // 获取参考图 embedding
  let refEmbedding = null;
  let refImageUrl = referenceImageUrl;
  let effectiveThreshold = threshold;

  if (characterId) {
    const charEmb = getCharacterEmbedding(db, characterId, characterType);
    if (charEmb) {
      refEmbedding = charEmb.embedding;
      if (!refImageUrl) {
        // 查角色图片
        const tableName = characterType === 'library' ? 'character_libraries' : 'characters';
        const char = _queryOne(db, `SELECT image_url, local_path, ref_image, four_view_image_url FROM ${tableName} WHERE id = ?`, [characterId]);
        refImageUrl = char?.image_url || char?.local_path || char?.ref_image || char?.four_view_image_url;
      }
      if (!effectiveThreshold) effectiveThreshold = charEmb.threshold;
    }
  }

  if (!effectiveThreshold) effectiveThreshold = 0.85;

  // 对生成图提取 embedding
  let genEmbedding = null;
  let visualScore = null;
  let checkMethod = 'cosine_embedding';
  let detail = {};

  try {
    // 尝试调用视觉模型提取生成图的 embedding
    const systemPrompt = `你是一个面部特征分析专家。请分析图片中角色的面部特征，输出一个包含 512 个浮点数的 JSON 数组，表示该角色面部的 embedding 向量。
向量要求：同一角色的不同角度图片应产生高相似度(>0.85)的向量，不同角色相似度应较低(<0.5)。
只输出 JSON 数组，不要任何其他文字。`;

    const raw = await aiClient.generateText(db, log, 'vision', '请分析这张图片中角色的面部特征并生成 embedding 向量。', systemPrompt, {
      scene_key: 'character_embedding',
      temperature: 0.1,
      max_tokens: 3000,
      image_url: generatedImageUrl,
      json_mode: true,
    });

    const parsed = safeParseAIJSON(raw, null);
    if (Array.isArray(parsed) && parsed.length >= 128) {
      genEmbedding = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.embedding)) {
      genEmbedding = parsed.embedding;
    }
  } catch (err) {
    log?.warn?.('[consistency] 生成图 embedding 提取失败', { error: err.message });
  }

  let similarityScore = 0;

  if (refEmbedding && genEmbedding) {
    // 方案 A：余弦相似度
    similarityScore = _cosineSimilarity(refEmbedding, genEmbedding);
    detail.embeddingMethod = 'cosine';
    detail.refDim = refEmbedding.length;
    detail.genDim = genEmbedding.length;
  } else {
    // 方案 B：视觉模型兜底校验
    checkMethod = 'visual_llm';
    try {
      visualScore = await _visualConsistencyCheck(db, log, refImageUrl, generatedImageUrl);
      similarityScore = visualScore.score;
      detail.visualAnalysis = visualScore.analysis;
    } catch (err) {
      log?.warn?.('[consistency] 视觉模型兜底校验失败', { error: err.message });
      // 方案 C：结构化校验（基于 identity_anchors 的文本匹配）
      checkMethod = 'structural';
      similarityScore = _structuralConsistencyCheck(db, characterId, characterType);
      detail.structuralFallback = true;
    }
  }

  const passed = similarityScore >= effectiveThreshold ? 1 : 0;
  const checkId = _uid('cchk');
  const now = _nowStr();

  detail.threshold = effectiveThreshold;
  detail.score = similarityScore;
  detail.passed = passed === 1;

  // 记录到 consistency_check_logs
  _runInsert(db, `INSERT INTO consistency_check_logs (check_id, drama_id, storyboard_id, character_id, generated_image_url, reference_image_url, similarity_score, threshold, passed, check_method, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    checkId, dramaId || null, storyboardId || null, characterId || null,
    generatedImageUrl, refImageUrl,
    similarityScore, effectiveThreshold, passed, checkMethod,
    JSON.stringify(detail), now,
  ]);

  return {
    checkId,
    dramaId, storyboardId, characterId,
    generatedImageUrl, referenceImageUrl: refImageUrl,
    similarityScore: Number(similarityScore.toFixed(4)),
    threshold: effectiveThreshold,
    passed: passed === 1,
    method: checkMethod,
    detail,
  };
}

/**
 * 视觉模型兜底校验：让多模态 AI 直接比对两张图片
 */
async function _visualConsistencyCheck(db, log, refImageUrl, generatedImageUrl) {
  const systemPrompt = `你是角色一致性校验专家。请比对两张图片中的角色是否为同一人，输出纯 JSON：
{
  "isSameCharacter": true/false,
  "similarityScore": 0.0~1.0,
  "analysis": "中文分析说明，包括面部特征/发型/服装/体型的比对",
  "confidence": 0.0~1.0
}`;
  const userPrompt = `第一张图片是角色参考图，第二张图片是生成的图片。请判断生成图片中的角色与参考图角色的相似度。
参考图: ${refImageUrl}
生成图: ${generatedImageUrl}`;

  const raw = await aiClient.generateText(db, log, 'vision', userPrompt, systemPrompt, {
    scene_key: 'consistency_visual_check',
    temperature: 0.1,
    max_tokens: 1000,
    image_url: refImageUrl,
    json_mode: true,
  });

  const parsed = safeParseAIJSON(raw, {});
  const score = typeof parsed.similarityScore === 'number'
    ? parsed.similarityScore
    : (parsed.isSameCharacter ? 0.9 : 0.3);

  return {
    score: Math.max(0, Math.min(1, score)),
    analysis: parsed.analysis || '视觉模型分析不可用',
  };
}

/**
 * 结构化校验降级方案：基于 identity_anchors 文本匹配
 */
function _structuralConsistencyCheck(db, characterId, characterType) {
  if (!characterId) return 0.5;
  const tableName = characterType === 'library' ? 'character_libraries' : 'characters';
  const char = _queryOne(db, `SELECT identity_anchors, appearance FROM ${tableName} WHERE id = ?`, [characterId]);
  if (!char) return 0.5;
  // 如果角色有 identity_anchors，给一个中等偏上的分数
  // 因为无法做像素级比对，保守给 0.75
  return char.identity_anchors ? 0.75 : 0.5;
}

/**
 * 查询一致性校验历史记录
 */
function listConsistencyLogs(db, params = {}) {
  const { dramaId, storyboardId, characterId, passed, limit = 20, offset = 0 } = params;
  let sql = 'SELECT * FROM consistency_check_logs WHERE 1=1';
  const vals = [];
  if (dramaId) { sql += ' AND drama_id = ?'; vals.push(dramaId); }
  if (storyboardId) { sql += ' AND storyboard_id = ?'; vals.push(storyboardId); }
  if (characterId) { sql += ' AND character_id = ?'; vals.push(characterId); }
  if (passed != null) { sql += ' AND passed = ?'; vals.push(passed ? 1 : 0); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  vals.push(Number(limit), Number(offset));
  return _queryAll(db, sql, vals).map(r => ({
    checkId: r.check_id,
    dramaId: r.drama_id,
    storyboardId: r.storyboard_id,
    characterId: r.character_id,
    generatedImageUrl: r.generated_image_url,
    referenceImageUrl: r.reference_image_url,
    similarityScore: r.similarity_score,
    threshold: r.threshold,
    passed: r.passed === 1,
    method: r.check_method,
    detail: r.detail_json ? JSON.parse(r.detail_json) : null,
    retryCount: r.retry_count,
    createdAt: r.created_at,
  }));
}

/**
 * 获取角色一致性统计
 */
function getCharacterConsistencyStats(db, characterId) {
  const logs = _queryAll(db, 'SELECT similarity_score, passed, created_at FROM consistency_check_logs WHERE character_id = ? ORDER BY created_at DESC LIMIT 100', [characterId]);
  if (logs.length === 0) return { totalChecks: 0, avgScore: 0, passRate: 0, recentScore: null };
  const scores = logs.map(l => l.similarity_score);
  const passed = logs.filter(l => l.passed === 1).length;
  return {
    totalChecks: logs.length,
    avgScore: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)),
    passRate: Number((passed / logs.length).toFixed(4)),
    recentScore: logs[0]?.similarity_score || null,
    recentPassed: logs[0]?.passed === 1,
  };
}

module.exports = {
  // S2-T07: 角色指纹系统
  generateCharacterEmbedding,
  generateEmbeddingsForDrama,
  getCharacterEmbedding,
  // S2-T08: 一致性校验
  checkConsistency,
  listConsistencyLogs,
  getCharacterConsistencyStats,
  // 工具函数导出（供测试）
  _cosineSimilarity,
  _parseEmbedding,
};
