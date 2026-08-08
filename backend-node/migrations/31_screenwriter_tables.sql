-- ============================================================
-- 31_screenwriter_tables.sql
-- Sprint 1: AI编剧助手数据库表结构
-- 共12张表 + 种子数据（剧本结构模板）
-- 兼容 MySQL 8.x + SQLite（通过migrate.js自动替换类型）
-- ============================================================

-- ------------------------------------------------------------
-- 1. sw_outlines — 剧本大纲表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_outlines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  outline_id VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NULL,
  enterprise_id BIGINT NULL,
  drama_id BIGINT NULL,
  title VARCHAR(255) NOT NULL,
  logline TEXT NULL,
  idea TEXT NOT NULL,
  genre VARCHAR(32) NULL COMMENT 'urban_romance/ancient_fantasy/mystery/scifi/campus/other',
  structure VARCHAR(32) NULL DEFAULT 'three_act' COMMENT 'three_act/heros_journey/qi_cheng_zhuan_he',
  style VARCHAR(32) NULL DEFAULT 'hot' COMMENT 'hot/sweet/abusive/suspense/comedy',
  episode_count INT NULL DEFAULT 10,
  target_audience VARCHAR(255) NULL,
  themes TEXT NULL COMMENT 'JSON array: ["成长","爱情"]',
  acts_json MEDIUMTEXT NULL COMMENT 'JSON三幕结构: [{act_number,title,summary,key_events[]}]',
  status VARCHAR(16) DEFAULT 'draft' COMMENT 'draft/generating/completed/failed',
  error_message TEXT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_drama_id (drama_id),
  INDEX idx_status (status),
  INDEX idx_outline_id (outline_id)
);

-- ------------------------------------------------------------
-- 2. sw_characters — 角色档案表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_characters (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  character_id VARCHAR(64) NOT NULL UNIQUE,
  outline_id VARCHAR(64) NULL,
  drama_id BIGINT NULL,
  user_id BIGINT NULL,
  name VARCHAR(128) NOT NULL,
  `role` VARCHAR(16) NOT NULL COMMENT 'protagonist/antagonist/supporting/minor',
  age INT NULL,
  gender VARCHAR(16) NULL COMMENT 'male/female/other',
  personality TEXT NULL,
  appearance TEXT NULL,
  background TEXT NULL,
  motivation TEXT NULL,
  arc TEXT NULL COMMENT '角色成长弧线',
  appearance_prompt TEXT NULL COMMENT '外貌提示词(用于生图)',
  voice_profile TEXT NULL COMMENT 'JSON: {tone,age_range,speed}',
  tags_json TEXT NULL COMMENT 'JSON array',
  sort_order INT DEFAULT 0,
  status VARCHAR(16) DEFAULT 'draft',
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_outline_id (outline_id),
  INDEX idx_drama_id (drama_id),
  INDEX idx_role (`role`),
  INDEX idx_character_id (character_id)
);

-- ------------------------------------------------------------
-- 3. sw_episodes — 分集剧情表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_episodes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  episode_id VARCHAR(64) NOT NULL UNIQUE,
  outline_id VARCHAR(64) NOT NULL,
  drama_id BIGINT NULL,
  user_id BIGINT NULL,
  episode_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary MEDIUMTEXT NULL,
  duration_estimate VARCHAR(32) NULL COMMENT '3-5分钟',
  cliffhanger TEXT NULL COMMENT '结尾悬念',
  status VARCHAR(16) DEFAULT 'draft',
  sort_order INT DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_outline_id (outline_id),
  INDEX idx_drama_id (drama_id),
  INDEX idx_episode_number (episode_number),
  INDEX idx_episode_id (episode_id)
);

-- ------------------------------------------------------------
-- 4. sw_scenes — 场景表（分集内的场景）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_scenes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  scene_id VARCHAR(64) NOT NULL UNIQUE,
  episode_id VARCHAR(64) NOT NULL,
  outline_id VARCHAR(64) NULL,
  scene_number INT NOT NULL,
  location VARCHAR(255) NULL,
  description MEDIUMTEXT NULL,
  time_of_day VARCHAR(32) NULL COMMENT 'day/night/dawn/dusk',
  atmosphere VARCHAR(64) NULL COMMENT 'tense/warm/mysterious',
  characters_json TEXT NULL COMMENT 'JSON: ["char_001","char_002"]',
  sort_order INT DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_episode_id (episode_id),
  INDEX idx_scene_id (scene_id)
);

-- ------------------------------------------------------------
-- 5. sw_storyboards — 分镜脚本表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_storyboards (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  frame_id VARCHAR(64) NOT NULL UNIQUE,
  episode_id VARCHAR(64) NULL,
  scene_id VARCHAR(64) NULL,
  drama_id BIGINT NULL,
  outline_id VARCHAR(64) NULL,
  user_id BIGINT NULL,
  frame_number INT NOT NULL,
  shot_type VARCHAR(32) NULL COMMENT 'close_up/medium/wide/long/extreme_wide',
  camera_movement VARCHAR(32) NULL COMMENT 'static/pan/tilt/dolly/track/crane/handheld',
  composition VARCHAR(32) NULL COMMENT 'rule_of_thirds/symmetric/leading_lines/center',
  emotion VARCHAR(32) NULL COMMENT 'tense/warm/shocking/sad/happy/neutral',
  duration VARCHAR(32) NULL COMMENT '3-5秒',
  transition VARCHAR(32) NULL DEFAULT 'cut' COMMENT 'cut/fade_in/fade_out/dissolve/wipe',
  visual_description MEDIUMTEXT NULL,
  prompt TEXT NULL COMMENT 'AI生图提示词',
  characters_json TEXT NULL COMMENT 'JSON: ["char_001"]',
  image_url VARCHAR(512) NULL,
  generation_status VARCHAR(16) DEFAULT 'pending' COMMENT 'pending/generating/success/failed',
  consistency_score FLOAT NULL COMMENT '0-1一致性分数',
  sort_order INT DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_episode_id (episode_id),
  INDEX idx_scene_id (scene_id),
  INDEX idx_frame_number (frame_number),
  INDEX idx_gen_status (generation_status),
  INDEX idx_frame_id (frame_id)
);

-- ------------------------------------------------------------
-- 6. sw_dialogues — 对话台词表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_dialogues (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  dialogue_id VARCHAR(64) NOT NULL UNIQUE,
  frame_id VARCHAR(64) NULL,
  episode_id VARCHAR(64) NULL,
  outline_id VARCHAR(64) NULL,
  character_id VARCHAR(64) NULL,
  character_name VARCHAR(128) NULL,
  line_text MEDIUMTEXT NOT NULL,
  emotion VARCHAR(32) NULL DEFAULT 'neutral' COMMENT 'happy/sad/angry/surprised/calm/nervous',
  action_description TEXT NULL COMMENT '伴随动作描述',
  duration_estimate VARCHAR(32) NULL COMMENT '2秒',
  audio_url VARCHAR(512) NULL COMMENT '配音文件URL',
  tts_provider VARCHAR(32) NULL COMMENT 'volcano/azure/elevenlabs/system',
  tts_voice_id VARCHAR(128) NULL,
  tts_status VARCHAR(16) DEFAULT 'pending' COMMENT 'pending/generating/success/failed',
  speed FLOAT NULL DEFAULT 1.0 COMMENT '语速0.5-2.0',
  sort_order INT DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_frame_id (frame_id),
  INDEX idx_episode_id (episode_id),
  INDEX idx_character_id (character_id),
  INDEX idx_tts_status (tts_status),
  INDEX idx_dialogue_id (dialogue_id)
);

-- ------------------------------------------------------------
-- 7. drama_templates — 剧本结构模板表（种子数据）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drama_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  template_id VARCHAR(64) NOT NULL UNIQUE,
  category VARCHAR(32) NOT NULL COMMENT 'structure/genre/style',
  `key` VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  prompt_system TEXT NULL COMMENT 'System prompt模板',
  prompt_example TEXT NULL COMMENT '示例输入',
  output_schema TEXT NULL COMMENT 'JSON schema',
  parameters_json TEXT NULL COMMENT '可调参数',
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uk_cat_key (category, `key`),
  INDEX idx_category (category),
  INDEX idx_active (is_active)
);

-- ------------------------------------------------------------
-- 8. sw_jobs — AI编剧异步任务表（Bull队列+DB双写）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id VARCHAR(64) NOT NULL UNIQUE,
  bull_job_id VARCHAR(128) NULL,
  user_id BIGINT NULL,
  enterprise_id BIGINT NULL,
  outline_id VARCHAR(64) NULL,
  episode_id VARCHAR(64) NULL,
  frame_id VARCHAR(64) NULL,
  job_type VARCHAR(32) NOT NULL COMMENT 'outline/characters/episodes/storyboard/dialogue/tts',
  payload_json MEDIUMTEXT NULL COMMENT '请求参数JSON',
  result_json MEDIUMTEXT NULL COMMENT '返回结果JSON',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed/cancelled',
  progress INT DEFAULT 0 COMMENT '0-100',
  error_message TEXT NULL,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  duration_ms BIGINT NULL,
  cost_points BIGINT DEFAULT 0 COMMENT '消耗积分',
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_outline_id (outline_id),
  INDEX idx_job_type (job_type),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_job_id (job_id)
);

-- ------------------------------------------------------------
-- 9. sw_dialogue_emotions — 台词情感标签字典
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_dialogue_emotions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  emotion_key VARCHAR(32) NOT NULL UNIQUE,
  label_zh VARCHAR(32) NOT NULL,
  description VARCHAR(255) NULL,
  tts_speed_modifier FLOAT DEFAULT 1.0,
  tts_volume_modifier FLOAT DEFAULT 1.0,
  tts_pitch_modifier FLOAT DEFAULT 0.0,
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NULL
);

-- ------------------------------------------------------------
-- 10. sw_shot_types — 镜头类型字典
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_shot_types (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  shot_key VARCHAR(32) NOT NULL UNIQUE,
  label_zh VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  default_duration VARCHAR(32) NULL,
  icon VARCHAR(64) NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NULL
);

-- ------------------------------------------------------------
-- 11. sw_genres — 漫剧类型字典
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_genres (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  genre_key VARCHAR(32) NOT NULL UNIQUE,
  label_zh VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  tags_json TEXT NULL COMMENT '常见题材标签',
  default_episode_count INT DEFAULT 10,
  default_style VARCHAR(32) NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NULL
);

-- ------------------------------------------------------------
-- 12. sw_styles — 风格基调字典
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_styles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  style_key VARCHAR(32) NOT NULL UNIQUE,
  label_zh VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  prompt_bias TEXT NULL COMMENT '默认提示词倾向',
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NULL
);

-- ------------------------------------------------------------
-- 13. sw_chat_sessions — 多轮对话会话表（S1-T02 多轮对话能力）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_chat_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NULL,
  outline_id VARCHAR(64) NULL COMMENT '关联的大纲ID',
  episode_id VARCHAR(64) NULL COMMENT '关联的分集ID',
  title VARCHAR(255) NULL COMMENT '会话标题',
  context_type VARCHAR(32) NULL DEFAULT 'general' COMMENT 'general/outline/characters/episodes/storyboard/dialogue',
  messages_count INT DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  INDEX idx_session_id (session_id),
  INDEX idx_user_id (user_id),
  INDEX idx_outline_id (outline_id)
);

-- ------------------------------------------------------------
-- 14. sw_chat_messages — 多轮对话消息表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sw_chat_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL COMMENT 'user/assistant/system',
  content TEXT NOT NULL,
  message_order INT DEFAULT 0,
  created_at DATETIME NULL,
  INDEX idx_session_id (session_id),
  INDEX idx_role (role)
);

-- ============================================================
-- 种子数据
-- ============================================================

-- drama_templates — 剧本结构模板（兼容 MySQL 8.x 与 SQLite：MySQL 使用 INSERT IGNORE，SQLite 使用 INSERT OR IGNORE，migrate.js 会自动替换）
INSERT IGNORE INTO drama_templates (template_id, category, `key`, name, description, prompt_system, prompt_example, output_schema, parameters_json, sort_order, is_active, created_at, updated_at) VALUES
('tpl_struct_3act', 'structure', 'three_act', '三幕式结构', '建置-对抗-结局，最经典的剧本结构，25%建置/50%对抗/25%结局',
'你是专业的漫剧编剧。请严格按照三幕式结构生成剧本大纲：
第一幕（建置25%）：介绍主角、世界观、激励事件
第二幕（对抗50%）：冲突升级，角色成长，中点转折
第三幕（结局25%）：高潮解决，人物弧光收尾
输出必须是纯JSON，不包含任何解释文字。',
'一个普通快递员意外获得超能力的故事',
'{"title":"string","logline":"string","themes":["string"],"acts":[{"act_number":1,"title":"string","summary":"string","key_events":["string"]}]}',
'{"episodeCount":{"type":"number","default":10,"min":3,"max":100}}',
1, 1, '2026-08-08 00:00:00', '2026-08-08 00:00:00'),

('tpl_struct_hero', 'structure', 'heros_journey', '英雄之旅', '坎贝尔12阶段英雄之旅结构',
'请按照英雄之旅的12个阶段结构生成本漫剧剧本大纲：
1.普通世界 2.冒险召唤 3.拒绝召唤 4.遇见导师 5.跨越第一道门槛
6.考验与盟友 7.接近洞穴深处 8.严峻考验 9.获得报酬 10.返回之路
11.复活重生 12.满载而归',
'一个平凡少年踏上修仙之路',
'{"title":"string","logline":"string","themes":["string"],"stages":[{"stage_key":"ordinary_world","content":"string"}]}',
'{"episodeCount":{"type":"number","default":12,"min":3,"max":100}}',
2, 1, '2026-08-08 00:00:00', '2026-08-08 00:00:00'),

('tpl_struct_qczh', 'structure', 'qi_cheng_zhuan_he', '起承转合', '东方传统四幕式叙事，注重内在节奏与情绪流转',
'请按照起承转合四幕式结构生成本漫剧剧本大纲：
起（起因）：交代背景、人物、主要矛盾
承（发展）：事件展开，层层递进，
转（转折）：发生重大转变，矛盾激化达到高潮
合（结局）：冲突解决，收束余韵',
'寒门书生偶遇富家小姐，开启一段跨越阶层的爱情',
'{"title":"string","logline":"string","qi":"string","cheng":"string","zhuan":"string","he":"string"}',
'{"episodeCount":{"type":"number","default":10,"min":3,"max":100}}',
3, 1, '2026-08-08 00:00:00', '2026-08-08 00:00:00');

-- sw_genres — 漫剧类型
INSERT IGNORE INTO sw_genres (genre_key, label_zh, description, tags_json, default_episode_count, default_style, sort_order, is_active, created_at) VALUES
('urban_romance', '都市爱情', '现代都市背景的爱情故事，强情节、快节奏', '["霸总","甜宠","先婚后爱","契约婚姻","豪门"]', 12, 'sweet', 1, 1, '2026-08-08 00:00:00'),
('ancient_fantasy', '古风仙侠', '古代修仙/武侠/宫斗背景，架空世界观', '["修仙","重生","穿越","宫斗","仙侠","权谋"]', 15, 'hot', 2, 1, '2026-08-08 00:00:00'),
('mystery', '悬疑推理', '悬疑/犯罪/推理题材，强逻辑反转', '["破案","反转","心理","密室","刑侦"]', 10, 'suspense', 3, 1, '2026-08-08 00:00:00'),
('scifi', '科幻未来', '未来/科技/赛博朋克/末世背景', '["赛博朋克","机甲","末世","重生","超能力"]', 10, 'hot', 4, 1, '2026-08-08 00:00:00'),
('campus', '校园青春', '校园/青春/成长/纯爱故事', '["青春","校园","纯爱","成长","友情"]', 12, 'sweet', 5, 1, '2026-08-08 00:00:00'),
('family', '家庭伦理', '家庭关系/亲情纠葛/伦理冲突', '["婆媳","妯娌","亲情","家产","逆袭"]', 15, 'hot', 6, 1, '2026-08-08 00:00:00'),
('action', '动作热血', '战斗/格斗/冒险/战争背景，高燃热血', '["热血","战斗","冒险","逆袭","英雄"]', 12, 'hot', 7, 1, '2026-08-08 00:00:00'),
('other', '其他', '自定义类型，不受限制', '[]', 10, 'hot', 99, 1, '2026-08-08 00:00:00');

-- sw_styles — 风格基调
INSERT IGNORE INTO sw_styles (style_key, label_zh, description, prompt_bias, sort_order, is_active, created_at) VALUES
('hot', '爽文', '节奏快、冲突强、打脸爽点密集，男主女主皆强', '冲突频繁，每集有反转，主角成长快，打脸精准，高潮迭起，绝不憋屈', 1, 1, '2026-08-08 00:00:00'),
('sweet', '甜宠', '甜蜜温馨、感情细腻，甜度高虐点少', '侧重感情描写，互动甜蜜，肢体接触与情话自然，少虐多甜，温暖治愈', 2, 1, '2026-08-08 00:00:00'),
('abusive', '虐恋', '悲情路线、情感纠葛深，后劲强', '情感张力强，误会重重，爱恨交织，情节催泪，人物命运多舛', 3, 1, '2026-08-08 00:00:00'),
('suspense', '悬疑', '悬念重重、节奏紧张，伏笔反转贯穿', '悬念贯穿始终，伏笔密集，反转不断，氛围紧张压抑，真相层层剥离', 4, 1, '2026-08-08 00:00:00'),
('comedy', '搞笑', '轻松幽默、反差喜感，解压治愈', '情节诙谐，角色反差鲜明，梗点密集，轻松解压，偶有泪点', 5, 1, '2026-08-08 00:00:00'),
('epic', '史诗', '宏大叙事、格局宏大，世界观构建完整', '背景宏大，人物众多，格局开阔，命运感强，史诗级场面描写', 6, 1, '2026-08-08 00:00:00');

-- sw_shot_types — 镜头类型
INSERT IGNORE INTO sw_shot_types (shot_key, label_zh, description, default_duration, icon, sort_order, is_active, created_at) VALUES
('extreme_wide', '大远景', '展示宏大环境和场景全貌，用于开篇/转场', '8-10秒', 'EWS', 1, 1, '2026-08-08 00:00:00'),
('long', '远景', '展示人物全身及其周围环境，交代空间关系', '5-8秒', 'LS', 2, 1, '2026-08-08 00:00:00'),
('wide', '全景', '人物完整+周围环境，展示动作全貌', '4-6秒', 'WS', 3, 1, '2026-08-08 00:00:00'),
('medium', '中景', '人物膝盖以上，适合互动对话叙事', '3-5秒', 'MS', 4, 1, '2026-08-08 00:00:00'),
('close_up', '特写', '人物胸部以上，突出表情情绪细节', '2-4秒', 'CU', 5, 1, '2026-08-08 00:00:00'),
('extreme_close_up', '大特写', '局部特写（眼/嘴/手/道具），强调关键细节', '1-2秒', 'ECU', 6, 1, '2026-08-08 00:00:00');

-- sw_dialogue_emotions — 台词情感
INSERT IGNORE INTO sw_dialogue_emotions (emotion_key, label_zh, description, tts_speed_modifier, tts_volume_modifier, tts_pitch_modifier, sort_order, is_active, created_at) VALUES
('neutral', '平静', '正常语速语调的对话', 1.0, 1.0, 0.0, 0, 1, '2026-08-08 00:00:00'),
('happy', '开心', '愉悦欢乐的语气，带笑意', 1.1, 1.1, 0.2, 1, 1, '2026-08-08 00:00:00'),
('sad', '悲伤', '低沉哀伤的语气，语速稍慢', 0.85, 0.85, -0.2, 2, 1, '2026-08-08 00:00:00'),
('angry', '愤怒', '高亢激动的语气，音量语速提升', 1.15, 1.2, 0.1, 3, 1, '2026-08-08 00:00:00'),
('surprised', '惊讶', '短促吃惊的语气，音调升高', 1.1, 1.1, 0.3, 4, 1, '2026-08-08 00:00:00'),
('calm', '沉稳', '从容淡定的语气，稍缓稍稳', 0.9, 0.95, -0.05, 5, 1, '2026-08-08 00:00:00'),
('nervous', '紧张', '急促紧绷的语气，略带颤抖', 1.05, 1.0, 0.1, 6, 1, '2026-08-08 00:00:00'),
('romantic', '温柔', '柔情似水的语气，带爱意', 0.92, 0.9, 0.1, 7, 1, '2026-08-08 00:00:00');
