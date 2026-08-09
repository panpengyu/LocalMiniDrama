-- ============================================================
-- 36_s4_model_routing.sql — Sprint 4 AI模型智能路由引擎
-- S4-T07: 按任务类型/成本/质量自动选择模型 + 故障转移
-- ============================================================

-- ========== 1. 模型路由规则表 ==========
-- 定义不同任务类型的模型路由策略（智能路由决策）
CREATE TABLE IF NOT EXISTS ai_routing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key VARCHAR(64) NOT NULL UNIQUE,      -- 规则标识，如 image_simple / image_high_quality / text_storyboard
  task_type VARCHAR(32) NOT NULL,            -- 任务类型：image/video/text/tts
  quality_tier VARCHAR(32) DEFAULT 'standard', -- 质量层级：low/standard/high/premium
  primary_config_id INT,                     -- 主模型 ai_service_configs.id
  primary_model VARCHAR(255),                -- 主模型名称
  fallback_config_id INT,                    -- 备选模型（故障转移）
  fallback_model VARCHAR(255),               -- 备选模型名称
  max_cost_per_call DECIMAL(10,4) DEFAULT 0, -- 单次调用成本上限（元）
  priority INT DEFAULT 100,                  -- 优先级（越大越优先匹配）
  is_active TINYINT(1) DEFAULT 1,
  description VARCHAR(512),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rr_task ON ai_routing_rules(task_type, quality_tier, is_active);

-- ========== 2. 模型调用记录表 ==========
-- 记录每次模型调用的成本/耗时/质量评分，用于智能路由优化
CREATE TABLE IF NOT EXISTS ai_model_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id BIGINT,
  drama_id BIGINT,
  config_id INT,                             -- 使用的 ai_service_configs.id
  service_type VARCHAR(32),                  -- image/video/text/tts
  provider VARCHAR(64),                      -- 供应方
  model VARCHAR(255),                        -- 实际调用的模型
  task_type VARCHAR(64),                     -- 业务任务类型
  status VARCHAR(32) DEFAULT 'success',      -- success/failed/timeout/fallback
  is_fallback TINYINT(1) DEFAULT 0,          -- 是否为故障转移调用
  latency_ms INT DEFAULT 0,                  -- 耗时（毫秒）
  cost DECIMAL(10,4) DEFAULT 0,              -- 估算成本（元）
  quality_score DECIMAL(4,2),                -- 质量评分 0~100
  error_message TEXT,
  routing_rule_key VARCHAR(64),              -- 命中的路由规则
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mcl_model ON ai_model_call_logs(model, service_type, created_at);
CREATE INDEX IF NOT EXISTS idx_mcl_status ON ai_model_call_logs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_mcl_task ON ai_model_call_logs(task_type, created_at);

-- ========== 3. 模型熔断状态表 ==========
-- Circuit Breaker 模式：记录模型连续失败次数，达到阈值后熔断
CREATE TABLE IF NOT EXISTS ai_model_circuit_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INT NOT NULL,
  model VARCHAR(255) NOT NULL,
  state VARCHAR(16) DEFAULT 'closed',        -- closed/open/half_open
  failure_count INT DEFAULT 0,               -- 连续失败次数
  last_failure_at DATETIME,
  opened_at DATETIME,                        -- 熔断打开时间
  half_open_at DATETIME,                     -- 半开探测时间
  UNIQUE(config_id, model)
);
