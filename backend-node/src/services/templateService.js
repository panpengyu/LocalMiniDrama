// 模板服务：drama_templates 的 CRUD + 筛选 + 应用模板创建项目
// 数据库使用 better-sqlite3（同步 API），SQL 兼容 MySQL（标准 SQL，`key` 用反引号转义）。

const dramaService = require('./dramaService');

/**
 * 解析 JSON 列：兼容 MySQL JSON 类型（返回对象）与 TEXT 类型（返回字符串）。
 */
function parseJson(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

/**
 * 序列化为 JSON 字符串：对象 → JSON 字符串；字符串原样返回；null/undefined → null。
 */
function stringifyJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return null;
  }
}

/**
 * 将数据库行转换为对外模板对象（JSON 列统一解析为对象）。
 */
function rowToTemplate(r) {
  if (!r) return null;
  return {
    id: r.id,
    template_id: r.template_id,
    category: r.category,
    key: r.key,
    name: r.name,
    description: r.description,
    prompt_system: r.prompt_system,
    prompt_example: r.prompt_example,
    output_schema: parseJson(r.output_schema),
    parameters_json: parseJson(r.parameters_json),
    sort_order: r.sort_order == null ? 0 : Number(r.sort_order),
    is_active: r.is_active == null ? 1 : Number(r.is_active),
    genre_type: r.genre_type,
    character_presets: parseJson(r.character_presets),
    scene_presets: parseJson(r.scene_presets),
    storyboard_rhythm: parseJson(r.storyboard_rhythm),
    style_config: parseJson(r.style_config),
    cover_image: r.cover_image,
    preview_data: parseJson(r.preview_data),
    metadata: parseJson(r.metadata),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * 生成唯一的 template_id（带冲突检测，最多重试 10 次）。
 */
function generateTemplateId(db) {
  for (let i = 0; i < 10; i++) {
    const candidate =
      'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const exists = db
      .prepare('SELECT 1 FROM drama_templates WHERE template_id = ?')
      .get(candidate);
    if (!exists) return candidate;
  }
  return 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

/**
 * 列表查询：支持按 category / genreType / isActive / keyword 筛选，分页。
 */
function listTemplates(db, query = {}) {
  const { category, genreType, isActive, keyword, page, pageSize } = query;

  let sql = 'FROM drama_templates WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (genreType) {
    sql += ' AND genre_type = ?';
    params.push(genreType);
  }
  if (isActive != null && isActive !== '') {
    sql += ' AND is_active = ?';
    params.push(Number(isActive) ? 1 : 0);
  }
  if (keyword) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const k = '%' + keyword + '%';
    params.push(k, k);
  }

  const countRow = db.prepare('SELECT COUNT(*) AS total ' + sql).get(...params);
  const total = countRow ? Number(countRow.total || 0) : 0;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (p - 1) * ps;

  const rows = db
    .prepare(
      'SELECT * ' +
        sql +
        ' ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?'
    )
    .all(...params, ps, offset);

  return {
    templates: rows.map(rowToTemplate),
    total,
    page: p,
    pageSize: ps,
  };
}

/**
 * 按主键 id 获取单个模板详情。
 */
function getTemplateById(db, id) {
  const row = db
    .prepare('SELECT * FROM drama_templates WHERE id = ?')
    .get(Number(id));
  return rowToTemplate(row);
}

/**
 * 按 template_id 字符串获取模板。
 */
function getTemplateByTemplateId(db, templateId) {
  const row = db
    .prepare('SELECT * FROM drama_templates WHERE template_id = ?')
    .get(templateId);
  return rowToTemplate(row);
}

/**
 * 创建模板，自动生成 template_id（若未提供）。
 */
function createTemplate(db, data) {
  const now = new Date().toISOString();
  const templateId = data.template_id || generateTemplateId(db);
  const keyVal = data.key || templateId;

  db.prepare(
    `INSERT INTO drama_templates
      (template_id, category, \`key\`, name, description, prompt_system, prompt_example,
       output_schema, parameters_json, sort_order, is_active, genre_type,
       character_presets, scene_presets, storyboard_rhythm, style_config,
       cover_image, preview_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    templateId,
    data.category || 'genre',
    keyVal,
    data.name,
    data.description || null,
    data.prompt_system || null,
    data.prompt_example || null,
    stringifyJson(data.output_schema),
    stringifyJson(data.parameters_json),
    data.sort_order == null ? 0 : Number(data.sort_order),
    data.is_active == null ? 1 : Number(data.is_active) ? 1 : 0,
    data.genre_type || null,
    stringifyJson(data.character_presets),
    stringifyJson(data.scene_presets),
    stringifyJson(data.storyboard_rhythm),
    stringifyJson(data.style_config),
    data.cover_image || null,
    stringifyJson(data.preview_data),
    now,
    now
  );

  return getTemplateByTemplateId(db, templateId);
}

/**
 * 更新模板：仅更新 data 中显式提供的字段。
 */
function updateTemplate(db, id, data) {
  const existing = getTemplateById(db, id);
  if (!existing) return null;

  const updates = [];
  const params = [];

  const scalarFields = [
    'template_id',
    'category',
    'key',
    'name',
    'description',
    'prompt_system',
    'prompt_example',
    'sort_order',
    'genre_type',
    'cover_image',
  ];
  for (const col of scalarFields) {
    if (col in data) {
      // `key` 是 MySQL 保留字，需反引号
      const quoted = col === 'key' ? '`key`' : col;
      updates.push(`${quoted} = ?`);
      params.push(data[col]);
    }
  }

  if ('is_active' in data) {
    updates.push('is_active = ?');
    params.push(Number(data.is_active) ? 1 : 0);
  }

  const jsonFields = [
    'output_schema',
    'parameters_json',
    'character_presets',
    'scene_presets',
    'storyboard_rhythm',
    'style_config',
    'preview_data',
  ];
  for (const col of jsonFields) {
    if (col in data) {
      updates.push(`${col} = ?`);
      params.push(stringifyJson(data[col]));
    }
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(Number(id));

  db.prepare(
    'UPDATE drama_templates SET ' + updates.join(', ') + ' WHERE id = ?'
  ).run(...params);

  return getTemplateById(db, id);
}

/**
 * 软删除模板（设 is_active=0）。
 */
function deleteTemplate(db, id) {
  const existing = getTemplateById(db, id);
  if (!existing) return false;
  db.prepare(
    'UPDATE drama_templates SET is_active = 0, updated_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), Number(id));
  return true;
}

/**
 * 应用模板创建新项目：
 *  - 从模板读取 character_presets / scene_presets / style_config 等
 *  - 调用 dramaService.createDrama 创建项目
 *  - 将角色预设写入 characters 表
 *  - 将场景预设写入 scenes 表
 *  - 将模板的 style_config 写入 drama.metadata
 * 整个过程在事务中执行，失败自动回滚。
 */
function applyTemplate(db, log, templateId, options = {}) {
  const template = getTemplateByTemplateId(db, templateId);
  if (!template) return null;

  const { title, userId, enterpriseId, teamId } = options;

  const characterPresets = Array.isArray(template.character_presets)
    ? template.character_presets
    : [];
  const scenePresets = Array.isArray(template.scene_presets)
    ? template.scene_presets
    : [];
  const styleConfig = template.style_config || {};

  const user = {
    id: userId || null,
    enterprise_id: enterpriseId || null,
    team_id: teamId || null,
  };

  const dramaReq = {
    title: title || template.name,
    description: template.description,
    genre: template.genre_type,
    style: (styleConfig && styleConfig.globalStyle) || 'realistic',
    metadata: {
      template_id: template.template_id,
      template_name: template.name,
      style_config: styleConfig,
      storyboard_rhythm: template.storyboard_rhythm || null,
    },
  };

  const tx = db.transaction(() => {
    const drama = dramaService.createDrama(db, log, dramaReq, user);
    if (!drama) throw new Error('创建项目失败');

    const dramaId = drama.id;
    const now = new Date().toISOString();

    // 写入角色预设
    if (characterPresets.length > 0) {
      const charStmt = db.prepare(
        `INSERT INTO characters
          (drama_id, name, role, description, personality, appearance, voice_style,
           sort_order, identity_anchors, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      characterPresets.forEach((c, idx) => {
        charStmt.run(
          dramaId,
          c.name || '角色' + (idx + 1),
          c.role || null,
          c.description || null,
          c.personality || null,
          c.appearance || null,
          c.voice_style || null,
          c.sort_order == null ? idx : Number(c.sort_order),
          c.identity_anchors ? stringifyJson(c.identity_anchors) : null,
          now,
          now
        );
      });
    }

    // 写入场景预设
    // 注：scenes 表无 name/description/sort_order 列，故将 name+description 合并写入 prompt。
    if (scenePresets.length > 0) {
      const sceneStmt = db.prepare(
        `INSERT INTO scenes
          (drama_id, episode_id, location, time, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      scenePresets.forEach((s) => {
        const prompt = [s.name, s.description].filter(Boolean).join('：') || null;
        sceneStmt.run(
          dramaId,
          null,
          s.location || null,
          s.time || null,
          prompt,
          now,
          now
        );
      });
    }

    return { dramaId, charCount: characterPresets.length, sceneCount: scenePresets.length };
  });

  const result = tx();

  log.info('Template applied', {
    template_id: templateId,
    drama_id: result.dramaId,
    characters: result.charCount,
    scenes: result.sceneCount,
  });

  const drama = dramaService.getDramaById(db, result.dramaId);
  if (drama) {
    drama.applied_characters_count = result.charCount;
    drama.applied_scenes_count = result.sceneCount;
  }
  return drama;
}

module.exports = {
  listTemplates,
  getTemplateById,
  getTemplateByTemplateId,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
};
