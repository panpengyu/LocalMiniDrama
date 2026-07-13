ALTER TABLE ai_service_configs ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE ai_service_configs ADD INDEX IF NOT EXISTS idx_ai_service_configs_user_id (user_id);
ALTER TABLE ai_service_configs ADD CONSTRAINT IF NOT EXISTS fk_ai_service_configs_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;