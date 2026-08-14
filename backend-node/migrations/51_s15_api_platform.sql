-- ============================================================
-- Sprint 15: API 开放平台（S15-T01~T05）
-- Migration 51
--
-- 说明：
--   S15-T01 API Key 管理  → api_apps    开发者应用（申请/审批/吊销载体）
--                        → api_keys    API 密钥（只存 SHA-256 哈希，明文绝不落库）
--   S15-T02 API 网关与限流 → api_call_logs    调用日志（调用统计 + 错误日志）
--                        → api_daily_usage   每日用量统计（配额监控）
--                        → api_rate_windows  固定窗口限流计数（分钟级）
--
-- 设计原则：
--   - 密钥明文不落库：api_keys 仅存 key_hash（SHA-256）+ key_prefix（明文前 8 位用于展示识别）
--   - 权限范围以 JSON 数组存储于 api_keys.scopes，合法性由后端常量表（API_SCOPES）约束
--   - 所有调用记录真实落库，支撑调用统计、配额监控与错误日志
--   - 兼容性：与 Sprint 14 保持一致，采用 CREATE TABLE IF NOT EXISTS 幂等创建，
--     全部为新增独立表，不改动既有表结构
-- ============================================================

-- ------------------------------------------------------------
-- 1) 开发者应用表（S15-T01）
--    status: pending(待审批) / approved(已通过) / rejected(已驳回)
--    app_id: 对外应用标识（lmd_app_xxx），全局唯一
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_apps (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  app_id        VARCHAR(64)  NOT NULL COMMENT '对外应用标识(lmd_app_xxx)',
  user_id       BIGINT       NOT NULL COMMENT '所属用户ID',
  name          VARCHAR(128) NOT NULL COMMENT '应用名称',
  description   VARCHAR(1000) NULL COMMENT '应用描述',
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
  reject_reason VARCHAR(500) NULL COMMENT '驳回原因',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME     NULL COMMENT '软删除时间',
  UNIQUE KEY uk_app_id (app_id),
  KEY idx_user (user_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S15-T01 开发者应用';

-- ------------------------------------------------------------
-- 2) API 密钥表（S15-T01）
--    key_id:    对外密钥标识（lmd_key_xxx），全局唯一
--    key_hash:  SHA-256(明文密钥)，用于鉴权比对，明文仅在创建时返回一次
--    key_prefix: 明文密钥前 8 位（用于控制台展示识别）
--    scopes:    权限范围 JSON 数组，如 ["drama:read","drama:write","screenplay:generate"]
--    status:    active(生效) / revoked(已吊销) / expired(已过期)
--    rate_limit_per_min: 每分钟速率上限（固定窗口限流）
--    daily_quota:        每日调用配额（自然日）
--    ip_whitelist:       IP 白名单 JSON 数组（NULL/空=不限制）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_id             VARCHAR(64)  NOT NULL COMMENT '对外密钥标识(lmd_key_xxx)',
  app_id             VARCHAR(64)  NOT NULL COMMENT '所属应用标识',
  user_id            BIGINT       NOT NULL COMMENT '所属用户ID',
  name               VARCHAR(128) NULL COMMENT '密钥备注名',
  key_hash           VARCHAR(128) NOT NULL COMMENT 'SHA-256(明文密钥)',
  key_prefix         VARCHAR(16)  NOT NULL COMMENT '明文密钥前8位',
  scopes             TEXT         NOT NULL COMMENT '权限范围JSON数组',
  status             VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/revoked/expired',
  ip_whitelist       TEXT         NULL COMMENT 'IP白名单JSON数组',
  rate_limit_per_min INT          NOT NULL DEFAULT 60 COMMENT '每分钟速率上限',
  daily_quota        INT          NOT NULL DEFAULT 1000 COMMENT '每日配额',
  expires_at         DATETIME     NOT NULL COMMENT '过期时间',
  last_used_at       DATETIME     NULL COMMENT '最后使用时间',
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  revoked_at         DATETIME     NULL COMMENT '吊销时间',
  revoked_reason     VARCHAR(500) NULL COMMENT '吊销原因',
  UNIQUE KEY uk_key_id (key_id),
  KEY idx_app (app_id),
  KEY idx_user (user_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S15-T01 API密钥';

-- ------------------------------------------------------------
-- 3) API 调用日志表（S15-T02）
--    每次网关调用落一条：端点/方法/状态码/错误码/IP/耗时
--    用于调用统计与错误日志（开发者控制台）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_call_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  app_id      VARCHAR(64)  NOT NULL COMMENT '所属应用标识',
  key_id      VARCHAR(64)  NOT NULL COMMENT '所用密钥标识',
  user_id     BIGINT       NOT NULL COMMENT '所属用户ID',
  endpoint    VARCHAR(255) NOT NULL COMMENT '请求端点(/open/...)',
  method      VARCHAR(8)   NOT NULL COMMENT 'HTTP方法',
  scope       VARCHAR(64)  NULL COMMENT '校验通过的权限范围',
  status_code INT          NOT NULL COMMENT 'HTTP状态码',
  error_code  VARCHAR(64)  NULL COMMENT '业务错误码(RATE_LIMITED等)',
  ip          VARCHAR(64)  NULL COMMENT '来源IP',
  latency_ms  INT          NULL COMMENT '耗时(毫秒)',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_key_time (key_id, created_at),
  KEY idx_app_time (app_id, created_at),
  KEY idx_user_time (user_id, created_at),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S15-T02 API调用日志';

-- ------------------------------------------------------------
-- 4) 每日用量统计表（S15-T02 配额监控）
--    usage_date: 自然日
--    call_count: 当日成功调用次数
--    error_count: 当日失败调用次数
--    quota_limit: 当日配额快照（便于追溯历史配额）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_daily_usage (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_id      VARCHAR(64) NOT NULL COMMENT '所用密钥标识',
  app_id      VARCHAR(64) NOT NULL COMMENT '所属应用标识',
  usage_date  DATE        NOT NULL COMMENT '统计日期',
  call_count  INT         NOT NULL DEFAULT 0 COMMENT '当日调用次数',
  error_count INT         NOT NULL DEFAULT 0 COMMENT '当日失败次数',
  quota_limit INT         NOT NULL DEFAULT 0 COMMENT '当日配额快照',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_key_date (key_id, usage_date),
  KEY idx_app_date (app_id, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S15-T02 每日用量统计';

-- ------------------------------------------------------------
-- 5) 限流窗口计数表（S15-T02 固定窗口限流）
--    window_start: 窗口起始时间（分钟粒度）
--    同一密钥同一分钟窗口内计数，超过 rate_limit_per_min 则返回 429
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_rate_windows (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_id       VARCHAR(64) NOT NULL COMMENT '所用密钥标识',
  window_start DATETIME    NOT NULL COMMENT '窗口起始(分钟粒度)',
  call_count   INT         NOT NULL DEFAULT 0 COMMENT '窗口内计数',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_key_window (key_id, window_start),
  KEY idx_window_start (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S15-T02 限流窗口计数';
