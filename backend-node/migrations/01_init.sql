CREATE TABLE IF NOT EXISTS dramas (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT,
  genre VARCHAR(255),
  style VARCHAR(255) DEFAULT 'realistic',
  tags VARCHAR(255),
  thumbnail VARCHAR(500),
  total_episodes INTEGER DEFAULT 1,
  total_duration INTEGER DEFAULT 0,
  status VARCHAR(255) DEFAULT 'draft',
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER NOT NULL,
  episode_number INTEGER DEFAULT 0,
  title VARCHAR(255) DEFAULT '',
  script_content TEXT,
  description TEXT,
  duration INTEGER DEFAULT 0,
  video_url VARCHAR(500),
  thumbnail VARCHAR(500),
  status VARCHAR(255) DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS storyboards (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  episode_id INTEGER NOT NULL,
  scene_id INTEGER,
  storyboard_number INTEGER DEFAULT 0,
  title VARCHAR(255),
  description TEXT,
  location VARCHAR(255),
  time VARCHAR(255),
  duration FLOAT,
  dialogue TEXT,
  action TEXT,
  atmosphere TEXT,
  image_prompt TEXT,
  video_prompt TEXT,
  characters TEXT,
  shot_type VARCHAR(255),
  angle VARCHAR(255),
  movement VARCHAR(255),
  video_url VARCHAR(500),
  status VARCHAR(255) DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  role VARCHAR(255),
  description TEXT,
  personality TEXT,
  appearance TEXT,
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  voice_style VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS episode_characters (
  episode_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  PRIMARY KEY (episode_id, character_id)
);

CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  location VARCHAR(255),
  time VARCHAR(255),
  prompt TEXT,
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  storyboard_count INTEGER DEFAULT 0,
  status VARCHAR(255) DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS props (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  type VARCHAR(255),
  description TEXT,
  prompt TEXT,
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS storyboard_props (
  storyboard_id INTEGER NOT NULL,
  prop_id INTEGER NOT NULL,
  PRIMARY KEY (storyboard_id, prop_id)
);

CREATE TABLE IF NOT EXISTS frame_prompts (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  storyboard_id INTEGER NOT NULL,
  frame_type VARCHAR(255),
  prompt TEXT,
  description TEXT,
  layout VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_service_configs (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  service_type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) DEFAULT '',
  name VARCHAR(255) DEFAULT '',
  base_url VARCHAR(500) DEFAULT '',
  api_key VARCHAR(500),
  model VARCHAR(255),
  default_model VARCHAR(255),
  endpoint VARCHAR(500),
  query_endpoint VARCHAR(500),
  priority INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  settings TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS async_tasks (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL,
  progress INTEGER DEFAULT 0,
  message TEXT,
  resource_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error TEXT,
  result TEXT,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS image_generations (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  storyboard_id INTEGER,
  drama_id INTEGER,
  scene_id INTEGER,
  character_id INTEGER,
  provider VARCHAR(255),
  prompt TEXT,
  negative_prompt TEXT,
  model VARCHAR(255),
  frame_type VARCHAR(255),
  reference_images TEXT,
  size VARCHAR(255),
  quality VARCHAR(255),
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  status VARCHAR(255),
  task_id VARCHAR(36),
  completed_at DATETIME,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS video_generations (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER,
  storyboard_id INTEGER,
  provider VARCHAR(255),
  prompt TEXT,
  model VARCHAR(255),
  duration FLOAT,
  aspect_ratio VARCHAR(255),
  image_url VARCHAR(500),
  first_frame_url VARCHAR(500),
  last_frame_url VARCHAR(500),
  reference_image_urls TEXT,
  video_url VARCHAR(500),
  local_path VARCHAR(500),
  status VARCHAR(255),
  task_id VARCHAR(36),
  scene_id INTEGER,
  completed_at DATETIME,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS video_merges (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  episode_id INTEGER,
  drama_id INTEGER,
  title VARCHAR(255),
  provider VARCHAR(255),
  model VARCHAR(255),
  status VARCHAR(255),
  scenes TEXT,
  task_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS character_libraries (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER,
  name VARCHAR(255) NOT NULL DEFAULT '',
  category VARCHAR(255),
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  description TEXT,
  tags VARCHAR(255),
  source_type VARCHAR(255),
  source_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS scene_libraries (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER,
  location VARCHAR(255) NOT NULL DEFAULT '',
  time VARCHAR(255),
  prompt TEXT,
  description TEXT,
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  category VARCHAR(255),
  tags VARCHAR(255),
  source_type VARCHAR(255),
  source_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS prop_libraries (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER,
  name VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT,
  prompt TEXT,
  image_url VARCHAR(500),
  local_path VARCHAR(500),
  category VARCHAR(255),
  tags VARCHAR(255),
  source_type VARCHAR(255),
  source_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  drama_id INTEGER,
  name VARCHAR(255),
  type VARCHAR(255),
  category VARCHAR(255),
  url VARCHAR(500),
  local_path VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(255),
  width INTEGER,
  height INTEGER,
  duration FLOAT,
  image_gen_id INTEGER,
  video_gen_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME
);