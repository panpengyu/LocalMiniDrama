-- S18-T01 事件埋点系统：tracking_events
-- 幂等：CREATE TABLE IF NOT EXISTS，重复执行自动跳过（migrate.js 捕获 ER_TABLE_EXISTS_ERROR 标 Skip）
CREATE TABLE IF NOT EXISTS tracking_events (
  id BIGINT NOT NULL COMMENT '雪花 ID 主键',
  user_id BIGINT NULL COMMENT '登录用户 ID（可空，允许匿名上报）',
  anonymous_id VARCHAR(64) NULL COMMENT '匿名身份标识（前端 localStorage 持久化）',
  event VARCHAR(64) NOT NULL COMMENT '事件名：page_view / click / create_drama / pay_success 等',
  category VARCHAR(32) NULL COMMENT '事件分类：navigation / click / business / performance',
  page VARCHAR(128) NULL COMMENT '发生页面路径',
  attrs JSON NULL COMMENT '事件附加属性（JSON）',
  ip VARCHAR(64) NULL COMMENT '来源 IP（脱敏展示）',
  created_at DATETIME NOT NULL COMMENT '事件时间',
  PRIMARY KEY (id),
  KEY idx_tracking_user_ts (user_id, created_at),
  KEY idx_tracking_event_ts (event, created_at),
  KEY idx_tracking_anon (anonymous_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事件埋点';
