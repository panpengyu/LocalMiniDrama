import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import UserLayout from '@/layouts/UserLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { title: '登录', requiresAuth: false }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/Register.vue'),
      meta: { title: '注册', requiresAuth: false }
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/Home.vue'),
      meta: { title: 'LocalMiniDrama', requiresAuth: false }
    },
    {
      path: '/',
      component: UserLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/FilmList.vue'),
          meta: { title: '项目列表' }
        },
        {
          path: 'drama/:id',
          name: 'drama-detail',
          component: () => import('@/views/DramaDetail.vue'),
          meta: { title: '剧集管理' }
        },
        {
          path: 'film/:id',
          name: 'film',
          component: () => import('@/views/FilmCreate.vue'),
          meta: { title: 'AI 视频生成' }
        },
        {
          path: 'film/:id/canvas',
          name: 'film-canvas',
          component: () => import('@/views/DramaCanvas.vue'),
          meta: { title: '画布模式' }
        },
        {
          path: 'ai-config',
          name: 'ai-config',
          component: () => import('@/views/AiConfig.vue'),
          meta: { title: 'AI 配置' }
        },
        {
          path: 'free-create',
          name: 'free-create',
          component: () => import('@/views/FreeCreate.vue'),
          meta: { title: '自由创作' }
        },
        {
          path: 'screenwriter',
          name: 'screenwriter-studio',
          component: () => import('@/views/ScreenwriterStudio.vue'),
          meta: { title: 'AI 编剧助手' }
        },
        {
          path: 'media-library',
          name: 'media-library',
          component: () => import('@/views/MediaLibrary.vue'),
          meta: { title: '媒体素材库' }
        },
        {
          path: 'tools/image-generate',
          name: 'tools-image-generate',
          component: () => import('@/views/tools/ImageGenerate.vue'),
          meta: { title: '图片生成' }
        },
        {
          path: 'tools/video-generate',
          name: 'tools-video-generate',
          component: () => import('@/views/tools/VideoGenerate.vue'),
          meta: { title: '视频生成' }
        },
        {
          path: 'tools/audio-generate',
          name: 'tools-audio-generate',
          component: () => import('@/views/tools/AudioGenerate.vue'),
          meta: { title: '音频生成' }
        },
        {
          path: 'tools/audio-pair',
          name: 'tools-audio-pair',
          component: () => import('@/views/tools/AudioPair.vue'),
          meta: { title: '音频成对' }
        },
        {
          path: 'tools/text-chat',
          name: 'tools-text-chat',
          component: () => import('@/views/tools/TextChat.vue'),
          meta: { title: '文字对话' }
        },
        {
          path: 'tools/prompt-optimize',
          name: 'tools-prompt-optimize',
          component: () => import('@/views/tools/PromptOptimize.vue'),
          meta: { title: '提示词优化' }
        },
        {
          path: 'tools/plot-split',
          name: 'tools-plot-split',
          component: () => import('@/views/tools/PlotSplit.vue'),
          meta: { title: '剧情拆分' }
        },
        {
          path: 'tools/video-reverse',
          name: 'tools-video-reverse',
          component: () => import('@/views/tools/VideoReverse.vue'),
          meta: { title: '反推视频' }
        },
        {
          path: 'tools/video-remove-subtitle',
          name: 'tools-video-remove-subtitle',
          component: () => import('@/views/tools/VideoRemoveSubtitle.vue'),
          meta: { title: '视频去字幕' }
        },
        {
          path: 'tools/video-upscale',
          name: 'tools-video-upscale',
          component: () => import('@/views/tools/VideoUpscale.vue'),
          meta: { title: '视频超分' }
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
    next('/dashboard')
  } else if (to.meta.requiresAuth === true && !userStore.isLoggedIn) {
    next('/')
  } else {
    next()
  }
})

export default router
