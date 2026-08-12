-- ============================================================
-- Sprint 13: 会员体系 + 评论批注
-- Migration 49
--
-- 说明：
--   S13-T01 会员等级体系   → membership_plans        免费/基础/专业/企业 四级套餐 + 功能配额定义(JSON)
--   S13-T02 会员计费系统   → user_memberships        用户当前会员关系(等级/周期/到期/自动续费)
--   S13-T04 支付集成       → membership_orders       会员购买订单(下单/支付回调/幂等)
--   S13-T05 功能配额限制   → membership_quota_usage  周期内配额用量计数(生成次数/项目数/存储/协作)
--   S13-T06 评论批注系统   → canvas_comments         画布节点评论 + 时间戳批注 + 线程回复 + 已解决状态
--                          → comment_mentions        评论 @提及 关系
--                          → comment_reads           评论已读/未读跟踪
--
-- 兼容性：
--   - 全部为新增独立表，不改动既有表结构，旧数据不受影响
--   - 采用 CREATE TABLE IF NOT EXISTS，重复执行幂等
--   - 计费复用系统既有约定：100 积分 = 1 元；金额单位为「元」(DECIMAL)
-- ============================================================

-- ------------------------------------------------------------
-- 1) 会员套餐表（S13-T01）
--    level_code:   free(免费) / basic(基础) / pro(专业) / enterprise(企业)
--    level_rank:   等级序号(0/1/2/3)，用于升降级比较
--    price_monthly / price_yearly / price_lifetime: 月付/年付/终身 价格(元)，NULL 表示该周期不售卖
--    quota_config: 功能配额定义(JSON)：
--        { monthly_generations, max_projects, storage_mb, max_collaborators, ... }
--        -1 表示无限制
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_plans (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  level_code      VARCHAR(24)  NOT NULL COMMENT '等级代码: free/basic/pro/enterprise',
  level_rank      INT          NOT NULL DEFAULT 0 COMMENT '等级序号(用于升降级比较)',
  name            VARCHAR(64)  NOT NULL COMMENT '套餐展示名',
  subtitle        VARCHAR(128) NULL COMMENT '副标题/一句话卖点',
  price_monthly   DECIMAL(10,2) NULL COMMENT '月付价格(元)，NULL=不售卖',
  price_yearly    DECIMAL(10,2) NULL COMMENT '年付价格(元)，NULL=不售卖',
  price_lifetime  DECIMAL(10,2) NULL COMMENT '终身价格(元)，NULL=不售卖',
  quota_config    TEXT         NOT NULL COMMENT '功能配额定义(JSON)',
  benefits        TEXT         NULL COMMENT '权益点列表(JSON数组，用于前端权益对比)',
  badge_color     VARCHAR(16)  NULL COMMENT '徽章配色(前端展示)',
  sort_order      INT          NOT NULL DEFAULT 0 COMMENT '展示排序',
  enabled         TINYINT      NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_level_code (level_code),
  KEY idx_rank (level_rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T01 会员套餐与配额定义';

-- ------------------------------------------------------------
-- 2) 用户会员关系表（S13-T02）
--    一个用户至多一条生效会员记录（UNIQUE user_id），免费用户可不存在记录（缺省视为 free）
--    billing_cycle: monthly / yearly / lifetime
--    status:        active(生效) / expired(过期) / cancelled(已取消自动续费但仍在有效期内)
--    started_at / expires_at: 生效/到期(终身为 NULL)
--    auto_renew:    1开启自动续费 0关闭
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_memberships (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT       NOT NULL COMMENT '用户ID',
  plan_id         BIGINT       NOT NULL COMMENT '当前套餐ID',
  level_code      VARCHAR(24)  NOT NULL DEFAULT 'free' COMMENT '冗余等级代码(便于查询)',
  billing_cycle   VARCHAR(16)  NOT NULL DEFAULT 'monthly' COMMENT 'monthly/yearly/lifetime',
  status          VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/expired/cancelled',
  auto_renew      TINYINT      NOT NULL DEFAULT 0 COMMENT '1自动续费 0否',
  started_at      DATETIME     NULL COMMENT '本期生效时间',
  expires_at      DATETIME     NULL COMMENT '到期时间(终身为NULL)',
  last_order_id   BIGINT       NULL COMMENT '最近一笔开通/续费订单ID',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user (user_id),
  KEY idx_level (level_code),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T02 用户会员关系';

-- ------------------------------------------------------------
-- 3) 会员订单表（S13-T04）
--    order_type:   new(首购) / renew(续费) / upgrade(升级) / downgrade(降级预约)
--    pay_method:   wechat(微信支付) / alipay(支付宝) / points(积分抵扣) / manual(后台开通)
--    pay_status:   pending(待支付) / paid(已支付) / failed(失败) / refunded(已退款) / closed(超时关闭)
--    order_no:     业务订单号(幂等，唯一)
--    trade_no:     第三方支付流水号(回调写入)
--    amount:       应付金额(元)；amount_yuan 冗余便于核对
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_orders (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no        VARCHAR(64)  NOT NULL COMMENT '业务订单号(幂等)',
  user_id         BIGINT       NOT NULL COMMENT '下单用户ID',
  plan_id         BIGINT       NOT NULL COMMENT '目标套餐ID',
  level_code      VARCHAR(24)  NOT NULL COMMENT '目标等级代码',
  billing_cycle   VARCHAR(16)  NOT NULL COMMENT 'monthly/yearly/lifetime',
  order_type      VARCHAR(16)  NOT NULL DEFAULT 'new' COMMENT 'new/renew/upgrade/downgrade',
  amount          DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '应付金额(元)',
  pay_method      VARCHAR(16)  NULL COMMENT 'wechat/alipay/points/manual',
  pay_status      VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/paid/failed/refunded/closed',
  trade_no        VARCHAR(128) NULL COMMENT '第三方支付流水号',
  prepay_id       VARCHAR(128) NULL COMMENT '预支付会话标识(微信prepay_id/支付宝trade)',
  paid_at         DATETIME     NULL COMMENT '支付完成时间',
  effective_from  DATETIME     NULL COMMENT '本单会员生效起点',
  effective_to    DATETIME     NULL COMMENT '本单会员到期(终身NULL)',
  remark          VARCHAR(500) NULL COMMENT '备注',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_user (user_id),
  KEY idx_status (pay_status),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T04 会员购买订单';

-- ------------------------------------------------------------
-- 4) 配额用量表（S13-T05）
--    metric:       generation(生成次数) / project(项目数) / storage(存储MB) / collaborator(协作人数)
--    period_key:   计量周期键。生成次数按自然月(yyyymm)；项目/存储/协作为累计型，period_key='total'
--    used:         已使用量
--    通过 UNIQUE(user_id, metric, period_key) 保证同周期单指标一行，配合原子自增计数
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_quota_usage (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT       NOT NULL COMMENT '用户ID',
  metric          VARCHAR(24)  NOT NULL COMMENT 'generation/project/storage/collaborator',
  period_key      VARCHAR(16)  NOT NULL DEFAULT 'total' COMMENT '周期键: yyyymm 或 total',
  used            BIGINT       NOT NULL DEFAULT 0 COMMENT '已使用量',
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_metric_period (user_id, metric, period_key),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T05 会员功能配额用量';

-- ------------------------------------------------------------
-- 5) 画布评论批注表（S13-T06）
--    node_key:     被评论的画布节点键(type:id，如 character:12 / storyboard:88)；NULL 为项目级评论
--    parent_id:    父评论ID(线程回复)，NULL 为顶层评论
--    root_id:      线程根评论ID(便于按线程聚合与批量回复)，顶层评论 root_id=自身
--    timestamp_ms: 时间戳批注(分镜/时间轴上的毫秒定位)，NULL 表示非时间戳批注
--    status:       open(未解决) / resolved(已解决)
--    is_deleted:   软删除
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_comments (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id        BIGINT       NOT NULL COMMENT '项目ID',
  node_key        VARCHAR(128) NULL COMMENT '画布节点键 type:id，NULL=项目级',
  parent_id       BIGINT       NULL COMMENT '父评论ID(回复)',
  root_id         BIGINT       NULL COMMENT '线程根评论ID',
  author_id       BIGINT       NOT NULL COMMENT '评论作者用户ID',
  author_name     VARCHAR(128) NULL COMMENT '作者用户名(冗余展示)',
  content         TEXT         NOT NULL COMMENT '评论正文',
  timestamp_ms    BIGINT       NULL COMMENT '时间戳批注(毫秒定位)',
  status          VARCHAR(16)  NOT NULL DEFAULT 'open' COMMENT 'open/resolved',
  resolved_by     BIGINT       NULL COMMENT '解决人用户ID',
  resolved_at     DATETIME     NULL COMMENT '解决时间',
  is_deleted      TINYINT      NOT NULL DEFAULT 0 COMMENT '1软删除',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_drama_node (drama_id, node_key),
  KEY idx_root (root_id),
  KEY idx_parent (parent_id),
  KEY idx_author (author_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T06 画布评论批注';

-- ------------------------------------------------------------
-- 6) 评论 @提及表（S13-T06）
--    记录一条评论中 @ 了哪些用户，用于给被提及者定向通知与高亮
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment_mentions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  comment_id      BIGINT       NOT NULL COMMENT '评论ID',
  drama_id        BIGINT       NOT NULL COMMENT '项目ID(便于按项目清理)',
  mentioned_user_id BIGINT     NOT NULL COMMENT '被提及用户ID',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comment_user (comment_id, mentioned_user_id),
  KEY idx_mentioned (mentioned_user_id),
  KEY idx_drama (drama_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T06 评论@提及关系';

-- ------------------------------------------------------------
-- 7) 评论已读表（S13-T06）
--    记录某用户已读到的评论。用于计算「未读评论数」与已读/未读状态跟踪。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment_reads (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  comment_id      BIGINT       NOT NULL COMMENT '评论ID',
  drama_id        BIGINT       NOT NULL COMMENT '项目ID',
  user_id         BIGINT       NOT NULL COMMENT '读者用户ID',
  read_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comment_user (comment_id, user_id),
  KEY idx_user_drama (user_id, drama_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S13-T06 评论已读跟踪';

-- ------------------------------------------------------------
-- 8) 默认四级会员套餐种子（幂等 INSERT ... 唯一键冲突忽略）
--    配额说明(quota_config)：-1 = 无限制
--      monthly_generations 每月 AI 生成次数
--      max_projects        可创建项目数(累计)
--      storage_mb          存储空间(MB)
--      max_collaborators   单项目最大协作人数
-- ------------------------------------------------------------
INSERT INTO membership_plans
  (level_code, level_rank, name, subtitle, price_monthly, price_yearly, price_lifetime, quota_config, benefits, badge_color, sort_order, enabled)
VALUES
  ('free', 0, '免费版', '入门体验，畅享基础创作', 0.00, 0.00, NULL,
   '{"monthly_generations":30,"max_projects":3,"storage_mb":512,"max_collaborators":1}',
   '["每月30次AI生成","最多3个项目","512MB存储空间","标准生成队列"]',
   '#94a3b8', 1, 1),
  ('basic', 1, '基础版', '高频创作者的性价比之选', 29.00, 299.00, NULL,
   '{"monthly_generations":300,"max_projects":15,"storage_mb":10240,"max_collaborators":3}',
   '["每月300次AI生成","最多15个项目","10GB存储空间","3人协作","优先生成队列"]',
   '#3b82f6', 2, 1),
  ('pro', 2, '专业版', '专业团队的高效创作引擎', 99.00, 999.00, NULL,
   '{"monthly_generations":2000,"max_projects":100,"storage_mb":102400,"max_collaborators":10}',
   '["每月2000次AI生成","最多100个项目","100GB存储空间","10人协作","高优先级队列","版本管理与批注"]',
   '#8b5cf6', 3, 1),
  ('enterprise', 3, '企业版', '不设限的企业级全能方案', 399.00, 3999.00, 9999.00,
   '{"monthly_generations":-1,"max_projects":-1,"storage_mb":1048576,"max_collaborators":-1}',
   '["无限AI生成","无限项目","1TB存储空间","无限协作","专属通道与SLA","团队权限与审计"]',
   '#f59e0b', 4, 1)
ON DUPLICATE KEY UPDATE level_code = level_code;
