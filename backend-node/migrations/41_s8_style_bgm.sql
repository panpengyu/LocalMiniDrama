-- ============================================================
-- Sprint 8: 风格配置系统 + BGM生成 + 缓存日志
-- 迁移编号: 41
-- 包含: S8-T01 风格配置表, S8-T04 BGM曲目表
-- ============================================================

-- 1) style_configs — 项目级风格配置（S8-T01）
-- 存储全局风格/色板/线条/渲染风格/构图规则 + 角色场景覆盖
CREATE TABLE IF NOT EXISTS style_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  drama_id BIGINT NOT NULL UNIQUE COMMENT '关联短剧项目（一对一）',
  global_style VARCHAR(64) NOT NULL DEFAULT 'anime' COMMENT '全局风格锁定: anime/realistic/cinematic/watercolor/oil_painting/ink_wash/comic/cartoon/3d_render/cyberpunk',
  color_palette JSON NULL COMMENT '主题色板: ["#FF6B6B","#4ECDC4",...]',
  line_weight VARCHAR(16) NOT NULL DEFAULT 'medium' COMMENT '线条粗细: thin/medium/thick',
  shading_style VARCHAR(32) NOT NULL DEFAULT 'cel-shading' COMMENT '渲染风格: cel-shading/flat/realistic/painterly/gradient',
  composition_rule VARCHAR(32) NOT NULL DEFAULT 'rule-of-thirds' COMMENT '构图规则: rule-of-thirds/symmetric/golden-ratio/centered/leading-lines',
  character_overrides JSON NULL COMMENT '角色风格覆盖: [{"id":1,"style":"realistic"}]',
  scene_overrides JSON NULL COMMENT '场景风格覆盖: [{"id":1,"style":"watercolor"}]',
  negative_prompt_suffix TEXT NULL COMMENT '风格统一负面提示词后缀',
  is_active TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用风格统一',
  created_by BIGINT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_style_drama (drama_id),
  INDEX idx_style_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目级风格配置表';

-- 2) bgm_tracks — BGM背景音乐曲目表（S8-T04）
-- 存储AI生成/用户上传的背景音乐
CREATE TABLE IF NOT EXISTS bgm_tracks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  drama_id BIGINT NULL COMMENT '关联短剧项目（NULL=通用素材）',
  episode_id BIGINT NULL COMMENT '关联分集',
  title VARCHAR(256) NOT NULL COMMENT '曲目名称',
  mood VARCHAR(32) NOT NULL DEFAULT 'neutral' COMMENT '情绪氛围: neutral/happy/sad/tense/epic/romantic/mysterious/energetic/calm/dark',
  genre VARCHAR(32) NULL COMMENT '音乐类型: orchestral/electronic/ambient/rock/pop/jazz/folk',
  duration_sec INT NULL COMMENT '时长（秒）',
  audio_url VARCHAR(512) NULL COMMENT '音频文件URL',
  provider VARCHAR(64) NULL COMMENT '生成提供商',
  model VARCHAR(128) NULL COMMENT '使用的模型',
  prompt TEXT NULL COMMENT '生成提示词',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed',
  progress INT NOT NULL DEFAULT 0 COMMENT '生成进度 0-100',
  error_message TEXT NULL,
  tempo_bpm INT NULL COMMENT '节拍 BPM',
  instruments JSON NULL COMMENT '乐器列表: ["piano","strings","drums"]',
  created_by BIGINT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_bgm_drama (drama_id),
  INDEX idx_bgm_episode (episode_id),
  INDEX idx_bgm_status (status),
  INDEX idx_bgm_mood (mood)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='BGM背景音乐曲目表';

-- 3) 插入风格配置种子数据（为已有项目创建默认配置）
INSERT INTO style_configs (drama_id, global_style, color_palette, line_weight, shading_style, composition_rule, is_active, created_by, created_at, updated_at)
SELECT d.id, COALESCE(d.style, 'anime'),
  JSON_ARRAY('#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981'),
  'medium', 'cel-shading', 'rule-of-thirds', 1, d.created_by, NOW(), NOW()
FROM dramas d
WHERE d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM style_configs sc WHERE sc.drama_id = d.id)
LIMIT 20;
