<template>
  <aside
    v-if="userStore.isLoggedIn && !userStore.isAdmin"
    class="floating-nav"
    aria-label="主导航"
    @mouseleave="toolboxOpen = false"
  >
    <button class="brand-button" title="返回项目首页" @click="go('/dashboard')">
      <span class="brand-mark">剧</span>
    </button>

    <nav class="nav-rail">
      <button
        v-for="item in primaryItems"
        :key="item.key"
        class="rail-item"
        :class="{ active: isActive(item) }"
        :title="item.label"
        @click="handleItem(item)"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>

      <div class="toolbox-wrap">
        <button
          class="rail-item"
          :class="{ active: toolboxOpen }"
          title="工具箱"
          @mouseenter="toolboxOpen = true"
          @click="toolboxOpen = !toolboxOpen"
        >
          <el-icon><Cpu /></el-icon>
          <span>工具箱</span>
        </button>
        <Transition name="toolbox-popover">
          <div v-if="toolboxOpen" class="toolbox-menu" @mouseenter="toolboxOpen = true">
            <button v-for="tool in tools" :key="tool.label" class="tool-item" @click="handleTool(tool)">
              <el-icon><component :is="tool.icon" /></el-icon>
              <span>{{ tool.label }}</span>
            </button>
          </div>
        </Transition>
      </div>

      <button
        v-for="item in secondaryItems"
        :key="item.key"
        class="rail-item"
        :class="{ active: isActive(item) }"
        :title="item.label"
        @click="handleItem(item)"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Box, Cpu, Document, Film, Grid, HomeFilled, Picture, Promotion,
  School, Scissor, Tickets, UserFilled, VideoCamera, MagicStick, Microphone,
  View, Remove, Operation
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const toolboxOpen = ref(false)
const activeKey = ref('home')

const primaryItems = [
  { key: 'home', label: '首页', icon: HomeFilled, path: '/dashboard' },
  { key: 'popular', label: '短剧热门', icon: Promotion, path: '/dashboard' },
  { key: 'team', label: '团队', icon: UserFilled },
  { key: 'canvas', label: '画布', icon: Grid },
  { key: 'projects', label: '项目', icon: Tickets, path: '/dashboard' },
  { key: 'plaza', label: '广场', icon: School, path: '/media-library' }
]

const secondaryItems = [
  { key: 'editor', label: '剪辑台', icon: Film },
  { key: 'assets', label: '资产库', icon: Box, path: '/media-library' }
]

const tools = [
  { label: '图片生成', icon: Picture, mode: 'image' },
  { label: '视频生成', icon: VideoCamera, mode: 'video' },
  { label: '音频生成', icon: Microphone },
  { label: '文字对话', icon: Document },
  { label: '提示词优化', icon: MagicStick },
  { label: '剧情拆分', icon: Scissor },
  { label: '反推视频', icon: View },
  { label: '视频去字幕', icon: Remove },
  { label: '视频超分', icon: Operation }
]

const currentPath = computed(() => route.path)

function isActive(item) {
  return activeKey.value === item.key
}

function go(path) {
  toolboxOpen.value = false
  if (currentPath.value !== path) router.push(path)
}

function handleItem(item) {
  activeKey.value = item.key
  if (item.path) {
    go(item.path)
    return
  }
  ElMessage.info(`${item.label}功能即将上线`)
}

watch(currentPath, (path) => {
  if (path === '/media-library') activeKey.value = 'assets'
  if (path === '/free-create') activeKey.value = 'toolbox'
})

function handleTool(tool) {
  toolboxOpen.value = false
  if (tool.mode) {
    router.push({ path: '/free-create', query: { mode: tool.mode } })
    return
  }
  ElMessage.info(`${tool.label}功能即将上线`)
}
</script>

<style scoped>
.floating-nav {
  position: fixed;
  z-index: 1200;
  top: 30px;
  left: 12px;
  width: 126px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  pointer-events: none;
}
.brand-button, .nav-rail, .toolbox-menu { pointer-events: auto; }
.brand-button {
  width: 76px;
  height: 76px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 50%;
  padding: 4px;
  cursor: pointer;
  background: #111217;
  box-shadow: 0 8px 28px rgba(0,0,0,.38);
}
.brand-mark {
  display: grid;
  width: 100%; height: 100%; place-items: center;
  border-radius: 50%;
  color: #ffdc72;
  font-size: 27px;
  font-weight: 800;
  letter-spacing: 2px;
  background: radial-gradient(circle at 32% 28%, #f7a96a 0 16%, #ce5a5e 44%, #483047 76%);
}
.nav-rail {
  width: 126px;
  padding: 22px 14px 26px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 58px;
  background: linear-gradient(180deg, rgba(20,21,27,.96), rgba(14,15,20,.98));
  box-shadow: 0 12px 36px rgba(0,0,0,.32), inset 0 1px rgba(255,255,255,.025);
}
.rail-item {
  width: 100%; min-height: 94px;
  border: 1px solid transparent;
  border-radius: 38px;
  padding: 12px 4px;
  display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;
  color: #d0d1d7;
  font-size: 17px; line-height: 1.12; font-weight: 600;
  background: transparent; cursor: pointer;
  transition: .2s ease;
}
.rail-item .el-icon { font-size: 34px; }
.rail-item:hover { color: #fff; background: rgba(255,255,255,.055); }
.rail-item.active { color: #f8c928; border-color: rgba(241,194,22,.5); background: linear-gradient(150deg, rgba(90,74,8,.38), rgba(35,29,7,.18)); box-shadow: 0 9px 24px rgba(218,170,11,.12); }
.toolbox-wrap { position: relative; }
.toolbox-menu {
  position: absolute;
  top: 50%; left: calc(100% + 14px);
  width: 254px;
  transform: translateY(-50%);
  padding: 12px;
  border: 1px solid rgba(255,255,255,.15);
  border-radius: 16px;
  background: rgba(27,28,35,.98);
  box-shadow: 0 16px 46px rgba(0,0,0,.4);
}
.tool-item {
  width: 100%; border: 0; border-radius: 10px; padding: 10px 12px;
  display: flex; align-items: center; gap: 18px;
  color: #f2f3f7; background: transparent; cursor: pointer;
  font-size: 22px; font-weight: 700; text-align: left;
}
.tool-item .el-icon { flex: 0 0 auto; color: #aeb3c2; font-size: 29px; }
.tool-item:hover { background: rgba(255,255,255,.075); }
.tool-item:hover .el-icon { color: #f8c928; }
.toolbox-popover-enter-active, .toolbox-popover-leave-active { transition: opacity .15s ease, transform .15s ease; }
.toolbox-popover-enter-from, .toolbox-popover-leave-to { opacity: 0; transform: translate(-8px, -50%); }
@media (max-width: 960px) { .floating-nav { transform: scale(.8); transform-origin: top left; } }
@media (max-width: 680px) { .floating-nav { display: none; } }
</style>
