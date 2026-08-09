-- ============================================================
-- Sprint 6: 模板系统扩展 + 画布标注表
-- 编号: 39
-- ============================================================

-- ------------------------------------------------------------
-- 1) drama_templates 表扩展：类型/角色预设/场景预设/分镜节奏/风格配置
-- ------------------------------------------------------------
SET @dt_exists = (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates');

-- 仅在表存在时添加新列
SET @add_col = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'genre_type');
SET @sql1 = IF(@dt_exists > 0 AND @add_col = 0,
  'ALTER TABLE drama_templates ADD COLUMN genre_type VARCHAR(32) NULL COMMENT ''类型：urban_romance/ancient_fantasy/mystery/scifi/campus/youth/structure''',
  'SELECT ''genre_type already exists or table missing'' AS note');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @add_col2 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'character_presets');
SET @sql2 = IF(@dt_exists > 0 AND @add_col2 = 0,
  'ALTER TABLE drama_templates ADD COLUMN character_presets JSON NULL COMMENT ''角色预设数组：[{name,role,personality,appearance}]''',
  'SELECT ''character_presets already exists or table missing'' AS note');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @add_col3 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'scene_presets');
SET @sql3 = IF(@dt_exists > 0 AND @add_col3 = 0,
  'ALTER TABLE drama_templates ADD COLUMN scene_presets JSON NULL COMMENT ''场景预设数组：[{name,location,time,description}]''',
  'SELECT ''scene_presets already exists or table missing'' AS note');
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

SET @add_col4 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'storyboard_rhythm');
SET @sql4 = IF(@dt_exists > 0 AND @add_col4 = 0,
  'ALTER TABLE drama_templates ADD COLUMN storyboard_rhythm JSON NULL COMMENT ''分镜节奏配置：{avgShotsPerEpisode, pacing, transitionStyle}''',
  'SELECT ''storyboard_rhythm already exists or table missing'' AS note');
PREPARE stmt4 FROM @sql4; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;

SET @add_col5 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'style_config');
SET @sql5 = IF(@dt_exists > 0 AND @add_col5 = 0,
  'ALTER TABLE drama_templates ADD COLUMN style_config JSON NULL COMMENT ''风格配置：{globalStyle,colorPalette,renderStyle,composition}''',
  'SELECT ''style_config already exists or table missing'' AS note');
PREPARE stmt5 FROM @sql5; EXECUTE stmt5; DEALLOCATE PREPARE stmt5;

SET @add_col6 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'cover_image');
SET @sql6 = IF(@dt_exists > 0 AND @add_col6 = 0,
  'ALTER TABLE drama_templates ADD COLUMN cover_image VARCHAR(512) NULL COMMENT ''模板封面图URL''',
  'SELECT ''cover_image already exists or table missing'' AS note');
PREPARE stmt6 FROM @sql6; EXECUTE stmt6; DEALLOCATE PREPARE stmt6;

SET @add_col7 = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'preview_data');
SET @sql7 = IF(@dt_exists > 0 AND @add_col7 = 0,
  'ALTER TABLE drama_templates ADD COLUMN preview_data JSON NULL COMMENT ''预览数据：示例大纲/角色/场景''',
  'SELECT ''preview_data already exists or table missing'' AS note');
PREPARE stmt7 FROM @sql7; EXECUTE stmt7; DEALLOCATE PREPARE stmt7;

-- 为 genre_type 添加索引
SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND INDEX_NAME = 'idx_genre_type');
SET @sql8 = IF(@dt_exists > 0 AND @add_idx = 0,
  'ALTER TABLE drama_templates ADD INDEX idx_genre_type (genre_type)',
  'SELECT ''idx_genre_type already exists'' AS note');
PREPARE stmt8 FROM @sql8; EXECUTE stmt8; DEALLOCATE PREPARE stmt8;

-- ------------------------------------------------------------
-- 2) canvas_annotations 表 — 画布标注（文字/箭头/框选）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_annotations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  drama_id BIGINT NOT NULL COMMENT '所属短剧项目',
  annotation_type VARCHAR(16) NOT NULL COMMENT 'text/arrow/box',
  -- 世界坐标（画布坐标空间，随缩放/平移变换）
  world_x DOUBLE NOT NULL COMMENT '标注世界坐标X',
  world_y DOUBLE NOT NULL COMMENT '标注世界坐标Y',
  world_x2 DOUBLE NULL COMMENT '箭头/框选的终点X（text 类型为 NULL）',
  world_y2 DOUBLE NULL COMMENT '箭头/框选的终点Y',
  content TEXT NULL COMMENT '文字内容（text 类型）',
  color VARCHAR(16) NOT NULL DEFAULT '#3b82f6' COMMENT '标注颜色',
  font_size INT NOT NULL DEFAULT 14 COMMENT '文字字号',
  created_by BIGINT NULL COMMENT '创建者用户ID',
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_annotations_drama (drama_id),
  INDEX idx_annotations_type (annotation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='画布标注表';

-- ------------------------------------------------------------
-- 3) canvas_bookmarks 表已存在（Sprint 5 migration 38 创建）
--    此处仅确认列完整性，如有缺失则补充
-- ------------------------------------------------------------
SET @cb_exists = (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_bookmarks');
SET @sql9 = IF(@cb_exists = 0,
  'CREATE TABLE IF NOT EXISTS canvas_bookmarks (id BIGINT PRIMARY KEY AUTO_INCREMENT, drama_id BIGINT NOT NULL, name VARCHAR(128) NOT NULL, viewport_x DOUBLE NOT NULL, viewport_y DOUBLE NOT NULL, viewport_zoom DOUBLE NOT NULL, sort_order INT DEFAULT 0, created_by BIGINT NULL, created_at DATETIME NULL, INDEX idx_bm_drama (drama_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=''画布视图书签表''',
  'SELECT ''canvas_bookmarks already exists'' AS note');
PREPARE stmt9 FROM @sql9; EXECUTE stmt9; DEALLOCATE PREPARE stmt9;
