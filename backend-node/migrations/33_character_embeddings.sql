-- ============================================================
-- 33_character_embeddings.sql
-- M033: Sprint 2 — 角色指纹系统 + 一致性校验记录表
-- 1. 扩展 character_libraries / characters 增加面部 embedding 向量字段
-- 2. 新增 character_embeddings 表（多角度指纹存储）
-- 3. 新增 consistency_check_logs 表（一致性校验记录）
-- 兼容 MySQL 8.x + SQLite（通过migrate.js自动替换类型）
-- ============================================================

-- ========== 1. character_libraries 扩展字段 ==========
ALTER TABLE character_libraries ADD COLUMN face_embedding TEXT;
ALTER TABLE character_libraries ADD COLUMN embedding_model VARCHAR(100);
ALTER TABLE character_libraries ADD COLUMN embedding_generated_at DATETIME;
ALTER TABLE character_libraries ADD COLUMN consistency_threshold FLOAT DEFAULT 0.85;

-- characters 表同步扩展
ALTER TABLE characters ADD COLUMN face_embedding TEXT;
ALTER TABLE characters ADD COLUMN embedding_model VARCHAR(100);
ALTER TABLE characters ADD COLUMN embedding_generated_at DATETIME;
ALTER TABLE characters ADD COLUMN consistency_threshold FLOAT DEFAULT 0.85;

-- ========== 2. character_embeddings 表（多角度指纹存储） ==========
CREATE TABLE IF NOT EXISTS character_embeddings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  character_id BIGINT NOT NULL,
  character_type VARCHAR(20) DEFAULT 'project' COMMENT 'project=剧集角色, library=角色库角色',
  drama_id BIGINT NULL,
  view_angle VARCHAR(50) DEFAULT 'front' COMMENT 'front/side/back/three_quarter',
  image_url VARCHAR(500) NULL,
  embedding TEXT NOT NULL COMMENT 'JSON数组，面部embedding向量',
  embedding_model VARCHAR(100) NULL,
  embedding_dim INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_char_emb_character (character_id),
  INDEX idx_char_emb_drama (drama_id),
  INDEX idx_char_emb_type (character_type)
);

-- ========== 3. consistency_check_logs 表（一致性校验记录） ==========
CREATE TABLE IF NOT EXISTS consistency_check_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  check_id VARCHAR(64) NOT NULL UNIQUE,
  drama_id BIGINT NULL,
  storyboard_id BIGINT NULL,
  character_id BIGINT NULL,
  generated_image_url VARCHAR(500) NULL,
  reference_image_url VARCHAR(500) NULL,
  similarity_score FLOAT NOT NULL DEFAULT 0 COMMENT '余弦相似度 0~1',
  threshold FLOAT DEFAULT 0.85,
  passed TINYINT DEFAULT 0 COMMENT '1=通过 0=不通过',
  check_method VARCHAR(50) DEFAULT 'cosine_embedding' COMMENT 'cosine_embedding/visual_llm/structural',
  detail_json TEXT NULL COMMENT '详细比对信息JSON',
  retry_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ccl_drama (drama_id),
  INDEX idx_ccl_storyboard (storyboard_id),
  INDEX idx_ccl_character (character_id),
  INDEX idx_ccl_passed (passed),
  INDEX idx_ccl_check_id (check_id)
);
