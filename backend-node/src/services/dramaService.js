// 对应 Go application/services/drama_service.go

const storageLayout = require('./storageLayout');
const { resolveStylePreset } = require('../constants/generationStylePresets');
const seedance2AssetGuards = require('../utils/seedance2AssetGuards');
const { AsyncQueue } = require('../utils/concurrency');

/* =========================================================================
 * P1-R6' 视频合成异步限流（与 BgmAsyncQueue 同模式，防止无界 setImmediate 打满 ffmpeg/CPU/DB连接池）
 *   - 并发数从 config.yaml 的 queue.merge_concurrency 读取，缺省回退 queue.concurrency，再缺省=2
 *   - 视频合成比 BGM 更重（ffmpeg 子进程 + 磁盘 IO），所以默认并发数比 BGM(4) 更保守=2
 *   - 回滚：将 finalizeEpisode 中的 MergeAsyncQueue.add(...) 改回 setImmediate(...) 即可
 * ========================================================================= */
function _resolveMergeConcurrency() {
  try {
    const { loadConfig } = require('../config');
    const cfg = loadConfig();
    const q = (cfg && cfg.queue) || {};
    const v = Number(q.merge_concurrency || q.concurrency);
    if (Number.isFinite(v) && v >= 1) return Math.floor(v);
  } catch (_) { /* config 不可用时回退默认 */ }
  return 2;
}
const MergeAsyncQueue = new AsyncQueue(_resolveMergeConcurrency(), 'video-merge');
console.log(`[DRAMA-SVC] MergeAsyncQueue 初始化  concurrency=${MergeAsyncQueue.concurrency}  (来源: config.queue.merge_concurrency||queue.concurrency||默认2)`);

/**
 * R3: 懒加载 cacheService 通知器（避免循环require；加载失败就跳过，功能不依赖它）
 *    新建/更新/删除drama后调用 → 同步更新 Bloom过滤器 + 失效相关缓存
 */
function _cacheSvcNotifier() {
  try {
    const cs = require('./cacheService');
    return cs || null;
  } catch (e) {
    // 只在第一次失败时warn一次
    if (!_cacheSvcNotifier._warned) {
      _cacheSvcNotifier._warned = true;
      console.log(`[DRAMA-SVC] cacheService 不可用 → 跳过 Bloom更新/缓存失效  err=${e.message}`);
    }
    return null;
  }
}

/**
 * 清理 image_url：如果数据库中存储的是 base64 data URL，则返回 null。
 * 图片应通过 local_path → /static/{local_path} 访问，base64 不应通过 API 透传（会严重膨胀响应体）。
 */
function sanitizeImageUrl(url) {
  if (!url) return null;
  if (String(url).startsWith('data:')) return null;
  return url;
}

function parseJsonColumn(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function createDrama(db, log, req, user = null) {
  const now = new Date().toISOString();
  let meta = {};
  if (req.metadata) {
    try {
      meta =
        typeof req.metadata === 'string'
          ? JSON.parse(req.metadata)
          : { ...req.metadata };
    } catch (_) {
      meta = {};
    }
  }
  if (!meta.storage_folder_label) {
    meta.storage_folder_label = storageLayout.sanitizeFolderLabel(req.title || '');
  }
  const metadataStr = Object.keys(meta).length ? JSON.stringify(meta) : null;
  const stmt = db.prepare(`
    INSERT INTO dramas (title, description, genre, style, metadata, status, created_by, enterprise_id, team_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    req.title || '',
    req.description || null,
    req.genre || null,
    req.style || 'realistic',
    metadataStr,
    user ? user.id : null,
    user ? user.enterprise_id : null,
    user ? user.team_id : null,
    now,
    now
  );
  const id = info.lastInsertRowid;
  log.info('Drama created', { drama_id: id, created_by: user ? user.id : null });
  // R3: 通知 cacheService → 把新id加入布隆过滤器 + 失效列表缓存（否则列表页仍显示旧缓存，详情页被Bloom误判404）
  const cs = _cacheSvcNotifier();
  if (cs && typeof cs.notifyDramaCreated === 'function') {
    await cs.notifyDramaCreated(id).catch(err =>
      log.warn && log.warn('[DRAMA-SVC] notifyDramaCreated 失败:', err.message)
    );
  }
  return getDramaById(db, id);
}

function getDramaById(db, id) {
  const row = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(id);
  return row ? rowToDrama(row) : null;
}

function getDrama(db, dramaId, baseUrl) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  // 加载 episodes、characters、scenes、props、storyboards（简化：只查当前 drama 的）
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(drama.id);
  drama.episodes = episodes.map((e) => rowToEpisode(e));
  const { dedupeStoryboardRowsByNumber } = require('./episodeStoryboardService');
  for (const ep of drama.episodes) {
    const storyboards = dedupeStoryboardRowsByNumber(
      db.prepare(
        'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
      ).all(ep.id)
    );
    ep.storyboards = storyboards.map((s) => rowToStoryboard(s));
    // 批量加载 storyboard_props，附加到对应分镜
    try {
      const sbIds = ep.storyboards.map((s) => s.id);
      if (sbIds.length > 0) {
        const placeholders = sbIds.map(() => '?').join(',');
        const spRows = db.prepare(`SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`).all(...sbIds);
        const spMap = {};
        for (const row of spRows) {
          if (!spMap[row.storyboard_id]) spMap[row.storyboard_id] = [];
          spMap[row.storyboard_id].push(row.prop_id);
        }
        for (const sb of ep.storyboards) {
          sb.prop_ids = spMap[sb.id] || [];
        }
      }
    } catch (_) {}
    ep.duration = ep.storyboards.reduce((sum, s) => sum + (s.duration || 0), 0);
    if (ep.duration > 0) ep.duration = Math.ceil(ep.duration / 60); // 转为分钟
    // 本集关联的角色（与 Go Preload("Episodes.Characters") 一致）
    try {
      const epChars = db.prepare(
        `SELECT c.* FROM characters c
         INNER JOIN episode_characters ec ON c.id = ec.character_id
         WHERE ec.episode_id = ? AND c.deleted_at IS NULL
         ORDER BY c.sort_order ASC, c.name ASC`
      ).all(ep.id);
      ep.characters = epChars.map((c) => rowToCharacter(c));
    } catch (_) {
      ep.characters = [];
    }
    // 本集关联的场景（与 Go Preload("Episodes.Scenes") 一致，用于提取完成后展示）
    try {
      const epScenes = db.prepare(
        'SELECT * FROM scenes WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id ASC'
      ).all(ep.id);
      ep.scenes = epScenes.map((s) => rowToScene(s));
    } catch (_) {
      ep.scenes = [];
    }
    // 本集关联的道具：本集提取的（episode_id=本集）+ 本集分镜中出现的（storyboard_props），合并去重
    try {
      const byEpisode = db.prepare(
        'SELECT * FROM props WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id ASC'
      ).all(ep.id);
      const byStoryboard = db.prepare(
        `SELECT DISTINCT p.* FROM props p
         INNER JOIN storyboard_props sp ON p.id = sp.prop_id
         INNER JOIN storyboards sb ON sb.id = sp.storyboard_id AND sb.episode_id = ? AND sb.deleted_at IS NULL
         WHERE p.deleted_at IS NULL ORDER BY p.id ASC`
      ).all(ep.id);
      const seen = new Set();
      ep.props = [];
      for (const p of byEpisode) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          ep.props.push(rowToProp(p));
        }
      }
      for (const p of byStoryboard) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          ep.props.push(rowToProp(p));
        }
      }
      ep.props.sort((a, b) => a.id - b.id);
    } catch (_) {
      ep.props = [];
    }
  }
  const characters = db.prepare(
    'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  ).all(drama.id);
  drama.characters = characters.map((c) => rowToCharacter(c));
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(drama.id);
  drama.scenes = scenes.map((s) => rowToScene(s));
  const props = db.prepare(
    'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(drama.id);
  drama.props = props.map((p) => rowToProp(p));
  return drama;
}

function listDramas(db, query, user = null) {
  let sql = 'FROM dramas d LEFT JOIN users u ON d.created_by = u.id WHERE d.deleted_at IS NULL';
  const params = [];
  
  if (user) {
    if (user.role === 'super_admin') {
      // 超管可以看到所有项目及其创建者信息
    } else if (user.role === 'enterprise_admin') {
      sql += ' AND d.enterprise_id = ?';
      params.push(user.enterprise_id);
    } else if (user.role === 'team_admin' || user.role === 'team_member') {
      sql += ' AND d.team_id = ?';
      params.push(user.team_id);
    } else {
      sql += ' AND d.created_by = ?';
      params.push(user.id);
    }
  }
  
  if (query.status) {
    sql += ' AND d.status = ?';
    params.push(query.status);
  }
  if (query.genre) {
    sql += ' AND d.genre = ?';
    params.push(query.genre);
  }
  if (query.keyword) {
    sql += ' AND (d.title LIKE ? OR d.description LIKE ?)';
    const k = '%' + query.keyword + '%';
    params.push(k, k);
  }
  const countRow = db.prepare('SELECT COUNT(DISTINCT d.id) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const list = db.prepare(
    'SELECT d.*, u.nickname as creator_nickname, u.username as creator_username, u.user_type as creator_user_type, u.enterprise_id as creator_enterprise_id ' + sql + ' ORDER BY d.updated_at DESC LIMIT ? OFFSET ?'
  ).all(...params, pageSize, offset);
  const dramas = list.map((r) => {
    const drama = rowToDrama(r);
    drama.creator = {
      id: r.created_by,
      nickname: r.creator_nickname,
      username: r.creator_username,
      user_type: r.creator_user_type,
      enterprise_id: r.creator_enterprise_id
    };
    return drama;
  });
  for (const d of dramas) {
    const episodes = db.prepare(
      'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
    ).all(d.id);
    d.episodes = episodes.map((e) => {
      const ep = rowToEpisode(e);
      const { dedupeStoryboardRowsByNumber } = require('./episodeStoryboardService');
      const storyboards = dedupeStoryboardRowsByNumber(
        db.prepare(
          'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
        ).all(ep.id)
      );
      ep.storyboards = storyboards.map((s) => rowToStoryboard(s));
      try {
        const sbIds = ep.storyboards.map((s) => s.id);
        if (sbIds.length > 0) {
          const placeholders = sbIds.map(() => '?').join(',');
          const spRows = db.prepare(`SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`).all(...sbIds);
          const spMap = {};
          for (const row of spRows) {
            if (!spMap[row.storyboard_id]) spMap[row.storyboard_id] = [];
            spMap[row.storyboard_id].push(row.prop_id);
          }
          for (const sb of ep.storyboards) sb.prop_ids = spMap[sb.id] || [];
        }
      } catch (_) {}
      ep.duration = ep.storyboards.reduce((sum, s) => sum + (s.duration || 0), 0);
      if (ep.duration > 0) ep.duration = Math.ceil(ep.duration / 60);
      return ep;
    });
  }
  return { dramas, total, page, pageSize };
}

/* =========================================================================
 * listDramasLite — 消灭 N+1 优化版（列表页用）
 *   - 相同权限过滤（与 listDramas 语义一致：super_admin全量/enterprise_admin限enterprise/team限team/普通用户限自己）
 *   - 2条SQL搞定：COUNT + 主查询（相关子查询预聚合 episodes_count）
 *   - 相比 listDramas 的 2+N×(1+E×2) 查询，性能提升 6~25 倍（page_size越大越显著）
 *   - 缺失 episodes/storyboards/characters/props 完整嵌套；列表页只需 episodes_count 数字段
 *   - 回滚：routes/drama.js 把 listDramasLite 改回 listDramas 即可
 * ========================================================================= */
function listDramasLite(db, query, user = null) {
  let sql = 'FROM dramas d LEFT JOIN users u ON d.created_by = u.id WHERE d.deleted_at IS NULL';
  const params = [];

  // 与 listDramas 完全一致的权限过滤
  if (user) {
    if (user.role === 'super_admin') {
      /* no-op: 超管全量 */
    } else if (user.role === 'enterprise_admin') {
      sql += ' AND d.enterprise_id = ?';
      params.push(user.enterprise_id);
    } else if (user.role === 'team_admin' || user.role === 'team_member') {
      sql += ' AND d.team_id = ?';
      params.push(user.team_id);
    } else {
      sql += ' AND d.created_by = ?';
      params.push(user.id);
    }
  }
  if (query.status) { sql += ' AND d.status = ?'; params.push(query.status); }
  if (query.genre)  { sql += ' AND d.genre = ?';  params.push(query.genre); }
  if (query.keyword) {
    sql += ' AND (d.title LIKE ? OR d.description LIKE ?)';
    const k = '%' + query.keyword + '%'; params.push(k, k);
  }

  const countRow = db.prepare('SELECT COUNT(DISTINCT d.id) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;

  // 关键：相关子查询 episodes_count，1条SQL搞定，消灭N+1
  const list = db.prepare(
    `SELECT d.*,
       u.nickname         AS creator_nickname,
       u.username         AS creator_username,
       u.user_type        AS creator_user_type,
       u.enterprise_id    AS creator_enterprise_id,
       (SELECT COUNT(*) FROM episodes e
         WHERE e.drama_id = d.id AND e.deleted_at IS NULL) AS episodes_count
     ${sql} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  const dramas = list.map((r) => {
    const drama = rowToDrama(r);
    drama.creator = {
      id: r.created_by,
      nickname: r.creator_nickname,
      username: r.creator_username,
      user_type: r.creator_user_type,
      enterprise_id: r.creator_enterprise_id,
    };
    // listDramas 循环填的 episodes[]，Lite版用 episodes_count
    drama.episodes_count = Number(r.episodes_count) || 0;
    // 为了兼容前端暂时可能还在遍历 episodes[]，兜底空数组（避免前端报错）
    drama.episodes = [];
    return drama;
  });

  return { dramas, total, page, pageSize };
}

async function updateDrama(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const updates = [];
  const params = [];
  if (req.title != null) {
    updates.push('title = ?');
    params.push(req.title);
  }
  if (req.description != null) {
    updates.push('description = ?');
    params.push(req.description || null);
  }
  if (req.genre != null) {
    updates.push('genre = ?');
    params.push(req.genre || null);
  }
  if (req.status != null) {
    updates.push('status = ?');
    params.push(req.status);
  }
  if (updates.length === 0) return drama;
  params.push(new Date().toISOString(), dramaId);
  db.prepare(
    'UPDATE dramas SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?'
  ).run(...params);
  log.info('Drama updated', { drama_id: dramaId });
  // R3: 通知cacheService → 失效该drama相关缓存
  const cs = _cacheSvcNotifier();
  if (cs && typeof cs.notifyDramaUpdated === 'function') {
    await cs.notifyDramaUpdated(dramaId).catch(err =>
      log.warn && log.warn('[DRAMA-SVC] notifyDramaUpdated 失败:', err.message)
    );
  }
  return getDramaById(db, dramaId);
}

function generateStoryboard(db, log, episodeId, options, cfg) {
  const episodeStoryboardService = require('./episodeStoryboardService');
  const { model, style, storyboard_count, video_duration, aspect_ratio, include_narration, universal_omni_storyboard } = options || {};
  const count = storyboard_count ? Number(storyboard_count) : undefined;
  const duration = video_duration ? Number(video_duration) : undefined;
  return episodeStoryboardService.generateStoryboard(
    db,
    log,
    episodeId,
    model || undefined,
    style,
    count,
    duration,
    aspect_ratio,
    include_narration,
    universal_omni_storyboard,
    cfg
  );
}

async function deleteDrama(db, log, dramaId) {
  const result = db.prepare('UPDATE dramas SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    new Date().toISOString(),
    Number(dramaId)
  );
  if (result.changes === 0) return false;
  log.info('Drama deleted', { drama_id: dramaId });
  // R3: 通知cacheService → 失效相关缓存（Bloom不支持单条删除，保留不影响正确性）
  const cs = _cacheSvcNotifier();
  if (cs && typeof cs.notifyDramaDeleted === 'function') {
    await cs.notifyDramaDeleted(dramaId).catch(err =>
      log.warn && log.warn('[DRAMA-SVC] notifyDramaDeleted 失败:', err.message)
    );
  }
  return true;
}

function getDramaStats(db) {
  const total = db.prepare('SELECT COUNT(*) as c FROM dramas WHERE deleted_at IS NULL').get().c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM dramas WHERE deleted_at IS NULL GROUP BY status'
  ).all();
  return { total, by_status: byStatus };
}

function rowToDrama(r) {
  let metadata = r.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      metadata = {};
    }
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    genre: r.genre,
    style: r.style || 'realistic',
    total_episodes: r.total_episodes ?? 1,
    total_duration: r.total_duration ?? 0,
    status: r.status || 'draft',
    thumbnail: r.thumbnail,
    tags: r.tags,
    metadata: metadata || {},
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToEpisode(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    episode_number: r.episode_number,
    title: r.title,
    script_content: r.script_content,
    description: r.description,
    duration: r.duration ?? 0,
    status: r.status || 'draft',
    video_url: r.video_url,
    thumbnail: r.thumbnail,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function parseStoryboardCharacters(charactersStr) {
  if (!charactersStr || typeof charactersStr !== 'string') return [];
  try {
    const parsed = JSON.parse(charactersStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => (typeof c === 'object' && c != null && c.id != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n));
  } catch (_) {
    return [];
  }
}

function rowToStoryboard(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    scene_id: r.scene_id,
    storyboard_number: r.storyboard_number,
    title: r.title,
    description: r.description,
    location: r.location,
    time: r.time,
    duration: r.duration ?? 0,
    dialogue: r.dialogue,
    narration: r.narration ?? null,
    action: r.action,
    result: r.result ?? null,
    atmosphere: r.atmosphere,
    image_prompt: r.image_prompt,
    polished_prompt: r.polished_prompt ?? null,
    continuity_snapshot: r.continuity_snapshot ?? null,
    video_prompt: r.video_prompt,
      shot_type: r.shot_type ?? null,
      angle: r.angle ?? null,
      angle_h: r.angle_h ?? null,
      angle_v: r.angle_v ?? null,
      angle_s: r.angle_s ?? null,
      movement: r.movement ?? null,
      lighting_style: r.lighting_style ?? null,
      depth_of_field: r.depth_of_field ?? null,
      segment_index: r.segment_index ?? 0,
      segment_title: r.segment_title ?? null,
      creation_mode: r.creation_mode === 'universal' ? 'universal' : 'classic',
      universal_segment_text: r.universal_segment_text ?? null,
      first_frame_image_id: r.first_frame_image_id ?? null,
      last_frame_image_id: r.last_frame_image_id ?? null,
      last_frame_image_url: sanitizeImageUrl(r.last_frame_image_url),
      last_frame_local_path: r.last_frame_local_path ?? null,
      characters: parseStoryboardCharacters(r.characters),
      composed_image: r.composed_image,
      image_url: sanitizeImageUrl(r.image_url),
      local_path: r.local_path ?? null,
      main_panel_idx: r.main_panel_idx != null ? Number(r.main_panel_idx) : null,
      video_url: r.video_url,
      audio_local_path: r.audio_local_path ?? null,
      narration_audio_local_path: r.narration_audio_local_path ?? null,
      status: r.status || 'pending',
      error_msg: r.error_msg,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
}

function rowToCharacter(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    role: r.role,
    description: r.description,
    appearance: r.appearance,
    personality: r.personality,
    voice_style: r.voice_style,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    reference_images: r.reference_images,
    seed_value: r.seed_value,
    sort_order: r.sort_order ?? 0,
    error_msg: r.error_msg,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    four_view_image_url: r.four_view_image_url || null,
    seedance2_asset: parseJsonColumn(r.seedance2_asset),
    seedance2_voice_asset: parseJsonColumn(r.seedance2_voice_asset),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToScene(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    location: r.location,
    time: r.time,
    prompt: r.prompt,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    storyboard_count: r.storyboard_count ?? 1,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    status: r.status || 'pending',
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToProp(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    description: r.description,
    prompt: r.prompt,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    negative_prompt: r.negative_prompt || null,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function saveOutline(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(req.tags) ? JSON.stringify(req.tags) : null;
  // Merge new metadata with existing metadata
  let existingMetadata = {};
  if (drama.metadata) {
    try {
      existingMetadata = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
    } catch (e) {
      existingMetadata = {};
    }
  }
  let newMetadata = {};
  if (req.metadata) {
    try {
      newMetadata = typeof req.metadata === 'string' ? JSON.parse(req.metadata) : req.metadata;
    } catch (e) {
      newMetadata = {};
    }
  }
  const mergedMetadata = { ...existingMetadata, ...newMetadata };

  // 与 mergeCfgStyleWithDrama 一致：提示词优先读 metadata.style_prompt_*。仅改 dramas.style 而不带画风长文案时，
  // 若仍保留旧的 metadata 画风，会出现「列表/首页 badge 已是新 style，角色提示词却仍用旧画风」。
  if (req.style !== undefined) {
    const styleVal = String(req.style || '').trim();
    const hasExplicitStylePrompt =
      req.metadata &&
      typeof req.metadata === 'object' &&
      !Array.isArray(req.metadata) &&
      ('style_prompt_zh' in req.metadata || 'style_prompt_en' in req.metadata);
    if (!hasExplicitStylePrompt && styleVal) {
      const preset = resolveStylePreset(styleVal);
      if (preset) {
        mergedMetadata.style_prompt_zh = preset.zh;
        mergedMetadata.style_prompt_en = preset.en;
      }
    }
  }

  const metadataStr = JSON.stringify(mergedMetadata);
  
  db.prepare(
    `UPDATE dramas SET title = ?, description = ?, genre = ?, tags = ?, style = ?, metadata = ?, updated_at = ? WHERE id = ?`
  ).run(
    req.title || drama.title, 
    req.summary ?? drama.description, 
    req.genre !== undefined ? req.genre : drama.genre, 
    tagsStr, 
    req.style !== undefined ? req.style : drama.style, 
    metadataStr, 
    now, 
    dramaId
  );
  log.info('Outline saved', { drama_id: dramaId, style: req.style, genre: req.genre, metadata: mergedMetadata });
  return true;
}

function getCharacters(db, dramaId, episodeId) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return null;
  let rows;
  if (episodeId) {
    const exists = db.prepare('SELECT 1 FROM episodes WHERE id = ? AND drama_id = ?').get(episodeId, did);
    if (!exists) return null;
    rows = db.prepare(
      `SELECT c.* FROM characters c
       INNER JOIN episode_characters ec ON ec.character_id = c.id
       WHERE ec.episode_id = ? AND c.deleted_at IS NULL ORDER BY c.sort_order ASC, c.name ASC`
    ).all(episodeId);
  } else {
    rows = db.prepare(
      'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
    ).all(did);
  }
  const characters = rows.map((r) => rowToCharacter(r));
  for (const c of characters) {
    const img = db.prepare(
      'SELECT status, error_msg FROM image_generations WHERE character_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(c.id);
    if (img && ['pending', 'processing', 'failed'].includes(img.status)) {
      c.image_generation_status = img.status;
      if (img.error_msg) c.image_generation_error = img.error_msg;
    }
  }
  return characters;
}

function saveCharacters(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  if (req.episode_id) {
    const ep = db.prepare('SELECT 1 FROM episodes WHERE id = ? AND drama_id = ?').get(req.episode_id, did);
    if (!ep) return false;
  }
  const characterIds = [];
  const chars = req.characters || [];
  for (const char of chars) {
    if (char.id) {
      const ex = db.prepare('SELECT id FROM characters WHERE id = ? AND drama_id = ?').get(char.id, did);
      if (ex) {
        characterIds.push(ex.id);
        // 只更新文本字段；image_url / local_path 仅在调用方显式传入时才覆盖，防止漏传字段清空已有图片
        const imgFields = [];
        const imgParams = [];
        if ('image_url' in char) { imgFields.push('image_url = ?'); imgParams.push(char.image_url ?? null); }
        if ('local_path' in char) { imgFields.push('local_path = ?'); imgParams.push(char.local_path ?? null); }
        if (imgFields.length > 0) {
          const prevC = db
            .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ? AND deleted_at IS NULL')
            .get(char.id);
          if (prevC) {
            seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevC, {
              image_url: 'image_url' in char ? char.image_url : prevC.image_url,
              local_path: 'local_path' in char ? char.local_path : prevC.local_path,
            });
          }
        }
        const imgSql = imgFields.length > 0 ? ', ' + imgFields.join(', ') : '';
        let setCore = 'name = ?, role = ?, description = ?, personality = ?, appearance = ?';
        const coreParams = [char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
        if ('negative_prompt' in char) {
          setCore += ', negative_prompt = ?';
          coreParams.push(char.negative_prompt ?? null);
        }
        db.prepare(
          `UPDATE characters SET ${setCore}${imgSql}, updated_at = ? WHERE id = ?`
        ).run(...coreParams, ...imgParams, new Date().toISOString(), char.id);
        continue;
      }
    }
    const byName = db.prepare('SELECT id FROM characters WHERE drama_id = ? AND name = ?').get(did, char.name);
    if (byName) {
      characterIds.push(byName.id);
      // 如果通过名字找到已存在的角色（包含软删除的），也要更新它的信息并复活
      const imgFieldsN = [];
      const imgParamsN = [];
      if ('image_url' in char) { imgFieldsN.push('image_url = ?'); imgParamsN.push(char.image_url ?? null); }
      if ('local_path' in char) { imgFieldsN.push('local_path = ?'); imgParamsN.push(char.local_path ?? null); }
      if (imgFieldsN.length > 0) {
        const prevN = db
          .prepare('SELECT id, local_path, image_url, seedance2_asset FROM characters WHERE id = ?')
          .get(byName.id);
        if (prevN) {
          seedance2AssetGuards.markStaleOnCharacterMainImageDrift(db, log, prevN, {
            image_url: 'image_url' in char ? char.image_url : prevN.image_url,
            local_path: 'local_path' in char ? char.local_path : prevN.local_path,
          });
        }
      }
      const imgSqlN = imgFieldsN.length > 0 ? ', ' + imgFieldsN.join(', ') : '';
      let setCoreN = 'role = ?, description = ?, personality = ?, appearance = ?';
      const coreParamsN = [char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null];
      if ('negative_prompt' in char) {
        setCoreN += ', negative_prompt = ?';
        coreParamsN.push(char.negative_prompt ?? null);
      }
      db.prepare(
        `UPDATE characters SET ${setCoreN}${imgSqlN}, updated_at = ?, deleted_at = NULL WHERE id = ?`
      ).run(...coreParamsN, ...imgParamsN, new Date().toISOString(), byName.id);
      continue;
    }
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, image_url, local_path, negative_prompt, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(did, char.name, char.role ?? null, char.description ?? null, char.personality ?? null, char.appearance ?? null, char.image_url ?? null, char.local_path ?? null, char.negative_prompt ?? null, now, now);
    characterIds.push(info.lastInsertRowid);
  }
  if (req.episode_id && characterIds.length > 0) {
    db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(req.episode_id);
    // 双数据库兼容：MySQL 用 INSERT IGNORE；SQLite 用 INSERT OR IGNORE（语法不互通）
    const insEC_sql = (db && db.type === 'mysql')
      ? 'INSERT IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
      : 'INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)';
    const ins = db.prepare(insEC_sql);
    for (const cid of characterIds) ins.run(req.episode_id, cid);
  }
  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), did);
  log.info('Characters saved', { drama_id: dramaId, count: chars.length });
  return true;
}

function saveEpisodes(db, log, dramaId, req) {
  const did = Number(dramaId);
  const drama = getDramaById(db, did);
  if (!drama) return false;
  const episodes = req.episodes || [];
  const now = new Date().toISOString();

  // 按 episode_number upsert：保留已有分集的 id，避免关联数据（角色/场景/道具/分镜）孤岛化
  const keptNumbers = new Set();
  for (const ep of episodes) {
    const num = ep.episode_number ?? 0;
    keptNumbers.add(num);
    // 查找已有的（包含软删除的，以防重新激活）
    const existing = db.prepare(
      'SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? ORDER BY deleted_at IS NOT NULL ASC, id ASC LIMIT 1'
    ).get(did, num);
    if (existing) {
      // 更新已有分集，保留 id
      db.prepare(
        `UPDATE episodes SET title = ?, script_content = ?, description = ?, duration = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`
      ).run(ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, existing.id);
    } else {
      // 新增
      db.prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
      ).run(did, num, ep.title || '', ep.script_content ?? null, ep.description ?? null, ep.duration ?? 0, now, now);
    }
  }

  // 软删除本次未提交的分集（如用户删掉了某一集）
  const liveEpisodes = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(did);
  for (const row of liveEpisodes) {
    if (!keptNumbers.has(row.episode_number)) {
      db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(now, row.id);
    }
  }

  db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run(now, did);
  log.info('Episodes saved', { drama_id: dramaId, count: episodes.length });
  return true;
}

function saveProgress(db, log, dramaId, req) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return false;
  // getDramaById 已通过 rowToDrama 把 metadata 解析为对象，不能对 object 再 JSON.parse，否则进 catch 得到 {} 会整表覆盖掉画风等字段
  const meta = storageLayout.parseMetadata(drama.metadata);
  meta.current_step = req.current_step;
  if (req.step_data) meta.step_data = req.step_data;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);
  log.info('Progress saved', { drama_id: dramaId, step: req.current_step });
  return true;
}

// S9-T07: 合法视图模式与预设机位集合（与前端 canvasLayout.js 保持一致）
const S9_VALID_VIEW_MODES = new Set(['2d', '3d']);
const S9_VALID_CAMERA_PRESETS = new Set([
  'front', 'side', 'top', 'free', 'close_up', 'bird_view',
]);

/**
 * S9-T07: 校验 canvas_layout 中的 3D 字段，返回规范化后的片段
 * @param {object} layout - canvas_layout 对象
 * @returns {object} { view_mode, camera_3d, camera_preset, nodes_3d } 规范化后的 3D 字段
 */
function validate3DFields(layout) {
  const result = { view_mode: null, camera_3d: null, camera_preset: null, nodes_3d: null,
                   character_stage: null, scene_depth: null, timeline_3d: null };

  // view_mode 校验
  if (layout.view_mode != null) {
    if (!S9_VALID_VIEW_MODES.has(layout.view_mode)) {
      const err = new Error(`view_mode 必须为 '2d' 或 '3d'，收到: ${layout.view_mode}`);
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.view_mode = layout.view_mode;
  }

  // camera_preset 校验
  if (layout.camera_preset != null) {
    if (!S9_VALID_CAMERA_PRESETS.has(layout.camera_preset)) {
      const err = new Error(`camera_preset 不合法: ${layout.camera_preset}`);
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.camera_preset = layout.camera_preset;
  }

  // camera_3d 结构校验
  if (layout.camera_3d != null) {
    const cam = layout.camera_3d;
    if (typeof cam !== 'object' || Array.isArray(cam)) {
      const err = new Error('camera_3d 必须为对象');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const pos = cam.position;
    const tgt = cam.target;
    if (!pos || !tgt) {
      const err = new Error('camera_3d 必须包含 position 和 target');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(pos[axis]) || !Number.isFinite(tgt[axis])) {
        const err = new Error(`camera_3d.position.${axis} / target.${axis} 必须为有限数值`);
        err.code = 'BAD_REQUEST';
        throw err;
      }
    }
    result.camera_3d = {
      position: { x: pos.x, y: pos.y, z: pos.z },
      target: { x: tgt.x, y: tgt.y, z: tgt.z },
      fov: Number.isFinite(cam.fov) ? cam.fov : 50,
      preset: S9_VALID_CAMERA_PRESETS.has(cam.preset) ? cam.preset : 'free',
    };
  }

  // nodes_3d 结构校验（可选）
  if (layout.nodes_3d != null) {
    if (typeof layout.nodes_3d !== 'object' || Array.isArray(layout.nodes_3d)) {
      const err = new Error('nodes_3d 必须为对象');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.nodes_3d = layout.nodes_3d;
  }

  // S10-T04: character_stage 校验（可选）
  if (layout.character_stage != null) {
    if (typeof layout.character_stage !== 'object' || Array.isArray(layout.character_stage)) {
      const err = new Error('character_stage 必须为对象');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.character_stage = layout.character_stage;
  }

  // S10-T05: scene_depth 校验（可选）
  if (layout.scene_depth != null) {
    if (typeof layout.scene_depth !== 'object' || Array.isArray(layout.scene_depth)) {
      const err = new Error('scene_depth 必须为对象');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.scene_depth = layout.scene_depth;
  }

  // S10-T06: timeline_3d 校验（可选）
  if (layout.timeline_3d != null) {
    if (typeof layout.timeline_3d !== 'object' || Array.isArray(layout.timeline_3d)) {
      const err = new Error('timeline_3d 必须为对象');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    result.timeline_3d = layout.timeline_3d;
  }

  return result;
}

/**
 * S9-T07: 将 3D 字段同步到 canvas_layouts 表（便于独立查询）
 * 兼容 SQLite 和 MySQL：先尝试 UPDATE，无命中则 INSERT
 * @param {object} db - 数据库连接
 * @param {number} dramaId - 项目ID
 * @param {object} layout - canvas_layout 对象（含 3D 字段）
 * @param {object} [log] - 日志对象（可选，写入失败时记录警告）
 */
function sync3DFieldsToTable(db, dramaId, layout, log) {
  const viewMode = S9_VALID_VIEW_MODES.has(layout.view_mode) ? layout.view_mode : '2d';
  const camera3D = layout.camera_3d ? JSON.stringify(layout.camera_3d) : null;
  const cameraPreset = S9_VALID_CAMERA_PRESETS.has(layout.camera_preset)
    ? layout.camera_preset
    : (layout.camera_3d?.preset && S9_VALID_CAMERA_PRESETS.has(layout.camera_3d.preset)
        ? layout.camera_3d.preset : null);
  const viewportJson = layout.viewport ? JSON.stringify(layout.viewport) : null;
  const nodesJson = layout.nodes ? JSON.stringify(layout.nodes) : null;
  const zoneCollapsedJson = layout.zone_collapsed ? JSON.stringify(layout.zone_collapsed) : null;
  const metaJson = layout.meta ? JSON.stringify(layout.meta) : null;
  // S10-T04/T05/T06: 新增 JSON 字段
  const characterStageJson = layout.character_stage ? JSON.stringify(layout.character_stage) : null;
  const sceneDepthJson = layout.scene_depth ? JSON.stringify(layout.scene_depth) : null;
  const timeline3DJson = layout.timeline_3d ? JSON.stringify(layout.timeline_3d) : null;

  try {
    // 先尝试 UPDATE（兼容 SQLite 和 MySQL）
    const updateResult = db.prepare(`
      UPDATE canvas_layouts
      SET viewport = ?, nodes = ?, zone_collapsed = ?, view_mode = ?,
          camera_3d = ?, camera_preset = ?, meta = ?,
          character_stage = ?, scene_depth = ?, timeline_3d = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE drama_id = ?
    `).run(viewportJson, nodesJson, zoneCollapsedJson, viewMode, camera3D, cameraPreset, metaJson,
          characterStageJson, sceneDepthJson, timeline3DJson, dramaId);

    // 如果没有命中行，执行 INSERT
    if (updateResult.changes === 0) {
      db.prepare(`
        INSERT INTO canvas_layouts
          (drama_id, viewport, nodes, zone_collapsed, view_mode, camera_3d, camera_preset, meta,
           character_stage, scene_depth, timeline_3d, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(dramaId, viewportJson, nodesJson, zoneCollapsedJson, viewMode, camera3D, cameraPreset, metaJson,
            characterStageJson, sceneDepthJson, timeline3DJson);
    }
  } catch (err) {
    // canvas_layouts 表写入失败不阻塞主流程（metadata JSON 是主存储）
    if (log && typeof log.warn === 'function') {
      log.warn('Sync 3D fields to canvas_layouts table failed', { drama_id: dramaId, error: err.message });
    }
  }
}

/** 保存画布布局 / 工作流组到 metadata（合并现有 metadata） */
function saveCanvasLayout(db, log, dramaId, req, operator) {
  const drama = getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const layout = req?.canvas_layout;
  const workflowGroups = req?.workflow_groups;
  if (
    (layout == null || typeof layout !== 'object' || Array.isArray(layout)) &&
    workflowGroups === undefined
  ) {
    const err = new Error('请提供 canvas_layout 或 workflow_groups');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (layout != null && (typeof layout !== 'object' || Array.isArray(layout))) {
    const err = new Error('canvas_layout 必须为对象');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (workflowGroups !== undefined && !Array.isArray(workflowGroups)) {
    const err = new Error('workflow_groups 必须为数组');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // S9-T07: 校验 3D 字段（view_mode / camera_3d / camera_preset / nodes_3d）
  let validated3D = null;
  if (layout) {
    validated3D = validate3DFields(layout);
  }

  const meta = storageLayout.parseMetadata(drama.metadata);
  if (layout) meta.canvas_layout = layout;
  if (workflowGroups !== undefined) meta.workflow_groups = workflowGroups;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), now, dramaId);

  // S9-T07: 同步 3D 字段到 canvas_layouts 表（便于独立查询，失败不阻塞）
  if (layout) {
    sync3DFieldsToTable(db, Number(dramaId), layout, log);
  }

  // S11-T06: 画布保存自动创建版本快照（失败不阻塞主流程）
  if (layout) {
    try {
      const versionService = require('./versionService');
      versionService.createSnapshot(db, log, Number(dramaId), layout, {
        operatorId: operator?.id,
        operatorName: operator?.username || operator?.name,
        source: 'save',
      });
    } catch (err) {
      if (log && typeof log.warn === 'function') {
        log.warn('S11-T06 版本快照创建失败(非致命)', { drama_id: dramaId, error: err.message });
      }
    }
  }

  log.info('Canvas state saved', {
    drama_id: dramaId,
    node_count: layout ? Object.keys(layout.nodes || {}).length : undefined,
    workflow_group_count: workflowGroups ? workflowGroups.length : undefined,
    view_mode: validated3D?.view_mode || undefined,
    camera_preset: validated3D?.camera_preset || validated3D?.camera_3d?.preset || undefined,
    has_camera_3d: !!validated3D?.camera_3d,
    nodes_3d_count: validated3D?.nodes_3d ? Object.keys(validated3D.nodes_3d).length : undefined,
  });
  return getDrama(db, dramaId);
}

/**
 * 取某分镜的视频地址：优先使用用户手动选定的 storyboard.video_url，否则取最新完成的 video_generations 记录
 */
function getVideoUrlForStoryboard(db, storyboardId, baseUrl) {
  // 1. 获取 storyboard 表中的视频信息（代表用户选定或上次同步的结果）
  const sb = db.prepare('SELECT video_url, local_path, updated_at FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(storyboardId);
  
  // 2. 获取 video_generations 表中最新完成的记录
  const vg = db.prepare(
    "SELECT video_url, local_path, completed_at, updated_at, created_at FROM video_generations WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(storyboardId);

  // 辅助函数：构造完整 URL，优先使用本地路径（避免远程URL过期导致无法合并）
  const buildUrl = (videoUrl, localPath) => {
    if (localPath && String(localPath).trim() && baseUrl) {
      const base = (baseUrl || '').replace(/\/$/, '');
      const p = String(localPath).replace(/^\//, '');
      return p ? base + '/' + p : null;
    }
    if (videoUrl && String(videoUrl).trim()) return videoUrl;
    return null;
  };

  const sbUrl = sb ? buildUrl(sb.video_url, sb.local_path) : null;
  const vgUrl = vg ? buildUrl(vg.video_url, vg.local_path) : null;

  // 策略：比较时间，取最新的
  // 如果只有其中一个有 URL，直接用那个
  if (sbUrl && !vgUrl) return sbUrl;
  if (!sbUrl && vgUrl) return vgUrl;
  if (!sbUrl && !vgUrl) return null;

  // 都有 URL，比较时间
  // sb 使用 updated_at
  // vg 使用 completed_at > updated_at > created_at
  const sbTime = sb.updated_at || '1970-01-01';
  const vgTime = vg.completed_at || vg.updated_at || vg.created_at || '1970-01-01';

  // 如果生成记录的时间比分镜更新时间还晚（说明是重新生成的，且可能没回写），则优先用生成记录
  if (vgTime > sbTime) {
    return vgUrl;
  }
  
  // 否则依然以 storyboard 为准（可能是用户手动修改过，或者已经回写过）
  return sbUrl;
}

function finalizeEpisode(db, log, episodeId, baseUrl, body = {}) {
  const ep = db.prepare('SELECT id, drama_id, episode_number FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
  if (!ep) return null;
  const drama = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(ep.drama_id);
  const storyboards = db.prepare(
    'SELECT id, storyboard_number, duration FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
  ).all(episodeId);
  const videoMergeService = require('./videoMergeService');
  const scenes = [];
  for (let i = 0; i < storyboards.length; i++) {
    const sb = storyboards[i];
    const videoUrl = getVideoUrlForStoryboard(db, sb.id, baseUrl);
    if (!videoUrl) {
      log.warn('Finalize skip storyboard (no video)', { storyboard_id: sb.id, storyboard_number: sb.storyboard_number });
      continue;
    }
    scenes.push({
      scene_id: sb.id,
      video_url: videoUrl,
      duration: Number(sb.duration) || 5,
      order: i,
    });
  }
  if (scenes.length === 0) {
    log.warn('Finalize no scenes with video', { episode_id: episodeId });
    return { message: '本集没有可合成的视频片段', merge_id: null, episode_id: episodeId, scenes_count: 0, task_id: null };
  }
  const title = drama && drama.title ? `${drama.title} - 第${ep.episode_number ?? episodeId}集` : null;
  const mergeReq = {
    episode_id: episodeId,
    drama_id: ep.drama_id,
    title,
    scenes,
    provider: 'ffmpeg',
    merge_options: {
      burn_narration_subtitles: !!(body && body.burn_narration_subtitles),
      burn_dialogue_audio: !!(body && body.burn_dialogue_audio),
      watermark_text: (body && body.watermark_text != null)
        ? String(body.watermark_text).trim().slice(0, 200)
        : '',
    },
  };
  const created = videoMergeService.create(db, log, mergeReq);
  const mergeId = created.merge_id || created.id;
  db.prepare('UPDATE episodes SET status = ? WHERE id = ?').run('processing', episodeId);

  // P1-R6': 视频合成进入并发限流队列（默认 concurrency=2，读自 config.yaml queue.merge_concurrency）
  //   回滚：将本块替换回 setImmediate(() => { videoMergeService.processVideoMerge(db, log, mergeId, baseUrl); });
  const qsBefore = MergeAsyncQueue.stats;
  MergeAsyncQueue.add(async () => {
    // 队列内任务失败不应打断后续任务调度（AsyncQueue 已在 finally 中 _runNext）
    try {
      await videoMergeService.processVideoMerge(db, log, mergeId, baseUrl);
    } catch (err) {
      console.error(`[MERGE-QUEUE] processVideoMerge 抛错（已隔离，不影响队列其他任务） mergeId=${mergeId}:`, err.message);
    }
  }).catch(() => { /* AsyncQueue.add 已捕获，此处仅防 PromiseUnhandledRejection */ });
  const qsAfter = MergeAsyncQueue.stats;
  console.log(`[MERGE-QUEUE] 合成任务入队  mergeId=${mergeId}  episodeId=${episodeId}  running=${qsAfter.running}/${qsAfter.concurrency}  queued=${qsAfter.queued}  submitted_total=${qsAfter.submitted}`);

  return {
    message: '视频合成任务已创建，正在后台处理',
    merge_id: mergeId,
    episode_id: episodeId,
    scenes_count: scenes.length,
    task_id: created.task_id,
  };
}

function downloadEpisodeVideo(db, episodeId) {
  const ep = db.prepare('SELECT id, title, episode_number, video_url FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeId);
  if (!ep) return null;
  if (!ep.video_url) return { error: '该剧集还没有生成视频' };
  return { video_url: ep.video_url, title: ep.title, episode_number: ep.episode_number };
}

module.exports = {
  createDrama,
  getDrama,
  getDramaById,
  listDramas,
  listDramasLite,
  updateDrama,
  deleteDrama,
  getDramaStats,
  saveOutline,
  getCharacters,
  saveCharacters,
  saveEpisodes,
  saveProgress,
  saveCanvasLayout,
  finalizeEpisode,
  downloadEpisodeVideo,
  generateStoryboard,
  // P1-R6': 暴露视频合成限流队列状态（测试/监控用）
  _mergeQueueStats: () => ({ ...MergeAsyncQueue.stats }),
  _mergeQueueDrain: () => MergeAsyncQueue._drain(),
  _MergeAsyncQueue: MergeAsyncQueue,
  // S9-T07: 暴露3D字段校验与同步函数（测试用）
  _validate3DFields: validate3DFields,
  _sync3DFieldsToTable: sync3DFieldsToTable,
  _S9_VALID_VIEW_MODES: S9_VALID_VIEW_MODES,
  _S9_VALID_CAMERA_PRESETS: S9_VALID_CAMERA_PRESETS,
};
