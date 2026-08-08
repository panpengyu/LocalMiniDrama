-- ============================================================
-- 32_rename_sw_templates_to_drama_templates.sql
-- Sprint 1 修正：将 sw_templates 重命名为 drama_templates
-- 兼容已有数据库：如果 sw_templates 不存在会报 ER_NO_SUCH_TABLE，
-- migrate.js runOne 会静默跳过；如果 drama_templates 已存在，
-- MySQL 会报 ER_TABLE_EXISTS_ERROR，同样被跳过。
-- ============================================================

RENAME TABLE sw_templates TO drama_templates
