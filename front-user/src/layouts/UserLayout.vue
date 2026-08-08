<template>
  <div class="user-layout">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="logo" @click="$router.push('/dashboard')">
          <span class="logo-icon">🎬</span>
          <span v-if="!sidebarCollapsed" class="logo-text">LocalMiniDrama</span>
        </div>
        <el-button class="collapse-btn" circle @click="sidebarCollapsed = !sidebarCollapsed">
          <el-icon><Fold v-if="!sidebarCollapsed" /><Expand v-else /></el-icon>
        </el-button>
      </div>
      <nav class="sidebar-nav">
        <el-menu :default-active="currentRoute" mode="vertical" class="sidebar-menu" @select="handleMenuSelect">
          <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.name }}</template>
          </el-menu-item>
          
          <el-sub-menu index="tools" v-for="group in toolGroups" :key="group.name">
            <template #title>
              <el-icon><component :is="group.icon" /></el-icon>
              <span>{{ group.name }}</span>
            </template>
            <el-menu-item v-for="item in group.children" :key="item.path" :index="item.path">
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>{{ item.name }}</template>
            </el-menu-item>
          </el-sub-menu>
        </el-menu>
      </nav>
      <div class="sidebar-footer">
        <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
          <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
          {{ isDark ? '浅色' : '暗色' }}
        </el-button>
        <el-dropdown class="user-dropdown">
          <span class="user-info">
            <el-icon><User /></el-icon>
            <span>{{ userStore.user?.nickname || userStore.user?.username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="$router.push('/ai-config')">
                <el-icon><Setting /></el-icon>AI配置
              </el-dropdown-item>
              <el-dropdown-item divided @click="handleLogout">
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </aside>
    <main class="main-content">
      <div class="content-wrapper">
        <router-view />
      </div>
    </main>
    
    <el-dialog v-if="showWechat" v-model="showWechat" title="扫码联系作者" width="320px" :close-on-click-modal="true">
      <div class="wechat-qr">
        <img :src="wechatQrCode" alt="微信二维码" class="qr-img" />
        <p class="qr-text">微信：xuanyustudio</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Fold, Expand, User, ArrowDown, SwitchButton, Setting, ChatDotSquare, Sunny, Moon, Grid, VideoPlay, Microphone, ChatSquare, MagicStick, Document, RefreshLeft, Memo, TrendCharts, PictureFilled, Box, Headset } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { useTheme } from '@localmini/shared/composables/useTheme';
const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const { isDark, toggleTheme } = useTheme();
const sidebarCollapsed = ref(false);
const showWechat = ref(false);
const vendorLockEnabled = ref(false);
const wechatQrCode = 'https://lf-cdn.trae.com.cn/obj/trae-ai-image/page_image/93f5b439665b51def2070e63f3651177.jpeg';
const menuItems = [
 { path: '/dashboard', name: '项目列表', icon: Grid },
 { path: '/drama/:id', name: '剧集管理', icon: VideoPlay },
 { path: '/film/:id', name: '视频生成', icon: VideoPlay },
 { path: '/film/:id/canvas', name: '画布模式', icon: Box },
 { path: '/ai-config', name: 'AI配置', icon: Setting },
 { path: '/media-library', name: '素材库', icon: PictureFilled },
];
const toolGroups = [
 {
 name: '工具箱',
 icon: MagicStick,
 children: [
 { path: '/tools/image-generate', name: '图片生成', icon: PictureFilled },
 { path: '/tools/video-generate', name: '视频生成', icon: VideoPlay },
 { path: '/tools/audio-generate', name: '音频生成', icon: Microphone },
 { path: '/tools/audio-pair', name: '音频成对', icon: Headset },
 { path: '/tools/text-chat', name: '文字对话', icon: ChatSquare },
 { path: '/tools/prompt-optimize', name: '提示词优化', icon: MagicStick },
 { path: '/tools/plot-split', name: '剧情拆分', icon: Document },
 { path: '/tools/video-reverse', name: '反推视频', icon: RefreshLeft },
 { path: '/tools/video-remove-subtitle', name: '视频去字幕', icon: Memo },
 { path: '/tools/video-upscale', name: '视频超分', icon: TrendCharts },
 ]
 }
];
const currentRoute = computed(() => {
 const path = route.path;
 const toolPaths = toolGroups.flatMap(g => g.children.map(c => c.path));
 if (toolPaths.some(p => path.startsWith(p.split('/:')[0]))) {
 return 'tools';
 }
 return path;
});
const breadcrumbs = computed(() => {
 const matched = route.matched;
 return matched.map((m, i) => ({
 name: m.meta.title || m.name,
 path: i === matched.length - 1 ? '' : matched.slice(0, i + 1).map(s => s.path).join('/')
 }));
});
function handleMenuSelect(index) {
 router.push(index);
}
function handleLogout() {
 userStore.logout();
 ElMessage.success('已退出登录');
 router.push('/');
}
</script>

<style scoped>
.user-layout {
  display: flex;
  min-height: 100vh;
  background: #f5f5f5;
}

.sidebar {
  width: 220px;
  background: linear-gradient(180deg, #1e1b4b 0%, #312e81 100%);
  color: #fff;
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
  transition: width 0.3s;
  display: flex;
  flex-direction: column;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.logo-icon {
  font-size: 28px;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, #c084fc 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.collapse-btn {
  --el-button-bg-color: rgba(255, 255, 255, 0.1);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.2);
}

.sidebar-nav {
  padding: 12px;
  flex: 1;
  overflow-y: auto;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-footer .btn-theme {
  --el-button-bg-color: rgba(255, 255, 255, 0.1);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.2);
}

.sidebar-footer .user-info {
  background: rgba(168, 85, 247, 0.2);
  color: #c084fc;
  padding: 6px 10px;
  border-radius: 16px;
  font-size: 13px;
}

.sidebar-menu {
  border-right: none;
}

.sidebar-menu :deep(.el-menu-item) {
  color: #cbd5e1;
  height: 42px;
  line-height: 42px;
  margin-bottom: 2px;
  border-radius: 6px;
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: rgba(168, 85, 247, 0.3);
  color: #c084fc;
}

.sidebar-menu :deep(.el-sub-menu__title) {
  color: #cbd5e1;
  height: 42px;
  line-height: 42px;
  border-radius: 6px;
}

.sidebar-menu :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.sidebar-menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  background: rgba(168, 85, 247, 0.3);
  color: #c084fc;
}

.sidebar-menu :deep(.el-sub-menu__icon-arrow) {
  color: #cbd5e1;
}

.sidebar-menu :deep(.el-menu--popup) {
  background: #312e81 !important;
  border: none;
}

.main-content {
  flex: 1;
  margin-left: 220px;
  transition: margin-left 0.3s;
}

.sidebar.collapsed + .main-content {
  margin-left: 64px;
}

.top-bar {
  background: #fff;
  padding: 12px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
  z-index: 90;
}

.top-bar-left {
  flex: 1;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-dropdown {
  cursor: pointer;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 20px;
  background: rgba(99, 102, 241, 0.1);
  color: #4f46e5;
}

.content-wrapper {
  padding: 0;
  height: 100vh;
}

.wechat-qr {
  text-align: center;
  padding: 20px;
}

.qr-img {
  width: 200px;
  height: 200px;
  border-radius: 8px;
}

.qr-text {
  margin-top: 12px;
  font-size: 14px;
  color: #666;
}

.btn-wechat {
  --el-button-bg-color: #07c160;
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: #06ad56;
}

.btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.1);
  --el-button-text-color: #4f46e5;
}
</style>