-- ============================================================
-- Sprint 10: 3D导演台 — 角色站位 + 场景深度 + 时间轴3D 字段扩展
-- Migration 43
--
-- 说明：
--   S10-T04: 角色站位编排 — character_stage JSON 存储站位模式/位置/关系
--   S10-T05: 场景深度预览 — scene_depth JSON 存储场景深度分层数据
--   S10-T06: 时间轴3D化  — timeline_3d JSON 存储3D时间轴布局
--
-- 字段说明：
--   character_stage  JSON  — { pattern, spacing, positions:{nodeId:{x,y,z}}, relations:[{from,to,type}] }
--   scene_depth      JSON  — { enabled, scenes:[{id, z, imageUrl, name}] }
--   timeline_3d      JSON  — { enabled, positions:{nodeId:{x,y,z}} }
--
-- 兼容性：
--   - 新增字段均为 NULL，旧数据不受影响
--   - 前端读取 NULL 时使用默认值（不启用对应功能）
-- ============================================================

-- 1) 添加 character_stage 列（若不存在）
SET @has_cs = (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'character_stage');
SET @sql_cs = IF(@has_cs = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN character_stage JSON NULL COMMENT ''S10-T04: 角色站位编排{pattern,positions,relations}'' AFTER camera_preset',
  'SELECT ''character_stage 列已存在'' AS note');
PREPARE stmt_cs FROM @sql_cs; EXECUTE stmt_cs; DEALLOCATE PREPARE stmt_cs;

-- 2) 添加 scene_depth 列（若不存在）
SET @has_sd = (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'scene_depth');
SET @sql_sd = IF(@has_sd = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN scene_depth JSON NULL COMMENT ''S10-T05: 场景深度预览{enabled,scenes}'' AFTER character_stage',
  'SELECT ''scene_depth 列已存在'' AS note');
PREPARE stmt_sd FROM @sql_sd; EXECUTE stmt_sd; DEALLOCATE PREPARE stmt_sd;

-- 3) 添加 timeline_3d 列（若不存在）
SET @has_t3d = (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts' AND COLUMN_NAME = 'timeline_3d');
SET @sql_t3d = IF(@has_t3d = 0,
  'ALTER TABLE canvas_layouts ADD COLUMN timeline_3d JSON NULL COMMENT ''S10-T06: 3D时间轴{enabled,positions}'' AFTER scene_depth',
  'SELECT ''timeline_3d 列已存在'' AS note');
PREPARE stmt_t3d FROM @sql_t3d; EXECUTE stmt_t3d; DEALLOCATE PREPARE stmt_t3d;

-- 4) 验证：输出当前表结构关键列
SELECT
  COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_layouts'
  AND COLUMN_NAME IN ('character_stage', 'scene_depth', 'timeline_3d')
ORDER BY ORDINAL_POSITION
