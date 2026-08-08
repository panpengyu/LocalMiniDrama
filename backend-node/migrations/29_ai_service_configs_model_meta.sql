ALTER TABLE ai_service_configs ADD COLUMN icon_char VARCHAR(10) DEFAULT '';
ALTER TABLE ai_service_configs ADD COLUMN description VARCHAR(500) DEFAULT '';
ALTER TABLE ai_service_configs ADD COLUMN tags TEXT;
ALTER TABLE ai_service_configs ADD COLUMN is_builtin TINYINT DEFAULT 0;
