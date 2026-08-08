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
        message: { duration: 5000, showClose: true, offset: 28 },
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

import { useAdminUserStore } from '@/stores/adminUser'
const userStore = useAdminUserStore()
userStore.loadUser()

app.mount('#app')
