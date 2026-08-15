ALTER TABLE prompt_overrides ADD COLUMN IF NOT EXISTS user_id BIGINT NULL;
ALTER TABLE prompt_overrides ADD INDEX IF NOT EXISTS idx_prompt_overrides_user_id (user_id);
ALTER TABLE prompt_overrides ADD CONSTRAINT IF NOT EXISTS fk_prompt_overrides_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;