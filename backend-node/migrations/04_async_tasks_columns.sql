ALTER TABLE async_tasks ADD COLUMN completed_at DATETIME;
ALTER TABLE async_tasks ADD COLUMN error TEXT;
ALTER TABLE async_tasks ADD COLUMN result TEXT;