-- ============================================================
-- 64_s21_copyright_ops.sql  Sprint 21 - 版权指纹 + 运维支撑
-- 幂等：CREATE TABLE IF NOT EXISTS；重复 ADD COLUMN 由迁移器安全跳过。
-- ============================================================

-- 素材感知指纹表（aHash + dHash，纯 Node 自研，比对基准仅限本项目自有素材）
CREATE TABLE IF NOT EXISTS asset_fingerprint (
  id BIGINT PRIMARY KEY,
  asset_id BIGINT NOT NULL,
  ahash VARCHAR(64) NULL,
  dhash VARCHAR(64) NULL,
  file_sha256 VARCHAR(64) NULL,
  width INT NULL,
  height INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uk_asset_fp (asset_id)
);

-- 素材版权检测状态：NULL=未检测 / pending=待检 / clear=无风险 / suspect=疑似重复 / unsupported=格式不支持感知哈希
ALTER TABLE assets ADD COLUMN copyright_status VARCHAR(16) NULL;
ALTER TABLE assets ADD COLUMN copyright_checked_at DATETIME NULL;
