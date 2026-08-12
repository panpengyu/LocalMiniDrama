-- ============================================================
-- Sprint 12: 修复 user_lifecycle.churn_risk 列类型
-- Migration 46
--
-- 背景：
--   45 号迁移中 user_lifecycle.churn_risk 定义为 FLOAT（原意 0~1 风险值），
--   但 S12-T04 服务(userLifecycleService.computeLifecycle) 实际写入的是语义标签
--   'high' / 'medium' / 'low'，与路由过滤、churnWarnings 的 FIELD 排序、
--   前端 UserLifecycle.vue 的下拉/标签/颜色完全一致。
--
--   在 MySQL(严格类型)下向 FLOAT 列写字符串会被截断为 0（WARN_DATA_TRUNCATED），
--   导致流失风险分级数据丢失；在 SQLite(动态类型)下则无此问题，故单测未暴露。
--
-- 修复：
--   将 churn_risk 改为 VARCHAR(12)，与全栈语义标签保持一致。
--   MySQL 执行 MODIFY；SQLite 为动态类型不支持 MODIFY，由 migrate.js runOne 安全跳过。
-- ============================================================

ALTER TABLE user_lifecycle MODIFY COLUMN churn_risk VARCHAR(12) NOT NULL DEFAULT 'low';
