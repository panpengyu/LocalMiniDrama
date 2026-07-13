/**
 * 日志模块
 * 
 * 提供简单的日志记录功能，与 Go 端行为保持一致。
 * 支持控制台输出和文件追加（通过 LOG_FILE 环境变量配置）。
 * 
 * 日志级别：
 * - INFO: 普通信息日志
 * - WARN: 警告信息
 * - ERROR: 错误信息
 */

const fs = require('fs');
const path = require('path');

/**
 * 核心日志函数
 * 
 * @param {string} level - 日志级别（INFO/WARN/ERROR）
 * @param {string} msg - 日志消息
 * @param {...any} args - 附加参数，支持对象（JSON序列化）或其他类型
 */
function log(level, msg, ...args) {
  // 获取当前时间戳（ISO 格式）
  const time = new Date().toISOString();
  
  // 处理附加参数
  let rest = '';
  if (args.length && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    // 如果第一个参数是对象，直接 JSON 序列化
    rest = ' ' + JSON.stringify(args[0]);
  } else if (args.length) {
    // 否则，将所有参数转为字符串并拼接
    rest = ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  }
  
  // 组装日志行
  const line = `${time} [${level}] ${msg}${rest}\n`;
  
  // 输出到控制台
  try {
    console.log(line.trimEnd());
  } catch (_) {}
  
  // 如果配置了日志文件，追加到文件
  const logFile = process.env.LOG_FILE;
  if (logFile) {
    try {
      // 确保日志目录存在
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // 追加写入日志文件
      fs.appendFileSync(logFile, line);
    } catch (_) {}
  }
}

/**
 * 日志模块导出
 * 
 * 提供 info/infow、warn/warnw、error/errorw 方法，
 * 带 w 后缀的方法用于与 Go 端命名保持一致（w = with）。
 */
module.exports = {
  /**
   * 记录 INFO 级别日志
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  info(msg, ...args) {
    log('INFO', msg, ...args);
  },
  
  /**
   * 记录 INFO 级别日志（与 Go 端命名一致）
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  infow(msg, ...args) {
    log('INFO', msg, ...args);
  },
  
  /**
   * 记录 WARN 级别日志
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  warn(msg, ...args) {
    log('WARN', msg, ...args);
  },
  
  /**
   * 记录 WARN 级别日志（与 Go 端命名一致）
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  warnw(msg, ...args) {
    log('WARN', msg, ...args);
  },
  
  /**
   * 记录 ERROR 级别日志
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  error(msg, ...args) {
    log('ERROR', msg, ...args);
  },
  
  /**
   * 记录 ERROR 级别日志（与 Go 端命名一致）
   * @param {string} msg - 日志消息
   * @param {...any} args - 附加参数
   */
  errorw(msg, ...args) {
    log('ERROR', msg, ...args);
  },
};