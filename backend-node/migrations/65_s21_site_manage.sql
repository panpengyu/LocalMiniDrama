-- ============================================================
-- 65_s21_site_manage.sql  Sprint 21 - 系统管理基础表（菜单/字典/参数）
-- 幂等：CREATE TABLE IF NOT EXISTS；MySQL/SQLite 双兼容（AUTOINCREMENT 由迁移器转换）
-- ============================================================

-- 系统菜单（批 C · Menus）
CREATE TABLE IF NOT EXISTS menus (
  id BIGINT PRIMARY KEY,
  parent_id BIGINT NOT NULL DEFAULT 0,
  name VARCHAR(100) NOT NULL,
  path VARCHAR(255),
  icon VARCHAR(100),
  sort_order INT NOT NULL DEFAULT 0,
  visible TINYINT NOT NULL DEFAULT 1,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME
);

-- 数据字典（批 C · Dict）
CREATE TABLE IF NOT EXISTS dict_items (
  id BIGINT PRIMARY KEY,
  dict_type VARCHAR(64) NOT NULL,
  label VARCHAR(100) NOT NULL,
  value VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1,
  remark VARCHAR(255),
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  KEY idx_dict_type (dict_type)
);

-- 系统参数（批 C · Params）
CREATE TABLE IF NOT EXISTS system_params (
  id BIGINT PRIMARY KEY,
  param_key VARCHAR(100) NOT NULL,
  param_value TEXT,
  description VARCHAR(255),
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  UNIQUE KEY uk_param_key (param_key)
);
