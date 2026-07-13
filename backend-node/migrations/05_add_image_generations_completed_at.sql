ALTER TABLE image_generations ADD COLUMN completed_at DATETIME;
ALTER TABLE image_generations ADD COLUMN error_msg TEXT;