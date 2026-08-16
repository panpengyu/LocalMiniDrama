-- S19-T01/T02: 模型 A/B 测试 + 用量配额
-- 幂等策略：索引内联进 CREATE TABLE（MySQL 不支持 CREATE INDEX IF NOT EXISTS）；
-- 重复执行由 CREATE TABLE IF NOT EXISTS 跳过，ab_group 列重复 ADD 报 duplicate column 由 migrate.js 容错跳过。

-- ========== 1. 模型 A/B 测试配置表 ==========
CREATE TABLE IF NOT EXISTS model_ab_test (
  id BIGINT PRIMARY KEY,
  name VARCHAR(128) NOT NULL DEFAULT '',
  task_type VARCHAR(64) NOT NULL DEFAULT '',           -- 业务任务类型（与 ai_routing_rules.task_type 对齐）
  service_type VARCHAR(32) NOT NULL DEFAULT 'text',     -- image/video/text/tts
  group_a_config_id INT,                                -- A 组模型配置（ai_service_configs.id）
  group_a_model VARCHAR(255),                           -- A 组模型名
  group_b_config_id INT,                                -- B 组模型配置
  group_b_model VARCHAR(255),                           -- B 组模型名
  traffic_ratio_b INT NOT NULL DEFAULT 50,              -- B 组流量占比（0~100，A 组 = 100 - ratio）
  is_active TINYINT DEFAULT 0,                          -- 仅允许一个激活测试 / 同一 task_type
  description VARCHAR(500),
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  KEY idx_ab_test_task (task_type, is_active)
);

-- ========== 2. 模型用量配额表 ==========
-- scope_type: account=按用户 / model=按模型 / global=全局限额
-- period_type: daily / weekly / monthly；period_key 形如 2026-08-16 / 2026-W33 / 2026-08
CREATE TABLE IF NOT EXISTS model_usage_quota (
  id BIGINT PRIMARY KEY,
  scope_type VARCHAR(16) NOT NULL DEFAULT 'account',    -- account / model / global
  scope_value VARCHAR(128) NOT NULL DEFAULT '',         -- 用户ID / 模型名 / '*'
  period_type VARCHAR(16) NOT NULL DEFAULT 'daily',
  period_key VARCHAR(16) NOT NULL DEFAULT '',           -- 当前周期键
  quota_value BIGINT NOT NULL DEFAULT 0,                -- 周期内允许调用次数（0=不限）
  used_value BIGINT NOT NULL DEFAULT 0,                 -- 周期内已用次数（原子自增）
  is_active TINYINT DEFAULT 1,
  remark VARCHAR(255),
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE KEY uk_quota_scope_period (scope_type, scope_value, period_type, period_key)
);

-- ========== 3. 调用日志增加 A/B 分组列 ==========
ALTER TABLE ai_model_call_logs ADD COLUMN ab_group VARCHAR(16) NULL COMMENT 'A/B 测试分组 A/B';
