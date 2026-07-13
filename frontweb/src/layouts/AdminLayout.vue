<template>
  <div class="admin-layout">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="logo" @click="$router.push('/admin')">
          <el-icon class="logo-icon"><Monitor /></el-icon>
          <span v-if="!sidebarCollapsed" class="logo-text">管理后台</span>
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
        </el-menu>
      </nav>
    </aside>
    <main class="main-content">
      <header class="top-bar">
        <div class="top-bar-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="(crumb, idx) in breadcrumbs" :key="idx">
              <router-link v-if="crumb.path" :to="crumb.path">{{ crumb.name }}</router-link>
              <span v-else>{{ crumb.name }}</span>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="top-bar-right">
          <el-dropdown class="user-dropdown">
            <span class="user-info">
              <el-icon><User /></el-icon>
              <span>{{ userStore.user?.nickname || userStore.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      <div class="content-wrapper">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Monitor, Fold, Expand, User, ArrowDown, SwitchButton,
  Grid, FolderOpened, Box, PictureFilled, Setting, VideoPlay
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const sidebarCollapsed = ref(false)

const menuItems = [
  { path: '/admin', name: '仪表盘', icon: Grid },
  { path: '/admin/users', name: '用户管理', icon: User },
  { path: '/admin/projects', name: '项目管理', icon: FolderOpened },
  { path: '/admin/enterprises', name: '企业管理', icon: Box },
  { path: '/admin/teams', name: '团队管理', icon: VideoPlay },
  { path: '/admin/assets', name: '资产管理', icon: PictureFilled },
  { path: '/admin/ai-config', name: 'AI配置', icon: Setting }
]

const currentRoute = computed(() => route.path)

const breadcrumbs = computed(() => {
  const matched = route.matched
  return matched.map((m, i) => ({
    name: m.meta.title || m.name,
    path: i === matched.length - 1 ? '' : matched.slice(0, i + 1).map(s => s.path).join('/')
  }))
})

function handleMenuSelect(index) {
  router.push(index)
}

function handleLogout() {
  userStore.logout()
  ElMessage.success('已退出登录')
  router.push('/')
}
</script>

<style scoped>
.admin-layout {
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
  overflow-y: auto;
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
  font-size: 24px;
  color: #c084fc;
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
}

.sidebar-menu {
  border-right: none;
}

.sidebar-menu :deep(.el-menu-item) {
  color: #cbd5e1;
  height: 44px;
  line-height: 44px;
  margin-bottom: 4px;
  border-radius: 8px;
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: rgba(168, 85, 247, 0.3);
  color: #c084fc;
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
  gap: 16px;
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
  padding: 24px;
}
</style>