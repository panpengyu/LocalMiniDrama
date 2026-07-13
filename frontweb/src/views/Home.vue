<template>
  <main class="home-page">
    <div class="home-art" aria-hidden="true"></div>

    <nav class="side-nav" aria-label="主导航">
      <button class="brand-button" aria-label="柚戏 YouSee" @click="scrollToTop"><span>🍊</span></button>
      <div class="nav-rail">
        <button v-for="item in navItems" :key="item.name" class="nav-item" :class="{ active: item.name === '首页' }" @click="handleNav(item)">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.name }}</span>
        </button>
      </div>
    </nav>

    <div class="top-actions">
      <button class="theme-button" aria-label="切换夜间模式" @click="darkMode = !darkMode"><el-icon><Moon /></el-icon></button>
      <button class="login-button" @click="showLoginDialog = true"><el-icon><Right /></el-icon>立即登录</button>
    </div>

    <section class="hero-content" :class="{ 'is-dimmed': darkMode }">
      <div class="mascot" aria-hidden="true">🍊</div>
      <h1><span>柚戏</span> YouSee</h1>
      <p>柚子专业 AI 影视创作平台</p>
      <div class="hero-actions">
        <button class="primary-action" @click="showLoginDialog = true"><el-icon><Plus /></el-icon>开始创作</button>
        <button class="ranking-action" @click="handleNav({ name: '短剧热门排行榜' })"><el-icon><Trophy /></el-icon>短剧热门排行榜</button>
      </div>
    </section>

    <button class="explore-button" @click="scrollToTop">向下探索<el-icon><ArrowDown /></el-icon></button>
    <button class="chat-button" aria-label="在线咨询" @click="ElMessage.info('在线咨询即将上线')"><el-icon><ChatDotRound /></el-icon></button>

    <el-dialog v-model="showLoginDialog" class="login-dialog" width="400px" :show-close="false" :close-on-click-modal="true" @closed="resetLoginForm">
      <template #header><div class="dialog-title">欢迎来到柚戏</div></template>
      <el-tabs v-model="loginTab" stretch>
        <el-tab-pane label="登录" name="login">
          <el-form ref="loginFormRef" :model="loginForm" :rules="loginRules" @submit.prevent>
            <el-form-item prop="username"><el-input v-model="loginForm.username" size="large" placeholder="用户名或手机号" :prefix-icon="User" /></el-form-item>
            <el-form-item prop="password"><el-input v-model="loginForm.password" size="large" type="password" show-password placeholder="密码" :prefix-icon="Lock" @keyup.enter="handleLogin" /></el-form-item>
            <el-button class="dialog-submit" size="large" :loading="loginLoading" @click="handleLogin">立即登录</el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="注册" name="register"><p class="register-tip">请使用现有注册入口创建账号。</p></el-tab-pane>
      </el-tabs>
    </el-dialog>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowDown, Box, ChatDotRound, Grid, HomeFilled, Lock, Moon, Plus, Promotion, Right, School, Tickets, Trophy, User } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const showLoginDialog = ref(false)
const loginTab = ref('login')
const loginFormRef = ref()
const loginLoading = ref(false)
const darkMode = ref(false)
const loginForm = reactive({ username: '', password: '' })
const loginRules = { username: [{ required: true, message: '请输入用户名或手机号', trigger: 'blur' }], password: [{ required: true, message: '请输入密码', trigger: 'blur' }] }
const navItems = [
  { name: '首页', icon: HomeFilled }, { name: '短剧热门\n排行榜', icon: Trophy }, { name: '团队', icon: User }, { name: '画布', icon: Grid },
  { name: '项目', icon: Tickets, path: '/dashboard' }, { name: '广场', icon: School, path: '/media-library' }, { name: '工具箱', icon: Box }, { name: '剪辑台', icon: Promotion }, { name: '资产库', icon: Box, path: '/media-library' }
]

function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
function handleNav(item) {
  if (item.path && userStore.isLoggedIn) router.push(item.path)
  else if (item.name !== '首页') ElMessage.info('请先登录后使用此功能')
}
function resetLoginForm() { loginForm.username = ''; loginForm.password = ''; loginTab.value = 'login' }
async function handleLogin() {
  const valid = await loginFormRef.value?.validate().catch(() => false)
  if (!valid) return
  loginLoading.value = true
  try {
    const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) })
    const data = await response.json()
    if (!data.success) throw new Error(data.error?.message || '登录失败')
    userStore.login(data.data.user, data.data.token)
    showLoginDialog.value = false
    router.push(data.data.user.role === 'super_admin' ? '/admin' : '/dashboard')
  } catch (error) { ElMessage.error(error.message || '网络错误，请稍后重试') }
  finally { loginLoading.value = false }
}
</script>

<style scoped>
.home-page { min-height: 100vh; overflow: hidden; position: relative; color: #fff; background: #061b36; font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif; }
.home-art { position: fixed; inset: 0; background: linear-gradient(rgba(2,18,39,.06), rgba(1,16,28,.08)), url('@/assets/yousee-home-reference.png') center center / cover no-repeat; transform: scale(1.004); z-index: 0; }
.home-page::after { content: ''; position: fixed; inset: 0; z-index: 1; pointer-events: none; background: radial-gradient(ellipse at center, transparent 22%, rgba(0,10,25,.18) 100%); }
.side-nav, .top-actions, .hero-content, .explore-button, .chat-button { position: fixed; z-index: 2; }
.side-nav { top: 24px; left: 5px; width: 94px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.brand-button { width: 64px; height: 64px; border-radius: 50%; border: 1px solid rgba(255,255,255,.13); background: rgba(10,36,66,.72); color: #fff; font-size: 34px; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
.brand-button span { display: block; transform: translateY(1px); filter: saturate(.8); }
.nav-rail { width: 94px; padding: 10px 10px 14px; border: 1px solid rgba(255,255,255,.15); border-radius: 48px; background: rgba(14,29,48,.78); backdrop-filter: blur(9px); }
.nav-item { width: 100%; min-height: 100px; border: 1px solid transparent; border-radius: 34px; padding: 12px 2px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; background: transparent; color: rgba(255,255,255,.72); font-size: 15px; font-weight: 700; line-height: 1.15; white-space: pre-line; cursor: pointer; transition: .2s; }
.nav-item .el-icon { font-size: 29px; }.nav-item:hover { background: rgba(255,255,255,.1); color: #fff; }.nav-item.active { color: #e9cafb; background: linear-gradient(145deg, rgba(169,128,209,.28), rgba(70,67,103,.36)); }
.top-actions { top: 2px; right: 34px; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }.theme-button { width: 53px; height: 53px; border: 1px solid rgba(255,255,255,.16); border-radius: 11px; background: rgba(6,8,15,.88); color: #aeb4c4; font-size: 27px; cursor: pointer; }.login-button { border: 0; border-radius: 12px; min-width: 168px; height: 53px; background: linear-gradient(108deg, #b476f6, #f4a5d9 56%, #ffc343); color: #fff; font-size: 19px; font-weight: 700; box-shadow: 0 10px 28px rgba(89,45,149,.28); cursor: pointer; }.login-button .el-icon { margin-right: 10px; font-size: 22px; vertical-align: -3px; }
.hero-content { top: 50%; left: calc(50% + 46px); transform: translate(-50%, -44%); text-align: center; width: min(710px, calc(100vw - 220px)); text-shadow: 0 3px 14px rgba(0,0,0,.36); transition: filter .3s; }.hero-content.is-dimmed { filter: brightness(.72); }.mascot { margin: 0 auto 38px; width: 112px; height: 112px; display: grid; place-items: center; border-radius: 45% 45% 38% 38%; background: radial-gradient(circle at 50% 44%, #ffe4c8 0 28%, #f89847 30% 54%, #ef753f 58%); box-shadow: 0 14px 36px rgba(0,0,0,.28), inset 0 0 0 5px rgba(255,255,255,.18); font-size: 68px; line-height: 1; }.hero-content h1 { margin: 0; font-size: clamp(54px, 5vw, 88px); letter-spacing: -3px; font-weight: 800; background: linear-gradient(100deg, #b777ff 0%, #d18eed 32%, #f3a3cc 62%, #ffc143 100%); -webkit-background-clip: text; color: transparent; }.hero-content p { margin: 30px 0 62px; color: rgba(238,244,255,.69); font-size: clamp(20px, 1.7vw, 28px); font-weight: 600; }.hero-actions { display: flex; justify-content: center; gap: 18px; }.hero-actions button { height: 90px; min-width: 330px; padding: 0 38px; border-radius: 46px; font-size: 25px; font-weight: 700; cursor: pointer; }.hero-actions .el-icon { margin-right: 14px; font-size: 31px; vertical-align: -5px; }.primary-action { border: 0; background: linear-gradient(105deg, #ad78f5 0%, #d58af0 42%, #ffbe40 100%); color: #fff; box-shadow: 0 14px 34px rgba(54,23,94,.29); }.ranking-action { color: #fff; border: 2px solid rgba(253,204,43,.8); background: rgba(24,53,66,.24); backdrop-filter: blur(4px); }.ranking-action .el-icon { color: #ffd32e; }.explore-button { bottom: 26px; left: calc(50% + 46px); transform: translateX(-50%); border: 0; background: transparent; color: rgba(224,232,242,.42); display: flex; flex-direction: column; align-items: center; gap: 7px; font-size: 16px; cursor: pointer; }.explore-button .el-icon { font-size: 26px; }.chat-button { right: 34px; bottom: 9px; width: 73px; height: 73px; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; background: rgba(10,47,64,.48); color: #fff; font-size: 30px; cursor: pointer; }
.dialog-title { font-size: 23px; font-weight: 700; color: #252a43; text-align: center; }.dialog-submit { width: 100%; border: 0; color: #fff; background: linear-gradient(105deg, #ae76f4, #f7b940); }.register-tip { text-align: center; color: #667085; padding: 22px 0; }
@media (max-width: 900px) { .side-nav { transform: scale(.8); transform-origin: top left; }.hero-content { left: 54%; }.hero-actions button { min-width: 240px; height: 72px; font-size: 19px; }.mascot { margin-bottom: 24px; }.hero-content p { margin: 20px 0 38px; } }
@media (max-width: 640px) { .side-nav { display: none; }.top-actions { right: 14px; }.login-button { min-width: 130px; height: 46px; font-size: 16px; }.theme-button { width: 46px; height: 46px; }.hero-content { left: 50%; width: calc(100vw - 28px); }.hero-actions { flex-direction: column; align-items: center; }.hero-actions button { width: 270px; min-width: 0; height: 58px; }.hero-content h1 { letter-spacing: -2px; }.chat-button { width: 52px; height: 52px; right: 15px; bottom: 15px; }.explore-button { left: 50%; } }
</style>
