'use strict';

/**
 * 雪花 ID 生成器（53 位缩短版）
 *
 * 布局（共 53 bit，恰好在 JS Number.MAX_SAFE_INTEGER = 2^53 - 1 范围内，无精度损失）：
 *   - 时间戳 41 bit：相对 EPOCH（2026-01-01T00:00:00Z）的毫秒数，可用约 69 年（到 2095 年）
 *   - 机器位 6 bit：进程 PID % 64，区分多进程（最大 64 个并发进程）
 *   - 序列号 6 bit：同一毫秒内自增，单机 64/ms；耗尽时自旋等待下一毫秒
 *
 * 为什么用 53 位而不是标准 63 位：
 *   - 标准雪花（41bit 时间戳 + 10bit 机器 + 12bit 序列）产生的 ID 约 7.4e18，
 *     超出 JS Number 安全整数（9e15），会导致 sync-mysql 驱动返回精度丢失、
 *     前端 Number(id) 归一化失效等一系列连锁问题。
 *   - 本项目为单机/少量进程部署，53 位缩短雪花同样满足"时间有序 + 全局唯一 + 分布式可扩展"，
 *     且所有端（后端 / 前端 / 数据库）都能以 number 精确处理，无需字符串迁移。
 */

const EPOCH = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
const MACHINE_BITS = 6;
const SEQUENCE_BITS = 6;
const SHIFT = MACHINE_BITS + SEQUENCE_BITS; // 12
const MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1; // 63
const MACHINE_ID = process.pid % (1 << MACHINE_BITS); // pid % 64
const MAX_TIMESTAMP = 2 ** 41 - 1; // 41 bit 时间戳上限（约 69 年）；注意不能用 1<<41（32 位截断）

let lastTimestamp = -1;
let sequence = 0;

/**
 * 生成一个雪花 ID（number，< 2^53）
 * @returns {number}
 */
function snowflakeId() {
  let ts = Date.now() - EPOCH;
  if (ts < 0) ts = 0;
  if (ts > MAX_TIMESTAMP) {
    throw new Error('雪花 ID 时间戳溢出：EPOCH 起超过约 69 年窗口');
  }
  if (ts === lastTimestamp) {
    sequence = (sequence + 1) & MAX_SEQUENCE;
    if (sequence === 0) {
      // 同一毫秒序列耗尽，自旋等待下一毫秒
      ts = Date.now() - EPOCH;
      while (ts <= lastTimestamp) {
        ts = Date.now() - EPOCH;
      }
    }
  } else {
    sequence = 0;
  }
  lastTimestamp = ts;
  // 注意：不能用位运算（<< 会截断为 32 位），必须用乘法
  return ts * (1 << SHIFT) + (MACHINE_ID << SEQUENCE_BITS) + sequence;
}

module.exports = { snowflakeId, EPOCH };
