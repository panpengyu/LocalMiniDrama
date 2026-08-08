-- 数据异常告警：通知渠道配置（钉钉 / 企业微信 / 飞书 群机器人 webhook）
-- 注意：
--   * sync-mysql 对 parameterized 查询传空字符串会当 NULL（已知兼容性坑），
--     因此 NOT NULL 文本列必须给默认值，并在应用层严格传非空字符串（推荐 secret 默认值就是空串 ""）；
--     这里为了兼容，把允许"空值语义"的列直接放宽为 DEFAULT NULL，由前端/应用层把空值等同于空串。
CREATE TABLE IF NOT EXISTS anomaly_alert_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name        VARCHAR(100) NOT NULL DEFAULT '',            -- 渠道名，例"运营告警钉钉群"
  channel_type VARCHAR(20) NOT NULL DEFAULT 'dingtalk',    -- dingtalk / wecom / feishu
  webhook_url VARCHAR(500) NOT NULL,
  secret      VARCHAR(255) NULL,                           -- 钉钉/飞书可选的签名密钥；空则是未启用加签
  mention_mobiles TEXT,                                     -- JSON 数组
  mention_all   TINYINT DEFAULT 0,
  severity_mask TINYINT NOT NULL DEFAULT 7,
  type_mask     VARCHAR(200) NOT NULL DEFAULT '*',
  rate_limit_minutes INTEGER NOT NULL DEFAULT 5,
  enabled       TINYINT DEFAULT 1,
  remark        VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 数据异常告警：发送历史（用来做去重节流 + 后台留痕）
CREATE TABLE IF NOT EXISTS anomaly_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    INTEGER NOT NULL,
  fingerprint   VARCHAR(64) NOT NULL,                      -- 去重指纹 = md5(channel_id+severity+anomaly_type+dedup_key)
  anomaly_type  VARCHAR(40) NOT NULL DEFAULT '',
  severity      VARCHAR(20) NOT NULL DEFAULT 'info',       -- critical / warning / info
  summary       VARCHAR(500) NOT NULL DEFAULT '',
  payload       TEXT,                                       -- 完整异常明细（JSON）
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending / sent / failed / suppressed
  error_msg     TEXT,
  sent_at       DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ev_fp_created (fingerprint, created_at),
  INDEX idx_ev_channel (channel_id, created_at)
);
