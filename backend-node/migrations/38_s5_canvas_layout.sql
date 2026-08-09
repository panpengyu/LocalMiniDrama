-- ============================================================
-- Sprint 5: 无限画布 — 分区 / 视口 / 书签 持久化增强
-- Migration 38
-- 说明：
--   1. canvas_layouts 表扩展存储分区折叠状态（zone_collapsed）
--   2. 新增 canvas_bookmarks 表，存储视图书签（S6 预留但本 sprint 已有字段）
--   3. dramas.metadata JSON 字段已经用于画布布局，本文件确认兼容
--   4. 保持向后兼容：新列有默认值
-- ============================================================

-- 1) dramas.metadata 已经是 JSON，无需改表；这里仅确保 drama_templates.metadata 也是 JSON 兼容
--    （如 31/32 号迁移已建 drama_templates 表，这里确保 metadata 列可用）
SET @dbt = (SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates');
SET @dt_has_meta = (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drama_templates' AND COLUMN_NAME = 'metadata');
-- 如果表存在且已有 metadata 列 → MODIFY；表存在但无 metadata 列 → ADD；表不存在 → 跳过
SET @sql1 = IF(@dbt > 0 AND @dt_has_meta > 0,
  'ALTER TABLE drama_templates MODIFY COLUMN metadata JSON NULL COMMENT ''模板元数据（含默认分区/默认视口）''',
  IF(@dbt > 0,
    'ALTER TABLE drama_templates ADD COLUMN metadata JSON NULL COMMENT ''模板元数据（含默认分区/默认视口）''',
    'SELECT ''drama_templates 表不存在，跳过'' AS note'));
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- 2) 新建 canvas_bookmarks 表（书签：常用视口位置，一键跳转）
CREATE TABLE IF NOT EXISTS canvas_bookmarks (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  drama_id      BIGINT UNSIGNED NOT NULL COMMENT '所属短剧项目ID',
  user_id       BIGINT UNSIGNED NOT NULL COMMENT '创建用户ID',
  name          VARCHAR(128)    NOT NULL COMMENT '书签名称',
  viewport_x    DOUBLE PRECISION NOT NULL DEFAULT 0 COMMENT '视口X偏移',
  viewport_y    DOUBLE PRECISION NOT NULL DEFAULT 0 COMMENT '视口Y偏移',
  viewport_zoom DOUBLE PRECISION NOT NULL DEFAULT 0.5 COMMENT '视口缩放比例',
  zone_key      VARCHAR(64)     NULL COMMENT '关联分区key（可选）',
  color         VARCHAR(16)     NULL DEFAULT '#60a5fa' COMMENT '书签颜色标记',
  sort_order    INT             NOT NULL DEFAULT 0 COMMENT '排序值',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_drama_user (drama_id, user_id),
  KEY idx_sort (drama_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S5/S6: 画布视图书签表';

-- 3) canvas_layouts 表：如果不存在则新建（已有就跳过）；同时确认 zone_collapsed 列
SET @cl_exist = (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts');
SET @sql2 = IF(@cl_exist = 0,
  'CREATE TABLE canvas_layouts (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      drama_id        BIGINT UNSIGNED NOT NULL UNIQUE,
      viewport        JSON NULL COMMENT ''视口状态{x,y,zoom}'',
      nodes           JSON NULL COMMENT ''节点位置列表'',
      zone_collapsed  JSON NULL COMMENT ''S5: 分区折叠状态{characters:bool,...}'',
      meta            JSON NULL COMMENT ''其他元数据'',
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_drama (drama_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT=''S5: 画布布局持久化表''',
  'SELECT ''canvas_layouts 已存在'' AS note');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- 4) canvas_layouts 如果已有但缺少 zone_collapsed 列，补上
SET @zc_exist = (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'zone_collapsed');
SET @sql3 = IF(@zc_exist = 0 AND @cl_exist > 0,
  'ALTER TABLE canvas_layouts ADD COLUMN zone_collapsed JSON NULL COMMENT ''S5: 分区折叠状态'' AFTER nodes',
  'SELECT ''zone_collapsed 列已存在或表不存在'' AS note');
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- ============================================================
-- 数据一致性：dramas.metadata 作为持久化布局的主存储（现有结构）
-- canvas_layouts 是独立表，用于大项目性能优化。两者可以双写，读以 metadata 为准。
-- ============================================================
