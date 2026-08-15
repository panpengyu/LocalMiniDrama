'use strict';
/**
 * screenwriterService.js
 * Sprint 1 - AI编剧助手服务层（后端核心）
 *
 * 功能（落库到MySQL）：
 *  S1-T03  generateOutline   生成剧本大纲   -> sw_outlines
 *  S1-T04  generateCharacters 生成角色档案  -> sw_characters
 *  S1-T05  generateEpisodes  分集剧情拆分   -> sw_episodes + sw_scenes
 *  S1-T06  generateStoryboard 分镜脚本生成  -> sw_storyboards
 *  S1-T07  generateDialogue  对话台词生成   -> sw_dialogues
 *
 *  基础查询 CRUD：
 *   - list/byId/update/delete  for each entity
 *
 * 依赖：
 *   aiClient.generateText      — 文本生成
 *   safeParseAIJSON            — 鲁棒JSON解析
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
    info: (...a) => console.log('[SW-INFO]', ...a),
    warn: (...a) => console.warn('[SW-WARN]', ...a),
    error: (...a) => console.error('[SW-ERROR]', ...a),
    debug: (...a) => console.debug('[SW-DEBUG]', ...a),
  };
}

function jsonField(v, fallback) {
  if (v == null) return fallback != null ? JSON.stringify(fallback) : null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function parseJsonField(v, fallback) {
  if (v == null || v === '') return fallback != null ? fallback : null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback != null ? fallback : null; }
}

// 尝试解析任意文本为 JSON：去除 markdown ```json 包裹，失败返回 fallback(默认 null)
function tryParse(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  let s = raw.trim();
  // 去除 ```json / ``` 代码块
  if (s.startsWith('```')) {
    s = s.replace(/^```(json)?\s*\n?/i, '');
    const lastTicks = s.lastIndexOf('```');
    if (lastTicks >= 0) s = s.slice(0, lastTicks);
    s = s.trim();
  }
  if (s === '') return fallback;
  try { return JSON.parse(s); } catch (_) {
    // 兜底：提取第一个 {…} / […] 尝试再解析一次
    const open1 = s.indexOf('{'); const open2 = s.indexOf('[');
    let i = -1; let closer = null;
    if (open1 < 0 && open2 < 0) return fallback;
    if (open1 < 0) { i = open2; closer = ']'; }
    else if (open2 < 0) { i = open1; closer = '}'; }
    else if (open1 < open2) { i = open1; closer = '}'; }
    else { i = open2; closer = ']'; }
    const j = s.lastIndexOf(closer);
    if (j < 0 || j <= i) return fallback;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (_2) { return fallback; }
  }
}

// ---------- Prompt 构建 ----------

function buildSystemPrompt(structure, genre, style) {
  const structureMap = {
    three_act: '三幕式结构：建置(25%)-对抗(50%)-结局(25%)，明确幕转折。',
    heros_journey: '英雄之旅12阶段：普通世界→冒险召唤→拒绝→导师→跨越门槛→考验盟友→接近洞穴→严峻考验→获得报酬→返回之路→复活→满载而归。',
    qi_cheng_zhuan_he: '起承转合四幕：起（起因与背景）→承（发展与递进）→转（转折与高潮）→合（结局与余韵）。',
  };
  const structureDesc = structureMap[structure] || structureMap.three_act;

  return `你是资深中文漫画短剧编剧，擅长${style || '爽文'}风格的${genre || '都市'}题材短剧。

核心要求：
1. 严格遵守${structureDesc}
2. 每300字必须出现一个冲突或爽点，避免注水
3. 情感基调：${style || 'hot'}
4. 输出必须为**纯粹JSON**，不要markdown、解释、前后缀文本。如果你的输出含\`\`\`json代码块将无法被解析。
5. 人物对白请自然口语化，符合短剧节奏。
`;
}

// ---------- S1-T03 剧本大纲 ----------

function outlineUserPrompt(params) {
  const { idea, title, genre, style, structure, episodeCount, targetAudience, themes } = params || {};
  const themesStr = Array.isArray(themes) ? themes.join('、') : (themes || '');
  return `请根据以下创作需求生成漫画短剧剧本大纲，并输出纯JSON：

【创作需求】
- 临时标题：${title || '（未提供）'}
- 创意梗概：${idea || ''}
- 题材类型：${genre || '都市爱情'}
- 风格基调：${style || '爽文'}
- 剧本结构：${structure || 'three_act'}
- 分集数：${episodeCount || 10} 集
- 目标受众：${targetAudience || '18-35岁女性观众'}
- 主题关键词：${themesStr || '（自行设定）'}

【输出JSON Schema】
{
  "title": "最终剧本标题（非空字符串，20字内）",
  "logline": "一句话梗概（50字内）",
  "themes": ["主题1", "主题2"],
  "acts": [
    { "act_number": 1, "title": "建置", "summary": "本幕概述 50-150字", "key_events": ["激励事件", "人物登场", "目标确立"] },
    { "act_number": 2, "title": "对抗", "summary": "", "key_events": ["第一个转折", "中点反转", "至暗时刻"] },
    { "act_number": 3, "title": "结局", "summary": "", "key_events": ["终极决战", "真相大白", "情感收尾"] }
  ]
}

注意：themes不要超过5个，每幕key_events不少于3条，不多于8条。`;
}

async function generateOutline(db, log, params) {
  log = logWrap(log);
  if (!params || !params.idea || !String(params.idea).trim()) {
    throw new Error('创意梗概(idea)不能为空');
  }
  const outlineId = params.outlineId || uid('outline');
  const userId = params.userId || null;
  const enterpriseId = params.enterpriseId || null;
  const dramaId = params.dramaId || null;

  const systemPrompt = buildSystemPrompt(params.structure, params.genre, params.style);
  const userPrompt = outlineUserPrompt(params);

  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_outline',
    model: params.model || undefined,
    temperature: 0.85,
    min_max_tokens: 2500,
    json_mode: false,
  });

  let parsed = null;
  try {
    parsed = safeParseAIJSON(rawText, log);
  } catch (e) {
    log.warn('大纲JSON解析失败，进入兜底', { error: e.message, preview: (rawText || '').slice(0, 200) });
  }

  // ---------- 规范化结构 ----------
  const clean = (s) => String(s || '').trim();
  const title = clean(parsed?.title) || clean(params.title) || '未命名剧本';
  const logline = clean(parsed?.logline) || clean(params.idea).slice(0, 80);
  let themes = parsed?.themes;
  if (!Array.isArray(themes)) themes = [];
  if (themes.length === 0) themes = ['成长', '爱情'];
  let acts = parsed?.acts;
  if (!Array.isArray(acts) || acts.length === 0) {
    acts = [
      { act_number: 1, title: '建置', summary: clean(params.idea).slice(0, 200), key_events: ['人物登场', '激励事件', '目标确立'] },
      { act_number: 2, title: '对抗', summary: '冲突层层升级', key_events: ['首个转折', '中点反转', '至暗时刻'] },
      { act_number: 3, title: '结局', summary: '高潮与收尾', key_events: ['终极对决', '真相揭露', '情感收尾'] },
    ];
  }
  acts = acts.map((a, i) => ({
    act_number: Number(a.act_number ?? i + 1),
    title: clean(a.title) || `第${i + 1}幕`,
    summary: clean(a.summary) || '（自动补全）',
    key_events: Array.isArray(a.key_events) ? a.key_events.map(clean).filter(Boolean) : ['关键事件'],
  }));

  // ---------- 落库 sw_outlines ----------
  const now = nowStr();
  const insSql = `INSERT INTO sw_outlines
      (outline_id, user_id, enterprise_id, drama_id, title, logline, idea, genre, structure, style,
       episode_count, target_audience, themes_json, acts_json, status, error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insVals = [
    outlineId, userId, enterpriseId, dramaId, title, logline, params.idea,
    params.genre || null, params.structure || 'three_act', params.style || 'hot',
    Number(params.episodeCount || 10), params.targetAudience || null,
    jsonField(themes), jsonField(acts), 'completed', null, now, now
  ];
  _runInsert(db, insSql, insVals);

  return {
    outlineId,
    title,
    logline,
    themes,
    acts,
    structure: params.structure || 'three_act',
    genre: params.genre || null,
    style: params.style || null,
    episodeCount: Number(params.episodeCount || 10),
  };
}

// ---------- S1-T04 角色档案 ----------

function charactersUserPrompt(outline, countHint) {
  const actsText = Array.isArray(outline.acts)
    ? outline.acts.map(a => `第${a.act_number}幕【${a.title}】: ${a.summary} 事件:${a.key_events?.join('/') || ''}`).join('\n')
    : '';
  return `根据以下剧本大纲，为短剧设计一组性格鲜明、有成长弧线的角色档案。

【剧本信息】
标题：${outline.title}
一句话梗概：${outline.logline}
${actsText}

【需求】请设计至少2个主要角色（主角+对手/女主）+ 若干配角，总计 ${countHint || 4} 个左右。

【输出JSON Schema】
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist | antagonist | supporting | minor",
      "age": 25,
      "gender": "male | female | other",
      "personality": "性格关键词或描述（3-5个关键词，逗号分隔或一段文字）",
      "appearance": "外貌特征详细描述（发色、服装、气质等）",
      "background": "背景故事/身世/社会地位",
      "motivation": "核心动机/渴望",
      "arc": "人物成长弧线：起点→转变→终点",
      "appearance_prompt": "用于AI生图的外貌提示词（英文或中文，高细节）",
      "voice_profile": { "tone": "低沉磁性", "age_range": "20-30", "speed": 1.0 },
      "tags": ["标签1", "标签2"]
    }
  ]
}`;
}

async function generateCharacters(db, log, params) {
  log = logWrap(log);
  const outlineId = params.outlineId;
  if (!outlineId) throw new Error('缺少outlineId');
  const userId = params.userId || null;
  const dramaId = params.dramaId || null;

  // 读 outline
  let outline = params.outline;
  if (!outline) {
    const row = _queryOne(db, 'SELECT * FROM sw_outlines WHERE outline_id = ?', [outlineId]);
    if (!row) throw new Error(`outline不存在: ${outlineId}`);
    outline = {
      title: row.title,
      logline: row.logline,
      idea: row.idea,
      genre: row.genre,
      structure: row.structure,
      style: row.style,
      episodeCount: row.episode_count,
      targetAudience: row.target_audience,
      themes: parseJsonField(row.themes_json, []),
      acts: parseJsonField(row.acts_json, []),
    };
  }

  const systemPrompt = buildSystemPrompt(outline.structure, outline.genre, outline.style);
  const userPrompt = charactersUserPrompt(outline, params.count || 4);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_characters',
    model: params.model || undefined,
    temperature: 0.8,
    min_max_tokens: 3000,
  });
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, log); } catch (_) {}

  let arr = [];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && Array.isArray(parsed.characters)) arr = parsed.characters;
  else if (parsed && parsed.data && Array.isArray(parsed.data.characters)) arr = parsed.data.characters;

  // 兜底：至少主角+女主
  if (arr.length === 0) {
    arr = [
      { name: '林慕白', role: 'protagonist', age: 25, gender: 'male', personality: '外冷内热，睿智果决', appearance: '黑色短发，高挺鼻梁，身形挺拔', background: '豪门弃子，白手起家', motivation: '查明当年真相，守护身边人', arc: '冷漠→信任→担当', appearance_prompt: 'handsome young man, short black hair, sharp eyes, black suit, dramatic lighting, detailed face', voice_profile: { tone: '低沉磁性', age_range: '25-30', speed: 1.0 }, tags: ['霸总', '重生'] },
      { name: '苏晚晴', role: 'antagonist', age: 22, gender: 'female', personality: '温柔坚韧，聪慧独立', appearance: '长发及腰，温婉可人，眉眼如画', background: '名门千金，家道中落', motivation: '守护家族产业', arc: '柔弱→觉醒→独立', appearance_prompt: 'beautiful young woman, long wavy hair, soft smile, elegant dress, detailed face, masterpiece', voice_profile: { tone: '清甜温柔', age_range: '20-25', speed: 0.95 }, tags: ['甜宠', '千金'] },
    ];
  }

  const result = [];
  const clean = (s) => String(s || '').trim();
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i] || {};
    const characterId = uid('char');
    const name = clean(c.name) || `角色${i + 1}`;
    const role = ['protagonist', 'antagonist', 'supporting', 'minor'].includes(c.role) ? c.role
      : (i === 0 ? 'protagonist' : (i === 1 ? 'antagonist' : 'supporting'));
    const voice = c.voice_profile && typeof c.voice_profile === 'object' ? c.voice_profile
      : { tone: '中性', age_range: '20-30', speed: 1.0 };
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const data = {
      characterId,
      name,
      role,
      age: Number(c.age) || null,
      gender: c.gender || null,
      personality: clean(c.personality),
      appearance: clean(c.appearance),
      background: clean(c.background),
      motivation: clean(c.motivation),
      arc: clean(c.arc),
      appearance_prompt: clean(c.appearance_prompt),
      voice_profile: voice,
      tags,
      sortOrder: i,
    };
    _insertCharacter(db, { ...data, outlineId, dramaId, userId });
    result.push(data);
  }

  return {
    outlineId,
    count: result.length,
    characters: result,
  };
}

function _insertCharacter(db, d) {
  const now = nowStr();
  const sql = `INSERT INTO sw_characters
    (character_id, outline_id, drama_id, user_id, name, \`role\`, age, gender, personality, appearance,
     background, motivation, arc, appearance_prompt, voice_profile, tags_json, sort_order, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const vals = [d.characterId, d.outlineId || null, d.dramaId || null, d.userId || null,
    d.name, d.role, d.age, d.gender, d.personality, d.appearance,
    d.background, d.motivation, d.arc, d.appearance_prompt,
    jsonField(d.voice_profile), jsonField(d.tags),
    d.sortOrder, 'completed', now, now];
  return _runInsert(db, sql, vals);
}

// ---------- S1-T05 分集剧情 ----------

function episodesUserPrompt(outline, characters, episodeCount) {
  const acts = Array.isArray(outline.acts) ? outline.acts : [];
  const chars = (characters || []).map(c => `${c.name}(${c.role}): ${c.personality?.slice(0, 30) || ''}`).join('\n');
  return `根据以下大纲和角色，将故事拆分为 ${episodeCount} 集短剧，每集3-5分钟，严格保证每集结尾有钩子/悬念。

【大纲】
标题：${outline.title}
梗概：${outline.logline}
${acts.map(a => `第${a.act_number}幕【${a.title}】：${a.summary} 事件:${(a.key_events || []).join('、')}`).join('\n')}

【角色】
${chars || '（未提供角色）'}

【输出JSON Schema】
{
  "episodes": [
    {
      "episode_number": 1,
      "title": "第1集：相遇",
      "summary": "本集剧情概述，50-150字。",
      "duration_estimate": "4分钟",
      "cliffhanger": "结尾悬念钩子，20-50字。",
      "scenes": [
        { "scene_number": 1, "location": "林家别墅客厅", "time_of_day": "night", "atmosphere": "tense", "description": "场景描述 30-80字", "characters": ["林慕白", "苏晚晴"] }
      ]
    }
  ]
}

要求：
- 总集数严格为${episodeCount}集，不要多也不要少。
- 每集至少2个场景。
- scene的atmosphere取值: tense/warm/mysterious/humorous/sad/suspenseful/romantic/epic/other
- time_of_day取值: day/night/dawn/dusk/indoor（室内不分昼夜）`;
}

async function generateEpisodes(db, log, params) {
  log = logWrap(log);
  const outlineId = params.outlineId;
  if (!outlineId) throw new Error('缺少outlineId');
  const userId = params.userId || null;
  const dramaId = params.dramaId || null;

  // 取 outline + characters
  const outline = params.outline || await _getOutline(db, outlineId);
  if (!outline) throw new Error(`outline不存在: ${outlineId}`);
  const episodeCount = Number(params.episodeCount) || Number(outline.episodeCount) || 10;
  outline.episodeCount = episodeCount;

  let characters = params.characters;
  if (!characters) characters = await _listCharacters(db, outlineId);

  const systemPrompt = buildSystemPrompt(outline.structure, outline.genre, outline.style);
  const userPrompt = episodesUserPrompt(outline, characters, episodeCount);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_episodes',
    model: params.model || undefined,
    temperature: 0.8,
    min_max_tokens: 4500,
  });
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, log); } catch (_) {}
  let eps = [];
  if (Array.isArray(parsed)) eps = parsed;
  else if (parsed && Array.isArray(parsed.episodes)) eps = parsed.episodes;
  else if (parsed && parsed.data && Array.isArray(parsed.data.episodes)) eps = parsed.data.episodes;

  // 兜底（无AI配置）：生产一组模板剧情
  if (eps.length === 0) eps = _fallbackEpisodes(episodeCount, outline, characters);

  const resultEps = [];
  const clean = (s) => String(s || '').trim();
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i] || {};
    const episodeId = uid('ep');
    const episodeNumber = Number(ep.episode_number ?? i + 1);
    const epTitle = clean(ep.title) || `第${episodeNumber}集`;
    const epSql = `INSERT INTO sw_episodes
      (episode_id, outline_id, drama_id, user_id, episode_number, title, summary, duration_estimate, cliffhanger, status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const epVals = [episodeId, outlineId, dramaId, userId, episodeNumber, epTitle,
      clean(ep.summary), clean(ep.duration_estimate || `${3 + (i % 3)}分钟`),
      clean(ep.cliffhanger), 'completed', i, nowStr(), nowStr()];
    _runInsert(db, epSql, epVals);

    // scenes
    const scenes = Array.isArray(ep.scenes) && ep.scenes.length > 0
      ? ep.scenes
      : _fallbackScenes(episodeNumber, outline, characters);
    const resultScenes = [];
    for (let j = 0; j < scenes.length; j++) {
      const sc = scenes[j] || {};
      const sceneId = uid('sc');
      const sceneNumber = Number(sc.scene_number ?? j + 1);
      const scSql = `INSERT INTO sw_scenes
        (scene_id, episode_id, outline_id, scene_number, location, description, time_of_day, atmosphere, characters_json, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const scVals = [sceneId, episodeId, outlineId, sceneNumber,
        clean(sc.location || '默认场景'),
        clean(sc.description || '场景描述'),
        sc.time_of_day || 'day',
        sc.atmosphere || 'neutral',
        jsonField(Array.isArray(sc.characters) ? sc.characters : []),
        j, nowStr(), nowStr()];
      _runInsert(db, scSql, scVals);
      resultScenes.push({ sceneId, sceneNumber, location: clean(sc.location), characters: sc.characters || [] });
    }

    resultEps.push({
      episodeId,
      episodeNumber,
      title: epTitle,
      summary: clean(ep.summary),
      cliffhanger: clean(ep.cliffhanger),
      scenes: resultScenes,
    });
  }

  return {
    outlineId,
    episodeCount: resultEps.length,
    episodes: resultEps,
  };
}

function _fallbackEpisodes(n, outline, characters) {
  const arr = [];
  const titles = ['相遇', '误会', '心动', '危机', '真相', '决裂', '援手', '高潮', '救赎', '终章'];
  for (let i = 0; i < n; i++) {
    const no = i + 1;
    const t = titles[i % titles.length];
    arr.push({
      episode_number: no,
      title: `第${no}集：${t}`,
      summary: `${outline.title} - ${t}阶段剧情展开。${(characters || []).map(c => c.name).join('、')}在本集中推进关系。`,
      duration_estimate: `${3 + (i % 3)}分钟`,
      cliffhanger: `第${no}集悬念：一个惊人的秘密即将揭晓。`,
      scenes: _fallbackScenes(no, outline, characters),
    });
  }
  return arr;
}
function _fallbackScenes(epNo, outline, characters) {
  const names = (characters || []).slice(0, 2).map(c => c.name);
  if (names.length === 0) names.push('主角', '女主');
  return [
    { scene_number: 1, location: '城市街道', time_of_day: 'day', atmosphere: 'romantic', description: `${names[0]}在街头偶遇${names[1]}，气氛微妙。`, characters: names },
    { scene_number: 2, location: '咖啡馆室内', time_of_day: 'indoor', atmosphere: 'tense', description: `${names[0]}与${names[1]}对质，揭开一个秘密。`, characters: names },
  ];
}

// ---------- S1-T06 分镜脚本 ----------

function storyboardUserPrompt(episode, outline, characters) {
  const scenesText = Array.isArray(episode.scenes)
    ? episode.scenes.map((s, i) => `S${i + 1}: ${s.location}(${s.time_of_day}/${s.atmosphere}) ${s.description}`).join('\n')
    : '（请自行设计3-5个分镜）';
  const chars = (characters || []).map(c => `${c.name}(${c.role})`).join('、');
  return `请为下面这一集短剧绘制分镜脚本（storyboard），每个分镜对应一个画面+镜头参数。

【集信息】
集号：${episode.episodeNumber}
标题：${episode.title}
本集概要：${episode.summary}
本集场景：
${scenesText}

【剧本信息】
标题：${outline.title}
角色：${chars}

【输出JSON Schema】
{
  "frames": [
    {
      "frame_number": 1,
      "shot_type": "close_up | medium | wide | long | extreme_wide",
      "camera_movement": "static | pan | tilt | dolly | track | crane | handheld",
      "composition": "rule_of_thirds | symmetric | leading_lines | center",
      "emotion": "tense | warm | shocking | sad | happy | neutral | scary | romantic | epic",
      "duration": "3秒",
      "transition": "cut | fade_in | fade_out | dissolve | wipe",
      "visual_description": "画面视觉描述（30-100字）",
      "prompt": "AI生图英文提示词",
      "characters": ["角色名1", "角色名2"]
    }
  ]
}

要求：
- 输出至少8个分镜frame，覆盖整集。
- 保证镜头语言丰富：远景交代环境，中景推进叙事，特写突出情绪。
- prompt字段请用英文撰写，用于Stable Diffusion/Flux等生图。`;
}

async function generateStoryboard(db, log, params) {
  log = logWrap(log);
  const episodeId = params.episodeId;
  if (!episodeId) throw new Error('缺少episodeId');
  const userId = params.userId || null;
  const dramaId = params.dramaId || null;

  const ep = params.episode || await _getEpisode(db, episodeId);
  if (!ep) throw new Error(`episode不存在: ${episodeId}`);
  const outlineId = ep.outlineId;
  const outline = params.outline || await _getOutline(db, outlineId);
  const characters = params.characters || await _listCharacters(db, outlineId);

  const systemPrompt = buildSystemPrompt(outline.structure, outline.genre, outline.style);
  const userPrompt = storyboardUserPrompt(ep, outline, characters);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_storyboard',
    model: params.model || undefined,
    temperature: 0.75,
    min_max_tokens: 5000,
  });
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, log); } catch (_) {}
  let frames = [];
  if (Array.isArray(parsed)) frames = parsed;
  else if (parsed && Array.isArray(parsed.frames)) frames = parsed.frames;
  else if (parsed && parsed.data && Array.isArray(parsed.data.frames)) frames = parsed.data.frames;

  if (frames.length === 0) frames = _fallbackFrames(ep, outline, characters);

  const result = [];
  const clean = (s) => String(s || '').trim();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] || {};
    const frameId = uid('frm');
    const frameNumber = Number(f.frame_number ?? i + 1);
    const sql = `INSERT INTO sw_storyboards
      (frame_id, episode_id, scene_id, drama_id, outline_id, user_id, frame_number, shot_type, camera_movement, composition,
       emotion, duration, transition, visual_description, prompt, characters_json, image_url, generation_status, consistency_score,
       sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const vals = [frameId, episodeId, null, dramaId, outlineId, userId, frameNumber,
      f.shot_type || 'medium', f.camera_movement || 'static', f.composition || 'rule_of_thirds',
      f.emotion || 'neutral', f.duration || '3秒', f.transition || 'cut',
      clean(f.visual_description), clean(f.prompt),
      jsonField(Array.isArray(f.characters) ? f.characters : []),
      null, 'pending', null,
      i, nowStr(), nowStr()];
    _runInsert(db, sql, vals);
    result.push({
      frameId,
      frameNumber,
      shotType: f.shot_type,
      emotion: f.emotion,
      prompt: clean(f.prompt),
      characters: Array.isArray(f.characters) ? f.characters : [],
    });
  }
  return {
    episodeId,
    outlineId,
    count: result.length,
    frames: result,
  };
}

function _fallbackFrames(ep, outline, characters) {
  const names = (characters || []).map(c => c.name);
  const shots = ['wide', 'medium', 'close_up', 'medium', 'close_up', 'wide', 'medium', 'close_up'];
  const cams = ['static', 'dolly', 'static', 'pan', 'static', 'static', 'track', 'static'];
  const emotions = ['warm', 'neutral', 'tense', 'sad', 'shocking', 'epic', 'warm', 'romantic'];
  const frames = [];
  for (let i = 0; i < 8; i++) {
    frames.push({
      frame_number: i + 1,
      shot_type: shots[i],
      camera_movement: cams[i],
      composition: 'rule_of_thirds',
      emotion: emotions[i],
      duration: `${2 + (i % 3)}秒`,
      transition: i === 0 ? 'fade_in' : 'cut',
      visual_description: `第${ep.episodeNumber}集${ep.title}分镜${i + 1}：${names.join('、')}推进剧情。`,
      prompt: `comic panel, masterpiece, best quality, ${shots[i]} shot, ${emotions[i]} atmosphere, detailed environment`,
      characters: names.slice(0, 2),
    });
  }
  return frames;
}

// ---------- S1-T07 对话台词 ----------

function dialogueUserPrompt(episode, frames, characters) {
  const framesText = frames.map((f, i) =>
    `F${i + 1}【${f.shotType || f.shot_type || 'medium'}|${f.emotion || 'neutral'}】: ${f.visual_description || (f.visual && f.visual.description) || ''} - 人物:${(f.characters || []).join('/')}`
  ).join('\n');
  const chars = (characters || []).map(c => `${c.name}(${c.role}): ${(c.personality || '').slice(0, 30)}`).join('\n');
  return `请根据该集分镜脚本和角色档案，为每个分镜画面撰写1-3条台词（对话/旁白）。

【集信息】
集号：${episode.episodeNumber}
标题：${episode.title}
本集概要：${episode.summary}

【分镜清单】
${framesText}

【角色档案】
${chars}

【输出JSON Schema】
{
  "lines": [
    {
      "frame_number": 1,
      "character_name": "林慕白",
      "line_text": "（台词正文，口语化，自然流畅）",
      "emotion": "neutral | happy | sad | angry | surprised | calm | nervous",
      "action_description": "说话时的伴随动作/表情",
      "duration_estimate": "2秒",
      "sort_order": 1
    }
  ]
}

要求：
- 总台词数量不少于分镜数的1倍，每个frame至少1条。
- line_text 不要太长，一般 15-30 字为宜（短剧节奏）。
- emotion 取值严格限定：neutral / happy / sad / angry / surprised / calm / nervous`;
}

async function generateDialogue(db, log, params) {
  log = logWrap(log);
  const episodeId = params.episodeId;
  if (!episodeId) throw new Error('缺少episodeId');
  const userId = params.userId || null;
  const dramaId = params.dramaId || null;

  const ep = params.episode || await _getEpisode(db, episodeId);
  if (!ep) throw new Error(`episode不存在: ${episodeId}`);
  const outlineId = ep.outlineId;
  const outline = params.outline || await _getOutline(db, outlineId);
  const characters = params.characters || await _listCharacters(db, outlineId);
  const frames = params.frames || await _listFrames(db, episodeId);
  if (!frames || frames.length === 0) {
    throw new Error('该集暂无分镜，请先生成分镜脚本');
  }

  const systemPrompt = buildSystemPrompt(outline.structure, outline.genre, outline.style);
  const userPrompt = dialogueUserPrompt(ep, frames, characters);
  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_dialogue',
    model: params.model || undefined,
    temperature: 0.75,
    min_max_tokens: 4500,
  });
  let parsed = null;
  try { parsed = safeParseAIJSON(rawText, log); } catch (_) {}
  let lines = [];
  if (Array.isArray(parsed)) lines = parsed;
  else if (parsed && Array.isArray(parsed.lines)) lines = parsed.lines;
  else if (parsed && parsed.data && Array.isArray(parsed.data.lines)) lines = parsed.data.lines;

  if (lines.length === 0) lines = _fallbackDialogue(frames, characters);

  const frameById = new Map(frames.map((f) => [Number(f.frameNumber || f.frame_number), f]));
  const charsByName = new Map((characters || []).map((c) => [c.name, c]));

  const result = [];
  const clean = (s) => String(s || '').trim();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || {};
    const dialogueId = uid('dlg');
    const frameNo = Number(l.frame_number ?? 1);
    const frame = frameById.get(frameNo) || frames[Math.min(frameNo - 1, frames.length - 1)] || null;
    const frameId = frame ? (frame.frameId || frame.frame_id) : null;
    const charName = clean(l.character_name) || (characters && characters[0] ? characters[0].name : '未知');
    const char = charsByName.get(charName);
    const emotion = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'calm', 'nervous'].includes(l.emotion) ? l.emotion : 'neutral';

    const sql = `INSERT INTO sw_dialogues
      (dialogue_id, frame_id, episode_id, outline_id, character_id, character_name, line_text, emotion,
       action_description, duration_estimate, audio_url, tts_provider, tts_voice_id, tts_status, speed, sort_order,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const vals = [dialogueId, frameId, episodeId, outlineId, char ? char.characterId : null, charName,
      clean(l.line_text) || '（台词占位）', emotion,
      clean(l.action_description), l.duration_estimate || '2秒',
      null, null, null, 'pending',
      Number(l.speed ?? 1.0),
      Number(l.sort_order ?? (i + 1)),
      nowStr(), nowStr()];
    _runInsert(db, sql, vals);

    result.push({
      dialogueId,
      frameNumber: frameNo,
      frameId,
      characterName: charName,
      characterId: char ? char.characterId : null,
      lineText: clean(l.line_text),
      emotion,
      actionDescription: clean(l.action_description),
    });
  }
  return {
    episodeId,
    outlineId,
    count: result.length,
    lines: result,
  };
}

function _fallbackDialogue(frames, characters) {
  const names = (characters && characters.length) ? characters.map(c => c.name) : ['主角', '女主'];
  const emotionPool = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'calm', 'nervous'];
  const sampleLines = [
    '这么久不见，你还是老样子。',
    '这件事……我必须给你一个交代。',
    '你怎么来了？快坐下。',
    '不要担心，一切有我。',
    '真相，就藏在那扇门后面。',
    '对不起，是我让你失望了。',
    '我不会再让你离开我。',
    '无论发生什么，我都相信你。',
  ];
  const lines = [];
  let k = 1;
  for (let i = 0; i < frames.length; i++) {
    const n = 1 + (i % 2);
    for (let j = 0; j < n; j++) {
      lines.push({
        frame_number: i + 1,
        character_name: names[(i + j) % names.length],
        line_text: sampleLines[(i * 3 + j) % sampleLines.length],
        emotion: emotionPool[(i + j) % emotionPool.length],
        action_description: j % 2 === 0 ? '微微皱眉' : '深吸一口气',
        duration_estimate: '2秒',
        sort_order: k++,
      });
    }
  }
  return lines;
}

// ---------- 通用CRUD辅助 ----------

function _queryOne(db, sql, params) {
  try {
    const stmt = db.prepare(sql);
    if (stmt && typeof stmt.get === 'function') {
      return stmt.get(...(params || [])) || null;
    }
  } catch (e) { console.warn('[SW]_queryOne', e.message, sql.slice(0, 80)); }
  return null;
}
function _queryAll(db, sql, params) {
  try {
    const stmt = db.prepare(sql);
    if (stmt && typeof stmt.all === 'function') {
      const rows = stmt.all(...(params || []));
      return Array.isArray(rows) ? rows : [];
    }
  } catch (e) { console.warn('[SW]_queryAll', e.message, sql.slice(0, 80)); }
  return [];
}
function _runInsert(db, sql, vals) {
  try {
    const stmt = db.prepare(sql);
    if (stmt && typeof stmt.run === 'function') {
      return stmt.run(...(vals || []));
    }
  } catch (e) {
    console.warn('[SW]_runInsert fail:', e.message, sql.slice(0, 80));
    throw e;
  }
  return null;
}

async function _getOutline(db, outlineId) {
  const row = _queryOne(db, 'SELECT * FROM sw_outlines WHERE outline_id = ?', [outlineId]);
  if (!row) return null;
  return {
    outlineId: row.outline_id,
    title: row.title,
    logline: row.logline,
    idea: row.idea,
    genre: row.genre,
    structure: row.structure,
    style: row.style,
    episodeCount: row.episode_count,
    targetAudience: row.target_audience,
    themes: parseJsonField(row.themes_json, []),
    acts: parseJsonField(row.acts_json, []),
    status: row.status,
  };
}

async function _listCharacters(db, outlineId) {
  const rows = _queryAll(db, 'SELECT * FROM sw_characters WHERE outline_id = ? ORDER BY sort_order', [outlineId]);
  return rows.map((r) => ({
    characterId: r.character_id,
    name: r.name,
    role: r.role,
    age: r.age,
    gender: r.gender,
    personality: r.personality,
    appearance: r.appearance,
    background: r.background,
    motivation: r.motivation,
    arc: r.arc,
    appearancePrompt: r.appearance_prompt,
    voiceProfile: parseJsonField(r.voice_profile, null),
    tags: parseJsonField(r.tags_json, []),
    sortOrder: r.sort_order,
  }));
}

async function _getEpisode(db, episodeId) {
  const row = _queryOne(db, 'SELECT * FROM sw_episodes WHERE episode_id = ?', [episodeId]);
  if (!row) return null;
  const scenes = _queryAll(db, 'SELECT * FROM sw_scenes WHERE episode_id = ? ORDER BY sort_order', [episodeId]);
  return {
    episodeId: row.episode_id,
    outlineId: row.outline_id,
    episodeNumber: row.episode_number,
    title: row.title,
    summary: row.summary,
    duration: row.duration_estimate,
    cliffhanger: row.cliffhanger,
    scenes: scenes.map((s) => ({
      sceneId: s.scene_id,
      sceneNumber: s.scene_number,
      location: s.location,
      timeOfDay: s.time_of_day,
      atmosphere: s.atmosphere,
      description: s.description,
      characters: parseJsonField(s.characters_json, []),
    })),
  };
}

async function _listFrames(db, episodeId) {
  const rows = _queryAll(db, 'SELECT * FROM sw_storyboards WHERE episode_id = ? ORDER BY sort_order', [episodeId]);
  return rows.map((r) => ({
    frameId: r.frame_id,
    frameNumber: r.frame_number,
    shotType: r.shot_type,
    cameraMovement: r.camera_movement,
    composition: r.composition,
    emotion: r.emotion,
    duration: r.duration,
    transition: r.transition,
    visualDescription: r.visual_description,
    prompt: r.prompt,
    characters: parseJsonField(r.characters_json, []),
    generationStatus: r.generation_status,
    consistencyScore: r.consistency_score,
  }));
}

async function _listDialogues(db, episodeId) {
  const rows = _queryAll(db, 'SELECT * FROM sw_dialogues WHERE episode_id = ? ORDER BY sort_order', [episodeId]);
  return rows.map((r) => ({
    dialogueId: r.dialogue_id,
    frameId: r.frame_id,
    characterId: r.character_id,
    characterName: r.character_name,
    lineText: r.line_text,
    emotion: r.emotion,
    actionDescription: r.action_description,
    durationEstimate: r.duration_estimate,
    ttsStatus: r.tts_status,
    speed: r.speed,
  }));
}

// ---------- 字典/模板查询 ----------
function _listTemplates(db, category) {
  const sql = category
    ? 'SELECT * FROM drama_templates WHERE category = ? AND is_active = 1 ORDER BY sort_order'
    : 'SELECT * FROM drama_templates WHERE is_active = 1 ORDER BY category, sort_order';
  const params = category ? [category] : [];
  const rows = _queryAll(db, sql, params);
  return rows.map((r) => ({
    templateId: r.template_id,
    category: r.category,
    key: r.key,
    name: r.name,
    description: r.description,
    promptSystem: r.prompt_system,
    promptExample: r.prompt_example,
    outputSchema: parseJsonField(r.output_schema, null),
    parameters: parseJsonField(r.parameters_json, null),
    sortOrder: r.sort_order,
  }));
}
function _listDict(db, table, keyField, zhField) {
  const rows = _queryAll(db, `SELECT * FROM ${table} WHERE is_active = 1 ORDER BY sort_order`);
  return rows.map((r) => {
    const o = { key: r[keyField], labelZh: r[zhField] };
    for (const k of Object.keys(r)) {
      if (k.endsWith('_json')) o[k.replace(/_json$/, '')] = parseJsonField(r[k], null);
      else if (k !== keyField && k !== zhField && k !== 'is_active' && k !== 'id' && k !== 'created_at') {
        o[k] = r[k];
      }
    }
    return o;
  });
}

// ---------- S1-T02 多轮对话式编剧 ----------

/**
 * 构建多轮对话上下文：把已有的大纲/角色/分集信息注入 system prompt
 */
function _buildChatContext(db, params) {
  const parts = ['你是专业漫剧编剧AI助手。用户正在与你进行多轮对话式创作，请根据上下文历史给出专业建议或修改方案。回复使用自然中文，可以是建议、修改后的文本或提问澄清。'];

  if (params.outlineId) {
    const outline = _getOutline(db, params.outlineId);
    if (outline) {
      parts.push(`\n【当前大纲上下文】\n标题: ${outline.title}\n梗概: ${outline.logline}\n题材: ${outline.genre || '未指定'}\n结构: ${outline.structure || 'three_act'}\n风格: ${outline.style || 'hot'}`);
      if (outline.acts && outline.acts.length) {
        parts.push('幕结构:\n' + outline.acts.map(a => `  第${a.actNumber}幕 ${a.title}: ${a.summary}`).join('\n'));
      }
    }
  }

  if (params.episodeId) {
    const ep = _getEpisode(db, params.episodeId);
    if (ep) {
      parts.push(`\n【当前分集上下文】\n第${ep.episodeNumber}集 ${ep.title}\n摘要: ${ep.summary}`);
      if (ep.cliffhanger) parts.push(`悬念: ${ep.cliffhanger}`);
    }
  }

  if (params.outlineId) {
    const chars = _listCharacters(db, params.outlineId);
    if (chars && chars.length) {
      parts.push('\n【已有角色】\n' + chars.map(c => `  ${c.name}(${c.role}): ${c.personality || ''}`).join('\n'));
    }
  }

  return parts.join('\n');
}

/**
 * 多轮对话：用户发送消息，AI 结合上下文历史回复
 * @param {object} db - 数据库连接
 * @param {object} log - 日志
 * @param {object} params - { sessionId, message, userId, outlineId, episodeId, contextType }
 * @returns {object} { sessionId, reply, messageOrder }
 */
async function chatWithScreenwriter(db, log, params) {
  log = logWrap(log);
  if (!params || !params.message || !String(params.message).trim()) {
    throw new Error('消息内容(message)不能为空');
  }

  const sessionId = params.sessionId || uid('swchat');
  const now = nowStr();

  // 1. 确保 session 存在
  const existing = _queryOne(db, 'SELECT * FROM sw_chat_sessions WHERE session_id = ?', [sessionId]);
  if (!existing) {
    _runInsert(db, `INSERT INTO sw_chat_sessions
      (session_id, user_id, outline_id, episode_id, title, context_type, messages_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      sessionId, params.userId || null, params.outlineId || null, params.episodeId || null,
      params.title || '编剧对话 ' + now, params.contextType || 'general', 0, now, now,
    ]);
  } else {
    // 如果传了新的 outlineId/episodeId，更新 session 关联
    if (params.outlineId && params.outlineId !== existing.outline_id) {
      _runInsert(db, 'UPDATE sw_chat_sessions SET outline_id = ?, updated_at = ? WHERE session_id = ?',
        [params.outlineId, now, sessionId]);
    }
    if (params.episodeId && params.episodeId !== existing.episode_id) {
      _runInsert(db, 'UPDATE sw_chat_sessions SET episode_id = ?, updated_at = ? WHERE session_id = ?',
        [params.episodeId, now, sessionId]);
    }
  }

  // 2. 加载历史消息（最近 20 条，防止 token 超限）
  const historyRows = _queryAll(db,
    'SELECT role, content, message_order FROM sw_chat_messages WHERE session_id = ? ORDER BY message_order DESC LIMIT 20',
    [sessionId]
  ).reverse();

  const currentOrder = historyRows.length > 0
    ? (historyRows[historyRows.length - 1].message_order || 0) + 1
    : 1;

  // 3. 存储用户消息
  _runInsert(db, `INSERT INTO sw_chat_messages (session_id, role, content, message_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, 'user', params.message, currentOrder, now]);

  // 4. 构建 system prompt + 上下文
  const systemPrompt = _buildChatContext(db, {
    outlineId: params.outlineId || (existing && existing.outline_id) || null,
    episodeId: params.episodeId || (existing && existing.episode_id) || null,
  });

  // 5. 构建多轮对话 prompt：把历史消息作为上下文拼接
  let conversationPrompt = '';
  for (const msg of historyRows) {
    const prefix = msg.role === 'user' ? '用户' : 'AI';
    conversationPrompt += `${prefix}: ${msg.content}\n`;
  }
  conversationPrompt += `用户: ${params.message}\n\n请以AI编剧身份回复：`;

  // 6. 调用 AI
  const rawText = await aiClient.generateText(db, log, 'text', conversationPrompt, systemPrompt, {
    scene_key: 'screenwriter_chat',
    model: params.model || undefined,
    temperature: 0.8,
    min_max_tokens: 2000,
    json_mode: false,
  });

  const reply = String(rawText || '').trim() || '抱歉，我暂时无法生成回复，请重试。';

  // 7. 存储 AI 回复
  _runInsert(db, `INSERT INTO sw_chat_messages (session_id, role, content, message_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, 'assistant', reply, currentOrder + 1, now]);

  // 8. 更新 session 消息计数
  _runInsert(db, 'UPDATE sw_chat_sessions SET messages_count = ?, updated_at = ? WHERE session_id = ?',
    [currentOrder + 1, now, sessionId]);

  return {
    sessionId,
    reply,
    messageOrder: currentOrder + 1,
  };
}

/**
 * 获取对话历史
 */
function getChatHistory(db, sessionId, limit = 50) {
  const rows = _queryAll(db,
    'SELECT role, content, message_order, created_at FROM sw_chat_messages WHERE session_id = ? ORDER BY message_order ASC LIMIT ?',
    [sessionId, Number(limit)]
  );
  return rows.map(r => ({
    role: r.role,
    content: r.content,
    messageOrder: r.message_order,
    createdAt: r.created_at,
  }));
}

/**
 * 列出用户的所有对话会话
 */
function listChatSessions(db, { userId, outlineId, limit = 50, offset = 0 } = {}) {
  const w = []; const p = [];
  if (userId) { w.push('user_id = ?'); p.push(userId); }
  if (outlineId) { w.push('outline_id = ?'); p.push(outlineId); }
  const rows = _queryAll(db,
    `SELECT * FROM sw_chat_sessions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    p
  );
  return rows.map(r => ({
    sessionId: r.session_id,
    userId: r.user_id,
    outlineId: r.outline_id,
    episodeId: r.episode_id,
    title: r.title,
    contextType: r.context_type,
    messagesCount: r.messages_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ---------- sw_jobs 双写 ----------
function createJobRecord(db, data) {
  const now = nowStr();
  const sql = `INSERT INTO sw_jobs
    (job_id, bull_job_id, user_id, enterprise_id, outline_id, episode_id, frame_id, job_type,
     payload_json, result_json, status, progress, error_message, retry_count, max_retries,
     started_at, completed_at, duration_ms, cost_points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const vals = [data.jobId, data.bullJobId || null, data.userId || null, data.enterpriseId || null,
    data.outlineId || null, data.episodeId || null, data.frameId || null,
    data.jobType, jsonField(data.payload), jsonField(data.result),
    data.status || 'pending', data.progress || 0, data.errorMessage || null,
    0, Number(data.maxRetries || 3),
    data.startedAt || null, data.completedAt || null, data.durationMs || null,
    Number(data.costPoints || 0), now, now];
  return _runInsert(db, sql, vals);
}

function updateJobRecord(db, jobId, patch) {
  const now = nowStr();
  const sets = [];
  const vals = [];
  const fmap = {
    status: 'status',
    progress: 'progress',
    errorMessage: 'error_message',
    result: 'result_json',
    retryCount: 'retry_count',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    durationMs: 'duration_ms',
    costPoints: 'cost_points',
    bullJobId: 'bull_job_id',
  };
  for (const k of Object.keys(patch || {})) {
    const col = fmap[k];
    if (!col) continue;
    let v = patch[k];
    if (k === 'result') v = jsonField(v);
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(now);
  vals.push(jobId);
  return _runInsert(db, `UPDATE sw_jobs SET ${sets.join(', ')} WHERE job_id = ?`, vals);
}

// ---------- PATCH /outlines/:id  修改大纲（逐段修改，保留未变更字段） ----------
function updateOutline(db, outlineId, patch = {}) {
  const existing = _queryOne(db, 'SELECT * FROM sw_outlines WHERE outline_id = ?', [outlineId]);
  if (!existing) return null;

  const themes = parseJsonField(existing.themes_json, []);
  const acts   = parseJsonField(existing.acts_json,   []);

  // 可改字段：title / logline / structure / style / genre / targetAudience
  // + 主题新增/移除 + 指定幕次修改 + 完整acts覆盖
  const nextTitle  = typeof patch.title === 'string'          ? patch.title          : existing.title;
  const nextLog    = typeof patch.logline === 'string'        ? patch.logline        : existing.logline;
  const nextStruc  = typeof patch.structure === 'string'      ? patch.structure      : existing.structure;
  const nextStyle  = typeof patch.style === 'string'          ? patch.style          : existing.style;
  const nextGenre  = typeof patch.genre === 'string'          ? patch.genre          : existing.genre;
  const nextAud    = typeof patch.targetAudience === 'string' ? patch.targetAudience : existing.target_audience;
  let nextEpCount  = existing.episode_count;
  if (typeof patch.episodeCount === 'number') nextEpCount = patch.episodeCount;

  let nextThemes = themes.slice();
  if (Array.isArray(patch.themeAdd))    nextThemes = nextThemes.concat(patch.themeAdd.filter(t => !nextThemes.includes(t)));
  if (Array.isArray(patch.themeRemove)) nextThemes = nextThemes.filter(t => !patch.themeRemove.includes(t));
  if (Array.isArray(patch.themes))      nextThemes = patch.themes;           // 全量覆盖

  let nextActs = acts.map(a => ({ ...a }));
  if (Array.isArray(patch.acts)) {
    nextActs = patch.acts;                                              // 全量覆盖
  } else if (typeof patch.replaceActNumber === 'number' && patch.replaceAct) {
    const idx = nextActs.findIndex(a => Number(a.act_number) === Number(patch.replaceActNumber));
    if (idx >= 0) nextActs[idx] = { ...nextActs[idx], ...patch.replaceAct };
  } else if (Number.isInteger(Number(patch.removeActNumber)) && Number(patch.removeActNumber) > 0) {
    nextActs = nextActs.filter(a => Number(a.act_number) !== Number(patch.removeActNumber));
  }

  const now = nowStr();
  _runInsert(db, `UPDATE sw_outlines SET title=?, logline=?, structure=?, style=?, genre=?, target_audience=?, episode_count=?, themes_json=?, acts_json=?, updated_at=? WHERE outline_id=?`, [
    nextTitle, nextLog, nextStruc, nextStyle, nextGenre, nextAud,
    Number(nextEpCount), jsonField(nextThemes), jsonField(nextActs), now, outlineId,
  ]);

  return {
    outlineId,
    title: nextTitle, logline: nextLog, structure: nextStruc, style: nextStyle, genre: nextGenre,
    targetAudience: nextAud, episodeCount: Number(nextEpCount),
    themes: nextThemes, acts: nextActs,
    updatedAt: now,
  };
}

// ---------- POST /episodes/:id/regenerate  重新生成单集剧情（不影响其他集） ----------
async function regenerateEpisode(db, log, episodeId, patch = {}) {
  log = logWrap(log);
  if (!episodeId) throw new Error('缺少episodeId');

  const epRow = _queryOne(db, 'SELECT * FROM sw_episodes WHERE episode_id = ?', [episodeId]);
  if (!epRow) throw new Error('episode not found');
  const outlineId = epRow.outline_id;
  const outline = _queryOne(db, 'SELECT * FROM sw_outlines WHERE outline_id = ?', [outlineId]);
  if (!outline) throw new Error('关联的outline不存在');

  // 构建 system prompt：包含 大纲上下文 + 现有人物档案 + 用户指定的额外要求(promptAppend)
  const characters = _listCharacters(db, outlineId);
  const eps = _queryAll(db, 'SELECT * FROM sw_episodes WHERE outline_id = ?', [outlineId]);
  const allEpisodes = eps.map(r => ({
    episodeId: r.episode_id, episodeNumber: r.episode_number,
    title: r.title, summary: r.summary,
  })).sort((a,b) => a.episodeNumber - b.episodeNumber);

  let systemPrompt = `你是专业漫剧编剧。现在需要重新改写第 ${epRow.episode_number} 集剧本，**只重写这一集**，不要变动其他分集的既有剧情线。\n`;
  systemPrompt += `\n【整体大纲】\n标题: ${outline.title}\n梗概: ${outline.logline}\n结构: ${outline.structure} 风格: ${outline.style}\n`;
  if (characters.length) {
    systemPrompt += `\n【已有角色】\n`;
    for (const c of characters) systemPrompt += `  - ${c.name} (${c.role}): ${c.personality || ''}\n`;
  }
  systemPrompt += `\n【所有分集速览（必须尊重其他集既有剧情走向！）】\n`;
  for (const e of allEpisodes) {
    systemPrompt += `  第${e.episodeNumber}集 ${e.title}: ${e.summary}\n`;
  }
  systemPrompt += `\n【当前集原始信息】\n标题: ${epRow.title}\n摘要: ${epRow.summary}\n悬念: ${epRow.cliffhanger || '(无)'}\n`;
  if (String(patch.promptAppend || '').trim()) systemPrompt += `\n【用户本次改写要求】\n${patch.promptAppend}\n`;
  systemPrompt += `\n要求输出纯 JSON: {"episodeNumber":${epRow.episode_number},"title":"...","summary":"...","cliffhanger":"...","durationEstimate":"...","scenes":[{"sceneNumber":1,"location":"...","description":"...","timeOfDay":"day","atmosphere":"...","characters":["角色A"]}]}`;

  const userPrompt = `请重写第${epRow.episode_number}集：`;

  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_episode_regen',
    model: patch.model || undefined, temperature: 0.85,
    min_max_tokens: 2500,
    json_mode: true,
  });
  const parsed = tryParse(raw);
  const single = parsed && Array.isArray(parsed.episodes) ? parsed.episodes[0] : parsed;

  const title    = String(single?.title    || epRow.title    || '').slice(0, 255);
  const summary  = String(single?.summary  || epRow.summary  || '').slice(0, 1000);
  const cliff    = String(single?.cliffhanger || single?.cliff || epRow.cliffhanger || '').slice(0, 500);
  const durEst   = String(single?.durationEstimate || single?.duration_estimate || epRow.duration_estimate || '').slice(0, 32);
  const scenes   = Array.isArray(single?.scenes) ? single.scenes : [];

  const now = nowStr();

  // 更新分集本身
  _runInsert(db, `UPDATE sw_episodes SET title=?, summary=?, cliffhanger=?, duration_estimate=?, updated_at=? WHERE episode_id=?`, [
    title, summary, cliff, durEst, now, episodeId
  ]);

  // 先删除该集原有 scenes（只删这一集的）
  _runInsert(db, `DELETE FROM sw_scenes WHERE episode_id = ?`, [episodeId]);

  // 插入新 scenes
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i] || {};
    const sceneId = uid('sc');
    _runInsert(db, `INSERT INTO sw_scenes (scene_id, episode_id, outline_id, scene_number, location, description, time_of_day, atmosphere, characters_json, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      sceneId, episodeId, outlineId,
      Number(s.sceneNumber ?? s.scene_number ?? i + 1),
      s.location || s.Location || null,
      s.description || s.Description || null,
      s.timeOfDay || s.time_of_day || 'day',
      s.atmosphere || s.Atmosphere || '',
      jsonField(Array.isArray(s.characters) ? s.characters : []),
      Number(s.sort_order ?? i + 1),
      now, now,
    ]);
  }

  return {
    episodeId,
    outlineId,
    episodeNumber: Number(epRow.episode_number),
    title, summary, cliffhanger: cliff, durationEstimate: durEst,
    scenesCount: scenes.length,
    regenerated: true,
  };
}

// ---------- POST /scene-description  场景描述生成（含美术风格建议） ----------
async function generateSceneDescription(db, log, params) {
  log = logWrap(log);
  if (!params || (!params.sceneId && !params.location)) {
    throw new Error('缺少 sceneId 或 location');
  }

  // 如果给了sceneId，先补全其他信息
  let { location, timeOfDay, characters, style, atmosphere, outlineId, episodeId, sceneId } = params;
  if (sceneId) {
    const sc = _queryOne(db, 'SELECT * FROM sw_scenes WHERE scene_id = ?', [sceneId]);
    if (sc) {
      location    = location    || sc.location;
      timeOfDay   = timeOfDay   || sc.time_of_day || 'day';
      atmosphere  = atmosphere  || sc.atmosphere  || '';
      characters  = characters  || parseJsonField(sc.characters_json, []);
      outlineId   = outlineId   || sc.outline_id;
      episodeId   = episodeId   || sc.episode_id;
    }
  }
  if (!characters) characters = [];

  const styleToneMap = {
    sweet:   '甜宠唯美，柔光，粉色/暖色，空气通透，人物柔光',
    abuse:   '虐恋阴郁，冷色调，雾/雨，高对比',
    hot:     '爽文高光，饱满色彩，动态构图，速度线',
    suspense:'悬疑压迫，低光，深色，阴影大面积，冷蓝',
    comedy:  '轻松欢快，色彩明快，明亮，人物夸张',
  };
  const tone = styleToneMap[String(style || '').toLowerCase()] ||
               (['ancient_fantasy','historical'].includes(String(style)) ? '古风工笔，敦煌色系，建筑细节，长袍细节' : '现代都市，写实，细节丰富，电影感');

  const userPrompt = `场景: ${location} / 时间: ${timeOfDay} / 人物: ${characters.join('、') || '(无)'} / 氛围: ${atmosphere || '(未指定)'}\n请输出该场景的美术描述和生图提示词。`;
  const systemPrompt = `你是专业的漫剧美术指导。请根据场景信息，输出该场景的详细美术描述 + 生图 prompt。\n
全局风格基调：${tone}。
输出纯 JSON：
{
  "visualDescription": "中文详细视觉描述，包括构图/色调/光影/道具/建筑/植被等",
  "artStyleSuggestion": "美术风格建议，如'新海诚风格+中式水墨融合'",
  "colorPalette": ["颜色1HEX","颜色2HEX","颜色3HEX"],
  "prompt": "英文 Stable Diffusion Prompt（逗号分隔，符合最佳实践，200词以内）",
  "negativePrompt": "英文 Negative Prompt，100词以内",
  "compositionAdvice": "构图建议（三分法/引导线/框架构图…）",
  "lightingAdvice": "光影建议（黄昏逆光/顶光/体积光…）",
  "props": ["道具1","道具2"]
}`;

  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_scene_desc',
    temperature: 0.8, min_max_tokens: 2000, json_mode: true,
  });
  const parsed = tryParse(raw);
  if (!parsed || typeof parsed !== 'object') {
    // 兜底
    return {
      sceneId: sceneId || null,
      location, timeOfDay,
      visualDescription: `${location}，${timeOfDay}，人物 ${characters.join('、') || '无'}，${atmosphere || '按默认风格渲染'}`,
      artStyleSuggestion: '漫剧写实风格',
      colorPalette: ['#FFFFFF','#000000','#808080'],
      prompt: `${location}, ${timeOfDay}, cinematic lighting, highly detailed, 8k`,
      negativePrompt: `blurry, low quality, deformed, ugly, text, watermark`,
      compositionAdvice: '三分法构图',
      lightingAdvice: '自然光主光 + 辅光补阴影',
      props: [],
    };
  }
  return {
    sceneId: sceneId || null,
    outlineId: outlineId || null,
    episodeId: episodeId || null,
    location,
    timeOfDay,
    characters,
    visualDescription: parsed.visualDescription,
    artStyleSuggestion: parsed.artStyleSuggestion,
    colorPalette: parsed.colorPalette || [],
    prompt: parsed.prompt,
    negativePrompt: parsed.negativePrompt || '',
    compositionAdvice: parsed.compositionAdvice || '',
    lightingAdvice: parsed.lightingAdvice || '',
    props: Array.isArray(parsed.props) ? parsed.props : [],
  };
}

// ============================================================
// Sprint 2 增量：角色/分幕 修改与单段重生成
// ============================================================

/**
 * S2-T03 / S2-T01: 修改角色信息（保存编辑后的人设/外貌/性格）
 * @param {object} db
 * @param {object} log
 * @param {string} characterId
 * @param {object} patch
 * @returns {object|null} 更新后的角色对象
 */
function updateCharacter(db, log, characterId, patch = {}) {
  const t0 = Date.now();
  log = logWrap(log);
  log.info('[screenwriter.updateCharacter] 开始', { characterId, patchKeys: Object.keys(patch) });

  if (!characterId) {
    log.warn('[screenwriter.updateCharacter] 参数非法：characterId 为空', { elapsedMs: Date.now() - t0 });
    return null;
  }
  const existing = _queryOne(db, 'SELECT * FROM sw_characters WHERE character_id = ?', [characterId]);
  if (!existing) {
    log.warn('[screenwriter.updateCharacter] 角色不存在', { characterId, elapsedMs: Date.now() - t0 });
    return null;
  }
  const now = nowStr();
  const allowed = ['name', 'role', 'personality', 'appearance', 'background', 'description', 'gender', 'age', 'motivation', 'arc', 'voice_profile', 'status', 'sort_order'];
  const changes = [];
  const params = [];
  for (const k of allowed) {
    if (k in patch) {
      // 过长字段只记录前 80 字符，避免日志膨胀
      const v = patch[k];
      const truncated = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + `...(${v.length})` : v;
      log.debug('[screenwriter.updateCharacter] 字段变更', { characterId, field: k, to: truncated });
      changes.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (changes.length === 0) {
    log.info('[screenwriter.updateCharacter] 无变更字段，直接返回原角色', { characterId, elapsedMs: Date.now() - t0 });
    return {
      characterId: existing.character_id,
      outlineId: existing.outline_id,
      name: existing.name,
      role: existing.role,
      personality: existing.personality,
      appearance: existing.appearance,
      background: existing.background,
      age: existing.age,
      gender: existing.gender,
      status: existing.status,
      sortOrder: existing.sort_order,
    };
  }
  changes.push('updated_at = ?');
  params.push(now, characterId);
  const runT0 = Date.now();
  _runInsert(db, `UPDATE sw_characters SET ${changes.join(', ')} WHERE character_id = ?`, params);
  const dbElapsed = Date.now() - runT0;
  const updated = _queryOne(db, 'SELECT * FROM sw_characters WHERE character_id = ?', [characterId]);
  const result = {
    characterId: updated.character_id,
    outlineId: updated.outline_id,
    name: updated.name,
    role: updated.role,
    personality: updated.personality,
    appearance: updated.appearance,
    background: updated.background,
    age: updated.age,
    gender: updated.gender,
    voiceProfile: updated.voice_profile,
    status: updated.status,
    sortOrder: updated.sort_order,
  };
  log.info('[screenwriter.updateCharacter] 完成', {
    characterId,
    changedFields: changes.length - 1, // exclude updated_at
    name: result.name,
    role: result.role,
    dbUpdateMs: dbElapsed,
    elapsedMs: Date.now() - t0,
  });
  return result;
}

/**
 * S2-T01: 单幕重生成 — 重新生成大纲的某一幕（建置/对抗/结局中的某一段）
 * 基于当前大纲其他幕信息 + 用户提示追加，确保上下文连贯
 *
 * @param {object} db
 * @param {object} log
 * @param {string} outlineId
 * @param {number|string} actIndex - 0-based 幕序号
 * @param {object} options - { promptAppend, idea, genre, style }
 * @returns {object} 更新后的单幕对象 {act_number, title, summary, key_events}
 */
async function regenerateAct(db, log, outlineId, actIndex, options = {}) {
  const t0 = Date.now();
  log = logWrap(log);
  log.info('[screenwriter.regenerateAct] 开始', { outlineId, actIndex, optionsKeys: Object.keys(options) });

  if (!outlineId) {
    log.warn('[screenwriter.regenerateAct] 参数非法：outlineId 为空', { elapsedMs: Date.now() - t0 });
    throw new Error('缺少 outlineId');
  }
  if (actIndex == null) {
    log.warn('[screenwriter.regenerateAct] 参数非法：actIndex 为空', { outlineId, elapsedMs: Date.now() - t0 });
    throw new Error('缺少 actIndex');
  }
  const idx = Number(actIndex);

  const outlineT0 = Date.now();
  const outline = await _getOutline(db, outlineId);
  const outlineElapsed = Date.now() - outlineT0;
  if (!outline) {
    log.warn('[screenwriter.regenerateAct] 大纲不存在', { outlineId, elapsedMs: Date.now() - t0 });
    throw new Error(`大纲不存在: ${outlineId}`);
  }
  const acts = Array.isArray(outline.acts) ? outline.acts : [];
  if (idx < 0 || idx >= acts.length) {
    log.warn('[screenwriter.regenerateAct] actIndex 越界', { outlineId, actIndex: idx, totalActs: acts.length, elapsedMs: Date.now() - t0 });
    throw new Error(`actIndex 越界: ${actIndex}，总幕数 ${acts.length}`);
  }
  log.info('[screenwriter.regenerateAct] 大纲读取完成', { outlineId, totalActs: acts.length, targetAct: idx, dbOutlineMs: outlineElapsed });

  // 其他幕摘要作为上下文，确保剧情连贯
  const others = acts
    .map((a, i) => (i === idx ? null : `【第${a.act_number || (i + 1)}幕 · ${a.title || ''}】${(a.summary || '').slice(0, 120)}`))
    .filter(Boolean)
    .join('\n');

  const contextAct = acts[idx];
  const actNum = contextAct.act_number || (idx + 1);
  const promptAppend = options.prompt_append || options.promptAppend || '保持原主题但让剧情更有张力和悬念';
  const userPrompt = `请重写该剧本大纲中的【第 ${actNum} 幕】。\n
创意主题：${outline.logline || outline.premise || options.idea || ''}
题材：${outline.genre || options.genre || ''}；风格：${outline.style || options.style || ''}
其余各幕上下文（保持逻辑衔接）：
${others}
当前这一幕初稿（可作为参考，需重写）：
  标题：${contextAct.title || ''}
  摘要：${contextAct.summary || ''}
  关键事件：${(contextAct.key_events || []).join(' / ')}
用户追加要求：${promptAppend}
`;

  const systemPrompt = `你是职业漫剧编剧。请针对用户指定的单幕重写该幕内容。\n
输出纯 JSON：
{
  "act_number": ${actNum},
  "title": "本幕标题（简短，有吸引力）",
  "summary": "本幕剧情摘要，150字左右，包含人物冲突与剧情转折",
  "key_events": ["关键事件1", "关键事件2", "关键事件3", "关键事件4"]
}
要求：
1. 摘要要有戏剧冲突，不平淡
2. key_events 3~6 条，顺序与摘要一致
3. 与其他幕保持逻辑一致
4. 只输出 JSON，不要多余文字`;

  log.info('[screenwriter.regenerateAct] 调用 AI', { outlineId, actIndex: idx, actNumber: actNum, promptAppend, userPromptLen: userPrompt.length, sysPromptLen: systemPrompt.length });
  const aiT0 = Date.now();
  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_regen_act',
    temperature: 0.9, min_max_tokens: 2500, json_mode: true,
  });
  const aiElapsed = Date.now() - aiT0;
  log.info('[screenwriter.regenerateAct] AI 返回', { outlineId, actIndex: idx, rawLen: (raw || '').length, aiMs: aiElapsed });

  const parsed = tryParse(raw);
  let newAct;
  let usedFallback = false;
  if (parsed && typeof parsed === 'object' && parsed.title && Array.isArray(parsed.key_events)) {
    newAct = {
      act_number: parsed.act_number || actNum,
      title: parsed.title,
      summary: parsed.summary || contextAct.summary,
      key_events: parsed.key_events,
    };
  } else {
    usedFallback = true;
    log.warn('[screenwriter.regenerateAct] AI 返回解析失败，使用兜底（原幕内容）', { outlineId, actIndex: idx, parsedType: typeof parsed, hasTitle: !!(parsed && parsed.title), hasKeyEvents: !!(parsed && Array.isArray(parsed.key_events)) });
    newAct = {
      act_number: actNum,
      title: contextAct.title || `第${actNum}幕`,
      summary: contextAct.summary,
      key_events: contextAct.key_events || [],
    };
  }

  // 替换数组中这一幕并落库
  acts[idx] = newAct;
  const actsJson = JSON.stringify(acts);
  const now = nowStr();
  const saveT0 = Date.now();
  _runInsert(db, 'UPDATE sw_outlines SET acts_json = ?, updated_at = ? WHERE outline_id = ?', [actsJson, now, outlineId]);
  const saveElapsed = Date.now() - saveT0;

  const totalElapsed = Date.now() - t0;
  log.info('[screenwriter.regenerateAct] 完成', {
    outlineId,
    actIndex: idx,
    actNumber: newAct.act_number,
    newTitle: newAct.title,
    keyEventCount: newAct.key_events.length,
    usedFallback,
    aiMs: aiElapsed,
    dbSaveMs: saveElapsed,
    elapsedMs: totalElapsed,
  });
  return newAct;
}

/**
 * S2-T01 / S2-T03: 单角色重生成 — 基于大纲 + 其他角色上下文，重写单个角色
 *
 * @param {object} db
 * @param {object} log
 * @param {string} characterId - sw_characters.character_id
 * @param {object} options - { promptAppend, idea, genre }
 * @returns {object} 重写后的角色
 */
async function regenerateCharacter(db, log, characterId, options = {}) {
  const t0 = Date.now();
  log = logWrap(log);
  log.info('[screenwriter.regenerateCharacter] 开始', { characterId, optionsKeys: Object.keys(options) });

  if (!characterId) {
    log.warn('[screenwriter.regenerateCharacter] 参数非法：characterId 为空', { elapsedMs: Date.now() - t0 });
    throw new Error('缺少 characterId');
  }
  const existT0 = Date.now();
  const existing = _queryOne(db, 'SELECT * FROM sw_characters WHERE character_id = ?', [characterId]);
  const existElapsed = Date.now() - existT0;
  if (!existing) {
    log.warn('[screenwriter.regenerateCharacter] 角色不存在', { characterId, elapsedMs: Date.now() - t0 });
    throw new Error(`角色不存在: ${characterId}`);
  }
  log.info('[screenwriter.regenerateCharacter] 读取原角色', { characterId, name: existing.name, role: existing.role, dbMs: existElapsed });

  const outlineId = existing.outline_id;
  let outline = null;
  let otherChars = [];
  if (outlineId) {
    const ctxT0 = Date.now();
    outline = await _getOutline(db, outlineId);
    otherChars = _queryAll(db, 'SELECT name, role, personality, appearance FROM sw_characters WHERE outline_id = ? AND character_id != ? ORDER BY sort_order', [outlineId, characterId]);
    log.info('[screenwriter.regenerateCharacter] 上下文读取完成', { characterId, outlineId, otherCharCount: otherChars.length, ctxMs: Date.now() - ctxT0 });
  }

  const othersStr = otherChars.map((c) => `- ${c.name}（${c.role || '配角'}）外貌：${(c.appearance || '未设').slice(0, 60)}；性格：${(c.personality || '未设').slice(0, 60)}`).join('\n') || '(无其他角色)';

  const promptAppend = options.prompt_append || options.promptAppend || '保留原定位，让外貌描述更具体，性格更鲜明有辨识度';
  const userPrompt = `请重写这个剧本的角色设定：
剧本主题：${outline?.logline || outline?.premise || options.idea || ''}
题材：${outline?.genre || options.genre || ''}
其他角色（避免设定冲突）：
${othersStr}
要重写的角色 原设定：
  姓名：${existing.name || ''}
  角色定位：${existing.role || ''}
  外貌：${existing.appearance || ''}
  性格：${existing.personality || ''}
  背景：${existing.background || ''}
用户追加要求：${promptAppend}
`;

  const systemPrompt = `你是职业漫剧编剧/角色设计师。请针对指定角色重写其档案。\n
输出纯 JSON：
{
  "name": "姓名（中文，好记有辨识度）",
  "role": "protagonist/antagonist/supporting/villain 之一",
  "appearance": "详细外貌描述，包括发型/五官/服装/身高体型/配饰，100字左右",
  "personality": "性格描述（优势、缺点、做事动机、口头禅或习惯），80字左右",
  "background": "成长背景/经历/家庭/关键事件，80字左右",
  "motivation": "核心动机（驱动该角色在故事中的一切行为）",
  "arc": "角色弧线（从怎样的人转变为怎样的人）"
}
要求：
1. 名字和定位尽量与用户设定一致
2. 避免与其他角色外貌、性格撞型
3. 只输出 JSON，不要多余文字`;

  log.info('[screenwriter.regenerateCharacter] 调用 AI', { characterId, name: existing.name, promptAppend, userPromptLen: userPrompt.length, sysPromptLen: systemPrompt.length, otherCharCount: otherChars.length });
  const aiT0 = Date.now();
  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'screenwriter_regen_character',
    temperature: 0.9, min_max_tokens: 2500, json_mode: true,
  });
  const aiElapsed = Date.now() - aiT0;
  log.info('[screenwriter.regenerateCharacter] AI 返回', { characterId, rawLen: (raw || '').length, aiMs: aiElapsed });

  const parsed = tryParse(raw);
  const now = nowStr();
  let usedFallback = false;
  if (parsed && typeof parsed === 'object') {
    const patch = {
      name: parsed.name || existing.name,
      role: parsed.role || existing.role,
      appearance: parsed.appearance || existing.appearance,
      personality: parsed.personality || existing.personality,
      background: parsed.background || existing.background,
      motivation: parsed.motivation || existing.motivation,
      arc: parsed.arc || existing.arc,
    };
    log.debug('[screenwriter.regenerateCharacter] 应用变更字段', { characterId, changedNameTo: patch.name, changedRoleTo: patch.role });
    const saveT0 = Date.now();
    _runInsert(db, `UPDATE sw_characters SET name=?, role=?, appearance=?, personality=?, background=?, motivation=?, arc=?, updated_at=? WHERE character_id=?`,
      [patch.name, patch.role, patch.appearance, patch.personality, patch.background, patch.motivation, patch.arc, now, characterId]);
    log.info('[screenwriter.regenerateCharacter] DB 更新完成', { characterId, dbSaveMs: Date.now() - saveT0 });
  } else {
    usedFallback = true;
    log.warn('[screenwriter.regenerateCharacter] AI 返回解析失败，保留原角色', { characterId, parsedType: typeof parsed });
  }

  const updated = _queryOne(db, 'SELECT * FROM sw_characters WHERE character_id = ?', [characterId]);
  const result = {
    characterId: updated.character_id,
    outlineId: updated.outline_id,
    name: updated.name,
    role: updated.role,
    personality: updated.personality,
    appearance: updated.appearance,
    background: updated.background,
    motivation: updated.motivation,
    arc: updated.arc,
    gender: updated.gender,
    age: updated.age,
    sortOrder: updated.sort_order,
    status: updated.status,
  };
  log.info('[screenwriter.regenerateCharacter] 完成', {
    characterId,
    oldName: existing.name,
    newName: result.name,
    role: result.role,
    usedFallback,
    aiMs: aiElapsed,
    elapsedMs: Date.now() - t0,
  });
  return result;
}

function getJobRecord(db, jobId) {
  const row = _queryOne(db, 'SELECT * FROM sw_jobs WHERE job_id = ?', [jobId]);
  if (!row) return null;
  return {
    jobId: row.job_id,
    bullJobId: row.bull_job_id,
    userId: row.user_id,
    enterpriseId: row.enterprise_id,
    outlineId: row.outline_id,
    episodeId: row.episode_id,
    frameId: row.frame_id,
    jobType: row.job_type,
    payload: parseJsonField(row.payload_json, null),
    result: parseJsonField(row.result_json, null),
    status: row.status,
    progress: row.progress,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    costPoints: row.cost_points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listJobs(db, { userId, jobType, status, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (jobType) { where.push('job_type = ?'); params.push(jobType); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql = `SELECT * FROM sw_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
  const rows = _queryAll(db, sql, params);
  return rows.map((r) => ({
    jobId: r.job_id, jobType: r.job_type, status: r.status, progress: r.progress,
    outlineId: r.outline_id, episodeId: r.episode_id, createdAt: r.created_at,
  }));
}

// ============================================================
// S2-T04: 一键创建项目
// 将 AI 编剧生成的大纲/角色/分集/场景/分镜 转换为正式项目数据
// ============================================================

/**
 * 一键创建完整项目
 * 将 sw_outlines / sw_characters / sw_episodes / sw_scenes / sw_storyboards
 * 映射到 dramas / characters / episodes / scenes / storyboards 表
 *
 * @param {object} db - 数据库连接
 * @param {object} log - 日志对象
 * @param {object} params - { outlineId, name, userId, user }
 * @returns {object} { projectId, dramaId, characterCount, episodeCount, sceneCount, storyboardCount }
 */
async function createProject(db, log, params = {}) {
  log = logWrap(log);
  const { outlineId, name, user } = params;
  if (!outlineId) throw new Error('缺少 outlineId');

  // 1. 加载大纲
  const outline = await _getOutline(db, outlineId);
  if (!outline) throw new Error(`大纲不存在: ${outlineId}`);

  // 2. 加载编剧生成的数据
  const swChars = _queryAll(db, 'SELECT * FROM sw_characters WHERE outline_id = ? ORDER BY sort_order, id', [outlineId]);
  const swEps = _queryAll(db, 'SELECT * FROM sw_episodes WHERE outline_id = ? ORDER BY episode_number, id', [outlineId]);
  const swEpIds = swEps.map((e) => e.episode_id);
  const swScenes = swEpIds.length
    ? _queryAll(db, `SELECT * FROM sw_scenes WHERE episode_id IN (${swEpIds.map(() => '?').join(',')}) ORDER BY sort_order, id`, swEpIds)
    : [];
  const swFrames = swEpIds.length
    ? _queryAll(db, `SELECT * FROM sw_storyboards WHERE episode_id IN (${swEpIds.map(() => '?').join(',')}) ORDER BY sort_order, frame_number, id`, swEpIds)
    : [];

  // 3. 创建 drama 记录
  const now = nowStr();
  const userId = user?.id || params.userId || outline.userId || null;
  const enterpriseId = user?.enterprise_id || null;
  const teamId = user?.team_id || null;
  const dramaTitle = (name && String(name).trim()) || outline.title || '未命名剧本';

  // 构建元数据（含存储目录标签 + 关联大纲ID，便于溯源）
  let storageLayout;
  try { storageLayout = require('./storageLayout'); } catch (_) { storageLayout = null; }
  const folderLabel = storageLayout
    ? storageLayout.sanitizeFolderLabel(dramaTitle)
    : dramaTitle.replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 64);
  const metadata = {
    storage_folder_label: folderLabel,
    source_outline_id: outlineId,
    source: 'ai_screenwriter',
    structure: outline.structure,
    themes: outline.themes,
  };

  const dramaId = snowflakeId();
  const dramaIns = _runInsert(db,
    `INSERT INTO dramas (id, title, description, genre, style, metadata, status, created_by, enterprise_id, team_id, total_episodes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [dramaId, dramaTitle, outline.logline || outline.idea || null, outline.genre || null, outline.style || 'realistic',
     JSON.stringify(metadata), userId, enterpriseId, teamId, swEps.length || 1, now, now]
  );

  // 4. 映射角色 sw_characters -> characters
  const charIdMap = {}; // sw character_id -> characters.id
  let characterCount = 0;
  for (const c of swChars) {
    const ins = _runInsert(db,
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [dramaId, c.name || '未命名', c.role || 'supporting', c.background || null, c.personality || null,
       c.appearance || null, c.sort_order || 0, now, now]
    );
    const newId = ins?.lastInsertRowid || ins?.insertId;
    if (newId && c.character_id) charIdMap[c.character_id] = newId;
    characterCount++;
  }

  // 5. 映射分集 sw_episodes -> episodes，并记录 id 映射
  const epIdMap = {}; // sw episode_id -> episodes.id
  let episodeCount = 0;
  for (const ep of swEps) {
    const ins = _runInsert(db,
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [dramaId, ep.episode_number || (episodeCount + 1), ep.title || `第${ep.episode_number || episodeCount + 1}集`,
       ep.summary || null, ep.cliffhanger || null, 0, now, now]
    );
    const newId = ins?.lastInsertRowid || ins?.insertId;
    if (newId && ep.episode_id) epIdMap[ep.episode_id] = newId;
    episodeCount++;
  }

  // 6. 映射场景 sw_scenes -> scenes
  const sceneIdMap = {}; // sw scene_id -> scenes.id
  let sceneCount = 0;
  for (const sc of swScenes) {
    const mappedEpId = sc.episode_id ? (epIdMap[sc.episode_id] || null) : null;
    const ins = _runInsert(db,
      `INSERT INTO scenes (drama_id, episode_id, location, time, prompt, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [dramaId, mappedEpId, sc.location || null, sc.time_of_day || null, sc.description || null, now, now]
    );
    const newId = ins?.lastInsertRowid || ins?.insertId;
    if (newId && sc.scene_id) sceneIdMap[sc.scene_id] = newId;
    sceneCount++;
  }

  // 7. 映射分镜 sw_storyboards -> storyboards
  let storyboardCount = 0;
  for (const fr of swFrames) {
    const mappedEpId = fr.episode_id ? (epIdMap[fr.episode_id] || null) : null;
    const mappedSceneId = fr.scene_id ? (sceneIdMap[fr.scene_id] || null) : null;
    // 解析角色 JSON，将 sw character_id 转为 characters.id
    let charNames = [];
    try {
      const raw = typeof fr.characters_json === 'string' ? JSON.parse(fr.characters_json) : fr.characters_json;
      if (Array.isArray(raw)) {
        charNames = raw.map((cid) => {
          if (charIdMap[cid]) return charIdMap[cid];
          // 如果不是 ID 而是名字，直接保留
          return cid;
        });
      }
    } catch (_) {}
    _runInsert(db,
      `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, description, dialogue, image_prompt, characters, shot_type, duration, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [mappedEpId, mappedSceneId, fr.frame_number || (storyboardCount + 1),
       fr.visual_description || null, null, fr.prompt || null,
       charNames.length ? JSON.stringify(charNames) : null,
       fr.shot_type || null, fr.duration || null, now, now]
    );
    storyboardCount++;
  }

  // 8. 回写 sw_outlines.drama_id 建立关联
  try {
    _runInsert(db, 'UPDATE sw_outlines SET drama_id = ?, updated_at = ? WHERE outline_id = ?', [dramaId, now, outlineId]);
  } catch (_) {}

  log.info('[screenwriter] 一键创建项目完成', {
    outlineId, dramaId, characterCount, episodeCount, sceneCount, storyboardCount,
  });

  return {
    projectId: dramaId,
    dramaId,
    title: dramaTitle,
    characterCount,
    episodeCount,
    sceneCount,
    storyboardCount,
    outlineId,
  };
}

// ---------- exports ----------
module.exports = {
  // 五大生成能力（落库）
  generateOutline,
  generateCharacters,
  generateEpisodes,
  generateStoryboard,
  generateDialogue,
  // CRUD
  getOutline: _getOutline,
  listOutlines(db, { userId, dramaId, limit = 50, offset = 0 } = {}) {
    const w = []; const p = [];
    if (userId) { w.push('user_id = ?'); p.push(userId); }
    if (dramaId) { w.push('drama_id = ?'); p.push(dramaId); }
    const rows = _queryAll(db, `SELECT * FROM sw_outlines ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, p);
    return rows.map(r => ({
      outlineId: r.outline_id, title: r.title, logline: r.logline, genre: r.genre, style: r.style,
      structure: r.structure, episodeCount: r.episode_count, status: r.status, createdAt: r.created_at,
      themes: parseJsonField(r.themes_json, []),
    }));
  },
  listCharacters: _listCharacters,
  getEpisode: _getEpisode,
  listEpisodes(db, outlineId) {
    const rows = _queryAll(db, 'SELECT * FROM sw_episodes WHERE outline_id = ? ORDER BY episode_number', [outlineId]);
    return rows.map(r => ({
      episodeId: r.episode_id, episodeNumber: r.episode_number, title: r.title, summary: r.summary,
      cliffhanger: r.cliffhanger, duration: r.duration_estimate, status: r.status,
    }));
  },
  listFrames: _listFrames,
  listDialogues: _listDialogues,
  // 字典/模板
  listTemplates: _listTemplates,
  listGenres(db) { return _listDict(db, 'sw_genres', 'genre_key', 'label_zh'); },
  listStyles(db) { return _listDict(db, 'sw_styles', 'style_key', 'label_zh'); },
  listShotTypes(db) { return _listDict(db, 'sw_shot_types', 'shot_key', 'label_zh'); },
  listEmotions(db) { return _listDict(db, 'sw_dialogue_emotions', 'emotion_key', 'label_zh'); },
  // 多轮对话
  chatWithScreenwriter,
  getChatHistory,
  listChatSessions,
  // 增量修改 / 重生成（平台文档 3.1：逐段修改和重新生成）
  updateOutline,
  regenerateEpisode,
  generateSceneDescription,
  // Sprint 2 新增：角色保存 / 单幕重生成 / 单角色重生成
  updateCharacter,
  regenerateAct,
  regenerateCharacter,
  // S2-T04: 一键创建项目
  createProject,
  // jobs
  createJobRecord,
  updateJobRecord,
  getJobRecord,
  listJobs,
  // 工具
  uid,
  nowStr,
};
