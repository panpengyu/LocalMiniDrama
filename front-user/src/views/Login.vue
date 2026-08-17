<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <h1 class="logo">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </h1>
        <p class="slogan">AI 驱动的短剧创作工具</p>
      </div>
      
      <el-card class="login-card">
        <div class="card-header">
          <h2 class="card-title">登录</h2>
          <p class="card-subtitle">欢迎回来，请登录您的账户</p>
        </div>
        
        <el-form ref="formRef" :model="form" :rules="rules" class="login-form">
          <el-form-item prop="username">
            <el-input 
              v-model="form.username" 
              placeholder="请输入用户名或手机号"
              prefix-icon="User"
              size="large"
            />
          </el-form-item>
          
          <el-form-item prop="password" v-if="!needTwoFa">
            <el-input 
              v-model="form.password" 
              type="password"
              placeholder="请输入密码"
              prefix-icon="Lock"
              size="large"
              show-password
            />
          </el-form-item>

          <template v-if="needTwoFa">
            <el-alert type="info" :closable="false" show-icon class="twofa-tip"
              title="该账户已启用两步验证，请输入身份验证器中的 6 位动态码。" />
            <el-form-item prop="code" class="mt16">
              <el-input
                v-model="twoFaCode"
                maxlength="6"
                placeholder="6 位动态码"
                prefix-icon="Key"
                size="large"
                class="code-input"
                @keyup.enter="handleTwoFaLogin"
              />
            </el-form-item>
          </template>
          
          <el-form-item>
            <el-button 
              type="primary" 
              size="large" 
              class="btn-login"
              :loading="loading"
              @click="needTwoFa ? handleTwoFaLogin() : handleLogin()"
            >
              <el-icon><CircleCheck /></el-icon>{{ needTwoFa ? '完成验证' : '登录' }}
            </el-button>
          </el-form-item>
        </el-form>
        
        <div class="login-footer">
          <span class="footer-text">还没有账户？</span>
          <el-button type="text" class="btn-register" @click="$router.push('/register')">
            立即注册
          </el-button>
        </div>
        
        <div class="admin-tip">
          <el-alert 
            title="管理员账号：admin / admin" 
            type="info" 
            :closable="false" 
            show-icon
            class="tip-alert"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const needTwoFa = ref(false)
const tempToken = ref('')
const twoFaCode = ref('')

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [
    { required: true, message: '请输入用户名或手机号', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' }
  ]
}

async function handleLogin() {
  const valid = await formRef.value.validate()
  if (!valid) return
  
  loading.value = true
  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await response.json()
    
    if (data.success) {
      if (data.data.needTwoFa) {
        // 进入第二步：等待动态码
        needTwoFa.value = true
        tempToken.value = data.data.tempToken
        twoFaCode.value = ''
        ElMessage.info(data.data.message || '请输入验证器动态码')
        return
      }
      userStore.login(data.data.user, data.data.token)
      ElMessage.success(data.data.message || '登录成功')
      router.push('/')
    } else {
      ElMessage.error(data.error?.message || '登录失败')
    }
  } catch (error) {
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function handleTwoFaLogin() {
  if (!/^\d{6}$/.test(twoFaCode.value)) {
    ElMessage.warning('请输入 6 位动态码')
    return
  }
  loading.value = true
  try {
    const response = await fetch('/api/v1/auth/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: tempToken.value, code: twoFaCode.value })
    })
    const data = await response.json()
    if (data.success) {
      userStore.login(data.data.user, data.data.token)
      ElMessage.success(data.data.message || '登录成功')
      router.push('/')
    } else {
      ElMessage.error(data.error?.message || '验证失败')
    }
  } catch (error) {
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.login-container {
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.login-header {
  margin-bottom: 30px;
}

.logo {
  display: block;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.logo-main {
  display: block;
  font-size: 28px;
}

.logo-sub {
  display: block;
  font-size: 14px;
  font-weight: 400;
  opacity: 0.8;
  margin-top: 4px;
}

.slogan {
  color: rgba(255,255,255,0.9);
  font-size: 14px;
  margin-top: 10px;
}

.login-card {
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  overflow: hidden;
}

.card-header {
  padding: 20px 24px 0;
}

.card-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.card-subtitle {
  font-size: 14px;
  color: #909399;
  margin-top: 8px;
}

.login-form {
  padding: 24px;
}

.btn-login {
  width: 100%;
  height: 44px;
  font-size: 16px;
}

.login-footer {
  padding: 0 24px 24px;
}

.footer-text {
  color: #909399;
  font-size: 14px;
}

.btn-register {
  color: #667eea;
  font-weight: 500;
}

.btn-register:hover {
  color: #764ba2;
}

.admin-tip {
  padding: 0 24px 24px;
}

.tip-alert {
  font-size: 12px;
}

.twofa-tip {
  margin: 0 24px 8px;
  font-size: 12px;
}

.mt16 {
  margin-top: 16px;
}

.code-input :deep(.el-input__inner) {
  letter-spacing: 4px;
  text-align: center;
  font-family: Menlo, Consolas, monospace;
}
</style>