import { createRouter, createWebHistory } from 'vue-router'
import { useAdminUserStore } from '@/stores/adminUser'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    meta: { requiresAuth: true, requiresAdmin: true },
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('@/views/Dashboard.vue'), meta: { title: '首页 · 运营概览' } },

      { path: 'model-gateway/model-config', name: 'ModelConfig', component: () => import('@/views/model-gateway/ModelConfig.vue'), meta: { title: '模型配置' } },
      { path: 'model-gateway/channel-list', name: 'ChannelList', component: () => import('@/views/model-gateway/ChannelList.vue'), meta: { title: '渠道列表' } },
      { path: 'model-gateway/request-logs', name: 'RequestLogs', component: () => import('@/views/model-gateway/RequestLogs.vue'), meta: { title: '请求记录' } },
      { path: 'model-gateway/task-queue', name: 'TaskQueue', component: () => import('@/views/model-gateway/TaskQueue.vue'), meta: { title: '任务队列' } },

      { path: 'user-team/users', name: 'Users', component: () => import('@/views/user-team/Users.vue'), meta: { title: '用户管理' } },
      { path: 'user-team/teams', name: 'Teams', component: () => import('@/views/user-team/Teams.vue'), meta: { title: '团队管理' } },
      { path: 'user-team/channels', name: 'UserTeamChannels', component: () => import('@/views/user-team/Channels.vue'), meta: { title: '渠道管理' } },
      { path: 'user-team/lifecycle', name: 'UserLifecycle', component: () => import('@/views/user-team/UserLifecycle.vue'), meta: { title: '用户生命周期' } },

      { path: 'content-asset/works', name: 'Works', component: () => import('@/views/content-asset/Works.vue'), meta: { title: '作品管理' } },
      { path: 'content-asset/skills', name: 'Skills', component: () => import('@/views/content-asset/Skills.vue'), meta: { title: '技能管理' } },
      { path: 'content-asset/templates', name: 'AdminTemplates', component: () => import('@/views/content/Templates.vue'), meta: { title: '模板管理' } },
      { path: 'content-asset/public-assets', name: 'PublicAssets', component: () => import('@/views/content-asset/PublicAssets.vue'), meta: { title: '公共资产 / 工具库' } },
      { path: 'content-asset/actor-library', name: 'ActorLibrary', component: () => import('@/views/content-asset/ActorLibrary.vue'), meta: { title: '真人库' } },
      { path: 'content-asset/storage-objects', name: 'StorageObjects', component: () => import('@/views/content-asset/StorageObjects.vue'), meta: { title: '存储对象管理' } },
      { path: 'content-asset/material-tags', name: 'MaterialTags', component: () => import('@/views/content-asset/MaterialTags.vue'), meta: { title: '素材标签库' } },

      { path: 'marketplace/review', name: 'MarketplaceReview', component: () => import('@/views/marketplace/ReviewWorkbench.vue'), meta: { title: '模板市场 · 审核工作台' } },

      { path: 'operation/site-brand', name: 'SiteBrand', component: () => import('@/views/operation/SiteBrand.vue'), meta: { title: '站点品牌' } },
      { path: 'operation/changelog', name: 'Changelog', component: () => import('@/views/operation/Changelog.vue'), meta: { title: '版本日志' } },
      { path: 'operation/sms-config', name: 'SmsConfig', component: () => import('@/views/operation/SmsConfig.vue'), meta: { title: '短信配置' } },
      { path: 'operation/tos-config', name: 'TosConfig', component: () => import('@/views/operation/TosConfig.vue'), meta: { title: 'TOS 配置' } },
      { path: 'operation/agreements', name: 'Agreements', component: () => import('@/views/operation/Agreements.vue'), meta: { title: '协议管理' } },
      { path: 'operation/troubleshoot', name: 'Troubleshoot', component: () => import('@/views/operation/Troubleshoot.vue'), meta: { title: '用户问题排查' } },
      { path: 'operation/log-search', name: 'LogSearch', component: () => import('@/views/operation/LogSearch.vue'), meta: { title: '日志检索' } },
      { path: 'operation/alert-channel', name: 'AlertChannel', component: () => import('@/views/operation/AlertChannel.vue'), meta: { title: '告警通道' } },
      { path: 'operation/alert-events', name: 'AlertEvents', component: () => import('@/views/operation/AlertEvents.vue'), meta: { title: '告警历史' } },
      { path: 'operation/data-anomalies', name: 'DataAnomalies', component: () => import('@/views/operation/DataAnomalies.vue'), meta: { title: '数据异常检测' } },

      { path: 'finance/overview', name: 'FinanceOverview', component: () => import('@/views/finance/Overview.vue'), meta: { title: '收支总览' } },
      { path: 'finance/recharge-plans', name: 'RechargePlans', component: () => import('@/views/finance/RechargePlans.vue'), meta: { title: '充值套餐' } },
      { path: 'finance/coupons', name: 'Coupons', component: () => import('@/views/finance/Coupons.vue'), meta: { title: '优惠券管理' } },
      { path: 'finance/payment-config', name: 'PaymentConfig', component: () => import('@/views/finance/PaymentConfig.vue'), meta: { title: '支付配置' } },
      { path: 'finance/payment-orders', name: 'PaymentOrders', component: () => import('@/views/finance/PaymentOrders.vue'), meta: { title: '支付订单' } },
      { path: 'finance/global-billing', name: 'GlobalBilling', component: () => import('@/views/finance/GlobalBilling.vue'), meta: { title: '全局计费设置' } },

      { path: 'system/admins', name: 'Admins', component: () => import('@/views/system/Admins.vue'), meta: { title: '管理员管理' } },
      { path: 'system/roles', name: 'Roles', component: () => import('@/views/system/Roles.vue'), meta: { title: '角色管理' } },
      { path: 'system/menus', name: 'Menus', component: () => import('@/views/system/Menus.vue'), meta: { title: '菜单管理' } },
      { path: 'system/dict', name: 'Dict', component: () => import('@/views/system/Dict.vue'), meta: { title: '字典管理' } },
      { path: 'system/params', name: 'Params', component: () => import('@/views/system/Params.vue'), meta: { title: '参数设置' } },
      { path: 'system/notices', name: 'Notices', component: () => import('@/views/system/Notices.vue'), meta: { title: '通知公告' } },
      { path: 'system/operation-logs', name: 'OperationLogs', component: () => import('@/views/system/OperationLogs.vue'), meta: { title: '操作日志' } },
      { path: 'system/login-logs', name: 'LoginLogs', component: () => import('@/views/system/LoginLogs.vue'), meta: { title: '登录日志' } },
      { path: 'system/monitor', name: 'SystemMonitor', component: () => import('@/views/system/Monitor.vue'), meta: { title: '系统监控大屏' } },
      { path: 'operation/data-analytics', name: 'DataAnalytics', component: () => import('@/views/operation/DataAnalytics.vue'), meta: { title: '数据分析平台' } }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const userStore = useAdminUserStore()

  // 兜底：初始导航可能早于 main.js 的 loadUser() 调用，此时 token 存在但 user 尚未加载
  if (userStore.token && !userStore.user) {
    userStore.loadUser()
  }

  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    return '/login'
  }
  if (to.meta.requiresAdmin && !userStore.isAdmin) {
    return '/login'
  }
  if (to.path === '/login' && userStore.isLoggedIn && userStore.isAdmin) {
    return '/dashboard'
  }
})

export default router
