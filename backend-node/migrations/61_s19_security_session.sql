-- S19-T03/T04: 安全策略 + 会话管理
-- 幂等策略：CREATE TABLE IF NOT EXISTS 跳过重复建表；
-- 重复 ADD COLUMN 报 duplicate column 由 migrate.js 容错跳过；
-- INSERT ... ON DUPLICATE KEY UPDATE 保证策略行唯一。

-- ========== 1. 安全策略表（单行配置 id=1，JSON 存储） ==========
CREATE TABLE IF NOT EXISTS security_policy (
  id INT PRIMARY KEY,
  policy TEXT,                                          -- JSON：enabled/password/lock/ip_whitelist/two_fa
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO security_policy (id, policy)
VALUES (1, '{"enabled":false,"password":{"min_length":8,"require_upper":true,"require_lower":true,"require_digit":true,"require_symbol":false,"expire_days":90},"lock":{"max_attempts":5,"lock_minutes":30},"ip_whitelist":[],"two_fa":{"required":false}}')
ON DUPLICATE KEY UPDATE id = id;

-- ========== 2. 用户会话表（登录后登记，强制下线置 revoked_at） ==========
CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  ip VARCHAR(64),
  user_agent VARCHAR(255),
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_expires (expires_at)
);

-- ========== 3. users 表新增安全相关列（幂等，重复 ADD 自动跳过） ==========
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) NULL COMMENT 'TOTP 2FA 密钥';
ALTER TABLE users ADD COLUMN two_fa_enabled TINYINT DEFAULT 0 COMMENT '是否启用两步验证';
ALTER TABLE users ADD COLUMN failed_attempts INT DEFAULT 0 COMMENT '连续登录失败次数';
ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL COMMENT '锁定截止时间';
ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL COMMENT '最近改密时间';
ALTER TABLE users ADD COLUMN token_version INT DEFAULT 0 COMMENT '令牌版本，强制下线/改密后 +1 使旧 Token 失效';
