/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、openai、edge-tts（本地）、macOS say（本地）
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { execFileSync } = require('child_process');

function sanitizeApiKey(apiKey) {
  if (!apiKey) return '';
  const str = String(apiKey).trim();
  return str.replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * 本地 voice_id → macOS say 语音名 映射
 * 覆盖本项目的预设音色字典（见 listVoices），确保每个 voice_id 都能映射到 macOS 中文语音
 */
const MAC_SAY_VOICE_MAP = {
  male_deep: 'Reed (中文（中国大陆）)',      // 男声-沉稳男主
  male_evil: 'Grandpa (中文（中国大陆）)',   // 男声-反派低音
  female_soft: 'Flo (中文（中国大陆）)',     // 女声-温柔女主
  female_sweet: 'Sandy (中文（中国大陆）)',  // 女声-活泼女二
  narrator_epic: 'Eddy (中文（中国大陆）)',  // 男声-史诗旁白
  // 兼容 OpenAI 通用 voice 名
  alloy: 'Reed (中文（中国大陆）)',
  echo: 'Grandpa (中文（中国大陆）)',
  fable: 'Flo (中文（中国大陆）)',
  nova: 'Sandy (中文（中国大陆）)',
  shimmer: 'Flo (中文（中国大陆）)',
};

/**
 * 使用 macOS `say` 命令本地合成中文语音 → 转 mp3
 * 优点：零配置、零成本、离线可用，便于本地调试配音效果
 * 限制：仅 macOS 可用；情感语调仅通过 rate（语速）近似
 *
 * @param {string} text 待合成文本
 * @param {string} voiceId 项目预设音色 ID（如 male_deep）
 * @param {number} speed 语速（0.5-2.0，1.0 为标准）
 * @returns {Promise<Buffer>} mp3 音频 Buffer
 */
async function synthesizeWithMacSay(text, voiceId, speed) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS say 仅在 darwin 平台可用，当前平台: ' + process.platform);
  }
  const voice = MAC_SAY_VOICE_MAP[voiceId] || MAC_SAY_VOICE_MAP.male_deep;
  // say 的 rate：每分钟字数，中文默认约 200；speed=1.0 → 200，speed=1.5 → 300
  const rate = Math.round(180 * (Number(speed) || 1.0));

  const tmpDir = os.tmpdir();
  const aiffPath = path.join(tmpDir, `tts_say_${randomUUID().slice(0, 8)}.aiff`);
  const mp3Path = path.join(tmpDir, `tts_say_${randomUUID().slice(0, 8)}.mp3`);

  try {
    // 1. say 生成 aiff
    execFileSync('say', ['-v', voice, '-r', String(rate), '-o', aiffPath, text], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30000,
    });
    if (!fs.existsSync(aiffPath)) throw new Error('say 未生成 aiff 文件');

    // 2. ffmpeg 转 mp3
    execFileSync('ffmpeg', ['-y', '-i', aiffPath, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3Path], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30000,
    });
    if (!fs.existsSync(mp3Path)) throw new Error('ffmpeg 未生成 mp3 文件');

    const buf = fs.readFileSync(mp3Path);
    if (buf.length === 0) throw new Error('生成的 mp3 为空');
    return buf;
  } finally {
    try { fs.unlinkSync(aiffPath); } catch (_) {}
    try { fs.unlinkSync(mp3Path); } catch (_) {}
  }
}

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sanitizeApiKey(apiKey)}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${sanitizeApiKey(apiKey)}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, audio_url: string }}
 */
async function synthesize(db, log, { text, storyboard_id, config, storage_base, voice_id, speed }) {
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();
  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  const provider = (ttsConfig.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
  // 外部传入的 voice_id / speed 优先（海外化场景），否则取配置值
  const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig.default_model || (Array.isArray(ttsConfig.model) ? ttsConfig.model[0] : ttsConfig.model) || '';
  const finalSpeed = speed || ttsSettings.speed || 1.0;
  let audioBuffer;

  if (provider === 'local_say') {
    // macOS 本地 TTS（零配置，离线可用，便于本地调试配音效果）
    audioBuffer = await synthesizeWithMacSay(text, voiceId || 'male_deep', finalSpeed);
  } else if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'openai' || ttsConfig.base_url) {
    console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ttsConfig.base_url, ttsModel, finalSpeed);
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 local_say、openai、minimax`);
  }

  // 保存到本地
  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const filename = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath };
}

// ============================================================
// Sprint 4 - S4-T03: 智能配音流水线扩展
// 角色音色绑定 / 台词提取 / 批量TTS / 情感语调控制
// ============================================================

/**
 * 内置音色字典（与前端选项对齐）
 * 实际 TTS 调用时映射到 provider 的 voice_id
 */
const VOICE_PRESETS = {
  female_soft:    { name: '女声-温柔旁白', provider: 'openai', voice_id: 'nova',     gender: 'female' },
  female_sweet:   { name: '女声-甜美白领', provider: 'openai', voice_id: 'shimmer',  gender: 'female' },
  male_deep:      { name: '男声-沉稳男主', provider: 'openai', voice_id: 'onyx',     gender: 'male' },
  male_teen:      { name: '男声-年轻少年', provider: 'openai', voice_id: 'echo',     gender: 'male' },
  male_villain:   { name: '反派-沙哑磁性', provider: 'openai', voice_id: 'fable',    gender: 'male' },
  male_warm:      { name: '男声-温暖大叔', provider: 'openai', voice_id: 'alloy',    gender: 'male' },
};

/**
 * 情感语调参数映射：根据剧情情绪调整语速/语调
 */
const EMOTION_PARAMS = {
  neutral:  { speed: 1.00, pitch: 0 },
  warm:     { speed: 0.95, pitch: 1 },
  happy:    { speed: 1.10, pitch: 2 },
  sad:      { speed: 0.85, pitch: -2 },
  angry:    { speed: 1.15, pitch: -1 },
  tense:    { speed: 1.05, pitch: -1 },
  shocking: { speed: 1.20, pitch: 0 },
  epic:     { speed: 0.90, pitch: -2 },
  romantic: { speed: 0.92, pitch: 1 },
  mysterious:{ speed: 0.88, pitch: -1 },
};

/**
 * 列出角色音色绑定
 */
function listVoiceBindings(db, { dramaId } = {}) {
  const w = []; const p = [];
  if (dramaId) { w.push('drama_id = ?'); p.push(dramaId); }
  const sql = `SELECT * FROM character_voice_bindings ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY is_default DESC, character_name ASC`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(r => ({
    id: r.id, dramaId: r.drama_id, characterId: r.character_id, characterName: r.character_name,
    voiceId: r.voice_id, voiceName: r.voice_name, provider: r.provider,
    emotion: r.emotion, speed: r.speed, pitch: r.pitch, language: r.language,
    isDefault: !!r.is_default, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

/**
 * 绑定/更新角色音色
 */
function bindVoice(db, log, params) {
  log = log || console;
  const { dramaId, characterId, characterName, voiceId, voiceName, provider,
    emotion, speed, pitch, language, isDefault } = params;
  if (!dramaId || !characterId || !voiceId) throw new Error('dramaId/characterId/voiceId 必填');

  // 查询是否已存在绑定
  const existing = db.prepare('SELECT id FROM character_voice_bindings WHERE drama_id = ? AND character_id = ?').get(dramaId, characterId);
  const preset = VOICE_PRESETS[voiceId] || {};
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`UPDATE character_voice_bindings SET
      character_name = ?, voice_id = ?, voice_name = ?, provider = ?,
      emotion = ?, speed = ?, pitch = ?, language = ?, is_default = ?, updated_at = ?
      WHERE id = ?`).run(
      characterName || null, voiceId, voiceName || preset.name || null, provider || preset.provider || 'openai',
      emotion || 'neutral', speed || 1.0, pitch || 0, language || 'zh', isDefault ? 1 : 0, now,
      existing.id
    );
    log.info('[TTS] 更新音色绑定', { id: existing.id, characterId, voiceId });
    return { id: existing.id, updated: true };
  }

  const result = db.prepare(`INSERT INTO character_voice_bindings
    (drama_id, character_id, character_name, voice_id, voice_name, provider, emotion, speed, pitch, language, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    dramaId, characterId, characterName || null, voiceId, voiceName || preset.name || null,
    provider || preset.provider || 'openai', emotion || 'neutral', speed || 1.0, pitch || 0,
    language || 'zh', isDefault ? 1 : 0, now, now
  );
  log.info('[TTS] 新增音色绑定', { id: result.lastInsertRowid, characterId, voiceId });
  return { id: result.lastInsertRowid, updated: false };
}

/**
 * 删除角色音色绑定
 */
function deleteVoiceBinding(db, log, id) {
  const info = db.prepare('DELETE FROM character_voice_bindings WHERE id = ?').run(id);
  return { deleted: info.changes > 0, id };
}

/**
 * 从分镜提取台词（支持 storyboards 表的 dialogue / narration 字段）
 * 返回 [{ storyboardId, episodeId, characterName, text, sortOrder }]
 */
function extractDialogues(db, { dramaId, episodeId } = {}) {
  const w = []; const p = [];
  w.push('deleted_at IS NULL');
  if (episodeId) { w.push('episode_id = ?'); p.push(episodeId); }

  let episodeIds = [];
  if (dramaId && !episodeId) {
    // 通过 episodes 表找到该剧所有 episode
    try {
      const eps = db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL').all(dramaId);
      episodeIds = eps.map(e => e.id);
    } catch (_) {}
    if (episodeIds.length) {
      w.push(`episode_id IN (${episodeIds.map(() => '?').join(',')})`);
      p.push(...episodeIds);
    }
  }

  const sql = `SELECT id, episode_id, storyboard_number, dialogue, narration, title FROM storyboards WHERE ${w.join(' AND ')} ORDER BY episode_id, storyboard_number`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();

  const items = [];
  for (const r of rows) {
    // 解析 dialogue 字段，支持 "角色名:台词" 多行格式
    const dialogueText = r.dialogue || r.narration || '';
    if (!dialogueText.trim()) continue;
    const lines = dialogueText.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(.{1,20}?)[:：](.+)$/);
      if (match) {
        items.push({
          storyboardId: r.id,
          episodeId: r.episode_id,
          characterName: match[1].replace(/[（）()]/g, '').trim(),
          text: match[2].trim(),
          sortOrder: items.length,
        });
      } else {
        // 旁白/无角色台词
        items.push({
          storyboardId: r.id,
          episodeId: r.episode_id,
          characterName: '旁白',
          text: line,
          sortOrder: items.length,
        });
      }
    }
  }
  return items;
}

/**
 * 批量 TTS 合成
 * @param {object} params - { dramaId, episodeId, items, storageBase, userId }
 *   items: [{ characterName, text, voiceId, emotion, speed }]
 * @returns {object} { batchId, total, success, failed, results }
 */
async function batchSynthesize(db, log, params) {
  log = log || console;
  const { dramaId, episodeId, items, storageBase, userId } = params;
  if (!Array.isArray(items) || items.length === 0) throw new Error('台词列表不能为空');

  const total = items.length;
  let success = 0;
  let failed = 0;
  const results = [];

  // 创建批次记录
  const now = new Date().toISOString();
  let batchId = null;
  try {
    const ins = db.prepare(`INSERT INTO tts_batch_jobs
      (drama_id, episode_id, user_id, status, total_count, success_count, failed_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(dramaId, episodeId, userId, 'running', total, 0, 0, now, now);
    batchId = ins.lastInsertRowid;
  } catch (_) {}

  // 查询角色音色绑定映射
  const voiceMap = {};
  if (dramaId) {
    try {
      const bindings = listVoiceBindings(db, { dramaId });
      for (const b of bindings) {
        voiceMap[b.characterName] = b;
      }
    } catch (_) {}
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.text || '';
    if (!text.trim()) { failed++; results.push({ index: i, status: 'skipped', error: '空台词' }); continue; }

    // 解析音色：item.voiceId > 角色绑定 > 默认
    const charName = item.characterName || '旁白';
    const binding = voiceMap[charName] || {};
    const voiceId = item.voiceId || binding.voiceId || 'female_soft';
    const preset = VOICE_PRESETS[voiceId] || {};
    const emotion = item.emotion || binding.emotion || 'neutral';
    const emoParams = EMOTION_PARAMS[emotion] || EMOTION_PARAMS.neutral;
    const speed = item.speed || binding.speed || emoParams.speed;

    try {
      const result = await synthesize(db, log, {
        text,
        storyboard_id: item.storyboardId || null,
        storage_base: storageBase,
        voice_id: voiceId,
        speed,
      });
      success++;
      results.push({
        index: i, status: 'success', characterName: charName, text: text.slice(0, 50),
        voiceId, emotion, audioPath: result.local_path, speed,
      });

      // 记录分镜配音关联
      if (item.storyboardId) {
        try {
          db.prepare(`INSERT INTO storyboard_dubbing
            (drama_id, episode_id, storyboard_id, character_name, dialogue_text, voice_id, emotion, audio_path, sort_order, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            dramaId, episodeId, item.storyboardId, charName, text,
            voiceId, emotion, result.local_path, i, 'synthesized', now, now
          );
        } catch (_) {}
      }
    } catch (err) {
      failed++;
      results.push({ index: i, status: 'failed', characterName: charName, text: text.slice(0, 50), error: err.message });
      log.error('[TTS] 批量合成单条失败', { index: i, charName, error: err.message });
    }
  }

  // 更新批次记录
  if (batchId) {
    try {
      db.prepare(`UPDATE tts_batch_jobs SET status = ?, success_count = ?, failed_count = ?, items_json = ?, updated_at = ? WHERE id = ?`)
        .run(failed === 0 ? 'completed' : (success === 0 ? 'failed' : 'completed'), success, failed, JSON.stringify(results), now, batchId);
    } catch (_) {}
  }

  log.info('[TTS] 批量配音完成', { batchId, total, success, failed });
  return { batchId, total, success, failed, results };
}

/**
 * 查询分集配音记录
 */
function listDubbingByEpisode(db, episodeId) {
  const rows = db.prepare('SELECT * FROM storyboard_dubbing WHERE episode_id = ? ORDER BY sort_order').all(episodeId);
  return rows.map(r => ({
    id: r.id, dramaId: r.drama_id, episodeId: r.episode_id, storyboardId: r.storyboard_id,
    characterName: r.character_name, dialogueText: r.dialogue_text, voiceId: r.voice_id,
    emotion: r.emotion, audioPath: r.audio_path, durationMs: r.duration_ms,
    sortOrder: r.sort_order, status: r.status, createdAt: r.created_at,
  }));
}

module.exports = {
  synthesize,
  // S4-T03 扩展
  listVoiceBindings,
  bindVoice,
  deleteVoiceBinding,
  extractDialogues,
  batchSynthesize,
  listDubbingByEpisode,
  listVoices: () => Object.entries(VOICE_PRESETS).map(([k, v]) => ({ id: k, ...v })),
  listEmotions: () => Object.entries(EMOTION_PARAMS).map(([k, v]) => ({ emotion: k, ...v })),
};
