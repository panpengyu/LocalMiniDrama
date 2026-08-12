-- ============================================================
-- Sprint 12: 素材管理 + 对象存储 + 后台深度运营
-- Migration 45
--
-- 说明（对应任务）：
--   S12-T01 素材智能标签   → material_tags / material_tag_relations 素材标签维度(内容/风格/情绪/色彩/用途)
--   S12-T02 三级素材库     → *_libraries 三张表新增 scope/owner_id/team_id/enterprise_id/visibility 列
--   S12-T03 对象存储迁移   → storage_objects 存储对象元数据 + 生命周期(归档/删除)
--   S12-T04 用户生命周期   → user_activity_logs 行为流水 + user_lifecycle 画像/健康分/阶段 + users.last_login_at 列
--   S12-T05 财务与计费     → billing_rules 计费规则 + finance_daily_reports 财务日报快照
--   S12-T06 系统监控       → system_metric_snapshots 系统指标采样(可选持久化)
--   S12-T07 权限与安全     → operation_audit_logs 全站操作审计 + login_logs 登录日志
--   S12-T08 数据分析       → 复用 point_logs / recharges / ai_model_call_logs / 现有埋点表，无需新表
--
-- 兼容性：
--   - 新增独立表用 CREATE TABLE IF NOT EXISTS，重复执行幂等
--   - 既有表(角色/场景/道具库、users)的列扩展由 db/migrate.js 的 ensureAllColumns 幂等补齐，
--     此处 ALTER 仅作显式声明；缺列错误被 runOne 吞掉，保证 SQLite/MySQL 双兼容
-- ============================================================

-- ------------------------------------------------------------
-- S12-T01 素材标签维度表
--   dimension: content(内容) / style(风格) / emotion(情绪) / color(色彩) / usage(用途)
--   name:      标签名(如 人物/动漫/温馨/暖色/背景)
--   source:    ai(AI自动) / rule(规则降级) / manual(人工)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_tags (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  dimension   VARCHAR(16)  NOT NULL COMMENT '标签维度: content/style/emotion/color/usage',
  name        VARCHAR(64)  NOT NULL COMMENT '标签名',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dim_name (dimension, name),
  KEY idx_dimension (dimension)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T01 素材标签词典(多维度)';

-- 素材(库条目) ↔ 标签 关联表
--   material_table: character_libraries / scene_libraries / prop_libraries
--   material_id:    对应库表主键
--   confidence:     置信度(0~1)，AI 打标签的可信程度
CREATE TABLE IF NOT EXISTS material_tag_relations (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  material_table VARCHAR(32)  NOT NULL COMMENT '素材所在库表名',
  material_id    BIGINT       NOT NULL COMMENT '素材(库条目)ID',
  tag_id         BIGINT       NOT NULL COMMENT '标签ID',
  source         VARCHAR(12)  NOT NULL DEFAULT 'ai' COMMENT '来源: ai/rule/manual',
  confidence     FLOAT        NOT NULL DEFAULT 1 COMMENT '置信度 0~1',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_material_tag (material_table, material_id, tag_id),
  KEY idx_material (material_table, material_id),
  KEY idx_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T01 素材-标签关联';

-- ------------------------------------------------------------
-- S12-T02 三级素材库：为三张既有库表补 scope 归属列
--   scope:       project(项目级) / personal(个人库) / team(团队库) / public(公共库)
--   owner_id:    个人库归属用户
--   team_id:     团队库归属团队
--   enterprise_id: 企业归属(团队库上层)
--   visibility:  private/team/public 可见性(与 scope 协同)
-- 说明：SQLite 不支持 ADD COLUMN IF NOT EXISTS，缺列/重复错误由 runOne 吞掉；
--       正式补列以 db/migrate.js ensureAllColumns 为准(双库统一)。
-- ------------------------------------------------------------
ALTER TABLE character_libraries ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'project' COMMENT 'project/personal/team/public';
ALTER TABLE character_libraries ADD COLUMN owner_id BIGINT NULL COMMENT '个人库归属用户ID';
ALTER TABLE character_libraries ADD COLUMN team_id BIGINT NULL COMMENT '团队库归属团队ID';
ALTER TABLE character_libraries ADD COLUMN enterprise_id BIGINT NULL COMMENT '企业归属ID';
ALTER TABLE character_libraries ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' COMMENT 'private/team/public';

ALTER TABLE scene_libraries ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'project' COMMENT 'project/personal/team/public';
ALTER TABLE scene_libraries ADD COLUMN owner_id BIGINT NULL COMMENT '个人库归属用户ID';
ALTER TABLE scene_libraries ADD COLUMN team_id BIGINT NULL COMMENT '团队库归属团队ID';
ALTER TABLE scene_libraries ADD COLUMN enterprise_id BIGINT NULL COMMENT '企业归属ID';
ALTER TABLE scene_libraries ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' COMMENT 'private/team/public';

ALTER TABLE prop_libraries ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'project' COMMENT 'project/personal/team/public';
ALTER TABLE prop_libraries ADD COLUMN owner_id BIGINT NULL COMMENT '个人库归属用户ID';
ALTER TABLE prop_libraries ADD COLUMN team_id BIGINT NULL COMMENT '团队库归属团队ID';
ALTER TABLE prop_libraries ADD COLUMN enterprise_id BIGINT NULL COMMENT '企业归属ID';
ALTER TABLE prop_libraries ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' COMMENT 'private/team/public';

-- ------------------------------------------------------------
-- S12-T03 存储对象元数据表(对象存储抽象)
--   backend:   local(本地) / minio / oss / cos
--   object_key: 存储后端内的对象键(本地为相对路径)
--   lifecycle: active(活跃) / archived(归档) / deleted(逻辑删除)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_objects (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  backend       VARCHAR(16)  NOT NULL DEFAULT 'local' COMMENT '存储后端: local/minio/oss/cos',
  bucket        VARCHAR(128) NULL COMMENT '桶名(对象存储)',
  object_key    VARCHAR(512) NOT NULL COMMENT '对象键/相对路径',
  url           VARCHAR(1024) NULL COMMENT '访问URL',
  category      VARCHAR(32)  NULL COMMENT '分类: images/videos/audios',
  drama_id      BIGINT       NULL COMMENT '归属项目',
  size_bytes    BIGINT       NOT NULL DEFAULT 0 COMMENT '文件大小',
  mime_type     VARCHAR(128) NULL COMMENT 'MIME',
  checksum      VARCHAR(128) NULL COMMENT '内容校验(sha256)',
  lifecycle     VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/archived/deleted',
  last_access_at DATETIME    NULL COMMENT '最近访问时间(生命周期依据)',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_backend_key (backend, object_key),
  KEY idx_lifecycle (lifecycle),
  KEY idx_drama (drama_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T03 存储对象元数据';

-- ------------------------------------------------------------
-- S12-T04 用户行为流水(全站埋点)
--   action: login / create_drama / gen_image / gen_video / gen_text / recharge / export / ...
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT      NOT NULL COMMENT '用户ID',
  action      VARCHAR(48) NOT NULL COMMENT '行为类型',
  target_type VARCHAR(32) NULL COMMENT '对象类型',
  target_id   VARCHAR(64) NULL COMMENT '对象ID',
  meta        TEXT        NULL COMMENT '附加信息(JSON)',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_created (user_id, created_at),
  KEY idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T04 用户行为流水';

-- 用户生命周期/画像/健康分快照
--   stage: new(新用户) / active(活跃) / dormant(沉睡) / churn_risk(流失预警) / churned(已流失)
CREATE TABLE IF NOT EXISTS user_lifecycle (
  user_id          BIGINT      NOT NULL PRIMARY KEY COMMENT '用户ID',
  stage            VARCHAR(16) NOT NULL DEFAULT 'new' COMMENT 'new/active/dormant/churn_risk/churned',
  health_score     INT         NOT NULL DEFAULT 0 COMMENT '健康分 0~100',
  churn_risk       FLOAT       NOT NULL DEFAULT 0 COMMENT '流失风险 0~1',
  active_days_30   INT         NOT NULL DEFAULT 0 COMMENT '近30天活跃天数',
  total_actions    INT         NOT NULL DEFAULT 0 COMMENT '累计行为数',
  total_recharge   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计充值金额',
  profile_tags     VARCHAR(512) NULL COMMENT '画像标签(逗号分隔)',
  last_active_at   DATETIME    NULL COMMENT '最近活跃时间',
  computed_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本次计算时间',
  KEY idx_stage (stage),
  KEY idx_health (health_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T04 用户生命周期与健康分';

-- users 表补最近登录时间(用于活跃度/生命周期计算)
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL COMMENT '最近登录时间';

-- ------------------------------------------------------------
-- S12-T05 计费规则(智能计费)
--   scope_type: global / user_level / business
--   会员/等级维度动态计费系数
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_rules (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(64)  NOT NULL COMMENT '规则名',
  business_type VARCHAR(32)  NOT NULL DEFAULT 'image' COMMENT 'image/video/text/audio/other',
  user_level    VARCHAR(24)  NULL COMMENT '适用用户等级(空=全部)',
  unit_points   INT          NOT NULL DEFAULT 0 COMMENT '单次消耗积分',
  discount      FLOAT        NOT NULL DEFAULT 1 COMMENT '折扣系数(0~1)',
  enabled       TINYINT      NOT NULL DEFAULT 1 COMMENT '0停用 1启用',
  priority      INT          NOT NULL DEFAULT 0 COMMENT '优先级(越大越优先)',
  remark        VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_business (business_type),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T05 智能计费规则';

-- 财务日报快照(自动生成的日/周/月报表基础粒度=日)
CREATE TABLE IF NOT EXISTS finance_daily_reports (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  report_date     DATE         NOT NULL COMMENT '报表日期',
  revenue         DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '当日收入(充值金额)',
  recharge_points BIGINT       NOT NULL DEFAULT 0 COMMENT '当日充值积分',
  consumed_points BIGINT       NOT NULL DEFAULT 0 COMMENT '当日消耗积分',
  model_cost      DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '当日模型成本',
  gross_profit    DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '当日毛利(收入-成本)',
  paying_users    INT          NOT NULL DEFAULT 0 COMMENT '当日付费用户数',
  arpu            DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '当日ARPU',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_report_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T05 财务日报快照';

-- ------------------------------------------------------------
-- S12-T06 系统指标采样(可选持久化，实时监控主要走即时采集)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_metric_snapshots (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  cpu_percent   FLOAT   NOT NULL DEFAULT 0 COMMENT 'CPU使用率%',
  mem_percent   FLOAT   NOT NULL DEFAULT 0 COMMENT '内存使用率%',
  disk_percent  FLOAT   NOT NULL DEFAULT 0 COMMENT '磁盘使用率%',
  load_avg      FLOAT   NOT NULL DEFAULT 0 COMMENT '系统负载(1min)',
  queue_waiting INT     NOT NULL DEFAULT 0 COMMENT '队列等待任务数',
  queue_active  INT     NOT NULL DEFAULT 0 COMMENT '队列执行中任务数',
  api_qpm       INT     NOT NULL DEFAULT 0 COMMENT '近1分钟API请求数',
  api_error_rate FLOAT  NOT NULL DEFAULT 0 COMMENT '近1分钟API错误率',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T06 系统指标采样';

-- ------------------------------------------------------------
-- S12-T07 全站操作审计
--   记录管理端敏感操作(创建/更新/删除用户、修改配置等)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operation_audit_logs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id     BIGINT      NULL COMMENT '操作者用户ID',
  actor_name   VARCHAR(128) NULL COMMENT '操作者用户名',
  actor_role   VARCHAR(32) NULL COMMENT '操作者角色',
  action       VARCHAR(64) NOT NULL COMMENT '操作: user.create/user.delete/config.update/...',
  method       VARCHAR(8)  NULL COMMENT 'HTTP方法',
  path         VARCHAR(255) NULL COMMENT '请求路径',
  target_type  VARCHAR(32) NULL COMMENT '对象类型',
  target_id    VARCHAR(64) NULL COMMENT '对象ID',
  status_code  INT         NULL COMMENT '响应状态码',
  ip           VARCHAR(64) NULL COMMENT '来源IP',
  detail       TEXT        NULL COMMENT '细节(脱敏后JSON)',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_actor (actor_id),
  KEY idx_action (action),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T07 全站操作审计';

-- 登录日志(会话/安全)
CREATE TABLE IF NOT EXISTS login_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT      NULL COMMENT '用户ID(成功登录)',
  username    VARCHAR(128) NULL COMMENT '登录名(含失败尝试)',
  success     TINYINT     NOT NULL DEFAULT 1 COMMENT '0失败 1成功',
  ip          VARCHAR(64) NULL COMMENT '来源IP',
  user_agent  VARCHAR(255) NULL COMMENT 'UA',
  reason      VARCHAR(128) NULL COMMENT '失败原因',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S12-T07 登录日志';
