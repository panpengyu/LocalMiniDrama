'use strict';
/**
 * storyboardGenService.js
 * Sprint 4 - S4-T01 智能分镜生成服务
 *
 * 功能：剧本段落 → AI分镜引擎 → 专业分镜列表
 *   输出维度：镜头类型 / 运镜方式 / 构图建议 / 情绪标注 / 时长建议 / 转场建议 / 视觉描述 / SD Prompt
 *
 * 接口：
 *   generate(db, log, { scriptText, dramaId, episodeId, style, count, characters, scenes, userId })
 *   listGenerations(db, { dramaId, userId, limit, offset })
 *   getGeneration(db, id)
 *   polishFramePrompt(db, log, { frame, style })  — 单帧提示词润色
 *
 * 依赖：
 *   aiClient.generateText  — 文本生成
 *   safeParseAIJSON        — 鲁棒JSON解析
 */

const aiClient = require('./aiClient');
const { safeParseAIJSON } = require('../utils/safeJson');

// ---------- 工具 ----------
function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function uid(prefix) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

function logWrap(log) {
  return log || {
    info: (...a) => console.log('[SB-GEN]', ...a),
    warn: (...a) => console.warn('[SB-GEN]', ...a),
    error: (...a) => console.error('[SB-GEN]', ...a),
  };
}

function jsonField(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function parseJsonField(v, fallback) {
  if (v == null || v === '') return fallback != null ? fallback : null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback != null ? fallback : null; }
}

// ---------- 影视分镜专业知识库 ----------

const SHOT_TYPES = {
  close_up: '特写', medium_close: '中近景', medium: '中景',
  medium_long: '中远景', long: '远景', wide: '大远景', over_shoulder: '过肩镜头',
};

const CAMERA_MOVEMENTS = {
  static: '固定', push: '推镜头', pull: '拉镜头', pan: '摇镜头',
  tilt: '俯仰', track: '跟拍', dolly: '移动车', crane: '升降',
  handheld: '手持', zoom: '变焦',
};

const COMPOSITIONS = {
  rule_of_thirds: '三分法', symmetry: '对称构图', leading_lines: '引导线',
  golden_ratio: '黄金比例', frame_within: '画中画', diagonal: '对角线',
};

const EMOTIONS = {
  neutral: '中性', warm: '温馨', tense: '紧张', sad: '悲伤',
  shocking: '震撼', epic: '史诗', romantic: '浪漫', mysterious: '悬疑',
  happy: '欢快', angry: '愤怒',
};

const TRANSITIONS = {
  cut: '硬切', fade_in: '淡入', fade_out: '淡出', dissolve: '叠化',
  wipe: '擦除', flash: '闪白', match_cut: '匹配剪辑',
};

// ---------- Prompt 构建 ----------

function buildSystemPrompt() {
  return `你是一位资深影视分镜导演，精通短剧/漫剧的镜头语言与蒙太奇理论。

你的任务：根据给定的剧本段落，拆分出专业分镜列表，每个分镜必须包含以下结构化字段：
{
  "frame_number": 数字(从1开始),
  "shot_type": 镜头类型(close_up特写/medium_close中近景/medium中景/medium_long中远景/long远景/wide大远景/over_shoulder过肩),
  "camera_movement": 运镜方式(static固定/push推/pull拉/pan摇/tilt俯仰/track跟拍/dolly移动/crane升降/handheld手持/zoom变焦),
  "composition": 构图建议(rule_of_thirds三分法/symmetry对称/leading_lines引导线/golden_ratio黄金比例/frame_within画中画/diagonal对角线),
  "emotion": 情绪标注(neutral中性/warm温馨/tense紧张/sad悲伤/shocking震撼/epic史诗/romantic浪漫/mysterious悬疑/happy欢快/angry愤怒),
  "duration": 时长建议(如"3秒"或"5秒",范围2-10秒),
  "transition": 转场建议(cut硬切/fade_in淡入/fade_out淡出/dissolve叠化/wipe擦除/flash闪白/match_cut匹配剪辑),
  "visual_description": 中文视觉描述(画面中的人物动作/环境/光影/氛围,50-100字),
  "prompt": 英文SD提示词(comic panel, masterpiece, best quality, [shot_type] shot, [emotion] atmosphere, 详细场景描述),
  "characters": 出场角色名数组
}

专业要求：
1. 镜头节奏：重要情绪点用特写，环境交代用远景/大远景，对话用过肩或中近景
2. 运镜逻辑：推镜头强调情绪递进，拉镜头揭示环境，跟拍增强代入感
3. 构图引导视线，三分法最常用，对称构图强化仪式感，引导线增强纵深
4. 转场服务于叙事：闪白表时间跳跃，叠化表回忆，硬切表紧凑节奏
5. 时长：特写2-3秒，中景3-5秒，远景5-8秒，关键镜头可延长
6. 英文prompt需包含镜头类型、情绪氛围、构图、光影、画风等要素

只返回JSON数组，不要任何额外文字。`;
}

function buildUserPrompt(scriptText, opts) {
  const count = opts.count || 8;
  const style = opts.style || 'vertical_916';
  const characters = (opts.characters || []).map(c => c.name || c).filter(Boolean);
  const scenes = opts.scenes || [];

  let context = '';
  if (characters.length) context += `\n本剧主要角色：${characters.join('、')}`;
  if (scenes.length) context += `\n参考场景：${scenes.map(s => s.name || s).join('、')}`;
  context += `\n画面比例：${style === 'vertical_916' ? '竖屏9:16' : style === 'horizontal_169' ? '横屏16:9' : '方形1:1'}`;

  return `请将以下剧本段落拆分为 ${count} 个专业分镜：${context}

剧本段落：
"""
${scriptText}
"""

要求：返回 ${count} 个分镜的JSON数组，每个分镜包含 frame_number/shot_type/camera_movement/composition/emotion/duration/transition/visual_description/prompt/characters 字段。`;
}

// ---------- 核心生成函数 ----------

/**
 * 智能分镜生成
 * @param {object} db - 数据库
 * @param {object} log - 日志
 * @param {object} params - { scriptText, dramaId, episodeId, style, count, characters, scenes, userId }
 * @returns {object} { generationId, count, frames }
 */
async function generate(db, log, params) {
  log = logWrap(log);
  const t0 = Date.now();
  const trace = `[SB-GEN#${Math.random().toString(36).slice(2, 8)}]`;

  const { scriptText } = params;
  if (!scriptText || !scriptText.trim()) {
    log.error(`${trace} 参数校验失败: 剧本段落为空`);
    throw new Error('剧本段落不能为空');
  }

  const count = Math.min(30, Math.max(1, Number(params.count) || 8));
  const style = params.style || 'vertical_916';
  const dramaId = params.dramaId || null;
  const episodeId = params.episodeId || null;
  const userId = params.userId || null;
  const characters = params.characters || [];
  const scenes = params.scenes || [];

  log.info(`${trace} ┌── 分镜生成任务启动 ──────────────`);
  log.info(`${trace} │ dramaId=${dramaId} episodeId=${episodeId} userId=${userId}`);
  log.info(`${trace} │ count=${count} style=${style} characters=${characters.length} scenes=${scenes.length}`);
  log.info(`${trace} │ scriptLength=${scriptText.length}chars (前30字): ${scriptText.slice(0, 30).replace(/\n/g, '\\n')}...`);

  // --- 阶段 1: Prompt 构建 ---
  const t1 = Date.now();
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(scriptText, { count, style, characters, scenes });
  log.info(`${trace} ├─[Prompt构建] ${Date.now() - t1}ms  system=${systemPrompt.length}chars user=${userPrompt.length}chars`);

  // --- 阶段 2: AI 调用（最容易超时/失败） ---
  const t2 = Date.now();
  let rawText = '';
  let aiError = null;
  try {
    log.info(`${trace} ├─[AI调用] 开始调用 aiClient.generateText scene_key=s4_storyboard_generate temp=0.75`);
    rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 's4_storyboard_generate',
      temperature: 0.75,
      min_max_tokens: 4000,
    });
    const elapsed = Date.now() - t2;
    log.info(`${trace} ├─[AI调用] 成功! 耗时=${elapsed}ms 返回长度=${(rawText||'').length}chars`);
    if (!rawText) {
      log.warn(`${trace} │ AI返回空字符串，将触发兜底分支`);
    } else {
      // 打印前 120 个字符的片段，便于快速判断返回格式是否为合法 JSON
      const preview = rawText.slice(0, 120).replace(/\s+/g, ' ');
      log.info(`${trace} │ AI返回片段: "${preview}${rawText.length > 120 ? '..."' : '"'}`);
    }
  } catch (err) {
    aiError = err;
    const elapsed = Date.now() - t2;
    log.error(`${trace} ├─[AI调用] 失败! 耗时=${elapsed}ms 错误=${err.name || 'Error'}: ${err.message}`);
    if (err.code) log.error(`${trace} │ errorCode=${err.code} statusCode=${err.statusCode || err.status || 'N/A'}`);
    if (err.cause) log.error(`${trace} │ cause=${String(err.cause).slice(0, 200)}`);
    log.warn(`${trace} │ 将走 AI兜底分镜分支`);
  }

  // --- 阶段 3: JSON 解析 ---
  const t3 = Date.now();
  let frames = [];
  let parseOk = false;
  let parseMode = 'raw-array';
  if (!aiError && rawText) {
    try {
      const parsed = safeParseAIJSON(rawText, log);
      frames = parsed || [];
      parseOk = Array.isArray(frames);
      if (!parseOk) {
        if (frames && Array.isArray(frames.frames)) {
          frames = frames.frames; parseOk = true; parseMode = 'wrapper.frames';
        } else if (frames && Array.isArray(frames.data)) {
          frames = frames.data; parseOk = true; parseMode = 'wrapper.data';
        } else {
          frames = []; parseMode = 'unknown-wrapper';
        }
      }
    } catch (parseErr) {
      log.error(`${trace} ├─[JSON解析] safeParseAIJSON 抛异常: ${parseErr.message}`);
      parseMode = 'parse-threw';
      frames = [];
    }
    log.info(`${trace} ├─[JSON解析] ${Date.now() - t3}ms  parseMode=${parseMode} 解析后数量=${frames.length}  parseStatus=${parseOk ? 'OK' : 'FAIL'}`);
  } else {
    log.info(`${trace} ├─[JSON解析] 跳过（AI调用失败或空返回）`);
  }

  // --- 阶段 4: 兜底分镜 ---
  let usedFallback = false;
  if (frames.length === 0) {
    usedFallback = true;
    log.warn(`${trace} ├─[兜底分镜] AI产出为 0 个有效分镜，启用确定性兜底算法 fallbackFrames(scriptLen=${scriptText.length}, targetCount=${count})`);
    frames = _fallbackFrames(scriptText, count, characters);
    log.info(`${trace} │ 兜底产出 ${frames.length} 个分镜`);
  }

  // --- 阶段 5: 规范化 ---
  const t4 = Date.now();
  const beforeNorm = frames.length;
  frames = frames.slice(0, count).map((f, i) => _normalizeFrame(f, i));
  log.info(`${trace} ├─[规范化] ${Date.now() - t4}ms  截断(${beforeNorm}→${frames.length})  标准化字段+label映射`);

  // --- 阶段 6: 落库 ---
  const t5 = Date.now();
  const generationId = uid('sbg');
  const insertSql = `INSERT INTO ai_storyboard_generations
    (generation_id, drama_id, episode_id, user_id, script_text, style, frame_count, status, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  let dbStatus = 'ok';
  try {
    db.prepare(insertSql).run(
      generationId, dramaId, episodeId, userId,
      scriptText.slice(0, 10000), style, frames.length, 'completed',
      jsonField({ frames }), nowStr(), nowStr()
    );
    log.info(`${trace} ├─[落库] ${Date.now() - t5}ms  generationId=${generationId} frameCount=${frames.length}`);
  } catch (e) {
    dbStatus = 'fail';
    log.error(`${trace} ├─[落库] 失败!  error=${e.message}`);
  }

  // --- 任务完成总结 ---
  const total = Date.now() - t0;
  log.info(`${trace} └── 分镜生成完成 总耗时=${total}ms ──────────────`);
  log.info(`${trace}    generationId=${generationId}`);
  log.info(`${trace}    AI=${aiError ? 'FAIL' : 'OK'}(${Date.now() - t2 - (Date.now() - t3)}ms)  JSON=${parseMode}  兜底=${usedFallback ? 'YES' : 'NO'}  落库=${dbStatus}`);
  log.info(`${trace}    最终产出: ${frames.length} 个分镜  (请求 ${count} 个)`);

  return {
    generationId,
    count: frames.length,
    frames,
    _diagnostics: {
      trace: trace.replace(/[\[\]]/g, ''),
      totalMs: total,
      aiOk: !aiError,
      aiMs: Date.now() - t2 - (Date.now() - t3),
      parseMode,
      usedFallback,
      dbStatus,
      finalFrameCount: frames.length,
    },
  };
}

function _normalizeFrame(f, i) {
  const frame = f || {};
  return {
    frame_number: Number(frame.frame_number ?? i + 1),
    shot_type: frame.shot_type || 'medium',
    shot_type_label: SHOT_TYPES[frame.shot_type] || '中景',
    camera_movement: frame.camera_movement || 'static',
    camera_movement_label: CAMERA_MOVEMENTS[frame.camera_movement] || '固定',
    composition: frame.composition || 'rule_of_thirds',
    composition_label: COMPOSITIONS[frame.composition] || '三分法',
    emotion: frame.emotion || 'neutral',
    emotion_label: EMOTIONS[frame.emotion] || '中性',
    duration: frame.duration || '3秒',
    transition: frame.transition || 'cut',
    transition_label: TRANSITIONS[frame.transition] || '硬切',
    visual_description: String(frame.visual_description || '').trim(),
    prompt: String(frame.prompt || '').trim(),
    characters: Array.isArray(frame.characters) ? frame.characters : [],
  };
}

function _fallbackFrames(scriptText, count, characters) {
  const names = (characters || []).map(c => c.name || c).filter(Boolean);
  const shots = ['wide', 'medium', 'close_up', 'medium', 'close_up', 'wide', 'medium', 'close_up'];
  const cams = ['static', 'push', 'static', 'pan', 'push', 'static', 'track', 'pull'];
  const emotions = ['neutral', 'tense', 'warm', 'sad', 'shocking', 'epic', 'romantic', 'mysterious'];
  const frames = [];
  const segments = scriptText.split(/[\n。！？]/).filter(s => s.trim()).slice(0, count);
  for (let i = 0; i < count; i++) {
    const seg = segments[i] || `分镜${i + 1}：推进剧情发展`;
    const shot = shots[i % shots.length];
    const emo = emotions[i % emotions.length];
    frames.push({
      frame_number: i + 1,
      shot_type: shot,
      camera_movement: cams[i % cams.length],
      composition: 'rule_of_thirds',
      emotion: emo,
      duration: `${2 + (i % 4)}秒`,
      transition: i === 0 ? 'fade_in' : 'cut',
      visual_description: seg.slice(0, 80),
      prompt: `comic panel, masterpiece, best quality, ${shot} shot, ${emo} atmosphere, detailed scene`,
      characters: names.slice(0, 2),
    });
  }
  return frames;
}

// ---------- 单帧提示词润色 ----------

/**
 * 润色单个分镜的英文SD提示词
 */
async function polishFramePrompt(db, log, params) {
  log = logWrap(log);
  const t0 = Date.now();
  const trace = `[SB-POL#${Math.random().toString(36).slice(2, 8)}]`;

  const frame = params.frame || {};
  if (!frame.visual_description && !frame.prompt) {
    log.error(`${trace} 参数校验失败: visual_description 和 prompt 同时为空`);
    throw new Error('分镜视觉描述和提示词不能同时为空');
  }
  const style = params.style || 'vertical_916';

  log.info(`${trace} ┌── 提示词润色启动 ──`);
  log.info(`${trace} │ shotType=${frame.shot_type}(${SHOT_TYPES[frame.shot_type]||''}) emotion=${frame.emotion}(${EMOTIONS[frame.emotion]||''})`);
  log.info(`${trace} │ visualDescriptionLen=${(frame.visual_description||'').length}  oldPromptLen=${(frame.prompt||'').length}`);

  const systemPrompt = `你是专业的AI绘画提示词工程师，精通Stable Diffusion/Midjourney提示词编写。
请根据给定的分镜信息，生成一段高质量的英文SD提示词。
要求：
1. 包含画质词(masterpiece, best quality, ultra-detailed)
2. 包含镜头类型、构图、光影氛围
3. 包含画面主体描述和环境描述
4. 风格统一为漫剧风格(comic panel, webtoon style)
5. 只返回提示词文本，不要其他内容`;

  const userPrompt = `分镜信息：
- 镜头类型：${SHOT_TYPES[frame.shot_type] || '中景'}
- 运镜：${CAMERA_MOVEMENTS[frame.camera_movement] || '固定'}
- 构图：${COMPOSITIONS[frame.composition] || '三分法'}
- 情绪：${EMOTIONS[frame.emotion] || '中性'}
- 视觉描述：${frame.visual_description || ''}
- 原始提示词：${frame.prompt || ''}
- 画面比例：${style === 'vertical_916' ? '竖屏9:16' : '横屏16:9'}

请生成润色后的英文SD提示词：`;

  const t1 = Date.now();
  let prompt = '';
  let aiError = null;
  try {
    log.info(`${trace} ├─[AI调用] aiClient.generateText scene_key=s4_storyboard_polish temp=0.6`);
    const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 's4_storyboard_polish',
      temperature: 0.6,
      min_max_tokens: 800,
    });
    prompt = String(rawText || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
    log.info(`${trace} ├─[AI调用] 成功! 耗时=${Date.now() - t1}ms  返回=${(rawText||'').length}chars  清洗后=${prompt.length}chars`);
    if (prompt.length < 10) {
      log.warn(`${trace} │ 润色结果过短 (${prompt.length}chars)，可能需要重试`);
    } else {
      log.info(`${trace} │ 润色结果预览: "${prompt.slice(0, 80)}..."`);
    }
  } catch (err) {
    aiError = err;
    log.error(`${trace} ├─[AI调用] 失败! 耗时=${Date.now() - t1}ms  error=${err.name}: ${err.message}`);
    // 润色失败不抛异常，返回原始 prompt 拼接画质词作为兜底
    prompt = `masterpiece, best quality, ultra-detailed, comic panel, webtoon style, ${frame.visual_description || frame.prompt || ''}`.trim();
    log.warn(`${trace} │ 使用兜底提示词 (len=${prompt.length})`);
  }

  log.info(`${trace} └── 提示词润色完成 总耗时=${Date.now() - t0}ms  成功=${!aiError}  最终=${prompt.length}chars`);
  return {
    prompt,
    _diagnostics: { aiOk: !aiError, totalMs: Date.now() - t0, fallback: !!aiError },
  };
}

// ---------- 查询 ----------

function _ensureTable(db) {
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_storyboard_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id VARCHAR(64) NOT NULL,
      drama_id BIGINT, episode_id BIGINT, user_id BIGINT,
      script_text TEXT, style VARCHAR(32), frame_count INT,
      status VARCHAR(32), result_json TEXT,
      created_at DATETIME, updated_at DATETIME
    )`).run();
  } catch (_) {}
}

function listGenerations(db, params = {}) {
  _ensureTable(db);
  const w = []; const p = [];
  if (params.dramaId) { w.push('drama_id = ?'); p.push(params.dramaId); }
  if (params.userId) { w.push('user_id = ?'); p.push(params.userId); }
  const limit = Math.min(100, Number(params.limit) || 50);
  const offset = Number(params.offset) || 0;
  const sql = `SELECT * FROM ai_storyboard_generations ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(r => ({
    generationId: r.generation_id,
    dramaId: r.drama_id, episodeId: r.episode_id,
    style: r.style, frameCount: r.frame_count, status: r.status,
    frames: parseJsonField(r.result_json, {}).frames || [],
    createdAt: r.created_at,
  }));
}

function getGeneration(db, generationId) {
  _ensureTable(db);
  const row = db.prepare('SELECT * FROM ai_storyboard_generations WHERE generation_id = ?').get(generationId);
  if (!row) return null;
  const parsed = parseJsonField(row.result_json, {});
  return {
    generationId: row.generation_id,
    dramaId: row.drama_id, episodeId: row.episode_id,
    style: row.style, frameCount: row.frame_count, status: row.status,
    scriptText: row.script_text,
    frames: parsed.frames || [],
    createdAt: row.created_at,
  };
}

module.exports = {
  generate,
  polishFramePrompt,
  listGenerations,
  getGeneration,
  // 暴露字典供前端使用
  SHOT_TYPES,
  CAMERA_MOVEMENTS,
  COMPOSITIONS,
  EMOTIONS,
  TRANSITIONS,
};
