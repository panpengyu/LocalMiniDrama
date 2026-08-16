import { createApp, h } from 'vue'
import '@localmini/shared/styles/theme.css'
import '@localmini/shared/composables/useTheme'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { ElConfigProvider } from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'

const app = createApp({
  name: 'RootProvider',
  render() {
    return h(
      ElConfigProvider,
      {
        message: {
          duration: 5000,
          showClose: true,
          offset: 28,
        },
      },
      () => h(App)
    )
  },
})
const pinia = createPinia()

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// S18-T01：事件埋点 SDK（匿名身份持久化 + 自动页面浏览 + 批量冲刷）
// 组件内可经 window.__tracking.track('event', attrs) 上报业务事件
import { createTracking } from '@localmini/shared'
const tracking = createTracking({ tokenKey: 'user_token', router })
tracking.init()
window.__tracking = tracking

import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
userStore.loadUser()

// S16-T05：前端错误上报（真实数据写入 MySQL frontend_error_logs）
// 采集 window error / unhandledrejection / Vue 渲染错误，节流上报 /api/v1/monitor/frontend-error
import { onErrorCaptured } from 'vue'
const FE_REPORT_THROTTLE = 3000 // 同页最多每 3s 上报一次，避免风暴
let feLastReport = 0
function reportFrontendError(payload) {
  const now = Date.now()
  if (now - feLastReport < FE_REPORT_THROTTLE) return
  feLastReport = now
  const token = localStorage.getItem('user_token')
  try {
    fetch('/api/v1/monitor/frontend-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...payload, pageUrl: location.href }),
      keepalive: true
    }).catch(() => {})
  } catch (_) { /* 静默 */ }
}
window.addEventListener('error', (e) => {
  reportFrontendError({
    level: 'error', category: 'window_error', message: e.message || String(e.error || ''),
    source: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack
  })
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  reportFrontendError({
    level: 'error', category: 'unhandledrejection',
    message: (reason && reason.message) || String(reason), stack: reason?.stack
  })
})
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue error]', err, info)
  reportFrontendError({
    level: 'error', category: 'vue_error',
    message: err?.message || String(err), stack: err?.stack, meta: info ? JSON.stringify(info).slice(0, 500) : undefined
  })
}
// 保持 onErrorCaptured 引用避免 tree-shaking 移除（组件内可选使用）
void onErrorCaptured

app.mount('#app')
