-- S17-T04: 支付订单管理（管理端查询/关单/退款）所需列补齐
-- 幂等：列已存在时 ensureColumns 会跳过；重复执行安全。
ALTER TABLE membership_orders ADD COLUMN refund_reason VARCHAR(500) NULL COMMENT '退款原因(管理端填写)';
ALTER TABLE membership_orders ADD COLUMN refunded_at DATETIME NULL COMMENT '退款完成时间';
