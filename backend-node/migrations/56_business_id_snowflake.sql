-- ============================================================
-- 核心业务表主键统一升级为雪花 ID (BIGINT)
--
-- 目标（对应产品要求）：
--   1. 业务主表主键：全部雪花 ID (BIGINT)
--      user(users) / team(teams) / work(dramas) / canvas / asset(assets)
--      order(recharges) / point_log(point_logs) / task(async_tasks) / role(roles)
--   2. 静态字典表（channels 等）：保持自增 int 即可
--   3. 关联字段（user_id / drama_id / enterprise_id / team_id / created_by）
--      类型与对应表主键保持一致，统一 BIGINT
--
-- 说明：
--   - 本文件仅包含幂等的 ALTER TABLE ... MODIFY COLUMN，重复执行无副作用；
--   - MySQL 的 DROP/ADD FOREIGN KEY 与 async_tasks 旧 UUID 数据清理为一次性操作，
--     已通过数据库手动脚本执行，此处不重复；
--   - SQLite 不支持 MODIFY，migrate.js 会自动跳过（动态类型无需改列）。
-- ============================================================

-- 1) 关联字段升级 BIGINT（引用核心表主键）
ALTER TABLE user_settings MODIFY COLUMN user_id BIGINT NOT NULL;
ALTER TABLE ai_service_configs MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE prompt_overrides MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE ai_model_map MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE teams MODIFY COLUMN enterprise_id BIGINT NOT NULL;
ALTER TABLE roles MODIFY COLUMN enterprise_id BIGINT NOT NULL;
ALTER TABLE users MODIFY COLUMN enterprise_id BIGINT NULL;
ALTER TABLE users MODIFY COLUMN team_id BIGINT NULL;
ALTER TABLE users MODIFY COLUMN created_by BIGINT NULL;
ALTER TABLE dramas MODIFY COLUMN created_by BIGINT NULL;
ALTER TABLE dramas MODIFY COLUMN enterprise_id BIGINT NULL;
ALTER TABLE dramas MODIFY COLUMN team_id BIGINT NULL;
ALTER TABLE episodes MODIFY COLUMN drama_id BIGINT NOT NULL;
ALTER TABLE characters MODIFY COLUMN drama_id BIGINT NOT NULL;
ALTER TABLE scenes MODIFY COLUMN drama_id BIGINT NOT NULL;
ALTER TABLE props MODIFY COLUMN drama_id BIGINT NOT NULL;
ALTER TABLE image_generations MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE video_generations MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE video_merges MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE character_libraries MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE scene_libraries MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE prop_libraries MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE character_embeddings MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE consistency_check_logs MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE assets MODIFY COLUMN drama_id BIGINT NULL;
ALTER TABLE point_logs MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE recharges MODIFY COLUMN user_id BIGINT NULL;

-- 2) 核心表主键升级 BIGINT（原自增数字可平滑转为雪花 ID）
ALTER TABLE users MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE enterprises MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE teams MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE roles MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE dramas MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE assets MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE point_logs MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE recharges MODIFY COLUMN id BIGINT NOT NULL;
ALTER TABLE async_tasks MODIFY COLUMN id BIGINT NOT NULL;
