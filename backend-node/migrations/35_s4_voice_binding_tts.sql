-- ============================================================
-- 35_s4_voice_binding_tts.sql — Sprint 4 智能配音流水线
-- S4-T03: 角色音色绑定 / 台词提取 / 批量TTS / 情感语调控制
-- ============================================================

-- ========== 1. 角色音色绑定表 ==========
-- 每个角色可绑定独特音色（年龄/性别/性格匹配），支持情感语调参数
CREATE TABLE IF NOT EXISTS character_voice_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id BIGINT NOT NULL,
  character_id BIGINT NOT NULL,
  character_name VARCHAR(128),
  voice_id VARCHAR(128) NOT NULL,          -- 音色标识（对应 TTS provider 的 voice_id）
  voice_name VARCHAR(128),                  -- 音色中文名
  provider VARCHAR(64) DEFAULT 'openai',    -- TTS 供应方：openai / minimax
  emotion VARCHAR(32) DEFAULT 'neutral',    -- 情感语调：neutral/happy/sad/angry/tense/warm/epic
  speed DECIMAL(3,2) DEFAULT 1.00,          -- 语速 0.5~2.0
  pitch INT DEFAULT 0,                      -- 语调偏移 -12~12
  language VARCHAR(16) DEFAULT 'zh',        -- 语言：zh/en/ja/ko
  is_default TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(drama_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_vb_drama ON character_voice_bindings(drama_id);
CREATE INDEX IF NOT EXISTS idx_vb_char ON character_voice_bindings(character_id);

-- ========== 2. TTS 批量配音任务表 ==========
-- 记录每次批量配音任务的状态与结果
CREATE TABLE IF NOT EXISTS tts_batch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id BIGINT,
  episode_id BIGINT,
  user_id BIGINT,
  status VARCHAR(32) DEFAULT 'pending',     -- pending/running/completed/failed
  total_count INT DEFAULT 0,                -- 总台词数
  success_count INT DEFAULT 0,              -- 成功数
  failed_count INT DEFAULT 0,               -- 失败数
  items_json TEXT,                          -- 台词明细 JSON: [{character, text, voice_id, audio_path, status, error}]
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tts_batch_drama ON tts_batch_jobs(drama_id);
CREATE INDEX IF NOT EXISTS idx_tts_batch_status ON tts_batch_jobs(status);

-- ========== 3. 分镜台词配音关联表 ==========
-- 分镜台词与生成的音频文件关联，支持时间轴对齐
CREATE TABLE IF NOT EXISTS storyboard_dubbing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id BIGINT,
  episode_id BIGINT,
  storyboard_id BIGINT,
  character_id BIGINT,
  character_name VARCHAR(128),
  dialogue_text TEXT,                       -- 台词文本
  voice_id VARCHAR(128),                    -- 使用的音色
  emotion VARCHAR(32) DEFAULT 'neutral',    -- 情感语调
  audio_path VARCHAR(512),                  -- 音频文件相对路径
  duration_ms INT DEFAULT 0,                -- 音频时长（毫秒）
  sort_order INT DEFAULT 0,                 -- 时间轴顺序
  status VARCHAR(32) DEFAULT 'pending',     -- pending/synthesized/failed
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sd_storyboard ON storyboard_dubbing(storyboard_id);
CREATE INDEX IF NOT EXISTS idx_sd_episode ON storyboard_dubbing(episode_id);
