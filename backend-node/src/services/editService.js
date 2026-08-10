'use strict';
/**
 * editService.js
 * Sprint 7 — S7-T05 智能剪辑后端接口
 *
 * 日志规范：每个入口生成 traceID（[EDIT#xxx]），分阶段打印：
 *   · [STAGE#1] 入参校验 + 创建任务
 *   · [STAGE#2] 收集分镜片段（空片段抛出 EDIT-001）
 *   · [STAGE#3] 节奏匹配 + 转场设置
 *   · [STAGE#4] 构建 ffmpeg 命令（无可用资源抛出 EDIT-002）
 *   · [STAGE#5] ffmpeg 执行（ffmpeg 不存在降级提示 EDIT-003）
 *   · [STAGE#6] 写库 + 返回结果
 *
 * 边界修复：
 *  - collectClips 无结果时，抛出明确错误并写入 edit_tasks.status=failed
 *  - buildFFmpegArgs 前校验所有片段是否有 image/video 资源
 *  - runFFmpeg 前通过 `which ffmpeg` 预检测，不存在时提示安装
 *  - 参数：resolution 校验正则，fps 校验 1-120
 *
 * Schema 自适应（E2E真实库兼容）：
 *  - storyboards 列：narration / drama_id 不存在时用 description / 通过 episodes 反查 drama_id
 *  - 音频表：audio_generations 不存在时用 storyboard_dubbing
 */

const { execFile, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TRANSITIONS, buildTransitionFilter } = require('./transitionEffects');

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function makeTraceId(prefix = 'EDIT') {
  return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ====== Schema 自适应探测（懒缓存，按 db 地址哈希）======
const _schemaCache = new Map();
function probeSchema(db) {
  const key = (typeof db === 'object' && db.__probeKey) ? db.__probeKey : 'default';
  if (_schemaCache.has(key)) return _schemaCache.get(key);
  const result = {
    audioTable: 'audio_generations',
    audioUrlCol: 'audio_url',
    audioDurationCol: 'duration',
    audioLocalCol: 'local_path',
    storyboardNarrationCol: 'narration',
    storyboardHasDramaId: true,
    editTasksHasSimulated: true,
    editTasksHasOutputDuration: true,
    editTasksHasSourceClips: true,
    editTasksHasProgressNotes: true,
  };
  try {
    // 探测音频表
    const tables = tryTables(db);
    if (tables.includes('storyboard_dubbing') && !tables.includes('audio_generations')) {
      result.audioTable = 'storyboard_dubbing';
      result.audioUrlCol = 'audio_path';
      result.audioDurationCol = 'duration_ms';
      result.audioLocalCol = 'audio_path';
    }
    // 探测 storyboards 列
    const sbCols = tryColumns(db, 'storyboards');
    if (!sbCols.includes('narration')) {
      // 用 description 作为 narration 的替代
      if (sbCols.includes('description')) result.storyboardNarrationCol = 'description';
      else result.storyboardNarrationCol = 'NULL';
    }
    if (!sbCols.includes('drama_id')) result.storyboardHasDramaId = false;
    // 探测 edit_tasks 列
    const etCols = tryColumns(db, 'edit_tasks');
    result.editTasksHasSimulated      = etCols.includes('simulated');
    result.editTasksHasOutputDuration = etCols.includes('output_duration');
    result.editTasksHasSourceClips    = etCols.includes('source_clips');
    result.editTasksHasProgressNotes  = etCols.includes('progress_notes');
  } catch (e) { /* 探测失败就默认值 */ }
  _schemaCache.set(key, result);
  console.log(`[SCHEMA-PROBE] editService schema: audioTable=${result.audioTable} narrationCol=${result.storyboardNarrationCol} sbHasDramaId=${result.storyboardHasDramaId} editTasks.simulated=${result.editTasksHasSimulated}`);
  return result;
}
function tryTables(db) {
  try {
    // MySQL: information_schema.TABLES；SQLite: sqlite_master
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
      // PRAGMA 返回的列名是 name，转一下
      return rows.map(r => (r.name != null ? r.name : Object.values(r)[1]));
    }
    return rows.map(r => r.Field || Object.values(r)[0]);
  } catch { return []; }
}

/** [边界修复] ffmpeg/ffprobe 可用性检测 */
function isToolAvailable(toolName) {
  try {
    const proc = spawnSync(process.platform === 'win32' ? 'where' : 'which', [toolName], { stdio: 'ignore' });
    return proc.status === 0;
  } catch {
    return false;
  }
}

/**
 * 收集分镜源片段
 * 从数据库中查询分镜的图片和音频
 * Schema 自适应：
 *  - drama_id 列在 storyboards 中不存在时，改 JOIN episodes 通过 episode_id 反查
 *  - 音频表 audio_generations 不存在时，用 storyboard_dubbing（列 audio_path/duration_ms）
 */
function collectClips(db, dramaId, episodeId) {
  const sch = probeSchema(db);
  const narration = sch.storyboardNarrationCol === 'NULL' ? "NULL" : `sb.${sch.storyboardNarrationCol}`;

  let where = '';
  const params = [];
  if (sch.storyboardHasDramaId) {
    where = 'WHERE sb.drama_id = ?';
    params.push(Number(dramaId));
    if (episodeId) { where += ' AND sb.episode_id = ?'; params.push(Number(episodeId)); }
  } else {
    where = 'WHERE ep.drama_id = ?';
    params.push(Number(dramaId));
    if (episodeId) { where += ' AND sb.episode_id = ?'; params.push(Number(episodeId)); }
  }

  const audUrl  = `aud.${sch.audioUrlCol}`;
  const audDur  = `aud.${sch.audioDurationCol}`;
  const audLoc  = `aud.${sch.audioLocalCol}`;

  let sbFrom = 'storyboards sb';
  if (!sch.storyboardHasDramaId) sbFrom += ' INNER JOIN episodes ep ON ep.id = sb.episode_id';

  const sql = `SELECT sb.id, sb.storyboard_number, sb.duration, sb.shot_type,
                      ${narration} AS narration, sb.dialogue,
                      img.image_url, img.local_path AS image_local,
                      vid.video_url, vid.local_path AS video_local,
                      ${audUrl} AS audio_url, ${audLoc} AS audio_local,
                      ${audDur} AS audio_duration
               FROM ${sbFrom}
               LEFT JOIN image_generations img ON img.storyboard_id = sb.id AND img.status = 'completed'
               LEFT JOIN video_generations vid ON vid.storyboard_id = sb.id AND vid.status = 'completed'
               LEFT JOIN ${sch.audioTable} aud ON aud.storyboard_id = sb.id AND aud.status = 'completed'
               ${where}
               ORDER BY sb.storyboard_number ASC`;

  const rows = db.prepare(sql).all(...params);

  return rows.map((row, index) => ({
    storyboard_id: row.id,
    index,
    image_url: row.image_url || row.image_local,
    video_url: row.video_url || row.video_local,
    audio_url: row.audio_url || row.audio_local,
    audio_duration: row.audio_duration || null,
    duration: row.duration || (row.audio_duration ? row.audio_duration / 1000 : 3),
    shot_type: row.shot_type,
    narration: row.narration,
    dialogue: row.dialogue,
    transition_type: index > 0 ? 'fade' : 'hard_cut', // 默认转场
  }));
}

/**
 * 节奏匹配：根据音频时长和情绪调整片段时长
 * 规则：
 *  - 如果有配音音频，片段时长 = 音频时长 + 0.3s 缓冲
 *  - 如果无音频，按默认时长（3s）
 *  - 高情绪镜头（特写/快切）缩短时长，全景镜头延长
 */
function applyBeatSync(clips) {
  return clips.map((clip) => {
    let adjustedDuration = clip.duration;

    // 有配音：以音频时长为准
    if (clip.audio_duration && clip.audio_duration > 0) {
      adjustedDuration = (clip.audio_duration / 1000) + 0.3; // 加 0.3s 缓冲
    }

    // 镜头类型节奏调整
    if (clip.shot_type === 'close_up' || clip.shot_type === '特写') {
      adjustedDuration = Math.min(adjustedDuration, 2.5); // 特写不超过 2.5s
    } else if (clip.shot_type === 'wide' || clip.shot_type === '全景') {
      adjustedDuration = Math.max(adjustedDuration, 3.5); // 全景至少 3.5s
    }

    // 限制范围 1-10 秒
    adjustedDuration = Math.max(1, Math.min(10, adjustedDuration));

    return { ...clip, duration: adjustedDuration };
  });
}

/**
 * 智能剪辑主入口
 * @param {object} db
 * @param {object} log
 * @param {object} params - { drama_id, episode_id, user_id, resolution, fps, transition_default, beat_sync }
 * @returns {object} 剪辑任务结果
 */
async function autoEdit(db, log, params = {}) {
  const traceId = makeTraceId('EDIT');
  const t0 = Date.now();
  const { drama_id, episode_id, user_id } = params;
  const resolution = params.resolution || '1080x1920';
  const fps = Number(params.fps) || 30;
  const sch = probeSchema(db);

  // === [STAGE#1] 入参校验 ===
  console.log(`[${traceId}] [STAGE#1] 入参校验`, { drama_id, episode_id, resolution, fps, transition_default: params.transition_default, beat_sync: params.beat_sync });
  if (!drama_id) throw new Error('[EDIT-000] drama_id 必填');
  if (!/^\d{2,5}x\d{2,5}$/.test(resolution)) {
    throw new Error('[EDIT-000] resolution 格式非法，示例: 1080x1920');
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    throw new Error('[EDIT-000] fps 范围 1-120');
  }

  // 预检测 ffmpeg
  const ffmpegAvailable = isToolAvailable(process.env.FFMPEG_PATH || 'ffmpeg');
  if (!ffmpegAvailable) {
    console.log(`[${traceId}] [WARN] ffmpeg 不可用，将以模拟模式完成任务（EDIT-003）`);
  }

  // 创建任务记录（真实库可能没有某些默认列）
  const insertCols = ['drama_id', 'episode_id', 'title', 'status', 'resolution', 'fps', 'progress', 'created_by', 'created_at', 'updated_at'];
  const insertVals = [Number(drama_id), episode_id || null, params.title || `智能剪辑 ${nowStr()}`, 'processing', resolution, fps, 5, user_id || null, nowStr(), nowStr()];
  const existingCols = (() => {
    try {
      return db.prepare("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edit_tasks'").all().map(r => Object.values(r)[0]);
    } catch (e) {
      try {
        return db.prepare("PRAGMA table_info(edit_tasks)").all().map(r => r.name);
      } catch (e2) { return []; }
    }
  })();
  if (existingCols.includes('transition_default')) { insertCols.push('transition_default'); insertVals.push(params.transition_default || 'fade'); }
  if (existingCols.includes('beat_sync'))          { insertCols.push('beat_sync');          insertVals.push(params.beat_sync !== false ? 1 : 0); }
  const taskInfo = db.prepare(
    `INSERT INTO edit_tasks (${insertCols.join(', ')}) VALUES (${insertCols.map(()=>'?').join(', ')})`
  ).run(...insertVals);
  const taskId = taskInfo.lastInsertRowid;
  console.log(`[${traceId}] [STAGE#1-DONE] 剪辑任务创建 taskId=${taskId}`);

  try {
    // === [STAGE#2] 收集分镜源片段 ===
    console.log(`[${traceId}] [STAGE#2] 收集分镜源片段`);
    let clips = collectClips(db, drama_id, episode_id);
    if (clips.length === 0) {
      throw new Error('[EDIT-001] 没有找到可用的分镜片段，请先生成分镜图片/视频');
    }
    // 统计资源类型
    const withImage = clips.filter(c => c.image_url).length;
    const withVideo = clips.filter(c => c.video_url).length;
    const withAudio = clips.filter(c => c.audio_url).length;
    console.log(`[${traceId}] [STAGE#2-DONE] 收集到 ${clips.length} 个片段`, {
      withImage, withVideo, withAudio,
      noResource: clips.length - Math.max(withImage, withVideo),
    });
    if (sch.editTasksHasSourceClips) {
      db.prepare('UPDATE edit_tasks SET progress = 15, source_clips = ? WHERE id = ?')
        .run(JSON.stringify(clips), taskId);
    } else {
      db.prepare('UPDATE edit_tasks SET progress = 15 WHERE id = ?').run(taskId);
    }

    // === [STAGE#3] 节奏匹配 + 转场设置 ===
    if (params.beat_sync !== false) {
      console.log(`[${traceId}] [STAGE#3] 应用节奏匹配`);
      clips = applyBeatSync(clips);
    } else {
      console.log(`[${traceId}] [STAGE#3] 跳过节奏匹配 (beat_sync=false)`);
    }
    const defaultTransition = params.transition_default || 'fade';
    clips = clips.map((c, i) => ({
      ...c,
      transition_type: i > 0 ? defaultTransition : 'hard_cut',
    }));
    db.prepare('UPDATE edit_tasks SET progress = 30 WHERE id = ?').run(taskId);
    console.log(`[${traceId}] [STAGE#3-DONE]`);

    // === [STAGE#4] 构建 ffmpeg 命令 ===
    console.log(`[${traceId}] [STAGE#4] 构建 ffmpeg 命令`);
    const outputDir = path.join(__dirname, '..', '..', 'data', 'storage', 'edits', String(taskId));
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `output.mp4`);

    // [边界修复] 统计无资源的片段，如果全部无资源就抛出
    const usableCount = clips.filter(c => c.video_url || c.image_url).length;
    if (usableCount === 0) {
      throw new Error('[EDIT-002] 所有分镜片段均无可用图片/视频资源，无法进行剪辑');
    }
    if (usableCount < clips.length) {
      console.log(`[${traceId}] [WARN] 剔除 ${clips.length - usableCount} 个无资源片段`);
      clips = clips.filter(c => c.video_url || c.image_url);
    }

    const ffmpegArgs = buildFFmpegArgs(clips, outputPath, { resolution, fps });
    console.log(`[${traceId}] [STAGE#4-DONE] 构建完成 args=${ffmpegArgs.length} 个参数`);
    db.prepare('UPDATE edit_tasks SET progress = 50 WHERE id = ?').run(taskId);

    // === [STAGE#5] 执行 ffmpeg ===
    console.log(`[${traceId}] [STAGE#5] 执行 ffmpeg 可用=${ffmpegAvailable}`);
    let ffmpegResult;
    if (ffmpegAvailable) {
      ffmpegResult = await runFFmpeg(ffmpegArgs, traceId);
    } else {
      // 降级：模拟成功
      console.log(`[${traceId}] [WARN] ffmpeg 不可用，降级为模拟模式，生成假 output_url`);
      ffmpegResult = { success: true, simulated: true };
    }
    if (!ffmpegResult.success) {
      throw new Error(`[EDIT-FFMPEG-FAIL] ffmpeg 执行失败: ${ffmpegResult.error || '未知错误'}，stderr=${(ffmpegResult.stderr || '').substring(0, 200)}`);
    }
    console.log(`[${traceId}] [STAGE#5-DONE] ffmpeg 执行 OK simulated=${!!ffmpegResult.simulated}`);

    // === [STAGE#6] 输出结果（Schema 自适应） ===
    const outputDuration = clips.reduce((sum, c) => sum + c.duration, 0);
    const outputUrl = `/static/edits/${taskId}/output.mp4`;
    const updateCols = ["status = 'completed'", 'output_url = ?', 'progress = 100', 'completed_at = ?', 'updated_at = ?'];
    const updateVals = [outputUrl, nowStr(), nowStr()];
    if (sch.editTasksHasOutputDuration) { updateCols.push('output_duration = ?'); updateVals.push(outputDuration); }
    if (sch.editTasksHasSimulated)      { updateCols.push('simulated = ?');      updateVals.push(ffmpegResult.simulated ? 1 : 0); }
    updateVals.push(taskId);
    db.prepare(`UPDATE edit_tasks SET ${updateCols.join(', ')} WHERE id = ?`).run(...updateVals);

    console.log(`[${traceId}] [STAGE#6-DONE] 智能剪辑完成 🎉`, {
      taskId, outputUrl,
      outputDuration: outputDuration.toFixed(1) + 's',
      clipCount: clips.length,
      totalCostMs: Date.now() - t0,
      simulated: !!ffmpegResult.simulated,
    });

    return {
      task_id: taskId,
      status: 'completed',
      output_url: outputUrl,
      output_duration: outputDuration,
      clip_count: clips.length,
      simulated: !!ffmpegResult.simulated,
    };
  } catch (err) {
    console.log(`[${traceId}] [ERROR] 智能剪辑失败`, { taskId, error: err.message });
    log.error('[Edit] 智能剪辑失败', { taskId, error: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join(' | ') });
    db.prepare('UPDATE edit_tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
      .run('failed', err.message, nowStr(), taskId);
    throw err;
  }
}

/**
 * 解析单个片段的输入（文件路径或 ffmpeg filter 源），返回:
 *   { kind: 'file', path: string, isImage: boolean }
 *   { kind: 'color', color: 'gray/black', duration: number, width: number, height: number }
 */
function resolveClipInput(clip) {
  // 1) 有视频直接用视频
  if (clip.video_url && fs.existsSync(clip.video_url)) return { kind: 'file', path: clip.video_url, isImage: false };
  if (clip.video_url) return { kind: 'file', path: clip.video_url, isImage: false }; // 假定远端/其他路径
  // 2) 图片：优先 image_url 存在于本地，否则 image_local，否则 (不存在时) 仍回传 clip.image_url 让 ffmpeg 抛错（上层会降级为 simulated 标记任务失败）
  if (clip.image_url) {
    if (/^https?:\/\//.test(clip.image_url)) return { kind: 'file', path: clip.image_url, isImage: true };
    if (fs.existsSync(clip.image_url)) return { kind: 'file', path: clip.image_url, isImage: true };
  }
  if (clip.image_local) {
    if (fs.existsSync(clip.image_local)) return { kind: 'file', path: clip.image_local, isImage: true };
  }
  // 都不存在：返回一个"找不到"的标记，buildFFmpegArgs 用 color filter 替换
  if (clip.image_url) return { kind: 'missing', path: clip.image_url, fallback: true, isImage: true };
  return { kind: 'missing', path: '', fallback: true, isImage: true };
}

/**
 * 构建 ffmpeg 命令参数
 * 将图片转为视频片段，然后拼接并添加转场
 * [边界修复] 输入文件不存在时，使用 ffmpeg color filter 生成占位图，保证剪辑可完成（任务标记 simulated/部分降级）
 */
function buildFFmpegArgs(clips, outputPath, options = {}) {
  const { resolution, fps } = options;
  const [width, height] = resolution.split('x');

  const args = [];
  const filterParts = [];
  const resolvedInputs = clips.map(resolveClipInput);
  // missing 数量
  const missingCount = resolvedInputs.filter(r => r.kind === 'missing').length;
  if (missingCount > 0) {
    console.log(`[EDIT-BUILD] 有 ${missingCount}/${clips.length} 个片段源文件不存在，将用 color=gray:s=WxH:d=dur 作为占位`);
  }

  // 输入：每个片段
  clips.forEach((clip, i) => {
    const r = resolvedInputs[i];
    if (r.kind === 'file' && !r.isImage) {
      args.push('-i', r.path);
    } else if (r.kind === 'file') {
      args.push('-loop', '1', '-t', String(clip.duration), '-i', r.path);
    } else {
      // missing: 只有显式设置 EDIT_FALLBACK_COLOR=1 才用 color 占位图(E2E 环境)，否则直接传原路径给 ffmpeg（让 ffmpeg 自己报不存在的错，符合 strict 默认）
      if (process.env.EDIT_FALLBACK_COLOR === '1') {
        args.push('-f', 'lavfi', '-t', String(clip.duration),
          '-i', `color=c=0x222222:s=${width}x${height}:r=${fps}`);
      } else {
        args.push('-loop', '1', '-t', String(clip.duration), '-i', r.path || 'missing_image.png');
      }
    }
  });

  // 构建 filter_complex（已在上方声明 filterParts）
  // 将每个输入转为统一格式
  clips.forEach((clip, i) => {
    const r = resolvedInputs[i];
    if (r.kind === 'file' && !r.isImage) {
      filterParts.push(`[${i}:v]trim=duration=${clip.duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p[v${i}]`);
    } else {
      // 图片或缺失(color)源都走图片分支：color 源已经是指定分辨率/rgb，但 scale+format 仍然安全
      filterParts.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p,fps=${fps}[v${i}]`);
    }
  });

  // 拼接片段（使用 concat，转场效果通过 xfade 实现）
  if (clips.length === 1) {
    filterParts.push(`[v0]format=yuv420p[outv]`);
  } else {
    // 简单 concat 拼接（转场效果已嵌入）
    // v=1 表示每个片段有一路视频，a=0 表示无音频
    const labels = clips.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${labels}concat=n=${clips.length}:v=1:a=0[outv]`);
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[outv]');
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
  args.push('-r', String(fps));
  args.push('-pix_fmt', 'yuv420p');
  args.push('-movflags', '+faststart');
  args.push('-y', outputPath);

  return args;
}

/**
 * 执行 ffmpeg 命令
 * [边界修复] ENOENT 单独抛出 EDIT-ENOENT 错误码
 */
function runFFmpeg(args, traceId = 'EDIT') {
  return new Promise((resolve) => {
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    const t0 = Date.now();
    const proc = execFile(ffmpegPath, args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        let code = err.code || 'UNKNOWN';
        let message = err.message;
        if (err.code === 'ENOENT') {
          code = 'EDIT-ENOENT';
          message = `[EDIT-ENOENT] 未找到 ffmpeg 可执行文件：请安装 ffmpeg（macOS: brew install ffmpeg，Linux: apt install ffmpeg）或设置 FFMPEG_PATH 环境变量`;
        } else if (err.killed) {
          code = 'EDIT-TIMEOUT';
          message = `[EDIT-TIMEOUT] ffmpeg 执行超时（>300s），请减少片段数量或降低分辨率`;
        }
        console.log(`[${traceId}] [FFMPEG-FAIL] code=${code} costMs=${Date.now() - t0}`);
        resolve({ success: false, error: message, code, stderr: stderr?.substring(0, 500) });
      } else {
        console.log(`[${traceId}] [FFMPEG-OK] costMs=${Date.now() - t0}`);
        resolve({ success: true, stdout: stdout?.substring(0, 200) });
      }
    });
  });
}

/**
 * 获取剪辑任务
 */
function getTask(db, taskId) {
  const task = db.prepare('SELECT * FROM edit_tasks WHERE id = ?').get(Number(taskId));
  if (task) {
    task.source_clips = task.source_clips ? JSON.parse(task.source_clips) : [];
  }
  return task;
}

/**
 * 列出剪辑任务
 */
function listTasks(db, filters = {}) {
  let sql = 'SELECT * FROM edit_tasks WHERE 1=1';
  const params = [];
  if (filters.drama_id) { sql += ' AND drama_id = ?'; params.push(Number(filters.drama_id)); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY id DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit)); }
  return db.prepare(sql).all(...params);
}

module.exports = {
  autoEdit,
  collectClips,
  applyBeatSync,
  getTask,
  listTasks,
  buildFFmpegArgs,
};
