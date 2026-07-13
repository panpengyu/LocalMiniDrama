<template>
  <div class="register-page">
    <div class="register-container">
      <div class="register-header">
        <h1 class="logo">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </h1>
        <p class="slogan">AI 驱动的短剧创作工具</p>
      </div>
      
      <el-card class="register-card">
        <div class="card-header">
          <h2 class="card-title">注册</h2>
          <p class="card-subtitle">创建您的账户，开始创作之旅</p>
        </div>
        
        <el-form ref="formRef" :model="form" :rules="rules" class="register-form">
          <el-form-item prop="phone">
            <el-input 
              v-model="form.phone" 
              placeholder="请输入手机号"
              prefix-icon="Mobile"
              size="large"
            />
          </el-form-item>
          
          <el-form-item prop="password">
            <el-input 
              v-model="form.password" 
              type="password"
              placeholder="请输入密码（至少6位）"
              prefix-icon="Lock"
              size="large"
              show-password
            />
          </el-form-item>
          
          <el-form-item prop="confirmPassword">
            <el-input 
              v-model="form.confirmPassword" 
              type="password"
              placeholder="请确认密码"
              prefix-icon="Lock"
              size="large"
              show-password
            />
          </el-form-item>
          
          <el-form-item prop="nickname">
            <el-input 
              v-model="form.nickname" 
              placeholder="请输入昵称（选填）"
              prefix-icon="User"
              size="large"
            />
          </el-form-item>
          
          <el-form-item>
            <el-button 
              type="primary" 
              size="large" 
              class="btn-register"
              :loading="loading"
              @click="handleRegister"
            >
              <el-icon><Plus /></el-icon>注册
            </el-button>
          </el-form-item>
        </el-form>
        
        <div class="register-footer">
          <span class="footer-text">已有账户？</span>
          <el-button type="text" class="btn-login" @click="$router.push('/login')">
            立即登录
          </el-button>
        </div>
        
        <div class="register-tip">
          <el-alert 
            title="注册后使用手机号和密码登录" 
            type="warning" 
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

const form = reactive({
  phone: '',
  password: '',
  confirmPassword: '',
  nickname: ''
})

const rules = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入有效的手机号', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { 
      validator: (rule, value, callback) => {
        if (value !== form.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  nickname: [
    { max: 50, message: '昵称不能超过50个字符', trigger: 'blur' }
  ]
}

async function handleRegister() {
  const valid = await formRef.value.validate()
  if (!valid) return
  
  loading.value = true
  try {
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: form.phone,
        password: form.password,
        nickname: form.nickname
      })
    })
    const data = await response.json()
    
    if (data.success) {
      userStore.login(data.data.user, data.data.token)
      ElMessage.success(data.data.message || '注册成功')
      router.push('/')
    } else {
      ElMessage.error(data.error?.message || '注册失败')
    }
  } catch (error) {
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.register-container {
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.register-header {
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

.register-card {
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

.register-form {
  padding: 24px;
}

.btn-register {
  width: 100%;
  height: 44px;
  font-size: 16px;
}

.register-footer {
  padding: 0 24px 24px;
}

.footer-text {
  color: #909399;
  font-size: 14px;
}

.btn-login {
  color: #667eea;
  font-weight: 500;
}

.btn-login:hover {
  color: #764ba2;
}

.register-tip {
  padding: 0 24px 24px;
}

.tip-alert {
  font-size: 12px;
}
</style>