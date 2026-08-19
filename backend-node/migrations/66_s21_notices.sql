-- ============================================================
-- 66_s21_notices.sql  Sprint 21 - 通知公告表（批 B · Notices）
-- 幂等：CREATE TABLE IF NOT EXISTS；MySQL/SQLite 双兼容
-- ============================================================

CREATE TABLE IF NOT EXISTS notices (
  id BIGINT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '公告标题',
  content TEXT COMMENT '公告正文',
  type VARCHAR(20) NOT NULL DEFAULT 'notice' COMMENT '类型: notice/announcement/maintenance',
  level VARCHAR(16) NOT NULL DEFAULT 'info' COMMENT '级别: info/warning/critical',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1发布/0下架',
  is_top TINYINT NOT NULL DEFAULT 0 COMMENT '是否置顶',
  publisher VARCHAR(64) COMMENT '发布人',
  publish_at DATETIME COMMENT '计划发布时间',
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  KEY idx_status_publish (status, publish_at)
);
