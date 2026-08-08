-- 运营概览 Dashboard 相关表
-- 渠道表（注册/引流渠道）
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) DEFAULT 'organic', -- organic / paid / partner / invite
  status TINYINT DEFAULT 1,
  remark VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 积分流水表（记录所有积分变更，支持按业务/日期统计）
CREATE TABLE IF NOT EXISTS point_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  change_type VARCHAR(20) NOT NULL, -- consume / recharge / refund / adjust
  business_type VARCHAR(30) DEFAULT 'other', -- image / video / text / audio / other
  amount INTEGER NOT NULL DEFAULT 0, -- 变更积分（正数增加 / 负数扣除）
  balance_after INTEGER DEFAULT 0,
  related_id VARCHAR(100), -- 关联业务ID（task_id / order_id 等）
  remark VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 充值订单表
CREATE TABLE IF NOT EXISTS recharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id INTEGER,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- 支付金额（元）
  points INTEGER NOT NULL DEFAULT 0, -- 到账积分
  pay_method VARCHAR(20), -- wechat / alipay / manual
  pay_status VARCHAR(20) DEFAULT 'paid', -- pending / paid / failed / refunded
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_point_logs_type ON point_logs(change_type, business_type);
CREATE INDEX IF NOT EXISTS idx_point_logs_created ON point_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_recharges_user ON recharges(user_id);
CREATE INDEX IF NOT EXISTS idx_recharges_status ON recharges(pay_status);
CREATE INDEX IF NOT EXISTS idx_recharges_created ON recharges(created_at);

-- 演示数据：渠道（8个分类，共 36 条）
INSERT OR IGNORE INTO channels (code, name, type, status, remark) VALUES
('ORG_001', '自然注册-官网首页', 'organic', 1, NULL),
('ORG_002', '自然注册-登录页分享链', 'organic', 1, NULL),
('ORG_003', '自然注册-公众号关注', 'organic', 1, NULL),
('ORG_004', '自然注册-邮件邀请', 'organic', 1, NULL),
('ORG_005', '自然注册-社群', 'organic', 1, NULL),
('PAID_001', '信息流-抖音', 'paid', 1, '短视频平台投放'),
('PAID_002', '信息流-快手', 'paid', 1, NULL),
('PAID_003', '信息流-小红书', 'paid', 1, NULL),
('PAID_004', '信息流-B站', 'paid', 1, NULL),
('PAID_005', '信息流-微信视频号', 'paid', 1, NULL),
('PAID_006', '搜索SEM-百度', 'paid', 1, NULL),
('PAID_007', '搜索SEM-谷歌', 'paid', 1, NULL),
('PAID_008', '搜索SEM-搜狗', 'paid', 1, NULL),
('PAID_009', '搜索SEM-360', 'paid', 1, NULL),
('PAID_010', '应用商店-应用宝', 'paid', 1, NULL),
('PAID_011', '应用商店-华为', 'paid', 1, NULL),
('PAID_012', '应用商店-小米', 'paid', 1, NULL),
('PAID_013', '应用商店-OPPO', 'paid', 1, NULL),
('PAID_014', '应用商店-VIVO', 'paid', 1, NULL),
('PAID_015', '应用商店-AppStore', 'paid', 1, NULL),
('PAID_016', '联盟CPS-短剧站A', 'paid', 1, '分成渠道'),
('PAID_017', '联盟CPS-短剧站B', 'paid', 1, NULL),
('PAID_018', '联盟CPS-小说站', 'paid', 1, NULL),
('PART_001', '合作伙伴-AIGC导航站', 'partner', 1, '友情推荐位'),
('PART_002', '合作伙伴-极客公园', 'partner', 1, NULL),
('PART_003', '合作伙伴-36氪', 'partner', 1, NULL),
('PART_004', '合作伙伴-少数派', 'partner', 1, NULL),
('PART_005', '合作伙伴-开源中国', 'partner', 1, NULL),
('PART_006', '合作伙伴-InfoQ', 'partner', 1, NULL),
('PART_007', '合作伙伴-掘金', 'partner', 1, NULL),
('INV_001', '用户邀请-一级', 'invite', 1, '好友邀请链接'),
('INV_002', '用户邀请-二级', 'invite', 1, NULL),
('INV_003', '企业邀请码', 'invite', 1, NULL),
('INV_004', 'KOL专属邀请', 'invite', 1, NULL),
('INV_005', '教育合作邀请', 'invite', 1, NULL),
('INV_006', '政府项目邀请', 'invite', 1, NULL);
