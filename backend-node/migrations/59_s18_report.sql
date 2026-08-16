-- S18-T02 报表订阅与自定义仪表盘
-- 幂等：CREATE TABLE IF NOT EXISTS，重复执行自动跳过（migrate.js 捕获 ER_TABLE_EXISTS_ERROR 标 Skip）

-- 报表订阅：周期/模板/接收渠道/开关/运行记录
CREATE TABLE IF NOT EXISTS report_subscription (
  id BIGINT NOT NULL COMMENT '雪花 ID 主键',
  name VARCHAR(128) NOT NULL COMMENT '订阅名称',
  report_type VARCHAR(32) NOT NULL DEFAULT 'daily' COMMENT '周期：daily / weekly / monthly',
  template_id BIGINT NULL COMMENT '关联 report_templates.id（自定义报表）',
  schedule VARCHAR(64) NULL COMMENT '可选 cron 表达式，优先于 report_type 周期',
  recipients JSON NULL COMMENT '接收渠道 [{type: email|dingtalk, target: 邮箱|webhook}]',
  enabled TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
  last_run_at DATETIME NULL COMMENT '最近一次运行时间',
  next_run_at DATETIME NULL COMMENT '下次计划运行时间',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rs_enabled (enabled, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报表订阅';

-- 自定义报表模板：选择分析模块与参数
CREATE TABLE IF NOT EXISTS report_templates (
  id BIGINT NOT NULL COMMENT '雪花 ID 主键',
  name VARCHAR(128) NOT NULL COMMENT '模板名称',
  description VARCHAR(512) NULL COMMENT '模板说明',
  sections JSON NULL COMMENT '分析模块数组，如 ["overview","behavior","funnel","retention","events"]',
  params JSON NULL COMMENT '模板参数，如 {"days":30,"funnel_steps":["page_view","login"]}',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='自定义报表模板';

-- 报表发送日志：发送历史与失败重试
CREATE TABLE IF NOT EXISTS report_send_log (
  id BIGINT NOT NULL COMMENT '雪花 ID 主键',
  subscription_id BIGINT NULL COMMENT '关联订阅（模板直发可为空）',
  report_type VARCHAR(32) NULL COMMENT '报表周期类型',
  title VARCHAR(256) NULL COMMENT '报表标题',
  channel VARCHAR(16) NOT NULL COMMENT '渠道：email / dingtalk',
  recipient VARCHAR(256) NULL COMMENT '接收方（邮箱 / webhook）',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending / success / failed',
  error VARCHAR(512) NULL COMMENT '失败原因（不落敏感信息）',
  retry_count INT NOT NULL DEFAULT 0 COMMENT '已重试次数',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_rsl_status (status),
  KEY idx_rsl_sub (subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报表发送日志';

-- 管理员自定义仪表盘布局
CREATE TABLE IF NOT EXISTS dashboard_layout (
  id BIGINT NOT NULL COMMENT '雪花 ID 主键',
  admin_id BIGINT NOT NULL COMMENT '管理员用户 ID',
  layout JSON NULL COMMENT '布局组件数组 [{type,title,width,height,order,opts}]',
  version INT NOT NULL DEFAULT 1 COMMENT '布局版本（乐观锁）',
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dl_admin (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员仪表盘布局';
