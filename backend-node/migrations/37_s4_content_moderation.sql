-- ============================================================
-- 37_s4_content_moderation.sql — Sprint 4 内容审核服务
-- S4-T08: AI辅助内容审核 + 违规拦截 + 审核记录
-- ============================================================

-- ========== 1. 内容审核记录表 ==========
-- 记录每次审核的完整日志，支持申诉和回溯
CREATE TABLE IF NOT EXISTS content_moderation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id BIGINT,
  drama_id BIGINT,
  resource_type VARCHAR(32) NOT NULL,        -- image/text/video
  resource_id BIGINT,                        -- 资源ID（image_generations.id 等）
  resource_url VARCHAR(1024),                -- 资源URL/文本片段
  content_snapshot TEXT,                     -- 审核内容快照（文本/图片URL）
  provider VARCHAR(64) DEFAULT 'builtin',    -- 审核服务：builtin/aliyun_green/tencent_youtu
  verdict VARCHAR(16) DEFAULT 'safe',        -- safe/pending/violation
  risk_label VARCHAR(64),                    -- 风险标签：porn/violence/political/spam/copyright/safe
  risk_score DECIMAL(5,2) DEFAULT 0,         -- 风险分值 0~100
  confidence DECIMAL(5,2) DEFAULT 0,         -- 置信度 0~100
  detail_json TEXT,                           -- 审核详情 JSON
  mode VARCHAR(16) DEFAULT 'standard',       -- 审核模式：strict/standard/loose
  is_blocked TINYINT(1) DEFAULT 0,           -- 是否已拦截
  reviewed_by BIGINT,                         -- 人工复审人ID
  reviewed_at DATETIME,                       -- 复审时间
  review_note TEXT,                           -- 复审备注
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cml_resource ON content_moderation_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_cml_verdict ON content_moderation_logs(verdict, is_blocked);
CREATE INDEX IF NOT EXISTS idx_cml_user ON content_moderation_logs(user_id, created_at);

-- ========== 2. 审核规则配置表 ==========
-- 支持严格/标准/宽松三种模式，可配置阈值
CREATE TABLE IF NOT EXISTS content_moderation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode VARCHAR(16) NOT NULL,                 -- strict/standard/loose
  category VARCHAR(32) NOT NULL,             -- porn/violence/political/spam/copyright
  threshold DECIMAL(5,2) NOT NULL,           -- 风险分拦截阈值
  action VARCHAR(16) DEFAULT 'block',        -- block/review/pass
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mode, category)
);

-- ========== 3. 种子数据：三种审核模式的默认阈值 ==========
INSERT OR IGNORE INTO content_moderation_rules (mode, category, threshold, action) VALUES
  ('strict',   'porn',      30.00, 'block'),
  ('strict',   'violence',  40.00, 'block'),
  ('strict',   'political', 30.00, 'block'),
  ('strict',   'spam',      50.00, 'review'),
  ('strict',   'copyright', 40.00, 'review'),
  ('standard', 'porn',      60.00, 'block'),
  ('standard', 'violence',  70.00, 'block'),
  ('standard', 'political', 60.00, 'block'),
  ('standard', 'spam',      70.00, 'review'),
  ('standard', 'copyright', 60.00, 'review'),
  ('loose',    'porn',      80.00, 'block'),
  ('loose',    'violence',  85.00, 'block'),
  ('loose',    'political', 80.00, 'block'),
  ('loose',    'spam',      85.00, 'review'),
  ('loose',    'copyright', 80.00, 'review');
