/**
 * ============================================================
 *  useWorkbenchLogger — Sprint 3 一站式工作台性能&异常日志工具
 * ============================================================
 *
 * 目标：
 *   1) 前端关键路径加统一格式的 console logger（含时间戳、模块、traceId）
 *   2) performance.now() 高精度耗时统计（measure / mark）
 *   3) 可选：通过 POST /api/logs/client 把 ERROR/WARN 同步到后端 log 文件
 *
 * 日志格式：
 *   [2026-08-09T12:34:56.789Z] [WB-{level}] [mod=WorkbenchCanvas] [trace=xxx] message | json={...}
 *
 * 使用：
 *   const { info, warn, error, startMeasure, endMeasure } = useWorkbenchLogger('WorkbenchCanvas')
 *   const m = startMeasure('rebuildGraph')
 *   await rebuild()
 *   const ms = endMeasure(m)  // -> 输出 INFO: "[perf] rebuildGraph 耗时 127ms" + 返回 ms
 */

import { getCurrentInstance } from 'vue'

const WB_LOG_PREFIX = 'WB'
const CLIENT_LOG_ENDPOINT = '/api/logs/client'
const SHOULD_UPLOAD = false   // 默认只打印console，打开后ERROR/WARN会异步POST到后端
const LEVEL_PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const MIN_LOG_LEVEL = (() => {
  try {
    const m = new URLSearchParams(location.search).get('wbLog')
    if (m) return LEVEL_PRIORITY[m.toUpperCase()] ?? 1
  } catch (_) {}
  return 1  // 默认 INFO 及以上
})()

function isoNow() { return new Date().toISOString() }
function shortId(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len) + Date.now().toString(36).slice(-2)
}

/**
 * 上传客户端日志到后端（低频，只上报 WARN/ERROR）
 */
let _uploadBusy = false
let _uploadQueue = []   // 兜底批量
async function uploadLogs(batch) {
  if (!SHOULD_UPLOAD || !batch?.length) return
  try {
    await fetch(CLIENT_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'workbench', items: batch }),
    }).catch(() => {})
  } catch (_) { /* 静默失败 */ }
}
async function enqueueUpload(item) {
  if (!SHOULD_UPLOAD) return
  if (LEVEL_PRIORITY[item.level] < LEVEL_PRIORITY.WARN) return
  _uploadQueue.push(item)
  if (_uploadBusy) return
  _uploadBusy = true
  while (_uploadQueue.length) {
    const batch = _uploadQueue.splice(0, 10)
    // eslint-disable-next-line no-await-in-loop
    await uploadLogs(batch)
  }
  _uploadBusy = false
}

/**
 * @param {string} mod - 模块名（DramaWorkbench / WorkbenchCanvas / AI / Timeline / NavTree）
 */
export function useWorkbenchLogger(mod = 'Workbench') {
  // 若在组件实例内，自动加 traceId
  let traceId = shortId()
  try {
    const inst = getCurrentInstance()
    if (inst) {
      traceId = (inst.type?.__name || 'Component') + ':' + shortId()
    }
  } catch (_) { /* 非组件上下文 */ }

  function _write(level, msg, extra = {}) {
    if (LEVEL_PRIORITY[level] < MIN_LOG_LEVEL) return
    const now = isoNow()
    const extraJson = Object.keys(extra).length ? ' | ' + JSON.stringify(extra) : ''
    const line = `[${now}] [${WB_LOG_PREFIX}-${level}] [mod=${mod}] [trace=${traceId}] ${msg}${extraJson}`

    // 1. console 输出（不同级别用不同方法，便于 DevTools 过滤）
    if (level === 'ERROR') console.error(line)
    else if (level === 'WARN') console.warn(line)
    else if (level === 'INFO') console.info(line)
    else console.debug(line)

    // 2. 可选上报后端（WARN/ERROR）
    enqueueUpload({ ts: now, level, mod, traceId, msg, extra }).catch(() => {})
  }

  function debug(msg, extra) { _write('DEBUG', msg, extra) }
  function info(msg, extra)  { _write('INFO',  msg, extra) }
  function warn(msg, extra)  { _write('WARN',  msg, extra) }
  function error(msg, err, extra = {}) {
    const combined = {
      message: err?.message || String(err || ''),
      stack: (err?.stack || '').slice(0, 500),
      ...extra,
    }
    _write('ERROR', msg, combined)
  }

  /**
   * 性能耗时测量：startMeasure 开始，endMeasure 结束并输出日志
   * @returns {() => number} end 闭包
   */
  function startMeasure(name) {
    const t0 = performance.now()
    const tag = shortId(4)
    debug(`[perf:start] ${name}`, { tag })
    return function endMeasure(success = true, detail = {}) {
      const ms = Math.round((performance.now() - t0) * 1000) / 1000
      const payload = { tag, ms, success, ...detail }
      if (success) info(`[perf] ${name} 耗时 ${ms}ms`, payload)
      else warn(`[perf:fail] ${name} 耗时 ${ms}ms`, payload)
      return ms
    }
  }

  /**
   * 包装异步函数，自动捕获异常 + 打印耗时日志
   */
  async function withPerfLog(name, fn, detail = {}) {
    const end = startMeasure(name)
    try {
      const result = await fn()
      end(true, detail)
      return result
    } catch (e) {
      end(false, { ...detail, errMsg: e?.message })
      error(`${name} 抛出异常`, e, detail)
      throw e   // 继续向上抛，保持原语义
    }
  }

  return {
    debug, info, warn, error,
    startMeasure, endMeasure: (fn) => fn(),  // 兼容性 API
    withPerfLog,
    traceId,
    setTraceId: (id) => { traceId = id },
  }
}

export default useWorkbenchLogger
