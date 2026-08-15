ALTER TABLE ai_model_map ADD COLUMN IF NOT EXISTS user_id BIGINT NULL;
ALTER TABLE ai_model_map ADD INDEX IF NOT EXISTS idx_ai_model_map_user_id (user_id);
ALTER TABLE ai_model_map ADD CONSTRAINT IF NOT EXISTS fk_ai_model_map_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;