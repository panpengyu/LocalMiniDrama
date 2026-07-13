ALTER TABLE storyboards ADD COLUMN creation_mode VARCHAR(50) DEFAULT 'classic';
ALTER TABLE storyboards ADD COLUMN universal_segment_text TEXT;