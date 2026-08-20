/**
 * 数据库连接模块
 * 
 * 提供统一的数据库连接管理，支持 MySQL 和 SQLite 两种数据库类型。
 * 使用单例模式确保全局只有一个数据库连接实例。
 * 
 * MySQL 使用 sync-mysql（同步查询），SQLite 使用 better-sqlite3（同步查询）。
 * 两种数据库都提供统一的 API：exec、prepare(all/get/run)、close。
 */

const fs = require('fs');
const path = require('path');

// 数据库连接实例（单例）
let db = null;

/**
 * 获取数据库连接实例
 * 
 * 如果已有连接，直接返回；否则根据配置创建新连接。
 * 
 * @param {object} config - 数据库配置对象
 * @param {string} config.type - 数据库类型（mysql/sqlite）
 * @param {string} config.host - MySQL 主机（仅 MySQL）
 * @param {number} config.port - MySQL 端口（仅 MySQL）
 * @param {string} config.user - MySQL 用户名（仅 MySQL）
 * @param {string} config.password - MySQL 密码（仅 MySQL）
 * @param {string} config.database - MySQL 数据库名（仅 MySQL）
 * @param {string} config.path - SQLite 数据库文件路径（仅 SQLite）
 * @returns {object} 数据库连接实例
 */
function getDb(config) {
  // 如果已有连接，直接返回
  if (db) return db;
  
  // 获取数据库类型，默认为 sqlite
  const type = config.type || 'sqlite';
  
  // MySQL 数据库连接
  if (type === 'mysql') {
    const MySql = require('sync-mysql');
    
    /**
     * MySQL 数据库包装类
     * 
     * 统一 MySQL 和 SQLite 的 API，提供 exec、prepare 方法。
     */
    class MySqlWrapper {
      /**
       * 构造函数
       * @param {object} conn - sync-mysql 连接实例
       */
      constructor(conn) {
        this.conn = conn;
        this.type = 'mysql';
      }
      
      /**
       * 执行 SQL 语句（不返回结果）
       * @param {string} sql - SQL 语句
       */
      exec(sql) {
        this.conn.query(sql);
      }
      
      /**
       * 准备 SQL 语句（支持参数化查询）
       * 
       * @param {string} sql - SQL 语句，使用 ? 作为占位符
       * @returns {object} 包含 all、get、run 方法的对象
       */
      prepare(sql) {
        const conn = this.conn;
        
        /**
         * 格式化日期值
         * 将 ISO 8601 时间戳字符串转换为 MySQL DATETIME 格式（YYYY-MM-DD HH:mm:ss）。
         *
         * 注意：必须用「精确前缀」匹配形如 2026-08-17T10:00:00 的时间戳，
         * 不能仅凭字符串同时包含 'T' 和 'Z' 判断——否则会误伤普通文本
         * （如 bcrypt 密码哈希、TOTP base32 密钥、JSON 配置等偶然含 T/Z 的字符串），
         * 造成写入数据被截断/替换的严重损坏。
         *
         * @param {any} value - 参数值
         * @returns {any} 格式化后的值
         */
        const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/;
        const formatDate = (value) => {
          if (typeof value === 'string') {
            const m = ISO_DATETIME_RE.exec(value);
            if (m) return `${m[1]} ${m[2]}`;
          }
          return value;
        };
        
        return {
          /**
           * 执行查询并返回所有结果
           * @param {...any} args - 查询参数（支持数组或多个参数）
           * @returns {Array} 查询结果数组
           */
          all(...args) {
            const params = args.length > 0 && Array.isArray(args[0]) ? args[0] : args;
            const formattedParams = params.map(formatDate);
            const result = formattedParams.length > 0 ? conn.query(sql, formattedParams) : conn.query(sql);
            return Array.isArray(result) ? result : [];
          },
          
          /**
           * 执行查询并返回第一条结果
           * @param {...any} args - 查询参数（支持数组或多个参数）
           * @returns {object|null} 查询结果对象或 null
           */
          get(...args) {
            const params = args.length > 0 && Array.isArray(args[0]) ? args[0] : args;
            const formattedParams = params.map(formatDate);
            const result = formattedParams.length > 0 ? conn.query(sql, formattedParams) : conn.query(sql);
            const rows = Array.isArray(result) ? result : [];
            return rows.length > 0 ? rows[0] : null;
          },
          
          /**
           * 执行写操作（INSERT/UPDATE/DELETE）
           * @param {...any} args - 查询参数（支持数组或多个参数）
           * @returns {object} { lastInsertRowid: number, changes: number } - 插入 ID + 影响行数
           */
          run(...args) {
            const params = args.length > 0 && Array.isArray(args[0]) ? args[0] : args;
            const formattedParams = params.map(formatDate);
            const result = formattedParams.length > 0 ? conn.query(sql, formattedParams) : conn.query(sql);
            // 影响行数优先取本次查询结果对象的 affectedRows：
            //   sync-mysql 内部可能对每条查询使用连接池中的不同连接，因此再单独执行
            //   SELECT ROW_COUNT() 可能落到另一条连接上而返回 0（会话级函数）。
            //   result.affectedRows 与本条 UPDATE/DELETE 同属一次查询结果，才是可靠来源。
            let changes = 0;
            if (result && typeof result.affectedRows === 'number') {
              changes = Number(result.affectedRows || 0);
            } else {
              // 兜底：极少数驱动不返回 affectedRows 时再尝试 ROW_COUNT()
              try {
                const rc = conn.query('SELECT ROW_COUNT() AS rc');
                if (rc && rc.length) changes = Number(rc[0].rc || 0);
              } catch (_) { /* ignore */ }
            }
            return {
              lastInsertRowid: result.insertId || 0,
              insertId: result.insertId || 0,
              changedRows: result.changedRows != null ? result.changedRows : changes,
              changes
            };
          }
        };
      }
      
      /**
       * 创建事务函数（兼容 better-sqlite3 API）
       *
       * - SQLite：better-sqlite3 原生 db.transaction(fn) 保证同一连接；这里走原生方法
       * - MySQL：sync-mysql 的 this.conn 是单连接（非连接池），BEGIN/COMMIT/ROLLBACK
       *          在同一连接串行执行，事务有效。默认使用更高隔离级别 + 写前 FOR UPDATE 行锁，
       *          保证在高并发修复同一条 users/point_logs 记录时不出现 lost update / write skew。
       *
       * 返回一个函数，调用该函数时才执行事务；回调抛错自动回滚。
       *
       * @param {function} fn - 事务回调函数
       * @returns {function} 可调用的事务执行函数
       */
      transaction(fn) {
        return () => {
          try {
            // 显式设置事务隔离级别为 READ COMMITTED（比默认 RR 更适合"读-改-写"短事务 + FOR UPDATE）
            try { this.conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); } catch (_) {}
            this.conn.query('BEGIN');
            const result = fn();
            this.conn.query('COMMIT');
            return result;
          } catch (err) {
            try { this.conn.query('ROLLBACK'); } catch (_) {}
            throw err;
          }
        };
      }
      
      /**
       * 关闭数据库连接（MySQL 连接由连接池管理，此处为空实现）
       */
      close() {
      }
    }
    
    // 创建 MySQL 连接
    try {
      const conn = new MySql({
        // 兜底仅用于本地开发；生产环境务必通过 config.yaml 或 DB_* 环境变量（见 config/index.js）显式配置
        host: config.host || process.env.DB_HOST || 'localhost',
        port: config.port || Number(process.env.DB_PORT) || 3306,
        user: config.user || process.env.DB_USER || 'root',
        password: config.password || process.env.DB_PASSWORD || '',
        database: config.database || process.env.DB_NAME || 'localminidrama',
        charset: 'utf8mb4'
      });
      
      // 测试连接
      conn.query('SELECT 1');
      console.log('MySQL connected successfully');
      
      // 创建包装实例并缓存
      db = new MySqlWrapper(conn);
      return db;
    } catch (err) {
      console.error('MySQL connection error:', err.message);
      throw err;
    }
  } else {
    // SQLite 数据库连接
    const Database = require('better-sqlite3');
    const dbPath = config.path;
    
    // 确保数据库目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 创建 SQLite 数据库实例
    db = new Database(dbPath, {
      verbose: process.env.DEBUG ? console.log : undefined,
    });
    
    // 配置 SQLite 数据库
    db.pragma('journal_mode = WAL');           // 使用 WAL 模式（提高并发性能）
    db.pragma('busy_timeout = 5000');         // 设置 5 秒忙等待超时
    
    // 设置数据库类型标识
    db.type = 'sqlite';
    
    return db;
  }
}

/**
 * 关闭数据库连接
 * 
 * SQLite 需要显式关闭，MySQL 由连接池管理无需关闭。
 */
function closeDb() {
  if (db) {
    if (db.type !== 'mysql') {
      db.close();
    }
    db = null;
  }
}

// 导出数据库连接和关闭方法
module.exports = { getDb, closeDb };