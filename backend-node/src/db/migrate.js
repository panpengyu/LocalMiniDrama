const fs = require('fs');
const path = require('path');
const { getDb } = require('./index.js');
const { loadConfig } = require('../config/index.js');

function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    })
    .join('\n')
    .trim();
}

function runOne(database, sql, file, index) {
  let s = stripLeadingComments(sql);
  if (!s) return;
  
  if (database.type === 'mysql') {
    s = s.replace(/AUTOINCREMENT/g, 'AUTO_INCREMENT');
    s = s.replace(/REAL/g, 'FLOAT');
  }
  
  try {
    database.exec(s);
    console.log('Ran migration:', file + (index >= 0 ? ' #' + (index + 1) : ''));
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if ((err.code === 'SQLITE_ERROR' || err.code === 'ER_DUP_FIELDNAME') && (msg.includes('duplicate column') || msg.includes('already exists'))) {
      console.log('Skip (already exists):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if ((err.code === 'SQLITE_ERROR' || err.code === 'ER_NO_SUCH_TABLE') && msg.includes('no such table')) {
      console.warn('Skip migration (table not found, will be ensured later):', file, '-', err.message);
    } else if (err.code === 'ER_DUP_ENTRY') {
      console.log('Skip (duplicate entry):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'ER_BLOB_CANT_HAVE_DEFAULT') {
      console.log('Skip (BLOB default not supported):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'ER_TOO_BIG_ROWSIZE') {
      console.log('Skip (row size too large):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'ER_TRUNCATED_WRONG_VALUE') {
      console.log('Skip (truncated wrong value):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'ER_PARSE_ERROR') {
      console.log('Skip (parse error):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_CANT_RENAME_TABLE') {
      console.log('Skip (table exists/rename conflict):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else {
      throw err;
    }
  }
}

function runMigrations(database) {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('Migrations dir missing, skipping:', migrationsDir);
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (statements.length <= 1) {
      runOne(database, sql, file, -1);
    } else {
      statements.forEach((stmt, i) => runOne(database, stmt + ';', file, i));
    }
  }
}

function ensureColumns(database, table, columns) {
  let existing;
  try {
    if (database.type === 'mysql') {
      const stmt = database.prepare(`DESCRIBE ${table}`);
      existing = stmt.all([]);
    } else {
      existing = database.prepare(`PRAGMA table_info(${table})`).all();
    }
  } catch (err) {
    if ((err.message || '').toLowerCase().includes('no such table')) {
      console.log(`ensureColumns: table ${table} not found, skip`);
      return;
    }
    throw err;
  }
  
  const names = new Set(existing.map((r) => r.Field || r.name));
  
  for (const col of columns) {
    if (names.has(col.name)) continue;
    try {
      let colType = col.type;
      if (database.type === 'mysql') {
        colType = colType.replace(/TEXT NOT NULL DEFAULT ['"]['"]/g, 'VARCHAR(255) NOT NULL DEFAULT \'\'');
        colType = colType.replace(/TEXT DEFAULT ['"][^'"]*['"]/g, 'VARCHAR(255)');
      }
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${colType}`);
      console.log(`ensureColumns: added ${table}.${col.name} (${colType})`);
    } catch (e) {
      if ((e.message || '').toLowerCase().includes('duplicate column')) {
      } else {
        console.warn(`ensureColumns: failed to add ${table}.${col.name}:`, e.message);
      }
    }
  }
}

function ensureAllColumns(database) {
  const ensure = (table, cols) => ensureColumns(database, table, cols);
  
  ensure('dramas', [
    { name: 'title', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'genre', type: 'VARCHAR(50)' },
    { name: 'style', type: 'VARCHAR(50) DEFAULT \'realistic\'' },
    { name: 'tags', type: 'TEXT' },
    { name: 'thumbnail', type: 'VARCHAR(255)' },
    { name: 'total_episodes', type: 'INTEGER DEFAULT 1' },
    { name: 'total_duration', type: 'INTEGER DEFAULT 0' },
    { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
    { name: 'metadata', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('episodes', [
    { name: 'drama_id', type: 'INTEGER DEFAULT 0' },
    { name: 'episode_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title', type: 'VARCHAR(255) DEFAULT \'\'' },
    { name: 'script_content', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'duration', type: 'INTEGER DEFAULT 0' },
    { name: 'video_url', type: 'VARCHAR(255)' },
    { name: 'thumbnail', type: 'VARCHAR(255)' },
    { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('storyboards', [
    { name: 'episode_id', type: 'INTEGER DEFAULT 0' },
    { name: 'scene_id', type: 'INTEGER' },
    { name: 'storyboard_number', type: 'INTEGER DEFAULT 0' },
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'description', type: 'TEXT' },
    { name: 'layout_description', type: 'TEXT' },
    { name: 'location', type: 'VARCHAR(255)' },
    { name: 'time', type: 'VARCHAR(50)' },
    { name: 'duration', type: 'FLOAT' },
    { name: 'dialogue', type: 'TEXT' },
    { name: 'narration', type: 'TEXT' },
    { name: 'action', type: 'TEXT' },
    { name: 'atmosphere', type: 'TEXT' },
    { name: 'image_prompt', type: 'TEXT' },
    { name: 'video_prompt', type: 'TEXT' },
    { name: 'characters', type: 'TEXT' },
    { name: 'shot_type', type: 'VARCHAR(50)' },
    { name: 'angle', type: 'VARCHAR(50)' },
    { name: 'movement', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'main_panel_idx', type: 'INTEGER' },
    { name: 'video_url', type: 'VARCHAR(255)' },
    { name: 'composed_image', type: 'VARCHAR(255)' },
    { name: 'result', type: 'TEXT' },
    { name: 'emotion', type: 'VARCHAR(50)' },
    { name: 'emotion_intensity', type: 'INTEGER' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'segment_index', type: 'INTEGER DEFAULT 0' },
    { name: 'segment_title', type: 'VARCHAR(255)' },
    { name: 'angle_h', type: 'VARCHAR(50)' },
    { name: 'angle_v', type: 'VARCHAR(50)' },
    { name: 'angle_s', type: 'VARCHAR(50)' },
    { name: 'lighting_style', type: 'VARCHAR(50)' },
    { name: 'depth_of_field', type: 'VARCHAR(50)' },
    { name: 'polished_prompt', type: 'TEXT' },
    { name: 'continuity_snapshot', type: 'TEXT' },
    { name: 'audio_local_path', type: 'VARCHAR(255)' },
    { name: 'narration_audio_local_path', type: 'VARCHAR(255)' },
    { name: 'creation_mode', type: 'VARCHAR(20) DEFAULT \'classic\'' },
    { name: 'universal_segment_text', type: 'TEXT' },
    { name: 'first_frame_image_id', type: 'INTEGER' },
    { name: 'last_frame_image_id', type: 'INTEGER' },
    { name: 'last_frame_image_url', type: 'VARCHAR(255)' },
    { name: 'last_frame_local_path', type: 'VARCHAR(255)' },
    { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('characters', [
    { name: 'drama_id', type: 'INTEGER DEFAULT 0' },
    { name: 'name', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'role', type: 'VARCHAR(50)' },
    { name: 'description', type: 'TEXT' },
    { name: 'personality', type: 'TEXT' },
    { name: 'appearance', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'extra_images', type: 'TEXT' },
    { name: 'voice_style', type: 'VARCHAR(50)' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'identity_anchors', type: 'TEXT' },
    { name: 'style_tokens', type: 'TEXT' },
    { name: 'color_palette', type: 'TEXT' },
    { name: 'four_view_image_url', type: 'VARCHAR(255)' },
    { name: 'polished_prompt', type: 'TEXT' },
    { name: 'ref_image', type: 'VARCHAR(255)' },
    { name: 'stages', type: 'TEXT' },
    { name: 'seedance2_asset', type: 'TEXT' },
    { name: 'seedance2_voice_asset', type: 'TEXT' },
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('scenes', [
    { name: 'drama_id', type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'location', type: 'VARCHAR(255)' },
    { name: 'time', type: 'VARCHAR(50)' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'polished_prompt', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'extra_images', type: 'TEXT' },
    { name: 'ref_image', type: 'VARCHAR(255)' },
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'storyboard_count', type: 'INTEGER DEFAULT 0' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('props', [
    { name: 'drama_id', type: 'INTEGER DEFAULT 0' },
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'type', type: 'VARCHAR(50)' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'extra_images', type: 'TEXT' },
    { name: 'ref_image', type: 'VARCHAR(255)' },
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('ai_service_configs', [
    { name: 'service_type', type: 'VARCHAR(50) NOT NULL DEFAULT \'text\'' },
    { name: 'provider', type: 'VARCHAR(50) DEFAULT \'\'' },
    { name: 'name', type: 'VARCHAR(100) DEFAULT \'\'' },
    { name: 'base_url', type: 'VARCHAR(255) DEFAULT \'\'' },
    { name: 'api_key', type: 'TEXT' },
    { name: 'model', type: 'VARCHAR(100)' },
    { name: 'default_model', type: 'VARCHAR(100)' },
    { name: 'endpoint', type: 'VARCHAR(255)' },
    { name: 'query_endpoint', type: 'VARCHAR(255)' },
    { name: 'priority', type: 'INTEGER DEFAULT 0' },
    { name: 'is_default', type: 'TINYINT DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'settings', type: 'TEXT' },
    { name: 'icon_char', type: 'VARCHAR(10) DEFAULT \'\'' },
    { name: 'description', type: 'VARCHAR(500) DEFAULT \'\'' },
    { name: 'tags', type: 'TEXT' },
    { name: 'is_builtin', type: 'TINYINT DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('async_tasks', [
    { name: 'type', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'status', type: 'VARCHAR(20) NOT NULL DEFAULT \'pending\'' },
    { name: 'progress', type: 'INTEGER DEFAULT 0' },
    { name: 'message', type: 'TEXT' },
    { name: 'resource_id', type: 'VARCHAR(100)' },
    { name: 'completed_at', type: 'DATETIME' },
    { name: 'error', type: 'TEXT' },
    { name: 'result', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('anomaly_alert_channels', [
    { name: 'name',              type: 'VARCHAR(100) NOT NULL DEFAULT \'\'' },
    { name: 'channel_type',      type: 'VARCHAR(20) NOT NULL DEFAULT \'dingtalk\'' },
    { name: 'webhook_url',       type: 'VARCHAR(500) NOT NULL DEFAULT \'\'' },
    { name: 'secret',            type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'mention_mobiles',   type: 'TEXT' },
    { name: 'mention_all',       type: 'TINYINT DEFAULT 0' },
    { name: 'severity_mask',     type: 'TINYINT NOT NULL DEFAULT 7' },
    { name: 'type_mask',         type: 'VARCHAR(200) NOT NULL DEFAULT \'*\'' },
    { name: 'rate_limit_minutes', type: 'INTEGER NOT NULL DEFAULT 5' },
    { name: 'enabled',           type: 'TINYINT DEFAULT 1' },
    { name: 'remark',            type: 'VARCHAR(500)' },
    { name: 'created_at',        type: 'DATETIME' },
    { name: 'updated_at',        type: 'DATETIME' }
  ]);
  ensure('anomaly_alert_events', [
    { name: 'channel_id',  type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'fingerprint', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'anomaly_type',type: 'VARCHAR(40) NOT NULL DEFAULT \'\'' },
    { name: 'severity',    type: 'VARCHAR(20) NOT NULL DEFAULT \'info\'' },
    { name: 'summary',     type: 'VARCHAR(500) NOT NULL DEFAULT \'\'' },
    { name: 'payload',     type: 'TEXT' },
    { name: 'status',      type: 'VARCHAR(20) NOT NULL DEFAULT \'pending\'' },
    { name: 'error_msg',   type: 'TEXT' },
    { name: 'sent_at',     type: 'DATETIME' },
    { name: 'created_at',  type: 'DATETIME' }
  ]);

  ensure('image_generations', [
    { name: 'storyboard_id', type: 'INTEGER' },
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'scene_id', type: 'INTEGER' },
    { name: 'character_id', type: 'INTEGER' },
    { name: 'provider', type: 'VARCHAR(50)' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'negative_prompt', type: 'TEXT' },
    { name: 'model', type: 'VARCHAR(100)' },
    { name: 'frame_type', type: 'VARCHAR(50)' },
    { name: 'reference_images', type: 'TEXT' },
    { name: 'use_first_frame_layout_lock', type: 'TINYINT' },
    { name: 'size', type: 'VARCHAR(20)' },
    { name: 'quality', type: 'VARCHAR(20)' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'width', type: 'INTEGER' },
    { name: 'height', type: 'INTEGER' },
    { name: 'status', type: 'VARCHAR(20)' },
    { name: 'task_id', type: 'VARCHAR(100)' },
    { name: 'completed_at', type: 'DATETIME' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('video_generations', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'storyboard_id', type: 'INTEGER' },
    { name: 'provider', type: 'VARCHAR(50)' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'model', type: 'VARCHAR(100)' },
    { name: 'duration', type: 'FLOAT' },
    { name: 'aspect_ratio', type: 'VARCHAR(20)' },
    { name: 'resolution', type: 'VARCHAR(20)' },
    { name: 'seed', type: 'INTEGER' },
    { name: 'camera_fixed', type: 'TINYINT' },
    { name: 'watermark', type: 'TINYINT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'first_frame_url', type: 'VARCHAR(255)' },
    { name: 'last_frame_url', type: 'VARCHAR(255)' },
    { name: 'reference_image_urls', type: 'TEXT' },
    { name: 'video_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'status', type: 'VARCHAR(20)' },
    { name: 'task_id', type: 'VARCHAR(100)' },
    { name: 'provider_task_id', type: 'VARCHAR(100)' },
    { name: 'scene_id', type: 'INTEGER' },
    { name: 'completed_at', type: 'DATETIME' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('video_merges', [
    { name: 'episode_id', type: 'INTEGER' },
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'provider', type: 'VARCHAR(50)' },
    { name: 'model', type: 'VARCHAR(100)' },
    { name: 'status', type: 'VARCHAR(20)' },
    { name: 'scenes', type: 'TEXT' },
    { name: 'merge_options', type: 'TEXT' },
    { name: 'task_id', type: 'VARCHAR(100)' },
    { name: 'merged_url', type: 'VARCHAR(255)' },
    { name: 'duration', type: 'INTEGER' },
    { name: 'completed_at', type: 'DATETIME' },
    { name: 'error_msg', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('assets', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR(255)' },
    { name: 'type', type: 'VARCHAR(50)' },
    { name: 'category', type: 'VARCHAR(50)' },
    { name: 'url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'file_size', type: 'INTEGER' },
    { name: 'mime_type', type: 'VARCHAR(100)' },
    { name: 'width', type: 'INTEGER' },
    { name: 'height', type: 'INTEGER' },
    { name: 'duration', type: 'FLOAT' },
    { name: 'image_gen_id', type: 'INTEGER' },
    { name: 'video_gen_id', type: 'INTEGER' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('character_libraries', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'category', type: 'VARCHAR(50)' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'description', type: 'TEXT' },
    { name: 'appearance', type: 'TEXT' },
    { name: 'tags', type: 'TEXT' },
    { name: 'source_type', type: 'VARCHAR(50)' },
    { name: 'source_id', type: 'VARCHAR(100)' },
    { name: 'identity_anchors', type: 'TEXT' },
    { name: 'style_tokens', type: 'TEXT' },
    { name: 'color_palette', type: 'TEXT' },
    { name: 'four_view_image_url', type: 'VARCHAR(255)' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('scene_libraries', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'location', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'time', type: 'VARCHAR(50)' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'category', type: 'VARCHAR(50)' },
    { name: 'tags', type: 'TEXT' },
    { name: 'source_type', type: 'VARCHAR(50)' },
    { name: 'source_id', type: 'VARCHAR(100)' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('prop_libraries', [
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'name', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(255)' },
    { name: 'local_path', type: 'VARCHAR(255)' },
    { name: 'category', type: 'VARCHAR(50)' },
    { name: 'tags', type: 'TEXT' },
    { name: 'source_type', type: 'VARCHAR(50)' },
    { name: 'source_id', type: 'VARCHAR(100)' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('image_proxy_cache', [
    { name: 'cache_key', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'proxy_url', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'created_at', type: 'DATETIME NOT NULL DEFAULT \'\'' },
  ]);

  ensure('ai_model_map', [
    { name: 'key', type: 'VARCHAR(100) NOT NULL DEFAULT \'\'' },
    { name: 'service_type', type: 'VARCHAR(50) NOT NULL DEFAULT \'text\'' },
    { name: 'config_id', type: 'INTEGER' },
    { name: 'model_override', type: 'VARCHAR(100)' },
    { name: 'description', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME NOT NULL DEFAULT \'\'' },
    { name: 'updated_at', type: 'DATETIME NOT NULL DEFAULT \'\'' },
  ]);

  ensure('users', [
    { name: 'username', type: 'VARCHAR(50) NOT NULL DEFAULT \'\'' },
    { name: 'phone', type: 'VARCHAR(20)' },
    { name: 'password', type: 'VARCHAR(255) NOT NULL' },
    { name: 'role', type: 'VARCHAR(20) NOT NULL DEFAULT \'user\'' },
    { name: 'nickname', type: 'VARCHAR(50) DEFAULT \'\'' },
    { name: 'avatar', type: 'VARCHAR(255)' },
    { name: 'email', type: 'VARCHAR(100)' },
    { name: 'status', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { name: 'deleted_at', type: 'DATETIME' },
  ]);

  ensure('channels', [
    { name: 'code', type: 'VARCHAR(50) NOT NULL' },
    { name: 'name', type: 'VARCHAR(100) NOT NULL' },
    { name: 'type', type: 'VARCHAR(20) DEFAULT \'organic\'' },
    { name: 'status', type: 'TINYINT DEFAULT 1' },
    { name: 'remark', type: 'VARCHAR(500)' },
    { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
  ]);

  ensure('point_logs', [
    { name: 'user_id', type: 'INTEGER' },
    { name: 'change_type', type: 'VARCHAR(20) NOT NULL' },
    { name: 'business_type', type: 'VARCHAR(30) DEFAULT \'other\'' },
    { name: 'amount', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'balance_after', type: 'INTEGER DEFAULT 0' },
    { name: 'related_id', type: 'VARCHAR(100)' },
    { name: 'remark', type: 'VARCHAR(500)' },
    { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
  ]);

  ensure('recharges', [
    { name: 'order_no', type: 'VARCHAR(64) NOT NULL' },
    { name: 'user_id', type: 'INTEGER' },
    { name: 'amount', type: 'DECIMAL(10,2) NOT NULL DEFAULT 0.00' },
    { name: 'points', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'pay_method', type: 'VARCHAR(20)' },
    { name: 'pay_status', type: 'VARCHAR(20) DEFAULT \'paid\'' },
    { name: 'paid_at', type: 'DATETIME' },
    { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
  ]);

  // ---------- AI编剧助手 Sprint 1: sw_* 系列表 ----------
  ensure('sw_outlines', [
    { name: 'outline_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'enterprise_id', type: 'BIGINT' },
    { name: 'drama_id', type: 'BIGINT' },
    { name: 'title', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'logline', type: 'TEXT' },
    { name: 'idea', type: 'TEXT' },
    { name: 'genre', type: 'VARCHAR(32)' },
    { name: 'structure', type: 'VARCHAR(32) DEFAULT \'three_act\'' },
    { name: 'style', type: 'VARCHAR(32) DEFAULT \'hot\'' },
    { name: 'episode_count', type: 'INTEGER DEFAULT 10' },
    { name: 'target_audience', type: 'VARCHAR(255)' },
    { name: 'themes_json', type: 'TEXT' },
    { name: 'acts_json', type: 'MEDIUMTEXT' },
    { name: 'status', type: 'VARCHAR(16) DEFAULT \'draft\'' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_characters', [
    { name: 'character_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'drama_id', type: 'BIGINT' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'name', type: 'VARCHAR(128) NOT NULL DEFAULT \'\'' },
    { name: '`role`', type: 'VARCHAR(16) NOT NULL DEFAULT \'supporting\'' },
    { name: 'age', type: 'INTEGER' },
    { name: 'gender', type: 'VARCHAR(16)' },
    { name: 'personality', type: 'TEXT' },
    { name: 'appearance', type: 'TEXT' },
    { name: 'background', type: 'TEXT' },
    { name: 'motivation', type: 'TEXT' },
    { name: 'arc', type: 'TEXT' },
    { name: 'appearance_prompt', type: 'TEXT' },
    { name: 'voice_profile', type: 'TEXT' },
    { name: 'tags_json', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'status', type: 'VARCHAR(16) DEFAULT \'draft\'' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_episodes', [
    { name: 'episode_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'outline_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'drama_id', type: 'BIGINT' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'episode_number', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'title', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
    { name: 'summary', type: 'MEDIUMTEXT' },
    { name: 'duration_estimate', type: 'VARCHAR(32)' },
    { name: 'cliffhanger', type: 'TEXT' },
    { name: 'status', type: 'VARCHAR(16) DEFAULT \'draft\'' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_scenes', [
    { name: 'scene_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'episode_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'scene_number', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'location', type: 'VARCHAR(255)' },
    { name: 'description', type: 'MEDIUMTEXT' },
    { name: 'time_of_day', type: 'VARCHAR(32)' },
    { name: 'atmosphere', type: 'VARCHAR(64)' },
    { name: 'characters_json', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_storyboards', [
    { name: 'frame_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'episode_id', type: 'VARCHAR(64)' },
    { name: 'scene_id', type: 'VARCHAR(64)' },
    { name: 'drama_id', type: 'BIGINT' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'frame_number', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'shot_type', type: 'VARCHAR(32)' },
    { name: 'camera_movement', type: 'VARCHAR(32)' },
    { name: 'composition', type: 'VARCHAR(32)' },
    { name: 'emotion', type: 'VARCHAR(32)' },
    { name: 'duration', type: 'VARCHAR(32)' },
    { name: 'transition', type: 'VARCHAR(32) DEFAULT \'cut\'' },
    { name: 'visual_description', type: 'MEDIUMTEXT' },
    { name: 'prompt', type: 'TEXT' },
    { name: 'characters_json', type: 'TEXT' },
    { name: 'image_url', type: 'VARCHAR(512)' },
    { name: 'generation_status', type: 'VARCHAR(16) DEFAULT \'pending\'' },
    { name: 'consistency_score', type: 'FLOAT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_dialogues', [
    { name: 'dialogue_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'frame_id', type: 'VARCHAR(64)' },
    { name: 'episode_id', type: 'VARCHAR(64)' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'character_id', type: 'VARCHAR(64)' },
    { name: 'character_name', type: 'VARCHAR(128)' },
    { name: 'line_text', type: 'MEDIUMTEXT' },
    { name: 'emotion', type: 'VARCHAR(32) DEFAULT \'neutral\'' },
    { name: 'action_description', type: 'TEXT' },
    { name: 'duration_estimate', type: 'VARCHAR(32)' },
    { name: 'audio_url', type: 'VARCHAR(512)' },
    { name: 'tts_provider', type: 'VARCHAR(32)' },
    { name: 'tts_voice_id', type: 'VARCHAR(128)' },
    { name: 'tts_status', type: 'VARCHAR(16) DEFAULT \'pending\'' },
    { name: 'speed', type: 'FLOAT DEFAULT 1.0' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('drama_templates', [
    { name: 'template_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'category', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: '`key`', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'name', type: 'VARCHAR(128) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'TEXT' },
    { name: 'prompt_system', type: 'TEXT' },
    { name: 'prompt_example', type: 'TEXT' },
    { name: 'output_schema', type: 'TEXT' },
    { name: 'parameters_json', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_jobs', [
    { name: 'job_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'bull_job_id', type: 'VARCHAR(128)' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'enterprise_id', type: 'BIGINT' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'episode_id', type: 'VARCHAR(64)' },
    { name: 'frame_id', type: 'VARCHAR(64)' },
    { name: 'job_type', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'payload_json', type: 'MEDIUMTEXT' },
    { name: 'result_json', type: 'MEDIUMTEXT' },
    { name: 'status', type: 'VARCHAR(16) NOT NULL DEFAULT \'pending\'' },
    { name: 'progress', type: 'INTEGER DEFAULT 0' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
    { name: 'max_retries', type: 'INTEGER DEFAULT 3' },
    { name: 'started_at', type: 'DATETIME' },
    { name: 'completed_at', type: 'DATETIME' },
    { name: 'duration_ms', type: 'BIGINT' },
    { name: 'cost_points', type: 'BIGINT DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_dialogue_emotions', [
    { name: 'emotion_key', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'label_zh', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'VARCHAR(255)' },
    { name: 'tts_speed_modifier', type: 'FLOAT DEFAULT 1.0' },
    { name: 'tts_volume_modifier', type: 'FLOAT DEFAULT 1.0' },
    { name: 'tts_pitch_modifier', type: 'FLOAT DEFAULT 0.0' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME' },
  ]);

  ensure('sw_shot_types', [
    { name: 'shot_key', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'label_zh', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'VARCHAR(255)' },
    { name: 'default_duration', type: 'VARCHAR(32)' },
    { name: 'icon', type: 'VARCHAR(64)' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME' },
  ]);

  ensure('sw_genres', [
    { name: 'genre_key', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'label_zh', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'VARCHAR(255)' },
    { name: 'tags_json', type: 'TEXT' },
    { name: 'default_episode_count', type: 'INTEGER DEFAULT 10' },
    { name: 'default_style', type: 'VARCHAR(32)' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME' },
  ]);

  ensure('sw_styles', [
    { name: 'style_key', type: 'VARCHAR(32) NOT NULL DEFAULT \'\'' },
    { name: 'label_zh', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'description', type: 'VARCHAR(255)' },
    { name: 'prompt_bias', type: 'TEXT' },
    { name: 'sort_order', type: 'INTEGER DEFAULT 0' },
    { name: 'is_active', type: 'TINYINT DEFAULT 1' },
    { name: 'created_at', type: 'DATETIME' },
  ]);

  // S1-T02: 多轮对话表
  ensure('sw_chat_sessions', [
    { name: 'session_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'user_id', type: 'BIGINT' },
    { name: 'outline_id', type: 'VARCHAR(64)' },
    { name: 'episode_id', type: 'VARCHAR(64)' },
    { name: 'title', type: 'VARCHAR(255)' },
    { name: 'context_type', type: 'VARCHAR(32) DEFAULT \'general\'' },
    { name: 'messages_count', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);

  ensure('sw_chat_messages', [
    { name: 'session_id', type: 'VARCHAR(64) NOT NULL DEFAULT \'\'' },
    { name: 'role', type: 'VARCHAR(16) NOT NULL DEFAULT \'user\'' },
    { name: 'content', type: 'TEXT' },
    { name: 'message_order', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
  ]);

  // ====== Sprint 2: 角色一致性 — character_embeddings + consistency_check_logs ======
  ensure('character_libraries', [
    { name: 'face_embedding', type: 'TEXT' },
    { name: 'embedding_model', type: 'VARCHAR(100)' },
    { name: 'embedding_generated_at', type: 'DATETIME' },
    { name: 'consistency_threshold', type: 'FLOAT DEFAULT 0.85' },
  ]);
  ensure('characters', [
    { name: 'face_embedding', type: 'TEXT' },
    { name: 'embedding_model', type: 'VARCHAR(100)' },
    { name: 'embedding_generated_at', type: 'DATETIME' },
    { name: 'consistency_threshold', type: 'FLOAT DEFAULT 0.85' },
  ]);
  ensure('character_embeddings', [
    { name: 'character_id', type: 'INTEGER NOT NULL' },
    { name: 'character_type', type: "VARCHAR(20) DEFAULT 'project'" },
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'view_angle', type: "VARCHAR(50) DEFAULT 'front'" },
    { name: 'image_url', type: 'VARCHAR(500)' },
    { name: 'embedding', type: 'TEXT NOT NULL' },
    { name: 'embedding_model', type: 'VARCHAR(100)' },
    { name: 'embedding_dim', type: 'INTEGER' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'updated_at', type: 'DATETIME' },
  ]);
  ensure('consistency_check_logs', [
    { name: 'check_id', type: 'VARCHAR(64) NOT NULL' },
    { name: 'drama_id', type: 'INTEGER' },
    { name: 'storyboard_id', type: 'INTEGER' },
    { name: 'character_id', type: 'INTEGER' },
    { name: 'generated_image_url', type: 'VARCHAR(500)' },
    { name: 'reference_image_url', type: 'VARCHAR(500)' },
    { name: 'similarity_score', type: 'FLOAT NOT NULL DEFAULT 0' },
    { name: 'threshold', type: 'FLOAT DEFAULT 0.85' },
    { name: 'passed', type: 'INTEGER DEFAULT 0' },
    { name: 'check_method', type: "VARCHAR(50) DEFAULT 'cosine_embedding'" },
    { name: 'detail_json', type: 'TEXT' },
    { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'DATETIME' },
  ]);
}

/**
 * 升级关键数值列为 BIGINT（避免 MySQL INT 4 字节 = 21 亿上界导致溢出）。
 * - 对 MySQL：执行 ALTER TABLE ... MODIFY COLUMN ... BIGINT，若已是 BIGINT 则自动 skip
 * - 对 SQLite：INTEGER 天然变长度 (1/2/3/4/6/8 字节，能存到 2^63-1)，不需要变更；但会检查列存在
 */
function ensureBigIntColumns(database) {
  const targets = [
    { table: 'point_logs', column: 'amount',        def: 'BIGINT NOT NULL DEFAULT 0' },
    { table: 'point_logs', column: 'balance_after', def: 'BIGINT DEFAULT 0' }
  ];

  for (const t of targets) {
    try {
      let currentType = null;
      if (database.type === 'mysql') {
        const row = database.prepare(`SHOW COLUMNS FROM ${t.table} LIKE ?`).get(t.column);
        currentType = row ? String(row.Type || '').toLowerCase() : null;
      } else {
        const rows = database.prepare(`PRAGMA table_info(${t.table})`).all();
        const hit = rows.find((r) => (r.name || '').toLowerCase() === String(t.column).toLowerCase());
        currentType = hit ? String(hit.type || '').toLowerCase() : null;
      }
      if (currentType === null) {
        console.log(`[ensureBigInt] column not found: ${t.table}.${t.column} -> add by ensureAllColumns automatically`);
        continue;
      }
      if (currentType.startsWith('bigint')) {
        console.log(`[ensureBigInt] ${t.table}.${t.column} already BIGINT, skip`);
        continue;
      }

      if (database.type === 'mysql') {
        database.exec(`ALTER TABLE ${t.table} MODIFY COLUMN \`${t.column}\` ${t.def}`);
        console.log(`[ensureBigInt] ${t.table}.${t.column} upgraded to BIGINT (${currentType} -> BIGINT)`);
      } else {
        // SQLite INTEGER 能自然容纳到 2^63-1，不再做表重建（风险高），只打印提示
        console.log(`[ensureBigInt] ${t.table}.${t.column} type=${currentType} (SQLite INTEGER auto-variable-width, safe up to 2^63-1)`);
      }
    } catch (err) {
      console.warn(`[ensureBigInt] ${t.table}.${t.column} upgrade skipped:`, err.message);
    }
  }
}

function runMigrationsAndEnsure(database) {
  runMigrations(database);
  ensureAllColumns(database);
  ensureBigIntColumns(database);
}

function main() {
  const config = loadConfig();
  const database = getDb(config.database);
  
  if (database.type === 'mysql') {
    database.exec(`CREATE DATABASE IF NOT EXISTS \`${config.database.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    database.exec(`USE \`${config.database.database}\``);
  }
  
  runMigrationsAndEnsure(database);
  console.log('Migrations complete.');
}

if (require.main === module) {
  main();
}

module.exports = { runMigrationsAndEnsure, ensureColumns };