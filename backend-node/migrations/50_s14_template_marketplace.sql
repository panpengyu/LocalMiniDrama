-- ============================================================
-- Sprint 14: 模板市场（创作者生态）
-- Migration 50
--
-- 说明：
--   S14-T01 模板市场后端 → marketplace_templates    上架模板（定价/分类/统计/上下架/内容体）
--                        → marketplace_ratings       模板评分与评论（一人一评，可更新）
--                        → marketplace_downloads      下载/购买明细（免费下载 & 付费购买）
--   S14-T03 创作者入驻   → marketplace_creators       创作者档案（认证状态/简介/收款信息/收益汇总）
--                        → marketplace_withdrawals    提现申请（待审/通过/驳回/打款）
--   S14-T04 审核流程     → marketplace_review_logs     审核流水（AI 预审 + 人工复审的完整轨迹）
--   S14-T05 收益分成     → marketplace_settlements     每笔付费购买的分成结算（平台/创作者）
--                        → marketplace_creator_ledger  创作者收益流水（收益入账/提现出账）
--                        → global_settings             分成比例等平台参数（复用既有 KV 表，见种子）
--
-- 兼容性：
--   - 全部为新增独立表，不改动既有表结构，旧数据不受影响
--   - 采用 CREATE TABLE IF NOT EXISTS，重复执行幂等
--   - 计费复用系统既有约定：100 积分 = 1 元；金额单位为「元」(DECIMAL)
--   - 与 Sprint 6 的 drama_templates（系统内置模板）解耦：
--       drama_templates       = 官方内置创作模板（不参与交易）
--       marketplace_templates = 创作者上架的可交易模板（本 Sprint 新增）
--     二者通过 marketplace_templates.source_template_id 建立可选引用关系。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 创作者档案表（S14-T03）
--    verify_status: pending(待审核) / approved(已认证) / rejected(驳回) / none(未申请，缺省不建行)
--    settle_account_type: alipay / wechat / bank —— 收款渠道类型（提现打款用）
--    balance/total_income/total_withdrawn 均为「元」，作为汇总冗余，明细以 ledger 为准
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_creators (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT        NOT NULL COMMENT '关联用户ID',
  display_name       VARCHAR(64)   NOT NULL COMMENT '创作者展示名',
  bio                VARCHAR(500)  NULL COMMENT '创作者简介',
  avatar             VARCHAR(512)  NULL COMMENT '头像URL',
  verify_status      VARCHAR(16)   NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
  verify_remark      VARCHAR(500)  NULL COMMENT '认证审核备注（驳回原因等）',
  real_name          VARCHAR(64)   NULL COMMENT '实名（认证用，脱敏存储由应用层保证）',
  contact            VARCHAR(128)  NULL COMMENT '联系方式（邮箱/手机）',
  settle_account_type VARCHAR(16)  NULL COMMENT '收款渠道: alipay/wechat/bank',
  settle_account     VARCHAR(128)  NULL COMMENT '收款账号',
  commission_rate    DECIMAL(5,4)  NULL COMMENT '专属创作者分成比例(0~1，NULL=用平台默认)',
  balance            DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '可提现余额(元)',
  total_income       DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '累计收益(元)',
  total_withdrawn    DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT '累计已提现(元)',
  template_count     INT           NOT NULL DEFAULT 0 COMMENT '已上架模板数(冗余统计)',
  verified_at        DATETIME      NULL COMMENT '认证通过时间',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user (user_id),
  KEY idx_verify_status (verify_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T03 模板市场创作者档案';

-- ------------------------------------------------------------
-- 2) 市场模板表（S14-T01 / S14-T04）
--    pricing_type: free(免费) / paid(付费)
--    price:        售价(元)，free 时为 0
--    status:       draft(草稿) / pending(待审核) / ai_reviewing(AI预审中) / ai_passed(AI通过待人工)
--                  / rejected(驳回) / listed(已上架) / delisted(已下架)
--    content_json: 模板内容体(JSON)：角色/场景/风格/分镜节奏等预设（应用到项目所需的全部数据）
--    审核相关的 ai_* 字段由 S14-T04 审核流程写入
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_templates (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_no        VARCHAR(64)   NOT NULL COMMENT '业务模板编号(唯一)',
  creator_id         BIGINT        NOT NULL COMMENT '创作者档案ID(marketplace_creators.id)',
  creator_user_id    BIGINT        NOT NULL COMMENT '创作者用户ID(冗余便于查询)',
  source_template_id BIGINT        NULL COMMENT '可选引用的内置模板ID(drama_templates.id)',
  title              VARCHAR(128)  NOT NULL COMMENT '模板标题',
  summary            VARCHAR(255)  NULL COMMENT '一句话简介',
  description        TEXT          NULL COMMENT '详细介绍(富文本纯文本)',
  category           VARCHAR(32)   NOT NULL DEFAULT 'general' COMMENT '分类: urban/ancient/scifi/campus/suspense/general...',
  genre_type         VARCHAR(32)   NULL COMMENT '题材类型(与内置模板对齐)',
  tags               TEXT          NULL COMMENT '标签(JSON数组)',
  cover_image        VARCHAR(512)  NULL COMMENT '封面图URL',
  preview_images     TEXT          NULL COMMENT '预览图集(JSON数组)',
  content_json       MEDIUMTEXT    NOT NULL COMMENT '模板内容体(JSON)：角色/场景/风格/分镜节奏预设',
  pricing_type       VARCHAR(16)   NOT NULL DEFAULT 'free' COMMENT 'free/paid',
  price              DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '售价(元)，free=0',
  status             VARCHAR(16)   NOT NULL DEFAULT 'draft' COMMENT 'draft/pending/ai_reviewing/ai_passed/rejected/listed/delisted',
  reject_reason      VARCHAR(500)  NULL COMMENT '最近一次驳回原因',
  ai_review_score    DECIMAL(5,2)  NULL COMMENT 'AI 预审综合分(0~100)',
  ai_review_passed   TINYINT       NULL COMMENT 'AI 预审是否通过: 1/0/NULL(未审)',
  ai_review_detail   TEXT          NULL COMMENT 'AI 预审明细(JSON)',
  reviewer_id        BIGINT        NULL COMMENT '人工复审管理员ID',
  reviewed_at        DATETIME      NULL COMMENT '人工复审时间',
  listed_at          DATETIME      NULL COMMENT '上架时间',
  download_count     INT           NOT NULL DEFAULT 0 COMMENT '下载/购买总数',
  purchase_count     INT           NOT NULL DEFAULT 0 COMMENT '付费购买数',
  rating_sum         BIGINT        NOT NULL DEFAULT 0 COMMENT '评分总和(用于均分计算)',
  rating_count       INT           NOT NULL DEFAULT 0 COMMENT '评分人数',
  rating_avg         DECIMAL(3,2)  NOT NULL DEFAULT 0.00 COMMENT '平均评分(0~5，冗余便于排序)',
  is_deleted         TINYINT       NOT NULL DEFAULT 0 COMMENT '1软删除',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_template_no (template_no),
  KEY idx_creator (creator_id),
  KEY idx_status (status),
  KEY idx_category (category),
  KEY idx_pricing (pricing_type),
  KEY idx_listed (listed_at),
  KEY idx_rating (rating_avg),
  KEY idx_downloads (download_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T01 市场可交易模板';

-- ------------------------------------------------------------
-- 3) 模板评分与评论表（S14-T01）
--    一个用户对一个模板至多一条评分（UNIQUE），可更新
--    仅允许「已下载/已购买」的用户评分（业务层校验）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_ratings (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_id        BIGINT        NOT NULL COMMENT '模板ID',
  user_id            BIGINT        NOT NULL COMMENT '评分用户ID',
  rating             TINYINT       NOT NULL COMMENT '评分(1~5)',
  comment            VARCHAR(1000) NULL COMMENT '评论内容',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_template_user (template_id, user_id),
  KEY idx_template (template_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T01 模板评分评论';

-- ------------------------------------------------------------
-- 4) 下载/购买明细表（S14-T01 / S14-T05）
--    acquire_type: download(免费下载) / purchase(付费购买)
--    order_no:     付费购买订单号(免费为 NULL)；同一用户对同一付费模板只需购买一次(UNIQUE 保证幂等)
--    price_paid:   实付金额(元)，免费为 0
--    settled:      是否已完成分成结算(1/0)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_downloads (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_id        BIGINT        NOT NULL COMMENT '模板ID',
  user_id            BIGINT        NOT NULL COMMENT '获取用户ID',
  creator_id         BIGINT        NOT NULL COMMENT '创作者档案ID(冗余便于收益核对)',
  acquire_type       VARCHAR(16)   NOT NULL DEFAULT 'download' COMMENT 'download/purchase',
  order_no           VARCHAR(64)   NULL COMMENT '购买订单号(免费为NULL)',
  pay_method         VARCHAR(16)   NULL COMMENT '支付方式: points/wechat/alipay',
  price_paid         DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '实付金额(元)',
  settled            TINYINT       NOT NULL DEFAULT 0 COMMENT '1已完成分成结算',
  applied_drama_id   BIGINT        NULL COMMENT '应用生成的项目ID(若下载后直接创建项目)',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_template_user (template_id, user_id),
  KEY idx_template (template_id),
  KEY idx_user (user_id),
  KEY idx_creator (creator_id),
  KEY idx_type (acquire_type),
  KEY idx_order (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T01 模板下载/购买明细';

-- ------------------------------------------------------------
-- 5) 审核流水表（S14-T04）
--    review_type: ai(AI预审) / manual(人工复审) / submit(提交审核) / resubmit(重新提交)
--    action:      submit / ai_pass / ai_reject / approve / reject / delist / relist
--    reviewer_id: 人工复审管理员ID(AI 审核为 NULL)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_review_logs (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  template_id        BIGINT        NOT NULL COMMENT '模板ID',
  review_type        VARCHAR(16)   NOT NULL COMMENT 'submit/ai/manual',
  action             VARCHAR(24)   NOT NULL COMMENT 'submit/ai_pass/ai_reject/approve/reject/delist/relist',
  from_status        VARCHAR(16)   NULL COMMENT '变更前状态',
  to_status          VARCHAR(16)   NULL COMMENT '变更后状态',
  score              DECIMAL(5,2)  NULL COMMENT 'AI 评分(0~100)',
  reviewer_id        BIGINT        NULL COMMENT '人工复审管理员ID',
  remark             VARCHAR(1000) NULL COMMENT '审核意见/驳回原因/AI摘要',
  detail_json        TEXT          NULL COMMENT '审核明细(JSON)',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_template (template_id),
  KEY idx_type (review_type),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T04 模板审核流水';

-- ------------------------------------------------------------
-- 6) 分成结算表（S14-T05）
--    每一笔付费购买产生一条结算记录：
--      gross_amount    成交金额(元)
--      platform_rate   平台分成比例(0~1)
--      platform_amount 平台所得(元)
--      creator_amount  创作者所得(元) = gross - platform
--    与 marketplace_downloads.id 一对一关联(download_id UNIQUE)，保证幂等结算
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_settlements (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  download_id        BIGINT        NOT NULL COMMENT '关联下载/购买记录ID',
  template_id        BIGINT        NOT NULL COMMENT '模板ID',
  creator_id         BIGINT        NOT NULL COMMENT '创作者档案ID',
  buyer_user_id      BIGINT        NOT NULL COMMENT '购买者用户ID',
  order_no           VARCHAR(64)   NULL COMMENT '购买订单号',
  gross_amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '成交金额(元)',
  platform_rate      DECIMAL(5,4)  NOT NULL DEFAULT 0.3000 COMMENT '平台分成比例(0~1)',
  platform_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '平台所得(元)',
  creator_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '创作者所得(元)',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_download (download_id),
  KEY idx_template (template_id),
  KEY idx_creator (creator_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T05 模板购买分成结算';

-- ------------------------------------------------------------
-- 7) 创作者收益流水表（S14-T05）
--    entry_type: income(收益入账) / withdraw(提现出账) / withdraw_refund(提现驳回退回)
--    amount:     正数入账，负数出账(元)
--    balance_after: 变更后余额(元)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_creator_ledger (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  creator_id         BIGINT        NOT NULL COMMENT '创作者档案ID',
  entry_type         VARCHAR(24)   NOT NULL COMMENT 'income/withdraw/withdraw_refund',
  amount             DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '金额(元)，正入账负出账',
  balance_after      DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '变更后余额(元)',
  ref_type           VARCHAR(24)   NULL COMMENT '来源类型: settlement/withdrawal',
  ref_id             BIGINT        NULL COMMENT '来源记录ID',
  remark             VARCHAR(500)  NULL COMMENT '备注',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_creator (creator_id),
  KEY idx_type (entry_type),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T05 创作者收益流水';

-- ------------------------------------------------------------
-- 8) 提现申请表（S14-T03 / S14-T05）
--    status: pending(待审核) / approved(已通过待打款) / paid(已打款) / rejected(驳回)
--    申请时冻结创作者余额(扣减 balance)，驳回时退回
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_withdrawals (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  withdraw_no        VARCHAR(64)   NOT NULL COMMENT '提现单号(唯一)',
  creator_id         BIGINT        NOT NULL COMMENT '创作者档案ID',
  creator_user_id    BIGINT        NOT NULL COMMENT '创作者用户ID',
  amount             DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '提现金额(元)',
  account_type       VARCHAR(16)   NULL COMMENT '收款渠道: alipay/wechat/bank',
  account            VARCHAR(128)  NULL COMMENT '收款账号(申请时快照)',
  status             VARCHAR(16)   NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/paid/rejected',
  review_remark      VARCHAR(500)  NULL COMMENT '审核备注/驳回原因',
  reviewer_id        BIGINT        NULL COMMENT '审核管理员ID',
  reviewed_at        DATETIME      NULL COMMENT '审核时间',
  paid_at            DATETIME      NULL COMMENT '打款时间',
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_withdraw_no (withdraw_no),
  KEY idx_creator (creator_id),
  KEY idx_status (status),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S14-T03/T05 创作者提现申请';

-- ------------------------------------------------------------
-- 9) 平台参数种子（S14-T05）：分成比例、提现门槛
--    复用既有 KV 表 global_settings（migration 48 创建，列：`key` / value / updated_at）
--    marketplace_platform_rate  平台分成比例(0~1)，默认 0.30（平台抽成30%，创作者得70%）
--    marketplace_min_withdrawal 最低提现金额(元)，默认 10
-- ------------------------------------------------------------
INSERT INTO global_settings (`key`, `value`, updated_at)
VALUES
  ('marketplace_platform_rate', '0.30', CURRENT_TIMESTAMP),
  ('marketplace_min_withdrawal', '10', CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE `key` = `key`;
