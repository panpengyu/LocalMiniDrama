-- ============================================================
-- 34_s3_consistency_retry.sql — Sprint 3 一致性自动重试 + 工作台扩展
-- M033（附录10.1）对应 S3-T02 / S3-T03
-- ============================================================

-- ========== 1. image_generations 扩展：记录重试链路 ==========
-- S3-T02: 一致性低于阈值时自动重试（最多3次）
ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS retried_from_id BIGINT NULL;
ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS consistency_score DECIMAL(6,4) NULL;
ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS consistency_passed TINYINT(1) NULL;
CREATE INDEX IF NOT EXISTS idx_ig_retried_from ON image_generations(retried_from_id);
CREATE INDEX IF NOT EXISTS idx_ig_consistency ON image_generations(consistency_passed);
