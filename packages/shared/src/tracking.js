/**
 * Sprint 18 - S18-T01 前端埋点 SDK（createTracking 工厂）
 *
 * 能力：
 *   - 匿名身份：localStorage 持久化 anonymous_id，未登录用户也可追踪
 *   - 自动页面浏览：路由切换自动上报 page_view（需传入 router）
 *   - 手动事件：track(event, attrs, opts) 上报业务/交互事件
 *   - 批量缓冲：累积 maxBuffer 条或每 flushInterval 毫秒自动冲刷一次
 *   - 卸载冲刷：beforeunload / pagehide 时以 fetch keepalive 补发
 *   - 静默失败：上报失败不影响主流程（不抛错、不重试风暴）
 *
 * 用法：
 *   import { createTracking } from '@localmini/shared'
 *   const tracking = createTracking({ tokenKey: 'user_token', router })
 *   tracking.init()
 *   tracking.track('create_drama', { title: 'xxx' }, { category: 'business' })
 */

function uid(prefix) {
  return (
    prefix +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  )
}

export function createTracking({
  tokenKey = 'user_token',
  router = null,
  apiBase = '/api/v1/tracking/collect',
  flushInterval = 5000,
  maxBuffer = 20,
  aidKey = 'tracking_anonymous_id',
} = {}) {
  let buffer = []
  let timer = null
  let enabled = true

  function anonymousId() {
    let id = null
    try { id = localStorage.getItem(aidKey) } catch (_) { /* SSR / 隐私模式 */ }
    if (!id) {
      id = uid('an_')
      try { localStorage.setItem(aidKey, id) } catch (_) { /* 忽略 */ }
    }
    return id
  }

  function authHeader() {
    let token = null
    try { token = localStorage.getItem(tokenKey) } catch (_) { /* 忽略 */ }
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  function currentPage() {
    return typeof location !== 'undefined' ? location.pathname : ''
  }

  function enqueue(ev) {
    buffer.push(ev)
    if (buffer.length >= maxBuffer) {
      flush()
    } else if (!timer) {
      timer = setTimeout(flush, flushInterval)
    }
  }

  function flush() {
    if (!enabled || !buffer.length) return
    const events = buffer
    buffer = []
    timer = null
    try {
      fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ events, anonymous_id: anonymousId() }),
        keepalive: true,
      }).catch(() => { /* 静默 */ })
    } catch (_) { /* 静默：不影响主流程 */ }
  }

  /**
   * 上报一个事件。
   * @param {string} event 事件名（≤64 字符）
   * @param {object} attrs 附加属性（对象）
   * @param {object} opts { category, page }
   */
  function track(event, attrs = {}, opts = {}) {
    if (!enabled || !event) return
    const payload = attrs && typeof attrs === 'object' ? attrs : { value: attrs }
    enqueue({
      event: String(event).slice(0, 64),
      category: opts.category || 'custom',
      page: opts.page || currentPage(),
      attrs: payload,
      ts: Date.now(),
    })
  }

  /** 页面浏览事件（通常由 init 自动触发）。 */
  function pageView(meta = {}) {
    track('page_view', meta, { category: 'navigation', page: currentPage() })
  }

  /** 初始化：上报首屏 + 监听路由切换 + 卸载冲刷。 */
  function init() {
    if (typeof window === 'undefined') return
    pageView({ title: document.title })
    if (router && typeof router.afterEach === 'function') {
      router.afterEach((to) => {
        pageView({ title: to.meta?.title || to.name || '' })
      })
    }
    const unload = () => flush()
    window.addEventListener('beforeunload', unload)
    window.addEventListener('pagehide', unload)
  }

  /** 开关（可在设置中关闭，关闭时清空未上报缓冲）。 */
  function setEnabled(v) {
    enabled = !!v
    if (!enabled) buffer = []
  }
  function getEnabled() {
    return enabled
  }

  return { track, pageView, init, flush, setEnabled, getEnabled, anonymousId }
}

export default createTracking
