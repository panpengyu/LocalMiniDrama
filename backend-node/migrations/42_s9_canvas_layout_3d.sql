-- ============================================================
-- Sprint 9: 3D导演台 — canvas_layouts 表 3D 字段扩展
-- Migration 42
--
-- 说明：
--   S9-T07: canvas_layout 数据结构扩展
--   增加 view_mode / camera_3d / camera_preset 字段，支持 2D/3D 视图模式持久化
--   nodes 字段（JSON）内部结构扩展 z / layer 子字段，无需改表结构
--
-- 字段说明：
--   view_mode      VARCHAR(16)  — 当前视图模式: '2d' | '3d'，默认 '2d'
--   camera_3d      JSON         — 3D摄像机状态 { position:{x,y,z}, target:{x,y,z}, fov, preset }
--   camera_preset  VARCHAR(32)  — 当前预设机位名称: front/side/top/free/close_up/bird_view
--
-- 兼容性：
--   - 旧数据 view_mode 为 NULL，后端读取时默认 '2d'，保持向后兼容
--   - camera_3d / camera_preset 为 NULL 时，前端使用默认机位 'free'
--   - nodes JSON 内的节点对象可选包含 z / layer 字段，旧数据无此字段时使用类型默认深度
-- ============================================================

-- 1) 确认 canvas_layouts 表存在（38号迁移创建）；若不存在则创建最小结构
SET @cl_exist = (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts');
SET @sql_create = IF(@cl_exist = 0,
  'CREATE TABLE canvas_layouts (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      drama_id        BIGINT UNSIGNED NOT NULL UNIQUE,
      viewport        JSON NULL COMMENT ''视口状态{x,y,zoom}'',
      nodes           JSON NULL COMMENT ''节点位置列表(含可选z/layer)'',
      zone_collapsed  JSON NULL COMMENT ''分区折叠状态'',
      meta            JSON NULL COMMENT ''其他元数据'',
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_drama (drama_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT=''画布布局持久化表''',
  'SELECT ''canvas_layouts 已存在'' AS note');
PREPARE stmt_create FROM @sql_create; EXECUTE stmt_create; DEALLOCATE PREPARE stmt_create;

-- 2) 添加 view_mode 列（若不存在）
SET @has_view_mode = (SELECT COUNT(*) FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'view_mode');
SET @sql_vm = IF(@has_view_mode = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN view_mode VARCHAR(16) NOT NULL DEFAULT ''2d'' COMMENT ''S9: 视图模式 2d|3d'' AFTER zone_collapsed',
  'SELECT ''view_mode 列已存在'' AS note');
PREPARE stmt_vm FROM @sql_vm; EXECUTE stmt_vm; DEALLOCATE PREPARE stmt_vm;

-- 3) 添加 camera_3d 列（若不存在）
SET @has_cam3d = (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'camera_3d');
SET @sql_c3d = IF(@has_cam3d = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN camera_3d JSON NULL COMMENT ''S9: 3D摄像机状态{position,target,fov,preset}'' AFTER view_mode',
  'SELECT ''camera_3d 列已存在'' AS note');
PREPARE stmt_c3d FROM @sql_c3d; EXECUTE stmt_c3d; DEALLOCATE PREPARE stmt_c3d;

-- 4) 添加 camera_preset 列（若不存在）
Set @has_cam_preset = (SELECT COUNT(*) FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'camera_preset');
SET @sql_cp = IF(@has_cam_preset = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN camera_preset VARCHAR(32) NULL COMMENT ''S9: 预设机位 front/side/top/free/close_up/bird_view'' AFTER camera_3d',
  'SELECT ''camera_preset 列已存在'' AS note');
PREPARE stmt_cp FROM @sql_cp; EXECUTE stmt_cp; DEALLOCATE PREPARE stmt_cp;

-- 5) 数据回填：已有记录的 view_mode 默认为 '2d'（由 DEFAULT 子句自动处理）
--    camera_3d / camera_preset 保持 NULL，前端读取后使用默认值

-- 6) 验证：输出当前表结构关键列
SELECT
  COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'canvas_layouts'
  AND COLUMN_NAME IN ('view_mode', 'camera_3d', 'camera_preset', 'nodes', 'zone_collapsed')
ORDER BY ORDINAL_POSITION;
