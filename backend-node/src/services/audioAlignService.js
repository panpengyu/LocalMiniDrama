'use strict';
/**
 * audioAlignService.js
 * Sprint 7 — S7-T08 配音与视频自动对齐
 *
 * 日志规范：traceID=[AAL#xxx]，分阶段打印
 * 对齐策略：
 *  stretch — 拉伸/缩短分镜时长以匹配配音（默认）
 *  trim    — 裁剪配音以匹配分镜时长
 *  loop    — 循环画面以匹配较长配音
 *  silence — 配音结束后保持静音画面
 *
 * 边界修复：
 *  - strategy 非法值时降级为 stretch
 *  - audio_duration_ms 为 0/NaN 时降级为原时长 + 告警
 *  - ffprobe 不可用时（ENOENT）给出明确的安装提示
 *  - storyboard.duration 非数字时默认 3000ms
 */

const { execFile, spawnSync } = require('child_process');
const crypto = require('crypto');

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function makeTraceId(prefix = 'AAL') {
  return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
function isToolAvailable(toolName) {
  try {
    const proc = spawnSync(process.platform === 'win32' ? 'where' : 'which', [toolName], { stdio: 'ignore' });
    return proc.status === 0;
  } catch { return false; }
}
const VALID_STRATEGIES = ['stretch', 'trim', 'loop', 'silence'];

// ====== Schema 自适应探测（与 editService 保持一致）======
const _schemaCache = new Map();
function probeSchema(db) {
  const key = (typeof db === 'object' && db.__probeKey) ? db.__probeKey : 'default';
  if (_schemaCache.has(key)) return _schemaCache.get(key);
  const result = {
    audioTable: 'audio_generations',
    audioUrlCol: 'audio_url',
    audioDurationCol: 'duration',
    storyboardNarrationCol: 'narration',
    storyboardHasDramaId: true,
  };
  try {
    const tables = tryTables(db);
    if (tables.includes('storyboard_dubbing') && !tables.includes('audio_generations')) {
      result.audioTable = 'storyboard_dubbing';
      result.audioUrlCol = 'audio_path';
      result.audioDurationCol = 'duration_ms';
    }
    const sbCols = tryColumns(db, 'storyboards');
    if (!sbCols.includes('narration')) {
      if (sbCols.includes('description')) result.storyboardNarrationCol = 'description';
      else result.storyboardNarrationCol = 'NULL';
    }
    if (!sbCols.includes('drama_id')) result.storyboardHasDramaId = false;
  } catch (e) { /* 探测失败就默认值 */ }
  _schemaCache.set(key, result);
  console.log(`[SCHEMA-PROBE] audioAlignService schema: audioTable=${result.audioTable} narrationCol=${result.storyboardNarrationCol} sbHasDramaId=${result.storyboardHasDramaId}`);
  return result;
}
function tryTables(db) {
  try {
    let rows = [];
    try {
      rows = db.prepare("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()").all();
    } catch (e) {
      rows = db.prepare("SELECT name AS TABLE_NAME FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    }
    return rows.map(r => Object.values(r)[0]);
  } catch { return []; }
}
function tryColumns(db, table) {
  try {
    let rows = [];
    try {
      rows = db.prepare(`DESCRIBE ${table}`).all();
    } catch (e) {
      rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.map(r => (r.name != null ? r.name : Object.values(r)[1]));
    }
    return rows.map(r => r.Field || Object.values(r)[0]);
  } catch { return []; }
}

/**
 * 获取音频时长（毫秒）
 * 使用 ffprobe 获取
 * [边界修复] ffprobe 不存在或返回非数值时，打印 WARN 并返回 null
 */
function getAudioDurationMs(audioPath) {
  return new Promise((resolve) => {
    const traceId = makeTraceId('FPROBE');
    const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
    if (!isToolAvailable(ffprobePath)) {
      console.log(`[${traceId}] [WARN] ffprobe 不可用，请安装 ffmpeg/ffprobe 或设置 FFPROBE_PATH，audioPath=${audioPath?.substring(0, 60)}`);
      resolve(null);
      return;
    }
    execFile(ffprobePath, [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        const code = err.code || 'UNKNOWN';
        if (err.code === 'ENOENT') {
          console.log(`[${traceId}] [WARN] ffprobe ENOENT`);
        } else {
          console.log(`[${traceId}] [WARN] ffprobe 执行失败 code=${code} msg=${err.message?.substring(0, 80)}`);
        }
        resolve(null);
        return;
      }
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration) || duration <= 0) {
        console.log(`[${traceId}] [WARN] ffprobe 返回非数值时长: "${stdout.trim().substring(0, 40)}"`);
        resolve(null);
        return;
      }
      resolve(Math.round(duration * 1000));
    });
  });
}

function alignStoryboard(db, log, params = {}) {
  const traceId = makeTraceId('AAL-SB');
  const t0 = Date.now();
  const { storyboard_id, audio_url, strategy: rawStrategy = 'stretch' } = params;

  // === [STAGE#1] 入参校验 ===
  if (!storyboard_id) throw new Error('[AAL-000] storyboard_id 必填');
  const strategy = VALID_STRATEGIES.includes(rawStrategy) ? rawStrategy : 'stretch';
  if (strategy !== rawStrategy) {
    console.log(`[${traceId}] [WARN] strategy 非法 "${rawStrategy}"，降级为 stretch`);
  }
  console.log(`[${traceId}] [STAGE#1] 入参校验通过`, { storyboard_id, strategy, audioUrl: (audio_url || '').substring(0, 50) });

  const sch = probeSchema(db);
  const narration = sch.storyboardNarrationCol === 'NULL' ? "NULL" : `${sch.storyboardNarrationCol}`;
  const sb = db.prepare(`SELECT id, duration, ${narration} AS narration, dialogue FROM storyboards WHERE id = ?`)
    .get(Number(storyboard_id));
  if (!sb) {
    throw new Error('[AAL-001] 分镜不存在: id=' + storyboard_id);
  }

  const originalDurationMs = sb.duration && typeof sb.duration === 'number' && sb.duration > 0
    ? Math.round(sb.duration * 1000) : 3000;
  let audioDurationMs = params.audio_duration_ms;

  if (!audioDurationMs && audio_url) {
    console.log(`[${traceId}] [WARN] 未提供 audio_duration_ms，本函数为同步接口跳过 ffprobe，降级使用原时长`);
    audioDurationMs = originalDurationMs;
  }
  if (audioDurationMs != null && (isNaN(audioDurationMs) || audioDurationMs <= 0)) {
    console.log(`[${traceId}] [WARN] audio_duration_ms 非法 (${audioDurationMs})，使用原时长 ${originalDurationMs}ms`);
    audioDurationMs = originalDurationMs;
  }

  let adjustedDurationMs = originalDurationMs;
  let alignmentStrategy = strategy;

  if (audioDurationMs && audioDurationMs > 0) {
    switch (strategy) {
      case 'stretch':  adjustedDurationMs = audioDurationMs + 300; break;
      case 'trim':     adjustedDurationMs = originalDurationMs; break;
      case 'loop':     adjustedDurationMs = Math.max(audioDurationMs + 300, originalDurationMs); break;
      case 'silence':  adjustedDurationMs = audioDurationMs + 500; break;
      default:         adjustedDurationMs = audioDurationMs + 300;
    }
  }

  const adjustedDurationSec = Math.max(0.5, adjustedDurationMs / 1000);  // [边界修复] 至少 0.5s
  db.prepare('UPDATE storyboards SET duration = ? WHERE id = ?')
    .run(adjustedDurationSec, Number(storyboard_id));

  db.prepare(
    `INSERT INTO audio_align_logs
      (drama_id, episode_id, storyboard_id, audio_url, audio_duration_ms,
       original_duration_ms, adjusted_duration_ms, alignment_strategy, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.drama_id || null,
    params.episode_id || null,
    Number(storyboard_id),
    audio_url || null,
    audioDurationMs || null,
    originalDurationMs,
    adjustedDurationMs,
    alignmentStrategy,
    'aligned',
    nowStr(),
    nowStr()
  );

  console.log(`[${traceId}] [STAGE#1-DONE] 对齐完成`, {
    storyboard_id,
    original: originalDurationMs + 'ms',
    audio:    (audioDurationMs || '-') + 'ms',
    adjusted: adjustedDurationMs + 'ms (' + adjustedDurationSec.toFixed(2) + 's)',
    strategy: alignmentStrategy,
    costMs:   Date.now() - t0,
  });

  return {
    storyboard_id,
    audio_duration_ms: audioDurationMs,
    original_duration_ms: originalDurationMs,
    adjusted_duration_ms: adjustedDurationMs,
    adjusted_duration_sec: adjustedDurationSec,
    strategy: alignmentStrategy,
  };
}

/**
 * 批量对齐分镜配音
 * 查询指定分集下所有分镜的配音，逐一调整时长
 * @param {object} db
 * @param {object} log
 * @param {object} params - { drama_id, episode_id, strategy }
 * @returns {object} 对齐结果汇总
 */
async function batchAlign(db, log, params = {}) {
  const traceId = makeTraceId('AAL-BATCH');
  const t0 = Date.now();
  const { drama_id, episode_id, strategy: rawStrategy = 'stretch' } = params;
  const strategy = VALID_STRATEGIES.includes(rawStrategy) ? rawStrategy : 'stretch';

  console.log(`[${traceId}] [STAGE#1] 批量对齐启动`, { drama_id, episode_id, strategy });
  if (!drama_id) throw new Error('[AAL-BATCH-000] drama_id 必填');

  const sch = probeSchema(db);
  const audUrl = `aud.${sch.audioUrlCol}`;
  const audDur = `aud.${sch.audioDurationCol}`;
  let sbFrom = 'storyboards sb';
  let where = '';
  const queryParams = [];
  if (sch.storyboardHasDramaId) {
    where = 'WHERE sb.drama_id = ?';
    queryParams.push(Number(drama_id));
  } else {
    sbFrom += ' INNER JOIN episodes ep ON ep.id = sb.episode_id';
    where = 'WHERE ep.drama_id = ?';
    queryParams.push(Number(drama_id));
  }
  if (episode_id) { where += ' AND sb.episode_id = ?'; queryParams.push(Number(episode_id)); }

  const sql = `SELECT sb.id, sb.duration, ${audUrl} AS audio_url, ${audDur} AS audio_duration_ms
             FROM ${sbFrom}
             INNER JOIN ${sch.audioTable} aud ON aud.storyboard_id = sb.id AND aud.status = 'completed'
             ${where}
             ORDER BY sb.storyboard_number ASC`;

  const storyboards = db.prepare(sql).all(...queryParams);

  if (storyboards.length === 0) {
    console.log(`[${traceId}] [WARN] 没有找到需要对齐的分镜配音`);
    return { drama_id, episode_id, total: 0, aligned_count: 0, failed_count: 0, results: [], message: '没有找到需要对齐的分镜配音' };
  }
  console.log(`[${traceId}] [STAGE#1-DONE] 查询到 ${storyboards.length} 个分镜需要对齐`);

  const results = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < storyboards.length; i++) {
    const sb = storyboards[i];
    try {
      let audioDurationMs = sb.audio_duration_ms;
      if ((!audioDurationMs || isNaN(audioDurationMs) || audioDurationMs <= 0) && sb.audio_url) {
        audioDurationMs = await getAudioDurationMs(sb.audio_url);
      }
      const result = alignStoryboard(db, log, {
        drama_id: Number(drama_id),
        episode_id: episode_id ? Number(episode_id) : null,
        storyboard_id: sb.id,
        audio_url: sb.audio_url,
        audio_duration_ms: audioDurationMs,
        original_duration_ms: sb.duration ? sb.duration * 1000 : 3000,
        strategy,
      });
      results.push(result);
      ok++;
    } catch (e) {
      fail++;
      console.log(`[${traceId}] [WARN] 第${i+1}/${storyboards.length} 个分镜对齐失败 sb=${sb.id}`, { error: e.message });
      results.push({ storyboard_id: sb.id, error: e.message });
    }
  }

  console.log(`[${traceId}] [DONE] 批量对齐完成，耗时 ${Date.now() - t0}ms`, {
    total: storyboards.length,
    success: ok,
    failed: fail,
  });

  return {
    drama_id,
    episode_id,
    total: storyboards.length,
    aligned_count: ok,
    failed_count: fail,
    results,
  };
}

/**
 * 获取对齐记录
 */
function getAlignLogs(db, filters = {}) {
  let sql = 'SELECT * FROM audio_align_logs WHERE 1=1';
  const params = [];
  if (filters.drama_id) { sql += ' AND drama_id = ?'; params.push(Number(filters.drama_id)); }
  if (filters.episode_id) { sql += ' AND episode_id = ?'; params.push(Number(filters.episode_id)); }
  sql += ' ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  alignStoryboard,
  batchAlign,
  getAudioDurationMs,
  getAlignLogs,
};
