<template>
  <div class="admin-layout">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-header" @click="$router.push('/dashboard')">
        <el-icon class="logo-icon"><Monitor /></el-icon>
        <span v-if="!sidebarCollapsed" class="logo-text">LocalMiniDrama 管理后台</span>
      </div>
      <div class="sidebar-toggle">
        <el-button class="collapse-btn" circle size="small" @click="sidebarCollapsed = !sidebarCollapsed">
          <el-icon><Fold v-if="!sidebarCollapsed" /><Expand v-else /></el-icon>
        </el-button>
      </div>
      <nav class="sidebar-nav">
        <el-menu
          :default-active="activeMenu"
          :collapse="sidebarCollapsed"
          :unique-opened="true"
          router
          class="sidebar-menu"
          background-color="transparent"
          text-color="#cbd5e1"
          active-text-color="#ffffff"
        >
          <template v-for="group in menuGroups" :key="group.title">
            <!-- 单页模块直接渲染为菜单项 -->
            <el-menu-item v-if="group.children.length === 1" :index="group.children[0].path">
              <el-icon><component :is="group.icon" /></el-icon>
              <template #title>{{ group.title }}</template>
            </el-menu-item>
            <!-- 多页模块渲染为子菜单 -->
            <el-sub-menu v-else :index="group.title">
              <template #title>
                <el-icon><component :is="group.icon" /></el-icon>
                <span>{{ group.title }}</span>
              </template>
              <el-menu-item v-for="child in group.children" :key="child.path" :index="child.path">
                {{ child.title }}
              </el-menu-item>
            </el-sub-menu>
          </template>
        </el-menu>
      </nav>
    </aside>

    <main class="main-content" :class="{ collapsed: sidebarCollapsed }">
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
          <el-dropdown class="user-dropdown" @command="handleCommand">
            <span class="user-info">
              <el-icon><User /></el-icon>
              <span class="user-name">{{ userStore.user?.nickname || userStore.user?.username || '管理员' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">
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
  Grid, Cpu, FolderOpened, Operation, Wallet, Setting
} from '@element-plus/icons-vue'
import { useAdminUserStore } from '@/stores/adminUser'

const router = useRouter()
const route = useRoute()
const userStore = useAdminUserStore()
const sidebarCollapsed = ref(false)

// 7 大模块菜单，菜单项路径与路由完全对应
const menuGroups = [
  {
    title: '首页',
    icon: Grid,
    children: [
      { path: '/dashboard', title: '运营概览' }
    ]
  },
  {
    title: '模型与网关',
    icon: Cpu,
    children: [
      { path: '/model-gateway/model-config', title: '模型配置' },
      { path: '/model-gateway/channel-list', title: '渠道列表' },
      { path: '/model-gateway/request-logs', title: '请求记录' },
      { path: '/model-gateway/task-queue', title: '任务队列' }
    ]
  },
  {
    title: '用户与团队',
    icon: User,
    children: [
      { path: '/user-team/users', title: '用户管理' },
      { path: '/user-team/teams', title: '团队管理' },
      { path: '/user-team/channels', title: '渠道管理' }
    ]
  },
  {
    title: '内容与资产',
    icon: FolderOpened,
    children: [
      { path: '/content-asset/works', title: '作品管理' },
      { path: '/content-asset/skills', title: '技能管理' },
      { path: '/content-asset/templates', title: '模板管理' },
      { path: '/content-asset/public-assets', title: '公共资产 / 工具库' },
      { path: '/content-asset/actor-library', title: '真人库' }
    ]
  },
  {
    title: '运营中心',
    icon: Operation,
    children: [
      { path: '/operation/site-brand', title: '站点品牌' },
      { path: '/operation/changelog', title: '版本日志' },
      { path: '/operation/sms-config', title: '短信配置' },
      { path: '/operation/tos-config', title: 'TOS 配置' },
      { path: '/operation/agreements', title: '协议管理' },
      { path: '/operation/troubleshoot', title: '用户问题排查' },
      { path: '/operation/log-search', title: '日志检索' },
      { path: '/operation/alert-channel', title: '告警通道' },
      { path: '/operation/alert-events', title: '告警历史' },
      { path: '/operation/data-anomalies', title: '数据异常检测' }
    ]
  },
  {
    title: '财务中心',
    icon: Wallet,
    children: [
      { path: '/finance/overview', title: '收支总览' },
      { path: '/finance/recharge-plans', title: '充值套餐' },
      { path: '/finance/coupons', title: '优惠券管理' },
      { path: '/finance/payment-config', title: '支付配置' },
      { path: '/finance/payment-orders', title: '支付订单' },
      { path: '/finance/global-billing', title: '全局计费设置' }
    ]
  },
  {
    title: '系统管理',
    icon: Setting,
    children: [
      { path: '/system/admins', title: '管理员管理' },
      { path: '/system/roles', title: '角色管理' },
      { path: '/system/menus', title: '菜单管理' },
      { path: '/system/dict', title: '字典管理' },
      { path: '/system/params', title: '参数设置' },
      { path: '/system/notices', title: '通知公告' },
      { path: '/system/operation-logs', title: '操作日志' },
      { path: '/system/login-logs', title: '登录日志' }
    ]
  }
]

const activeMenu = computed(() => route.path)

const breadcrumbs = computed(() => {
  const matched = route.matched.filter((m) => m.meta && m.meta.title)
  return matched.map((m, i) => ({
    name: m.meta.title,
    path: i === matched.length - 1 ? '' : m.path
  }))
})

function handleCommand(command) {
  if (command === 'logout') {
    userStore.logout()
    ElMessage.success('已退出登录')
    router.push('/login')
  }
}
</script>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
  background: var(--bg-page);
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
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
  overflow: hidden;
}

.logo-icon {
  font-size: 24px;
  color: #c084fc;
  flex-shrink: 0;
}

.logo-text {
  font-size: 15px;
  font-weight: 700;
  background: linear-gradient(135deg, #c084fc 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-toggle {
  padding: 8px 16px;
  display: flex;
  justify-content: flex-end;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.collapse-btn {
  --el-button-bg-color: rgba(255, 255, 255, 0.12);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.22);
  --el-button-border-color: transparent;
}

.sidebar-nav {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.sidebar-menu {
  border-right: none;
}

.sidebar-menu:not(.el-menu--collapse) {
  width: 100%;
}

.sidebar-menu :deep(.el-menu-item),
.sidebar-menu :deep(.el-sub-menu__title) {
  color: #cbd5e1;
  height: 44px;
  line-height: 44px;
  border-radius: 8px;
  margin-bottom: 4px;
}

.sidebar-menu :deep(.el-menu-item:hover),
.sidebar-menu :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: rgba(168, 85, 247, 0.32);
  color: #fff;
}

.sidebar-menu :deep(.el-sub-menu .el-menu-item) {
  background-color: transparent;
  min-width: unset;
}

.main-content {
  flex: 1;
  margin-left: 220px;
  transition: margin-left 0.3s;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.main-content.collapsed {
  margin-left: 64px;
}

.top-bar {
  background: var(--bg-card);
  padding: 12px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
  z-index: 90;
  border-bottom: 1px solid var(--border-color);
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
  padding: 8px 14px;
  border-radius: 20px;
  background: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
  outline: none;
}

.user-name {
  font-size: 14px;
}

.content-wrapper {
  padding: 20px;
  flex: 1;
}
</style>
