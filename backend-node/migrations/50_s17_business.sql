-- ============================================================
-- Sprint 17 - 商业化闭环（财务 + 支付 + 会员）
--   T17-02 优惠券：coupons / coupon_redemptions
--   会员订单增加优惠抵扣字段（幂等：重复执行报 duplicate column 自动跳过）
-- ============================================================

-- ------------------------------------------------------------
-- 1) 优惠券表（S17-T02）
--    type:        amount(固定金额,元) / percent(折扣率,百分数如 10 表示 9 折)
--    value:       amount→面额(元)；percent→折扣率(0,100]
--    min_spend:   订单原价门槛（元），低于门槛不可用
--    scope:       适用范围，默认 membership（会员购买）
--    total_stock: 总库存，0=不限量
--    used_count:  已领取次数（含核销），领取时原子 +1，关单回退 -1
--    start_at/end_at: 生效/失效时间，NULL 表示不限制
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(64)  NOT NULL COMMENT '唯一兑换码(大写)',
  name        VARCHAR(64)  NOT NULL COMMENT '优惠券名称',
  type        VARCHAR(16)  NOT NULL DEFAULT 'amount' COMMENT 'amount固定金额/percent折扣率',
  value       DECIMAL(10,2) NOT NULL COMMENT '面额(元)或折扣率(percent时,0-100)',
  min_spend   DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '使用门槛(订单金额下限,元)',
  scope       VARCHAR(32)  NOT NULL DEFAULT 'membership' COMMENT '适用范围: membership会员购买',
  total_stock INT          NOT NULL DEFAULT 0 COMMENT '总库存(0=不限)',
  used_count  INT          NOT NULL DEFAULT 0 COMMENT '已领取次数',
  start_at    DATETIME     NULL COMMENT '生效时间(NULL=不限)',
  end_at      DATETIME     NULL COMMENT '失效时间(NULL=不限)',
  enabled     TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用/0失效',
  remark      VARCHAR(255) NULL COMMENT '备注',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_coupon_code (code),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S17-T02 优惠券';

-- ------------------------------------------------------------
-- 2) 优惠券领取/核销记录（S17-T02）
--    status: claimed(已领取) / used(已核销) / refunded(关单退回后恢复claimed则无此态) / invalid
--    防重复领取：uk_coupon_user (coupon_id, user_id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  coupon_id   BIGINT       NOT NULL COMMENT '优惠券ID',
  user_id     BIGINT       NOT NULL COMMENT '领取用户ID',
  code        VARCHAR(64)  NOT NULL COMMENT '券码快照',
  status      VARCHAR(16)  NOT NULL DEFAULT 'claimed' COMMENT 'claimed已领取/used已核销',
  order_no    VARCHAR(64)  NULL COMMENT '核销关联订单号',
  amount      DECIMAL(10,2) NULL COMMENT '实际抵扣金额(元)',
  claimed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at     DATETIME     NULL COMMENT '核销时间',
  UNIQUE KEY uk_coupon_user (coupon_id, user_id),
  KEY idx_user (user_id),
  KEY idx_status (status),
  KEY idx_order (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S17-T02 优惠券领取/核销记录';

-- ------------------------------------------------------------
-- 3) 会员订单增加优惠券抵扣字段（S17-T02）
--    重复执行时报 duplicate column，migrate.js 自动跳过（幂等）
-- ------------------------------------------------------------
ALTER TABLE membership_orders ADD COLUMN coupon_id BIGINT NULL COMMENT 'S17-T02 使用的优惠券ID';
ALTER TABLE membership_orders ADD COLUMN coupon_code VARCHAR(64) NULL COMMENT 'S17-T02 使用的券码';
ALTER TABLE membership_orders ADD COLUMN original_amount DECIMAL(10,2) NULL COMMENT 'S17-T02 优惠前应付金额(元)';
ALTER TABLE membership_orders ADD COLUMN discount_amount DECIMAL(10,2) NULL COMMENT 'S17-T02 优惠抵扣金额(元)';
