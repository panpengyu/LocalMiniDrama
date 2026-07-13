import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import AdminLayout from '@/layouts/AdminLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/Home.vue'),
      meta: { title: '本地短剧助手', requiresAuth: false }
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/FilmList.vue'),
      meta: { title: '项目列表', requiresAuth: true }
    },
    {
      path: '/drama/:id',
      name: 'drama-detail',
      component: () => import('@/views/DramaDetail.vue'),
      meta: { title: '剧集管理', requiresAuth: true }
    },
    {
      path: '/film/:id',
      name: 'film',
      component: () => import('@/views/FilmCreate.vue'),
      meta: { title: 'AI 视频生成', requiresAuth: true }
    },
    {
      path: '/film/:id/canvas',
      name: 'film-canvas',
      component: () => import('@/views/DramaCanvas.vue'),
      meta: { title: '画布模式', requiresAuth: true }
    },
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置', requiresAuth: true }
    },
    {
      path: '/free-create',
      name: 'free-create',
      component: () => import('@/views/FreeCreate.vue'),
      meta: { title: '自由创作', requiresAuth: true }
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '媒体素材库', requiresAuth: true }
    },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        {
          path: '',
          name: 'admin-dashboard',
          component: () => import('@/views/admin/Dashboard.vue'),
          meta: { title: '仪表盘' }
        },
        {
          path: 'users',
          name: 'admin-users',
          component: () => import('@/views/admin/UserManagement.vue'),
          meta: { title: '用户管理' }
        },
        {
          path: 'projects',
          name: 'admin-projects',
          component: () => import('@/views/admin/ProjectManagement.vue'),
          meta: { title: '项目管理' }
        },
        {
          path: 'enterprises',
          name: 'admin-enterprises',
          component: () => import('@/views/admin/EnterpriseManagement.vue'),
          meta: { title: '企业管理' }
        },
        {
          path: 'teams',
          name: 'admin-teams',
          component: () => import('@/views/admin/TeamManagement.vue'),
          meta: { title: '团队管理' }
        },
        {
          path: 'assets',
          name: 'admin-assets',
          component: () => import('@/views/admin/AssetManagement.vue'),
          meta: { title: '资产管理' }
        },
        {
          path: 'ai-config',
          name: 'admin-ai-config',
          component: () => import('@/views/admin/AIConfigManagement.vue'),
          meta: { title: 'AI配置' }
        }
      ]
    }
  ]
})

router.beforeEach((to, from, next) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - LocalMiniDrama`
  }
  
  const userStore = useUserStore()
  
  if (to.name === 'home' && userStore.isLoggedIn) {
    if (userStore.isAdmin) {
      next('/admin')
    } else {
      next('/dashboard')
    }
  } else if (to.meta.requiresAuth === true && !userStore.isLoggedIn) {
    next('/')
  } else if (to.meta.requiresAdmin === true && !userStore.isAdmin) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router