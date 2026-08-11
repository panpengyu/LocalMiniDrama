'use strict';

/**
 * bgmService.js
 * Sprint 8 - S8-T04: BGM生成接口
 *
 * 职责：
 *  1) 根据场景氛围生成BGM（集成AI音乐生成API）
 *  2) BGM曲目CRUD管理
 *  3) 根据分镜/分集情绪自动匹配BGM
 *
 * 日志：每个操作生成 traceId（BGM#xxx），分阶段打印
 */

const VALID_MOODS = ['neutral', 'happy', 'sad', 'tense', 'epic', 'romantic', 'mysterious', 'energetic', 'calm', 'dark'];
const VALID_GENRES = ['orchestral', 'electronic', 'ambient', 'rock', 'pop', 'jazz', 'folk'];

const MOOD_TO_PROMPT = {
  neutral: 'neutral background music, ambient, soft and unobtrusive',
  happy: 'upbeat cheerful music, bright melody, joyful and optimistic',
  sad: 'melancholic music, slow tempo, emotional and touching, minor key',
  tense: 'suspenseful music, building tension, dark and thrilling',
  epic: 'epic orchestral music, grand and powerful, cinematic, soaring',
  romantic: 'romantic music, gentle and warm, love theme, soft strings',
  mysterious: 'mysterious music, enigmatic atmosphere, ambient and intriguing',
  energetic: 'high energy music, fast tempo, driving rhythm, exciting',
  calm: 'calm peaceful music, serene and relaxing, gentle and soothing',
  dark: 'dark ominous music, heavy and foreboding, sinister atmosphere',
};

const MOOD_TO_BPM = {
  neutral: 90, happy: 120, sad: 60, tense: 140, epic: 100,
  romantic: 70, mysterious: 80, energetic: 150, calm: 50, dark: 75,
};

const MOOD_TO_INSTRUMENTS = {
  neutral: ['piano', 'strings'],
  happy: ['piano', 'guitar', 'drums'],
  sad: ['piano', 'cello', 'strings'],
  tense: ['strings', 'percussion', 'brass'],
  epic: ['orchestra', 'brass', 'timpani', 'choir'],
  romantic: ['piano', 'violin', 'strings'],
  mysterious: ['synth', 'piano', 'ambient pads'],
  energetic: ['electric guitar', 'drums', 'bass', 'synth'],
  calm: ['piano', 'flute', 'ambient pads'],
  dark: ['cello', 'bass', 'percussion', 'choir'],
};

let _idCounter = 0;
function makeTraceId() {
  _idCounter += 1;
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BGM-${ts}${rand}${_idCounter}`;
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function safeParseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return fallback; }
}

/* =========================================================================
 * P0-R6 修复: BGM异步生成并发限流 (防止无界setImmediate打满DB连接池)
 *   使用 "本地异步Semaphore队列" 实现，不依赖Redis/Bull，保证：
 *   - 开发态/无Redis环境下也可稳定限流
 *   - 并发数默认4，可从 config.queue.bgm_concurrency 配置
 *   - 超过并发上限的任务会排队(FIFO)等待，绝不同时跑N个processBgmGeneration
 *   - 回滚成本极低：把 queue.add(...) 改回 setImmediate(...) 一行即可
 * ========================================================================= */
const BgmAsyncQueue = (() => {
  // 允许通过环境变量或配置覆盖，但此处硬编码默认4（在本模块内读config有循环加载风险时安全）
  const CONCURRENCY = 4;
  let _running = 0;
  const _queue = []; // Array<{fn, resolve, reject}>
  let _submitted = 0;
  let _completed = 0;

  function _runNext() {
    while (_running < CONCURRENCY && _queue.length > 0) {
      const task = _queue.shift();
      _running++;
      Promise.resolve()
        .then(() => task.fn())
        .then((r) => task.resolve(r))
        .catch((e) => task.reject(e))
        .finally(() => {
          _running--;
          _completed++;
          // 允许微任务队列清空后再调度下一个，避免长同步链阻塞事件循环
          Promise.resolve().then(_runNext);
        });
    }
  }

  return {
    get CONCURRENCY() { return CONCURRENCY; },
    get stats() {
      return { concurrency: CONCURRENCY, running: _running, queued: _queue.length, submitted: _submitted, completed: _completed };
    },
    /**
     * @param {() => Promise<any>} fn 实际任务
     * @returns {Promise<any>} 任务结果
     */
    add(fn) {
      _submitted++;
      return new Promise((resolve, reject) => {
        _queue.push({ fn, resolve, reject });
        Promise.resolve().then(_runNext);
      });
    },
    /** 仅用于测试，等待全部清空 */
    _drain() {
      const check = () => new Promise(res => {
        if (_running === 0 && _queue.length === 0) return res();
        setTimeout(() => check().then(res), 20);
      });
      return check();
    },
  };
})();

/**
 * 构建 BGM 生成提示词
 */
function buildBgmPrompt(mood, options = {}) {
  const traceId = makeTraceId();
  const t0 = Date.now();
  const effectiveMood = VALID_MOODS.includes(mood) ? mood : 'neutral';
  const moodFallback = !VALID_MOODS.includes(mood) && mood ? true : false;
  const moodPrompt = MOOD_TO_PROMPT[effectiveMood];

  console.log(`[${traceId}] [BGM-PROMPT#1] 提示词构建入口`, {
    traceId,
    input_mood: mood,
    effective_mood: effectiveMood,
    mood_fallback_applied: moodFallback,
    options_keys: Object.keys(options),
    genre_input: options.genre ?? null,
    tempo_input: options.tempo_bpm ?? null,
    duration_input: options.duration_sec ?? null,
    instruments_count: Array.isArray(options.instruments) ? options.instruments.length : 0,
    has_custom_prompt: !!options.custom_prompt,
  });

  const parts = [moodPrompt];
  const stages = ['mood_base'];

  if (options.genre) {
    if (VALID_GENRES.includes(options.genre)) {
      parts.push(`${options.genre} style`);
      stages.push('genre');
    } else {
      console.log(`[${traceId}] [BGM-PROMPT#WARN] genre 参数非法，已跳过`, {
        invalid_genre: options.genre,
        allowed: VALID_GENRES.join(', '),
      });
    }
  }
  if (options.tempo_bpm) {
    const bpm = Number(options.tempo_bpm);
    if (!isNaN(bpm) && bpm > 0 && bpm < 300) {
      parts.push(`${bpm} BPM`);
      stages.push('tempo');
    } else {
      console.log(`[${traceId}] [BGM-PROMPT#WARN] tempo_bpm 参数异常，已跳过`, { tempo_bpm: options.tempo_bpm });
    }
  }
  if (options.instruments && Array.isArray(options.instruments) && options.instruments.length > 0) {
    const validInstruments = options.instruments.filter(i => typeof i === 'string' && i.length < 50);
    if (validInstruments.length > 0) {
      parts.push(`instruments: ${validInstruments.join(', ')}`);
      stages.push('instruments');
    }
  }
  if (options.duration_sec) {
    const dur = Number(options.duration_sec);
    if (!isNaN(dur) && dur > 0 && dur < 3600) {
      parts.push(`duration approximately ${dur} seconds`);
      stages.push('duration');
    } else {
      console.log(`[${traceId}] [BGM-PROMPT#WARN] duration_sec 超出合理范围(0-3600s)，已跳过`, { duration_sec: options.duration_sec });
    }
  }
  if (options.custom_prompt) {
    if (typeof options.custom_prompt === 'string' && options.custom_prompt.length < 2000) {
      parts.push(options.custom_prompt);
      stages.push('custom');
    } else {
      console.log(`[${traceId}] [BGM-PROMPT#WARN] custom_prompt 过长或类型错误，已跳过`, {
        type: typeof options.custom_prompt,
        length: typeof options.custom_prompt === 'string' ? options.custom_prompt.length : 'N/A',
      });
    }
  }

  const result = parts.join(', ');
  console.log(`[${traceId}] [BGM-PROMPT#DONE] 提示词构建完成`, {
    traceId,
    stages_applied: stages.join(' -> '),
    parts_count: parts.length,
    prompt_len: result.length,
    result_preview: result.substring(0, 150),
    cost_ms: Date.now() - t0,
  });

  return result;
}

/**
 * 创建BGM生成任务
 */
async function createBgm(db, log, params = {}) {
  const traceId = makeTraceId();
  const t0 = Date.now();
  console.log(`[${traceId}] [CREATE#1] 入参校验与默认值填充`, {
    traceId,
    drama_id_raw: params.drama_id ?? 'MISSING',
    mood_raw: params.mood ?? 'MISSING',
    genre_raw: params.genre ?? null,
    episode_id_raw: params.episode_id ?? null,
    duration_sec_raw: params.duration_sec ?? null,
    tempo_bpm_raw: params.tempo_bpm ?? null,
    custom_prompt_len: typeof params.custom_prompt === 'string' ? params.custom_prompt.length : 0,
    title_provided: !!params.title,
    provider_input: params.provider ?? null,
    model_input: params.model ?? null,
    created_by: params.created_by ?? null,
    skipAsync_flag: params.skipAsync ?? false,
  });

  if (!params.drama_id) {
    console.error(`[${traceId}] [CREATE#FAIL-1] drama_id 缺失`);
    throw new Error('[BGM-001] drama_id 不能为空');
  }
  const mood = params.mood || 'neutral';
  const moodDefaulted = !params.mood;
  if (!VALID_MOODS.includes(mood)) {
    console.error(`[${traceId}] [CREATE#FAIL-2] mood 非法`, {
      invalid_mood: mood,
      allowed: VALID_MOODS.join(', '),
    });
    throw new Error(`[BGM-002] mood 非法（允许值: ${VALID_MOODS.join(', ')}）`);
  }

  const genre = params.genre || null;
  if (genre && !VALID_GENRES.includes(genre)) {
    console.error(`[${traceId}] [CREATE#FAIL-3] genre 非法`, {
      invalid_genre: genre,
      allowed: VALID_GENRES.join(', '),
    });
    throw new Error(`[BGM-003] genre 非法（允许值: ${VALID_GENRES.join(', ')}）`);
  }

  const durationSec = params.duration_sec ? Number(params.duration_sec) : null;
  const defaultTempo = MOOD_TO_BPM[mood] ?? 90;
  const tempoBpm = params.tempo_bpm || defaultTempo;
  const tempoDefaulted = !params.tempo_bpm;
  const defaultInstruments = MOOD_TO_INSTRUMENTS[mood] ?? ['piano', 'strings'];
  const instruments = params.instruments || defaultInstruments;
  const instrumentsDefaulted = !params.instruments;

  console.log(`[${traceId}] [CREATE#2] 参数解析结果`, {
    mood: mood,
    mood_defaulted: moodDefaulted,
    mood_to_bpm_lookup: defaultTempo,
    tempo_bpm: tempoBpm,
    tempo_defaulted: tempoDefaulted,
    genre: genre,
    duration_sec: durationSec,
    instruments_count: instruments.length,
    instruments: instruments,
    instruments_defaulted: instrumentsDefaulted,
  });

  const prompt = buildBgmPrompt(mood, { genre, tempo_bpm: tempoBpm, instruments, duration_sec: durationSec, custom_prompt: params.custom_prompt });

  const title = params.title || `${mood}_bgm_${Date.now()}`;
  const now = nowStr();

  const info = db.prepare(
    `INSERT INTO bgm_tracks
      (drama_id, episode_id, title, mood, genre, duration_sec, audio_url, provider, model, prompt,
       status, progress, tempo_bpm, instruments, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`
  ).run(
    Number(params.drama_id),
    params.episode_id ? Number(params.episode_id) : null,
    title,
    mood,
    genre,
    durationSec,
    params.provider || 'local',
    params.model || null,
    prompt,
    tempoBpm,
    JSON.stringify(instruments),
    params.created_by || null,
    now,
    now
  );

  const bgmId = info.lastInsertRowid;
  console.log(`[${traceId}] [CREATE#DONE] BGM任务创建成功，待异步执行`, {
    traceId,
    bgmId,
    drama_id: Number(params.drama_id),
    episode_id: params.episode_id ? Number(params.episode_id) : null,
    title,
    mood,
    genre,
    duration_sec: durationSec,
    tempo_bpm: tempoBpm,
    prompt_len: prompt.length,
    provider: params.provider || 'local',
    async_triggered: !params.skipAsync,
    cost_ms: Date.now() - t0,
  });

  // P0-R6: 异步生成任务进入并发=4的限流队列，防止无界setImmediate打垮DB连接池
  //        回滚：将下面 BgmAsyncQueue.add(...) 整块替换回 setImmediate(() => processBgmGeneration(db, log, bgmId)) 即可
  if (!params.skipAsync) {
    const qsBefore = BgmAsyncQueue.stats;
    BgmAsyncQueue.add(async () => {
      // BgmAsyncQueue.add 是一个 Promise，这里不会阻塞 createBgm 返回
      // 但实际并发会被限制到 CONCURRENCY(4)
      try {
        await processBgmGeneration(db, log, bgmId);
      } catch (err) {
        // 队列处理器不应抛出异常打断队列（单个任务失败不影响后续）
        console.error(`[BGM-QUEUE-${traceId}] processBgmGeneration 抛错（已隔离，不影响队列其他任务）:`, err.message);
      }
    }).catch(() => { /* BgmAsyncQueue.add 已捕获，此处仅防止 PromiseUnhandledRejection */ });
    const qsAfter = BgmAsyncQueue.stats;
    console.log(`[${traceId}] [CREATE#QUEUE] BGM任务入队限流完成`, {
      bgmId,
      submitted_total: qsAfter.submitted,
      running_now: qsAfter.running,
      queued_waiting: qsAfter.queued,
      concurrency_limit: qsAfter.concurrency,
    });
  } else {
    console.log(`[${traceId}] [CREATE#NOTE] skipAsync=true，跳过异步生成触发（测试模式）`);
  }

  return getBgm(db, bgmId);
}

/**
 * 异步处理 BGM 生成
 * 实际环境中调用 AI 音乐生成 API；开发环境降级为模拟生成
 */
async function processBgmGeneration(db, log, bgmId) {
  const traceId = makeTraceId();
  const t0 = Date.now();

  console.log(`[${traceId}] [GEN#0] 异步生成任务启动`, {
    traceId, bgmId,
    triggered_at: nowStr(),
  });

  const row = db.prepare('SELECT * FROM bgm_tracks WHERE id = ?').get(Number(bgmId));
  if (!row) {
    if (log && log.error) log.error(`[${traceId}] BGM记录不存在`, { bgmId });
    console.error(`[${traceId}] [GEN#FAIL-0] BGM数据库记录不存在`, { bgmId });
    return;
  }

  console.log(`[${traceId}] [GEN#1] 记录读取校验`, {
    bgmId,
    db_status: row.status,
    mood: row.mood,
    genre: row.genre,
    title: row.title,
    tempo_bpm: row.tempo_bpm,
    instruments: row.instruments,
    provider: row.provider,
    model: row.model,
    prompt_len: (row.prompt || '').length,
    prompt_preview: (row.prompt || '').substring(0, 100),
  });

  if (row.status !== 'pending') {
    if (log && log.info) log.info(`[${traceId}] BGM已被处理，跳过`, { bgmId, status: row.status });
    console.log(`[${traceId}] [GEN#SKIP] 状态非 pending，跳过生成`, {
      bgmId, current_status: row.status,
    });
    return;
  }

  // 更新为处理中
  const tStart = Date.now();
  db.prepare("UPDATE bgm_tracks SET status = 'processing', progress = 10, updated_at = ? WHERE id = ?")
    .run(nowStr(), Number(bgmId));
  console.log(`[${traceId}] [GEN#2] 开始生成BGM（模拟模式）`, {
    bgmId,
    mood: row.mood,
    prompt_preview: (row.prompt || '').substring(0, 80),
    stage_1_enter_ms: Date.now() - tStart,
  });

  try {
    // 模拟生成进度（实际环境调用外部 API）
    const progressStages = [
      { p: 30, label: '情绪解析 → 旋律骨架生成' },
      { p: 50, label: '和声编排 → 配器构建' },
      { p: 70, label: '音色采样 → 混音合成' },
      { p: 90, label: '母带处理 → 输出编码' },
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, 200));
      db.prepare('UPDATE bgm_tracks SET progress = ?, updated_at = ? WHERE id = ?')
        .run(stage.p, nowStr(), Number(bgmId));
      console.log(`[${traceId}] [GEN#2-PROGRESS] ${stage.p}%`, {
        bgmId,
        stage_label: stage.label,
        elapsed_from_start_ms: Date.now() - tStart,
      });
    }

    // 生成完成：写入模拟音频URL（实际环境写入API返回的音频地址）
    const audioUrl = `/static/bgm/bgm_${bgmId}_${row.mood}.mp3`;
    const durationSec = row.duration_sec || 30;

    db.prepare(
      "UPDATE bgm_tracks SET status = 'completed', progress = 100, audio_url = ?, duration_sec = ?, updated_at = ? WHERE id = ?"
    ).run(audioUrl, durationSec, nowStr(), Number(bgmId));

    const totalCost = Date.now() - t0;
    console.log(`[${traceId}] [GEN#DONE] BGM生成完成 ✓`, {
      traceId,
      bgmId,
      final_status: 'completed',
      audio_url: audioUrl,
      duration_sec: durationSec,
      mood: row.mood,
      tempo_bpm: row.tempo_bpm,
      total_cost_ms: totalCost,
      simulated_wait_count: progressStages.length,
      simulated_wait_ms: progressStages.length * 200,
      db_overhead_ms: totalCost - progressStages.length * 200,
    });
  } catch (err) {
    db.prepare(
      "UPDATE bgm_tracks SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
    ).run(err.message, nowStr(), Number(bgmId));
    if (log && log.error) log.error(`[${traceId}] [GEN#FAIL] BGM生成失败`, { bgmId, error: err.message });
    console.error(`[${traceId}] [GEN#FAIL] BGM生成异常`, {
      bgmId,
      error_message: err.message,
      error_stack: (err.stack || '').substring(0, 300),
      cost_ms_before_fail: Date.now() - t0,
    });
  }
}

/**
 * 获取 BGM 曲目详情
 */
function getBgm(db, bgmId) {
  const row = db.prepare('SELECT * FROM bgm_tracks WHERE id = ?').get(Number(bgmId));
  if (!row) return null;
  return rowToBgm(row);
}

/**
 * 列出 BGM 曲目
 */
function listBgm(db, filters = {}) {
  const traceId = makeTraceId();
  let sql = 'SELECT * FROM bgm_tracks WHERE 1=1';
  const params = [];

  const filterApplied = [];
  if (filters.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(Number(filters.drama_id));
    filterApplied.push(`drama_id=${filters.drama_id}`);
  }
  if (filters.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(Number(filters.episode_id));
    filterApplied.push(`episode_id=${filters.episode_id}`);
  }
  if (filters.mood) {
    sql += ' AND mood = ?';
    params.push(filters.mood);
    filterApplied.push(`mood=${filters.mood}`);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
    filterApplied.push(`status=${filters.status}`);
  }

  sql += ' ORDER BY id DESC';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Number(filters.limit));
    filterApplied.push(`limit=${filters.limit}`);
  }

  const rows = db.prepare(sql).all(...params);
  const result = rows.map(rowToBgm);

  if (filterApplied.length > 0) {
    console.log(`[${traceId}] [LIST] BGM列表查询`, {
      filters: filterApplied.join(' | '),
      row_count: result.length,
    });
  }

  return result;
}

/**
 * 根据分集情绪自动匹配BGM
 * 三级降级策略：同分集同情绪 → 同项目同情绪 → 同项目任意BGM
 */
function matchBgmByMood(db, dramaId, episodeId, mood) {
  const traceId = makeTraceId();
  const t0 = Date.now();
  const inputMood = mood;
  const fallbackApplied = !VALID_MOODS.includes(mood) && mood;
  const effectiveMood = VALID_MOODS.includes(mood) ? mood : 'neutral';

  console.log(`[${traceId}] [MATCH#1] 情绪匹配入口`, {
    traceId,
    dramaId,
    episodeId,
    input_mood: inputMood ?? 'MISSING',
    effective_mood: effectiveMood,
    mood_fallback: fallbackApplied,
    strategy_chain: '同分集+同情绪 → 同项目+同情绪 → 同项目任意',
  });

  // L1: 优先查找同分集同情绪的BGM
  let l1 = listBgm(db, { drama_id: dramaId, episode_id: episodeId, mood: effectiveMood, status: 'completed' });
  if (l1.length > 0) {
    console.log(`[${traceId}] [MATCH#L1-HIT] 同分集同情绪命中`, {
      level: 'L1',
      matched_count: l1.length,
      bgm_id: l1[0].id,
      bgm_title: l1[0].title,
      mood: l1[0].mood,
      duration: l1[0].duration_sec,
      cost_ms: Date.now() - t0,
    });
    return l1[0];
  }
  console.log(`[${traceId}] [MATCH#L1-MISS] 同分集同情绪无结果，继续L2`, { episodeId, mood: effectiveMood });

  // L2: 其次查找同项目同情绪的BGM
  let l2 = listBgm(db, { drama_id: dramaId, mood: effectiveMood, status: 'completed' });
  if (l2.length > 0) {
    console.log(`[${traceId}] [MATCH#L2-HIT] 同项目同情绪命中`, {
      level: 'L2',
      matched_count: l2.length,
      bgm_id: l2[0].id,
      bgm_title: l2[0].title,
      mood: l2[0].mood,
      episode_of_bgm: l2[0].episode_id ?? '(项目级)',
      cost_ms: Date.now() - t0,
    });
    return l2[0];
  }
  console.log(`[${traceId}] [MATCH#L2-MISS] 同项目同情绪无结果，继续L3`, { dramaId, mood: effectiveMood });

  // L3: 最后查找同项目的任意BGM
  let l3 = listBgm(db, { drama_id: dramaId, status: 'completed' });
  if (l3.length > 0) {
    console.log(`[${traceId}] [MATCH#L3-HIT] 同项目任意BGM命中（最终降级）`, {
      level: 'L3',
      matched_count: l3.length,
      bgm_id: l3[0].id,
      bgm_title: l3[0].title,
      actual_mood: l3[0].mood,
      requested_mood: effectiveMood,
      note: '情绪不完全匹配，建议为该情绪新建BGM',
      cost_ms: Date.now() - t0,
    });
    return l3[0];
  }

  console.log(`[${traceId}] [MATCH#ALL-MISS] 三级匹配全部失败`, {
    traceId,
    dramaId,
    episodeId,
    requested_mood: effectiveMood,
    suggestion: '项目无任何已完成BGM，建议先生成',
    cost_ms: Date.now() - t0,
  });
  return null;
}

/**
 * 删除 BGM 曲目
 */
function deleteBgm(db, bgmId) {
  const result = db.prepare('DELETE FROM bgm_tracks WHERE id = ?').run(Number(bgmId));
  return result.changes > 0;
}

function rowToBgm(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    title: row.title,
    mood: row.mood,
    genre: row.genre,
    duration_sec: row.duration_sec,
    audio_url: row.audio_url,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    progress: row.progress,
    error_message: row.error_message,
    tempo_bpm: row.tempo_bpm,
    instruments: safeParseJSON(row.instruments, []),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  VALID_MOODS,
  VALID_GENRES,
  MOOD_TO_PROMPT,
  MOOD_TO_BPM,
  MOOD_TO_INSTRUMENTS,
  buildBgmPrompt,
  createBgm,
  processBgmGeneration,
  getBgm,
  listBgm,
  matchBgmByMood,
  deleteBgm,
  // P0-R6: 暴露BGM限流队列状态（测试/监控用）—— 生产环境监控面板可轮询 _bgmQueueStats()
  _bgmQueueStats: () => ({ ...BgmAsyncQueue.stats }),
  _bgmQueueDrain: () => BgmAsyncQueue._drain(),
  _BgmAsyncQueue: BgmAsyncQueue,
};
