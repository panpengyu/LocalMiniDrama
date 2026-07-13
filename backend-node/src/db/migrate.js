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
}

function runMigrationsAndEnsure(database) {
  runMigrations(database);
  ensureAllColumns(database);
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