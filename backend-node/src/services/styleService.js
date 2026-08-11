'use strict';

/**
 * styleService.js
 * Sprint 8 - S8-T01: 风格配置系统
 * Sprint 8 - S8-T02: 风格统一引擎集成
 *
 * 职责：
 *  1) 项目级风格配置 CRUD（global_style / color_palette / line_weight / shading_style / composition_rule + 角色场景覆盖）
 *  2) 风格参数 → 提示词注入（injectStyleToPrompt），确保跨分镜风格一致
 *  3) 风格参数 → 负面提示词构建（buildNegativePrompt）
 *
 * 日志：每个操作生成 traceId（STYLE#xxx），按阶段打印
 */

const VALID_GLOBAL_STYLES = [
  'anime', 'realistic', 'cinematic', 'watercolor', 'oil_painting',
  'ink_wash', 'comic', 'cartoon', '3d_render', 'cyberpunk',
  'fantasy', 'dark_fantasy', 'sci_fi', 'pixel_art', 'minimalist'
];

const VALID_LINE_WEIGHTS = ['thin', 'medium', 'thick'];
const VALID_SHADING_STYLES = ['cel-shading', 'flat', 'realistic', 'painterly', 'gradient'];
const VALID_COMPOSITION_RULES = ['rule-of-thirds', 'symmetric', 'golden-ratio', 'centered', 'leading-lines'];

const STYLE_PROMPT_MAP = {
  anime: 'anime style, Japanese animation, clean lines, vibrant colors, detailed eyes',
  realistic: 'realistic, photorealistic, high detail, natural lighting, lifelike textures',
  cinematic: 'cinematic, dramatic lighting, film grain, depth of field, movie still',
  watercolor: 'watercolor painting, soft edges, flowing colors, artistic brush strokes',
  oil_painting: 'oil painting, rich textures, visible brushwork, classical art style',
  ink_wash: 'ink wash painting, Chinese traditional style, monochrome, elegant brushwork',
  comic: 'comic book style, bold outlines, halftone shading, dynamic panels',
  cartoon: 'cartoon style, exaggerated features, bright colors, simple shapes',
  '3d_render': '3D render, CG artwork, smooth shading, realistic materials, octane render',
  cyberpunk: 'cyberpunk, neon lights, futuristic, dark atmosphere, sci-fi city',
  fantasy: 'fantasy art, magical atmosphere, ethereal lighting, detailed fantasy world',
  dark_fantasy: 'dark fantasy, gothic, moody atmosphere, shadow and light contrast',
  sci_fi: 'science fiction, futuristic technology, space, advanced civilization',
  pixel_art: 'pixel art, 8-bit style, retro game aesthetic, blocky pixels',
  minimalist: 'minimalist, clean design, simple shapes, limited color palette',
};

const LINE_WEIGHT_MAP = {
  thin: 'thin line art, delicate outlines',
  medium: 'medium line weight, clean outlines',
  thick: 'thick bold outlines, strong line art',
};

const SHADING_MAP = {
  'cel-shading': 'cel shading, flat colors with hard shadows',
  'flat': 'flat shading, solid color fills, no gradients',
  'realistic': 'realistic shading, soft shadows, ambient occlusion',
  'painterly': 'painterly shading, visible brush strokes, blended colors',
  'gradient': 'gradient shading, smooth color transitions',
};

const COMPOSITION_MAP = {
  'rule-of-thirds': 'rule of thirds composition',
  'symmetric': 'symmetrical composition',
  'golden-ratio': 'golden ratio composition',
  'centered': 'centered composition',
  'leading-lines': 'leading lines composition',
};

let _idCounter = 0;
function makeTraceId(prefix) {
  _idCounter += 1;
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${ts}${rand}${_idCounter}`;
}

function safeParseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return fallback; }
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 获取项目的风格配置
 */
function getStyleConfig(db, dramaId) {
  const row = db.prepare('SELECT * FROM style_configs WHERE drama_id = ?').get(Number(dramaId));
  if (!row) return null;
  return rowToConfig(row);
}

/**
 * 创建风格配置
 */
function createStyleConfig(db, body) {
  const traceId = makeTraceId('STYLE-CR');
  const t0 = Date.now();
  console.log(`[${traceId}] [STAGE#1] 入参校验`, { drama_id: body.drama_id });

  if (!body.drama_id) throw new Error('[STYLE-001] drama_id 不能为空');
  if (body.global_style && !VALID_GLOBAL_STYLES.includes(body.global_style)) {
    throw new Error(`[STYLE-002] global_style 非法（允许值: ${VALID_GLOBAL_STYLES.join(', ')}）`);
  }
  if (body.line_weight && !VALID_LINE_WEIGHTS.includes(body.line_weight)) {
    throw new Error(`[STYLE-003] line_weight 非法（允许值: ${VALID_LINE_WEIGHTS.join(', ')}）`);
  }

  const dramaId = Number(body.drama_id);
  const existing = getStyleConfig(db, dramaId);
  if (existing) throw new Error(`[STYLE-004] 项目 ${dramaId} 已有风格配置，请使用更新接口`);

  const colorPalette = Array.isArray(body.color_palette) ? JSON.stringify(body.color_palette) : null;
  const characterOverrides = Array.isArray(body.character_overrides) ? JSON.stringify(body.character_overrides) : null;
  const sceneOverrides = Array.isArray(body.scene_overrides) ? JSON.stringify(body.scene_overrides) : null;

  const info = db.prepare(
    `INSERT INTO style_configs
      (drama_id, global_style, color_palette, line_weight, shading_style, composition_rule,
       character_overrides, scene_overrides, negative_prompt_suffix, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dramaId,
    body.global_style || 'anime',
    colorPalette,
    body.line_weight || 'medium',
    body.shading_style || 'cel-shading',
    body.composition_rule || 'rule-of-thirds',
    characterOverrides,
    sceneOverrides,
    body.negative_prompt_suffix || null,
    body.is_active != null ? (body.is_active ? 1 : 0) : 1,
    body.created_by || null,
    nowStr(),
    nowStr()
  );

  const config = getStyleConfig(db, dramaId);
  console.log(`[${traceId}] [STAGE#1-DONE] 风格配置创建成功`, { configId: info.lastInsertRowid, costMs: Date.now() - t0 });
  return config;
}

/**
 * 更新风格配置
 */
function updateStyleConfig(db, dramaId, body) {
  const traceId = makeTraceId('STYLE-UP');
  const existing = getStyleConfig(db, dramaId);
  if (!existing) throw new Error(`[STYLE-005] 项目 ${dramaId} 无风格配置，请先创建`);

  if (body.global_style && !VALID_GLOBAL_STYLES.includes(body.global_style)) {
    throw new Error(`[STYLE-002] global_style 非法`);
  }

  const updates = [];
  const params = [];
  if (body.global_style != null) { updates.push('global_style = ?'); params.push(body.global_style); }
  if (body.color_palette != null) { updates.push('color_palette = ?'); params.push(Array.isArray(body.color_palette) ? JSON.stringify(body.color_palette) : body.color_palette); }
  if (body.line_weight != null) { updates.push('line_weight = ?'); params.push(body.line_weight); }
  if (body.shading_style != null) { updates.push('shading_style = ?'); params.push(body.shading_style); }
  if (body.composition_rule != null) { updates.push('composition_rule = ?'); params.push(body.composition_rule); }
  if (body.character_overrides != null) { updates.push('character_overrides = ?'); params.push(Array.isArray(body.character_overrides) ? JSON.stringify(body.character_overrides) : body.character_overrides); }
  if (body.scene_overrides != null) { updates.push('scene_overrides = ?'); params.push(Array.isArray(body.scene_overrides) ? JSON.stringify(body.scene_overrides) : body.scene_overrides); }
  if (body.negative_prompt_suffix != null) { updates.push('negative_prompt_suffix = ?'); params.push(body.negative_prompt_suffix); }
  if (body.is_active != null) { updates.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }

  if (updates.length === 0) return existing;
  updates.push('updated_at = ?');
  params.push(nowStr());
  params.push(Number(dramaId));

  db.prepare(`UPDATE style_configs SET ${updates.join(', ')} WHERE drama_id = ?`).run(...params);
  console.log(`[${traceId}] [DONE] 风格配置更新成功`, { dramaId });
  return getStyleConfig(db, dramaId);
}

/**
 * 删除风格配置
 */
function deleteStyleConfig(db, dramaId) {
  const result = db.prepare('DELETE FROM style_configs WHERE drama_id = ?').run(Number(dramaId));
  if (result.changes === 0) return false;
  console.log(`[STYLE-DEL] 风格配置已删除`, { dramaId });
  return true;
}

/**
 * S8-T02: 风格参数 → 提示词注入
 * 根据项目风格配置，构建风格提示词片段，追加到原始 prompt 后面
 *
 * @param {object} db - 数据库连接
 * @param {number} dramaId - 项目ID
 * @param {string} originalPrompt - 原始提示词
 * @param {object} options - 可选覆盖 { characterId, sceneId }
 * @returns {string} 注入风格后的提示词
 */
function injectStyleToPrompt(db, dramaId, originalPrompt, options = {}) {
  const traceId = makeTraceId('STYLE-INJ');
  const t0 = Date.now();
  const config = getStyleConfig(db, dramaId);

  console.log(`[${traceId}] [IN-CTX] 风格注入入口上下文`, {
    traceId, dramaId,
    config_exists: !!config,
    config_active: config?.is_active,
    options_characterId: options.characterId ?? null,
    options_sceneId: options.sceneId ?? null,
    originalPrompt_len: (originalPrompt || '').length,
    originalPrompt_preview: (originalPrompt || '').toString().slice(0, 60),
  });

  if (!config) {
    console.log(`[${traceId}] [BYPASS] 项目无风格配置，直接返回原始提示词（长度=${(originalPrompt || '').length}）`);
    return originalPrompt || '';
  }
  if (!config.is_active) {
    console.log(`[${traceId}] [BYPASS] 风格配置已禁用（is_active=0），跳过注入。dramaId=${dramaId}`);
    return originalPrompt || '';
  }

  const parts = [];
  const base = (originalPrompt || '').toString().trim();

  // 1. 检查角色覆盖
  let effectiveStyle = config.global_style;
  let overrideSrc = 'global';
  if (options.characterId && config.character_overrides) {
    const overrides = safeParseJSON(config.character_overrides, []);
    const charOverride = overrides.find(o => Number(o.id) === Number(options.characterId));
    if (charOverride && charOverride.style && VALID_GLOBAL_STYLES.includes(charOverride.style)) {
      effectiveStyle = charOverride.style;
      overrideSrc = `character#${options.characterId}`;
      console.log(`[${traceId}] [OVERRIDE] 角色级风格覆盖生效`, {
        characterId: options.characterId,
        before: config.global_style,
        after: effectiveStyle,
        override_list_length: overrides.length,
      });
    }
  }

  // 2. 检查场景覆盖（优先级高于角色覆盖）
  if (options.sceneId && config.scene_overrides) {
    const overrides = safeParseJSON(config.scene_overrides, []);
    const sceneOverride = overrides.find(o => Number(o.id) === Number(options.sceneId));
    if (sceneOverride && sceneOverride.style && VALID_GLOBAL_STYLES.includes(sceneOverride.style)) {
      effectiveStyle = sceneOverride.style;
      overrideSrc = `scene#${options.sceneId}`;
      console.log(`[${traceId}] [OVERRIDE] 场景级风格覆盖生效（覆盖角色结果）`, {
        sceneId: options.sceneId,
        final_style: effectiveStyle,
        override_list_length: overrides.length,
      });
    }
  }

  console.log(`[${traceId}] [RESOLVE] 最终风格参数解析`, {
    global_style: config.global_style,
    effective_style: effectiveStyle,
    override_src: overrideSrc,
    line_weight: config.line_weight,
    shading_style: config.shading_style,
    composition_rule: config.composition_rule,
    palette_colors: Array.isArray(safeParseJSON(config.color_palette, [])) ? safeParseJSON(config.color_palette, []).length : 0,
    has_negative_suffix: !!config.negative_prompt_suffix,
  });

  // 3. 构建风格提示词
  const stylePrompt = STYLE_PROMPT_MAP[effectiveStyle];
  if (stylePrompt) parts.push(stylePrompt);

  // 4. 线条粗细
  const linePrompt = LINE_WEIGHT_MAP[config.line_weight];
  if (linePrompt) parts.push(linePrompt);

  // 5. 渲染风格
  const shadingPrompt = SHADING_MAP[config.shading_style];
  if (shadingPrompt) parts.push(shadingPrompt);

  // 6. 构图规则
  const compPrompt = COMPOSITION_MAP[config.composition_rule];
  if (compPrompt) parts.push(compPrompt);

  // 7. 色板（作为颜色提示参考）
  const palette = safeParseJSON(config.color_palette, []);
  if (Array.isArray(palette) && palette.length > 0) {
    parts.push(`color palette: ${palette.slice(0, 5).join(', ')}`);
  }

  const styleSuffix = parts.join(', ');
  const result = base ? `${base}, ${styleSuffix}` : styleSuffix;

  console.log(`[${traceId}] [INJECT-OK] 风格注入完成`, {
    traceId,
    dramaId,
    effective_style: effectiveStyle,
    override_src: overrideSrc,
    original_len: base.length,
    suffix_len: styleSuffix.length,
    result_len: result.length,
    inflate_ratio: base.length > 0 ? ((result.length / base.length) * 100 - 100).toFixed(0) + '%' : 'N/A（空prompt）',
    suffix_preview: styleSuffix.slice(0, 80),
    result_preview: result.slice(0, 120),
    cost_ms: Date.now() - t0,
  });

  return result;
}

/**
 * S8-T02: 构建风格统一负面提示词
 */
function buildNegativePrompt(db, dramaId, originalNegative) {
  const traceId = makeTraceId('STYLE-NEG');
  const t0 = Date.now();
  const config = getStyleConfig(db, dramaId);

  console.log(`[${traceId}] [IN] 负面提示词构建入口`, {
    dramaId,
    has_config: !!config,
    config_active: config?.is_active,
    original_len: (originalNegative || '').length,
    original_preview: (originalNegative || '').toString().slice(0, 80),
  });

  if (!config || !config.is_active) {
    console.log(`[${traceId}] [BYPASS] 无配置或已禁用，返回原始负面词`);
    return originalNegative || '';
  }

  const parts = [];
  const base = (originalNegative || '').toString().trim();
  if (base) parts.push(base);
  const hasSuffix = !!config.negative_prompt_suffix;
  if (hasSuffix) parts.push(config.negative_prompt_suffix);

  // 风格一致性负面提示：防止风格漂移
  const driftBlock = 'inconsistent style, style drift, mixed art styles, off-model, inconsistent colors, inconsistent line weight';
  parts.push(driftBlock);

  const result = parts.join(', ');
  console.log(`[${traceId}] [NEG-OK] 负面提示词构建完成`, {
    traceId,
    dramaId,
    original_len: base.length,
    user_suffix_added: hasSuffix,
    drift_block_len: driftBlock.length,
    total_len: result.length,
    result_preview: result.slice(0, 120),
    cost_ms: Date.now() - t0,
  });
  return result;
}

/**
 * 获取风格配置的概要信息（用于前端展示）
 */
function getStyleSummary(db, dramaId) {
  const config = getStyleConfig(db, dramaId);
  if (!config) return null;
  return {
    drama_id: config.drama_id,
    global_style: config.global_style,
    global_style_label: config.global_style,
    color_palette: safeParseJSON(config.color_palette, []),
    line_weight: config.line_weight,
    shading_style: config.shading_style,
    composition_rule: config.composition_rule,
    character_overrides: safeParseJSON(config.character_overrides, []),
    scene_overrides: safeParseJSON(config.scene_overrides, []),
    is_active: !!config.is_active,
    has_negative_suffix: !!config.negative_prompt_suffix,
  };
}

function rowToConfig(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    global_style: row.global_style,
    color_palette: safeParseJSON(row.color_palette, []),
    line_weight: row.line_weight,
    shading_style: row.shading_style,
    composition_rule: row.composition_rule,
    character_overrides: safeParseJSON(row.character_overrides, []),
    scene_overrides: safeParseJSON(row.scene_overrides, []),
    negative_prompt_suffix: row.negative_prompt_suffix,
    is_active: !!row.is_active,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  VALID_GLOBAL_STYLES,
  VALID_LINE_WEIGHTS,
  VALID_SHADING_STYLES,
  VALID_COMPOSITION_RULES,
  STYLE_PROMPT_MAP,
  getStyleConfig,
  createStyleConfig,
  updateStyleConfig,
  deleteStyleConfig,
  injectStyleToPrompt,
  buildNegativePrompt,
  getStyleSummary,
};
