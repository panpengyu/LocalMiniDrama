-- ============================================================
-- Sprint 17: 补齐真实业务缺失表（测试统一使用真实 MySQL 前先建表）
-- 背景：以下 3 张表被 service 代码真实使用，但此前未纳入迁移，
--       导致测试只能用 SQLite 临时库模拟。本迁移补齐后，
--       所有测试数据均可真实落库到 MySQL，杜绝 mock / SQLite 混用。
-- ============================================================

-- 1) storyboard_characters — 分镜-角色关联表（storyboardService/episodeStoryboardService/imageService 使用）
CREATE TABLE IF NOT EXISTS storyboard_characters (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  storyboard_id BIGINT NOT NULL COMMENT '分镜ID',
  character_id BIGINT NOT NULL COMMENT '角色库ID（character_libraries.id）',
  created_at DATETIME NULL,
  INDEX idx_sbc_storyboard (storyboard_id),
  INDEX idx_sbc_character (character_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分镜-角色关联表';

-- 2) audio_generations — 音频生成记录表（audioAlignService/editService 使用；不存在时降级到 storyboard_dubbing）
CREATE TABLE IF NOT EXISTS audio_generations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  storyboard_id BIGINT NULL COMMENT '分镜ID',
  drama_id BIGINT NULL,
  episode_id BIGINT NULL,
  audio_url VARCHAR(512) NULL COMMENT '音频URL',
  local_path VARCHAR(512) NULL COMMENT '本地文件路径',
  duration INT NULL COMMENT '音频时长（毫秒）',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed',
  provider VARCHAR(50) NULL,
  voice_id VARCHAR(128) NULL,
  text_content TEXT NULL,
  error_msg TEXT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  deleted_at DATETIME NULL,
  INDEX idx_audgen_storyboard (storyboard_id),
  INDEX idx_audgen_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='音频生成记录表';

-- 3) ai_storyboard_generations — AI 分镜生成记录表（storyboardGenService 使用，原 service 内自建）
CREATE TABLE IF NOT EXISTS ai_storyboard_generations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  generation_id VARCHAR(64) NOT NULL COMMENT '生成批次ID',
  drama_id BIGINT NULL,
  episode_id BIGINT NULL,
  user_id BIGINT NULL,
  script_text TEXT NULL,
  style VARCHAR(32) NULL,
  frame_count INT NULL,
  status VARCHAR(32) NULL DEFAULT 'pending' COMMENT 'pending/completed/failed',
  result_json TEXT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_asg_generation (generation_id),
  INDEX idx_asg_drama (drama_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI分镜生成记录表';
