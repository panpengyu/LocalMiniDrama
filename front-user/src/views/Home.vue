<template>
  <div class="hero-page">
    <div class="hero-bg"></div>
    <div class="hero-gradient"></div>
    <div class="particles"></div>
    
    <header class="hero-header">
      <div class="header-left">
        <div class="logo">
          <span class="logo-icon">🎬</span>
          <span class="logo-text">LocalMiniDrama</span>
        </div>
      </div>
      <div class="header-right">
        <button class="login-btn" @click="showLogin = true">
          <span class="login-text">登录</span>
          <span class="login-glow"></span>
        </button>
      </div>
    </header>

    <main class="hero-content">
      <div class="hero-title-wrapper">
        <h1 class="hero-title">
          <span class="title-word title-word-1">AI</span>
          <span class="title-word title-word-2">驱动</span>
          <span class="title-word title-word-3">的</span>
          <span class="title-word title-word-4">短剧</span>
          <span class="title-word title-word-5">创作</span>
          <span class="title-word title-word-6">平台</span>
        </h1>
      </div>
      
      <p class="hero-subtitle">一站式完成剧本创作、分镜设计、AI绘图与视频生成</p>
      
      <div class="hero-buttons">
        <button class="start-btn" @click="handleStart">
          <span class="btn-icon">✨</span>
          <span class="btn-text">开始创作</span>
          <span class="btn-arrow">→</span>
        </button>
        <button class="demo-btn" @click="showDemo">
          <span class="btn-icon">🎥</span>
          <span class="btn-text">观看演示</span>
        </button>
      </div>
      
      <div class="stats">
        <div class="stat-item">
          <span class="stat-value">10K+</span>
          <span class="stat-label">创作者</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-value">100K+</span>
          <span class="stat-label">作品</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-value">99%</span>
          <span class="stat-label">好评率</span>
        </div>
      </div>
    </main>

    <div class="features-preview">
      <div class="feature-card" v-for="(feature, index) in features" :key="index" :style="{ animationDelay: `${index * 0.1}s` }">
        <div class="feature-icon" :style="{ background: feature.gradient }">
          {{ feature.icon }}
        </div>
        <div class="feature-info">
          <h3 class="feature-title">{{ feature.title }}</h3>
          <p class="feature-desc">{{ feature.desc }}</p>
        </div>
      </div>
    </div>

    <div class="floating-elements">
      <div class="float-element float-1">🎭</div>
      <div class="float-element float-2">📽️</div>
      <div class="float-element float-3">✨</div>
      <div class="float-element float-4">🎨</div>
      <div class="float-element float-5">💫</div>
    </div>

    <el-dialog v-model="showLogin" class="hero-login-dialog" width="420px" :show-close="false" :close-on-click-modal="true">
      <div class="dialog-content">
        <div class="dialog-header">
          <h3 class="dialog-title">欢迎回来</h3>
          <p class="dialog-subtitle">登录您的账户开始创作</p>
        </div>
        
        <el-form ref="loginFormRef" :model="loginForm" :rules="loginRules" class="login-form">
          <el-form-item prop="username">
            <el-input 
              v-model="loginForm.username" 
              placeholder="用户名或手机号"
              size="large"
              prefix-icon="User"
              class="login-input"
            />
          </el-form-item>
          
          <el-form-item prop="password">
            <el-input 
              v-model="loginForm.password" 
              type="password"
              placeholder="密码"
              size="large"
              prefix-icon="Lock"
              show-password
              class="login-input"
            />
          </el-form-item>
          
          <el-form-item>
            <el-button 
              type="primary" 
              size="large" 
              class="login-submit-btn"
              :loading="loginLoading"
              @click="handleLogin"
            >
              登录
            </el-button>
          </el-form-item>
        </el-form>
        
        <div class="dialog-footer">
          <span>还没有账户？</span>
          <el-button type="text" @click="$router.push('/register')">立即注册</el-button>
        </div>
        
        <div class="dialog-tip">
          <span>管理员账号：admin / admin123</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
// Hero 背景图 URL 统一收敛到外部资源常量（部署时可整体替换为自有资源）
import { HERO_BG_URL } from '@/constants/externalAssets'

const router = useRouter()
const userStore = useUserStore()
const showLogin = ref(false)
const loginFormRef = ref(null)
const loginLoading = ref(false)

const loginForm = reactive({
  username: '',
  password: ''
})

const loginRules = {
  username: [{ required: true, message: '请输入用户名或手机号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

const features = [
  { icon: '📝', title: 'AI编剧', desc: '自动生成剧本大纲', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { icon: '🎬', title: '分镜设计', desc: '可视化分镜编辑', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { icon: '🎨', title: 'AI绘图', desc: '高质量场景生成', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { icon: '🎥', title: '视频渲染', desc: '多模型视频生成', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
]

function handleStart() {
  if (userStore.isLoggedIn) {
    router.push('/')
  } else {
    showLogin.value = true
  }
}

function showDemo() {
  ElMessage.info('演示功能开发中')
}

async function handleLogin() {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  
  loginLoading.value = true
  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm)
    })
    const data = await response.json()
    
    if (data.success) {
      userStore.login(data.data.user, data.data.token)
      showLogin.value = false
      ElMessage.success('登录成功')
      router.push('/dashboard')
    } else {
      ElMessage.error(data.error?.message || '登录失败')
    }
  } catch (error) {
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    loginLoading.value = false
  }
}
</script>

<style scoped>
.hero-page {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.hero-bg {
  position: fixed;
  inset: 0;
  /* 背景图 URL 统一收敛到外部资源常量 externalAssets.js，部署时可整体替换为自有资源 */
  background: v-bind(HERO_BG_URL) center center / cover no-repeat;
  z-index: 0;
}

.hero-gradient {
  position: fixed;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 10, 30, 0.9) 0%,
    rgba(10, 20, 50, 0.85) 40%,
    rgba(20, 30, 70, 0.9) 100%
  );
  z-index: 1;
}

.particles {
  position: fixed;
  inset: 0;
  z-index: 2;
  background-image: 
    radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,0.6), transparent),
    radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.4), transparent),
    radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.5), transparent),
    radial-gradient(2px 2px at 160px 120px, rgba(255,255,255,0.6), transparent),
    radial-gradient(1px 1px at 230px 80px, rgba(255,255,255,0.3), transparent),
    radial-gradient(2px 2px at 300px 150px, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 400px 200px, rgba(255,255,255,0.4), transparent),
    radial-gradient(2px 2px at 500px 100px, rgba(255,255,255,0.5), transparent),
    radial-gradient(1px 1px at 600px 180px, rgba(255,255,255,0.3), transparent);
  background-repeat: repeat;
  background-size: 700px 300px;
  animation: particlesMove 20s ease-in-out infinite;
}

@keyframes particlesMove {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-20px); }
}

.hero-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 40px;
  z-index: 100;
  background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%);
}

.header-left .logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  font-size: 36px;
  animation: bounceIcon 2s ease-in-out infinite;
}

@keyframes bounceIcon {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

.logo-text {
  font-size: 22px;
  font-weight: 800;
  background: linear-gradient(135deg, #fff 0%, #a0aec0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.login-btn {
  position: relative;
  padding: 14px 32px;
  border: none;
  border-radius: 50px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.3s;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.login-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.login-glow {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.5s;
}

.login-btn:hover .login-glow {
  left: 100%;
}

.hero-content {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding-top: 80px;
}

.hero-title-wrapper {
  perspective: 1000px;
  margin-bottom: 30px;
}

.hero-title {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  font-size: clamp(48px, 10vw, 80px);
  font-weight: 900;
  margin: 0;
}

.title-word {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #f093fb 50%, #f5576c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: wordFloat 3s ease-in-out infinite;
}

.title-word:nth-child(1) { animation-delay: 0s; }
.title-word:nth-child(2) { animation-delay: 0.1s; }
.title-word:nth-child(3) { animation-delay: 0.2s; }
.title-word:nth-child(4) { animation-delay: 0.3s; }
.title-word:nth-child(5) { animation-delay: 0.4s; }
.title-word:nth-child(6) { animation-delay: 0.5s; }

@keyframes wordFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-10px) rotate(-1deg); }
  75% { transform: translateY(-5px) rotate(1deg); }
}

.hero-subtitle {
  font-size: clamp(18px, 2vw, 24px);
  color: rgba(255,255,255,0.8);
  margin: 0 0 50px;
  text-align: center;
  max-width: 600px;
}

.hero-buttons {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 60px;
}

.start-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 48px;
  border: none;
  border-radius: 50px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.3s;
  box-shadow: 0 8px 30px rgba(102, 126, 234, 0.4);
}

.start-btn:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 12px 40px rgba(102, 126, 234, 0.5);
}

.start-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent, rgba(255,255,255,0.2), transparent);
  transform: translateX(-100%);
  transition: transform 0.5s;
}

.start-btn:hover::before {
  transform: translateX(100%);
}

.btn-icon {
  font-size: 24px;
}

.btn-arrow {
  font-size: 20px;
  animation: arrowMove 1.5s ease-in-out infinite;
}

@keyframes arrowMove {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(5px); }
}

.demo-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 48px;
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50px;
  background: rgba(255,255,255,0.05);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  backdrop-filter: blur(10px);
}

.demo-btn:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.5);
}

.stats {
  display: flex;
  align-items: center;
  gap: 40px;
  padding: 30px 50px;
  border-radius: 20px;
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 800;
  background: linear-gradient(135deg, #667eea 0%, #f093fb 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.stat-label {
  font-size: 14px;
  color: rgba(255,255,255,0.6);
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: rgba(255,255,255,0.2);
}

.features-preview {
  position: relative;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  max-width: 1200px;
  margin: 80px auto 0;
  padding: 0 40px;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  border-radius: 20px;
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.1);
  animation: cardSlideIn 0.6s ease-out forwards;
  opacity: 0;
  transform: translateY(30px);
}

@keyframes cardSlideIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.feature-icon {
  width: 60px;
  height: 60px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  flex-shrink: 0;
}

.feature-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 6px;
}

.feature-desc {
  font-size: 14px;
  color: rgba(255,255,255,0.6);
  margin: 0;
}

.floating-elements {
  position: fixed;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.float-element {
  position: absolute;
  font-size: 40px;
  opacity: 0.3;
  animation: float 8s ease-in-out infinite;
}

.float-1 { top: 20%; left: 10%; animation-delay: 0s; }
.float-2 { top: 30%; right: 15%; animation-delay: 2s; }
.float-3 { top: 60%; left: 20%; animation-delay: 4s; }
.float-4 { top: 70%; right: 10%; animation-delay: 1s; }
.float-5 { top: 40%; left: 5%; animation-delay: 3s; }

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-20px) rotate(5deg); }
  50% { transform: translateY(-10px) rotate(0deg); }
  75% { transform: translateY(-30px) rotate(-5deg); }
}

.hero-login-dialog :deep(.el-dialog) {
  background: rgba(10, 20, 40, 0.95);
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 24px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.5);
}

.hero-login-dialog :deep(.el-dialog__header) {
  display: none;
}

.hero-login-dialog :deep(.el-dialog__body) {
  padding: 0;
}

.dialog-content {
  padding: 32px;
}

.dialog-header {
  text-align: center;
  margin-bottom: 30px;
}

.dialog-title {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}

.dialog-subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.6);
  margin: 0;
}

.login-input {
  --el-input-bg-color: rgba(255,255,255,0.05);
  --el-input-border-color: rgba(255,255,255,0.2);
  --el-input-text-color: #fff;
}

.login-input :deep(.el-input__wrapper) {
  border-radius: 12px;
}

.login-submit-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-submit-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  font-size: 14px;
  color: rgba(255,255,255,0.6);
}

.dialog-footer :deep(.el-button) {
  color: #667eea;
  font-weight: 500;
}

.dialog-tip {
  text-align: center;
  margin-top: 20px;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(102, 126, 234, 0.1);
  font-size: 12px;
  color: rgba(255,255,255,0.7);
}

@media (max-width: 768px) {
  .hero-header {
    padding: 0 20px;
  }
  
  .hero-title {
    font-size: clamp(32px, 8vw, 56px);
  }
  
  .hero-subtitle {
    padding: 0 20px;
  }
  
  .hero-buttons {
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  
  .start-btn, .demo-btn {
    width: 280px;
    padding: 16px 32px;
    justify-content: center;
  }
  
  .stats {
    flex-direction: column;
    gap: 20px;
    padding: 20px;
  }
  
  .stat-divider {
    width: 40px;
    height: 1px;
  }
  
  .features-preview {
    grid-template-columns: 1fr;
    padding: 0 20px;
  }
  
  .login-btn {
    padding: 10px 24px;
    font-size: 14px;
  }
}
</style>