'use strict';

/**
 * MySQL DATETIME 无时区语义：统一写入本地时间字符串（YYYY-MM-DD HH:MM:SS），
 * 避免 toISOString() 的 UTC 字符串（YYYY-MM-DDTHH:MM:SS.sssZ）被按本地时区误读
 * 导致 8 小时偏差（锁定/过期等时间判断失效）。
 */

function toMysql(d) {
  const v = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
}

function mysqlNow() {
  return toMysql(new Date());
}

module.exports = { toMysql, mysqlNow };
