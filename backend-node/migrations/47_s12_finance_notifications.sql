-- ============================================================
-- Sprint 12: S12-T05 财务欠费闭环 — 平台站内通知表
-- Migration 47
--
-- 说明：
--   collaboration_notifications 是项目协作专用（drama_id NOT NULL），
--   不适合承载"欠费提醒"这类与具体项目无关的平台级用户通知。
--   本迁移新增 platform_notifications 表，用于系统向单个用户推送的
--   平台级通知（欠费预警、余额不足、系统公告等）。
--
--   category: 通知分类  arrears(欠费预警) / system(系统) / finance(财务) ...
--   dedup_key: 幂等去重键（如 arrears:userId:yyyymmdd），配合唯一索引避免重复推送
--
-- 兼容性：
--   - 新增独立表，不改动既有表结构
--   - CREATE TABLE IF NOT EXISTS，重复执行幂等
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_notifications (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT       NOT NULL COMMENT '接收用户ID',
  category    VARCHAR(24)  NOT NULL DEFAULT 'system' COMMENT '通知分类: arrears/finance/system',
  level       VARCHAR(16)  NOT NULL DEFAULT 'info' COMMENT '级别: info/warning/critical',
  title       VARCHAR(200) NULL COMMENT '标题',
  content     VARCHAR(1000) NULL COMMENT '正文',
  payload     TEXT         NULL COMMENT '附加结构化数据(JSON)',
  dedup_key   VARCHAR(191) NULL COMMENT '幂等去重键，配合唯一索引避免重复推送',
  is_read     TINYINT      NOT NULL DEFAULT 0 COMMENT '0未读/1已读',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dedup (dedup_key),
  KEY idx_user_read (user_id, is_read),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T05 平台级用户站内通知(欠费预警等)';
