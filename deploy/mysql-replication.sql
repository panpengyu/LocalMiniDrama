-- ============================================================
-- Sprint 16 - S16-T04 MySQL 主从复制初始化脚本
-- 说明：
--   1) 在【主库】执行本文件，配置 server-id / binlog 并创建复制账号
--   2) 在【从库】用 mysqldump --master-data 初始化数据后执行
--      CHANGE MASTER TO ...（见文件末尾注释）
--   3) 读写分离建议：业务读写走主库，报表/监控/推荐冷读走从库
-- ============================================================

-- ---------- 主库：启用 binlog 与 server-id ----------
-- [mysqld] 配置（/etc/mysql/my.cnf）：
--   server-id = 1
--   log_bin = /var/log/mysql/mysql-bin
--   binlog_format = ROW
--   expire_logs_days = 7
--   max_binlog_size = 512M

-- 创建复制专用账号（仅 REPLICATION SLAVE 权限）
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'CHANGE_ME_REPL_PASSWORD';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;

-- ---------- 从库：配置（/etc/mysql/my.cnf） ----------
--   server-id = 2
--   relay_log = /var/log/mysql/mysql-relay-bin
--   read_only = 1        -- 从库只读（避免数据漂移）

-- 在从库执行（master_log_file / master_log_pos 取主库 SHOW MASTER STATUS 输出）：
--   CHANGE MASTER TO
--     MASTER_HOST='10.0.0.11',
--     MASTER_USER='repl',
--     MASTER_PASSWORD='CHANGE_ME_REPL_PASSWORD',
--     MASTER_LOG_FILE='mysql-bin.000001',
--     MASTER_LOG_POS=154;
--   START SLAVE;
--   SHOW SLAVE STATUS\G   -- 检查 Slave_IO_Running/Slave_SQL_Running 均为 Yes

-- ---------- 生产建库（主库执行一次） ----------
-- CREATE DATABASE IF NOT EXISTS localminidrama
--   DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
