-- ============================================================
-- Sprint 7: 工作流引擎 + 智能剪辑
-- 迁移编号: 40
-- 包含: S7-T01/T02 工作流引擎表, S7-T05 智能剪辑任务表, S7-T08 配音对齐表
-- ============================================================

-- 1) workflow_definitions — 工作流定义（模板）
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL COMMENT '工作流名称',
  description TEXT NULL COMMENT '工作流描述',
  drama_id BIGINT NULL COMMENT '关联短剧项目（NULL=通用模板）',
  steps_config JSON NOT NULL COMMENT '步骤配置数组: [{type,name,need_review,max_retry,condition,params}]',
  trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT '触发方式: manual/auto/scheduled',
  is_active TINYINT NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_wf_def_drama (drama_id),
  INDEX idx_wf_def_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作流定义表';

-- 2) workflow_instances — 工作流执行实例
CREATE TABLE IF NOT EXISTS workflow_instances (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  definition_id BIGINT NOT NULL,
  drama_id BIGINT NULL,
  episode_id BIGINT NULL COMMENT '关联分集',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/running/paused/completed/failed/cancelled',
  current_step_index INT NOT NULL DEFAULT 0 COMMENT '当前执行到的步骤索引',
  context JSON NULL COMMENT '执行上下文（步骤间传递的数据）',
  total_steps INT NOT NULL DEFAULT 0,
  completed_steps INT NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  error_message TEXT NULL,
  created_by BIGINT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_wf_inst_status (status),
  INDEX idx_wf_inst_drama (drama_id),
  INDEX idx_wf_inst_def (definition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作流执行实例表';

-- 3) workflow_step_logs — 步骤执行日志
CREATE TABLE IF NOT EXISTS workflow_step_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  instance_id BIGINT NOT NULL,
  step_index INT NOT NULL COMMENT '步骤索引',
  step_type VARCHAR(64) NOT NULL COMMENT 'generate_outline/characters/episodes/storyboard/images/tts/edit',
  step_name VARCHAR(128) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/running/completed/failed/skipped/reviewing',
  input_data JSON NULL COMMENT '步骤输入',
  output_data JSON NULL COMMENT '步骤输出',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  duration_ms BIGINT NULL COMMENT '执行耗时（毫秒）',
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  reviewer_id BIGINT NULL COMMENT '审核人ID',
  reviewed_at DATETIME NULL,
  review_note TEXT NULL COMMENT '审核备注',
  INDEX idx_wf_step_inst (instance_id),
  INDEX idx_wf_step_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工作流步骤执行日志';

-- 4) edit_tasks — 智能剪辑任务表（S7-T05）
CREATE TABLE IF NOT EXISTS edit_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  drama_id BIGINT NOT NULL,
  episode_id BIGINT NULL,
  title VARCHAR(256) NULL COMMENT '剪辑任务名称',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed',
  source_clips JSON NULL COMMENT '源片段列表: [{storyboard_id,image_url,audio_url,duration,transition_type}]',
  output_url VARCHAR(512) NULL COMMENT '输出视频URL',
  output_duration DOUBLE NULL COMMENT '输出视频时长（秒）',
  resolution VARCHAR(16) NULL DEFAULT '1080x1920',
  fps INT NULL DEFAULT 30,
  transition_default VARCHAR(32) NULL DEFAULT 'fade' COMMENT '默认转场效果',
  beat_sync TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用节奏匹配',
  progress INT NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  error_message TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_by BIGINT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_edit_drama (drama_id),
  INDEX idx_edit_status (status),
  INDEX idx_edit_episode (episode_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能剪辑任务表';

-- 5) audio_align_logs — 配音与视频对齐记录（S7-T08）
CREATE TABLE IF NOT EXISTS audio_align_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  drama_id BIGINT NOT NULL,
  episode_id BIGINT NULL,
  storyboard_id BIGINT NULL,
  audio_url VARCHAR(512) NULL COMMENT '配音音频URL',
  audio_duration_ms BIGINT NULL COMMENT '音频时长（毫秒）',
  original_duration_ms BIGINT NULL COMMENT '原分镜时长（毫秒）',
  adjusted_duration_ms BIGINT NULL COMMENT '调整后分镜时长（毫秒）',
  alignment_strategy VARCHAR(32) NULL DEFAULT 'stretch' COMMENT 'stretch/trim/loop/silence',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/aligned/failed',
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_align_drama (drama_id),
  INDEX idx_align_episode (episode_id),
  INDEX idx_align_storyboard (storyboard_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='配音与视频对齐记录';

-- 6) 插入内置工作流模板种子数据
INSERT INTO workflow_definitions (name, description, drama_id, steps_config, trigger_type, is_active, created_by, created_at, updated_at)
SELECT '全链路自动生成工作流', '从一句话创意到完整视频的一键生成流程', NULL,
  JSON_ARRAY(
    JSON_OBJECT('type','generate_outline','name','生成剧本大纲','need_review',false,'max_retry',2),
    JSON_OBJECT('type','generate_characters','name','生成角色档案','need_review',false,'max_retry',2),
    JSON_OBJECT('type','generate_episodes','name','拆分分集剧情','need_review',true,'max_retry',2),
    JSON_OBJECT('type','generate_storyboard','name','生成分镜脚本','need_review',false,'max_retry',2),
    JSON_OBJECT('type','generate_images','name','生成分镜图片','need_review',false,'max_retry',3),
    JSON_OBJECT('type','generate_tts','name','批量配音','need_review',false,'max_retry',2),
    JSON_OBJECT('type','auto_edit','name','智能剪辑','need_review',false,'max_retry',2)
  ),
  'manual', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE name = '全链路自动生成工作流');

INSERT INTO workflow_definitions (name, description, drama_id, steps_config, trigger_type, is_active, created_by, created_at, updated_at)
SELECT '分镜到视频工作流', '从已有分镜生成图片→配音→剪辑', NULL,
  JSON_ARRAY(
    JSON_OBJECT('type','generate_images','name','生成分镜图片','need_review',false,'max_retry',3),
    JSON_OBJECT('type','generate_tts','name','批量配音','need_review',false,'max_retry',2),
    JSON_OBJECT('type','auto_edit','name','智能剪辑','need_review',false,'max_retry',2)
  ),
  'manual', 1, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE name = '分镜到视频工作流');
