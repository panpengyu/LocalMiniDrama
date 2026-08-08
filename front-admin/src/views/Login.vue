<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <h1 class="logo">LocalMiniDrama 管理后台</h1>
        <p class="slogan">仅超级管理员（super_admin）可登录</p>
      </div>

      <el-card class="login-card" shadow="always">
        <el-form ref="formRef" :model="form" :rules="rules" class="login-form" label-position="top">
          <el-form-item prop="username" label="账号">
            <el-input
              v-model="form.username"
              placeholder="请输入用户名或手机号"
              size="large"
              :prefix-icon="User"
            />
          </el-form-item>

          <el-form-item prop="password" label="密码">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              show-password
              :prefix-icon="Lock"
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              size="large"
              class="btn-login"
              :loading="loading"
              @click="handleLogin"
            >
              登录
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { useAdminUserStore } from '@/stores/adminUser'

const router = useRouter()
const userStore = useAdminUserStore()
const formRef = ref(null)
const loading = ref(false)

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名或手机号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  loading.value = true
  try {
    // createRequest 响应拦截器已解包，res 即 { user, token, message }
    const res = await request.post('/auth/login', {
      username: form.username,
      password: form.password
    })

    if (!res || !res.user || !res.token) {
      ElMessage.error('登录响应异常，请稍后重试')
      return
    }

    // 仅 super_admin 角色可登录管理后台
    if (res.user.role !== 'super_admin') {
      ElMessage.error('无管理员权限')
      return
    }

    userStore.login(res.user, res.token)
    ElMessage.success(res.message || '登录成功')
    router.push('/dashboard')
  } catch {
    // 错误信息已由 request 拦截器统一提示
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
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%);
  padding: 20px;
}

.login-container {
  width: 100%;
  max-width: 420px;
  text-align: center;
}

.login-header {
  margin-bottom: 28px;
}

.logo {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.slogan {
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  margin-top: 10px;
}

.login-card {
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.login-form {
  padding: 12px 4px 4px;
}

.btn-login {
  width: 100%;
  height: 44px;
  font-size: 16px;
}
</style>
