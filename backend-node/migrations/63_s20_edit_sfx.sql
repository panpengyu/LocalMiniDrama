-- ============================================================
-- 63_s20_edit_sfx.sql  Sprint 20 - 智能剪辑效果参数 + 音效标签
-- 幂等：MySQL 不允许 ADD COLUMN IF NOT EXISTS，重复执行时迁移器会跳过
-- "Duplicate column name" 错误；SQLite 的 ADD COLUMN 重复会抛
-- "duplicate column name"，同样被迁移器安全跳过。
-- ============================================================

-- 智能剪辑任务：字幕/水印/调色效果参数（S20-T03 参数透传落库）
ALTER TABLE edit_tasks ADD COLUMN subtitle_enabled TINYINT NULL;
ALTER TABLE edit_tasks ADD COLUMN subtitle_text VARCHAR(1000) NULL;
ALTER TABLE edit_tasks ADD COLUMN subtitle_style VARCHAR(255) NULL;
ALTER TABLE edit_tasks ADD COLUMN watermark_text VARCHAR(255) NULL;
ALTER TABLE edit_tasks ADD COLUMN watermark_position VARCHAR(32) NULL;
ALTER TABLE edit_tasks ADD COLUMN color_grade VARCHAR(32) NULL;
ALTER TABLE edit_tasks ADD COLUMN brightness FLOAT NULL;
ALTER TABLE edit_tasks ADD COLUMN contrast FLOAT NULL;
ALTER TABLE edit_tasks ADD COLUMN saturation FLOAT NULL;
ALTER TABLE edit_tasks ADD COLUMN sfx_matches JSON NULL;

-- 素材表增加 tags：音效智能匹配基于用户自有素材标签（S20-T04）
ALTER TABLE assets ADD COLUMN tags VARCHAR(500) NULL;
