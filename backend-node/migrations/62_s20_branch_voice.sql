-- S20-T01 分支叙事：episodes/storyboards 可空分支列
-- S20-T02 语音评论：canvas_comments 语音列
-- 全部幂等：MySQL 不支持 ADD COLUMN IF NOT EXISTS，重复列会被跳过

-- episodes 分支列（branch_id NULL = 主线）
ALTER TABLE episodes ADD COLUMN branch_id VARCHAR(64) NULL;
ALTER TABLE episodes ADD COLUMN branch_type VARCHAR(16) NOT NULL DEFAULT 'main';
ALTER TABLE episodes ADD COLUMN branch_name VARCHAR(128) NULL;
ALTER TABLE episodes ADD COLUMN branch_condition TEXT NULL;

-- storyboards 分支列 + 条件连线
ALTER TABLE storyboards ADD COLUMN branch_id VARCHAR(64) NULL;
ALTER TABLE storyboards ADD COLUMN branch_type VARCHAR(16) NOT NULL DEFAULT 'main';
ALTER TABLE storyboards ADD COLUMN branch_condition TEXT NULL;
ALTER TABLE storyboards ADD COLUMN branch_target_scene_id INTEGER NULL;

-- canvas_comments 语音评论
ALTER TABLE canvas_comments ADD COLUMN voice_url VARCHAR(500) NULL;
ALTER TABLE canvas_comments ADD COLUMN voice_duration FLOAT NULL;

-- 语音评论允许「仅语音无文字」：content 列改为可空
-- 注：sync-mysql 驱动会把空字符串 '' 转成 NULL 写入，若 content 为 NOT NULL 会报
--     ER_BAD_NULL_ERROR；SQLite 动态类型不受影响，其 MODIFY 语句会被迁移器安全跳过。
ALTER TABLE canvas_comments MODIFY COLUMN content TEXT NULL;
