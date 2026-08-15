-- S17: 一致性校验重试相关列补齐
-- imageService.internalEnforceConsistencyAndMaybeRetry 真实使用这些列，
-- 但 image_generations 表缺失（SQLite 临时表掩盖了该缺陷），此处补齐。
ALTER TABLE image_generations ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE image_generations ADD COLUMN retried_from_id BIGINT NULL;
ALTER TABLE image_generations ADD COLUMN consistency_score FLOAT NULL;
ALTER TABLE image_generations ADD COLUMN consistency_passed TINYINT(1) NULL;
