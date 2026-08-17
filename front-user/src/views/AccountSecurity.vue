<template>
  <div class="account-security">
    <div class="page-head">
      <h2>账户安全</h2>
      <p>两步验证（2FA）与登录密码管理，保护你的账号安全。</p>
    </div>

    <!-- 两步验证 -->
    <el-card shadow="never" class="sec-card">
      <template #header>
        <div class="card-head">
          <span><el-icon class="vam"><Lock /></el-icon> 两步验证（2FA）</span>
          <el-tag v-if="twoFaEnabled" type="success" size="small">已启用</el-tag>
          <el-tag v-else type="info" size="small">未启用</el-tag>
        </div>
      </template>

      <template v-if="!twoFaEnabled">
        <el-alert type="info" :closable="false" show-icon class="mb16"
          title="启用后，登录时除密码外还需输入身份验证器生成的 6 位动态码，可有效防止账号被盗。" />
        <el-button type="primary" :loading="binding" @click="startBind">立即绑定</el-button>
      </template>

      <template v-else>
        <div class="enabled-tip">
          <el-icon class="vam"><CircleCheckFilled /></el-icon>
          已启用两步验证。如需更换设备，可先关闭后重新绑定。
        </div>
        <el-button type="danger" plain :loading="disabling" @click="unbindVisible = true">关闭两步验证</el-button>
      </template>
    </el-card>

    <!-- 修改密码 -->
    <el-card shadow="never" class="sec-card">
      <template #header>
        <div class="card-head"><span><el-icon class="vam"><Key /></el-icon> 修改登录密码</span></div>
      </template>
      <el-alert type="warning" :closable="false" show-icon class="mb16"
        title="密码修改成功后，当前账号的所有登录会话将立即失效，需重新登录。" />
      <el-form ref="pwFormRef" :model="pwForm" :rules="pwRules" label-width="110px" class="pw-form">
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input v-model="pwForm.oldPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="pwForm.newPassword" type="password" show-password placeholder="8 位以上，建议包含大小写与数字" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm">
          <el-input v-model="pwForm.confirm" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="pwSaving" @click="submitPw">确认修改</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 绑定 2FA 弹窗 -->
    <el-dialog v-model="bindVisible" title="绑定两步验证" width="460px" :close-on-click-modal="false" @closed="resetBind">
      <el-steps :active="bindStep" align-center finish-status="success" class="mb24">
        <el-step title="获取密钥" />
        <el-step title="添加验证器" />
        <el-step title="输入动态码" />
      </el-steps>

      <template v-if="bindStep === 0">
        <div class="bind-empty">
          <el-button type="primary" :loading="gettingSecret" @click="fetchSecret">获取绑定密钥</el-button>
        </div>
      </template>

      <template v-else-if="bindStep === 1 && secret">
        <el-alert type="success" :closable="false" show-icon class="mb16"
          title="请使用身份验证器 App（如 Google Authenticator / Authy / 微信小程序）添加以下账户：" />
        <div class="secret-box">
          <div class="secret-label">账户名</div>
          <div class="secret-value">{{ uriAccount }}</div>
        </div>
        <div class="secret-box">
          <div class="secret-label">手动输入密钥</div>
          <div class="secret-value mono">{{ secret }}</div>
          <el-button link type="primary" size="small" @click="copyText(secret)">复制</el-button>
        </div>
        <div class="uri-box">
          <div class="secret-label">或使用 otpauth 链接（支持二维码扫描）</div>
          <div class="uri-text">{{ uri }}</div>
          <el-button link type="primary" size="small" @click="copyText(uri)">复制链接</el-button>
        </div>
      </template>

      <template v-else-if="bindStep === 2">
        <el-form label-width="90px">
          <el-form-item label="动态验证码">
            <el-input v-model="bindCode" maxlength="6" placeholder="6 位动态码" class="code-input">
              <template #suffix><span class="code-tip">有效期 30 秒</span></template>
            </el-input>
          </el-form-item>
        </el-form>
      </template>

      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button v-if="bindStep > 0" @click="bindStep--">上一步</el-button>
        <el-button v-if="bindStep === 0" type="primary" @click="fetchSecret" :loading="gettingSecret">下一步</el-button>
        <el-button v-if="bindStep === 1" type="primary" @click="bindStep = 2">我已添加，下一步</el-button>
        <el-button v-if="bindStep === 2" type="primary" :loading="verifying" @click="verifyBind">完成绑定</el-button>
      </template>
    </el-dialog>

    <!-- 关闭 2FA 弹窗 -->
    <el-dialog v-model="unbindVisible" title="关闭两步验证" width="420px">
      <el-alert type="warning" :closable="false" show-icon class="mb16"
        title="关闭后登录将不再需要动态码。请输入当前验证码确认操作。" />
      <el-form label-width="90px">
        <el-form-item label="动态验证码">
          <el-input v-model="unbindCode" maxlength="6" placeholder="6 位动态码" class="code-input" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="unbindVisible = false">取消</el-button>
        <el-button type="danger" :loading="disabling" @click="confirmUnbind">确认关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Lock, Key, CircleCheckFilled } from '@element-plus/icons-vue'
import { securityAPI } from '@/api/security'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const twoFaEnabled = ref(!!userStore.user?.two_fa_enabled)

// ---------- 2FA 绑定 ----------
const bindVisible = ref(false)
const bindStep = ref(0)
const gettingSecret = ref(false)
const verifying = ref(false)
const secret = ref('')
const uri = ref('')
const bindCode = ref('')

const uriAccount = computed(() => {
  const m = /label=([^&]+)/.exec(uri.value || '')
  return m ? decodeURIComponent(m[1]) : (userStore.user?.username || '')
})

function startBind() {
  bindStep.value = 0
  bindCode.value = ''
  secret.value = ''
  uri.value = ''
  bindVisible.value = true
}

function resetBind() {
  bindStep.value = 0
  bindCode.value = ''
}

async function fetchSecret() {
  gettingSecret.value = true
  try {
    const res = await securityAPI.setupTwoFa()
    secret.value = res.secret
    uri.value = res.uri
    bindStep.value = 1
  } catch (e) {
    ElMessage.error('获取密钥失败：' + (e.message || '网络错误'))
  } finally {
    gettingSecret.value = false
  }
}

async function verifyBind() {
  if (!/^\d{6}$/.test(bindCode.value)) {
    ElMessage.warning('请输入 6 位动态码')
    return
  }
  verifying.value = true
  try {
    await securityAPI.verifyTwoFa(bindCode.value)
    twoFaEnabled.value = true
    bindVisible.value = false
    if (userStore.user) userStore.user.two_fa_enabled = 1
    ElMessage.success('两步验证已启用')
  } catch (e) {
    ElMessage.error('验证失败：' + (e.message || '验证码错误，请重试'))
  } finally {
    verifying.value = false
  }
}

// ---------- 关闭 2FA ----------
const unbindVisible = ref(false)
const unbindCode = ref('')
const disabling = ref(false)

async function confirmUnbind() {
  if (!/^\d{6}$/.test(unbindCode.value)) {
    ElMessage.warning('请输入 6 位动态码')
    return
  }
  disabling.value = true
  try {
    await securityAPI.disableTwoFa(unbindCode.value)
    twoFaEnabled.value = false
    unbindVisible.value = false
    unbindCode.value = ''
    if (userStore.user) userStore.user.two_fa_enabled = 0
    ElMessage.success('两步验证已关闭')
  } catch (e) {
    ElMessage.error('关闭失败：' + (e.message || '验证码错误'))
  } finally {
    disabling.value = false
  }
}

// ---------- 修改密码 ----------
const pwFormRef = ref()
const pwSaving = ref(false)
const pwForm = ref({ oldPassword: '', newPassword: '', confirm: '' })
const pwRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' }
  ],
  confirm: [{
    validator: (_, value, cb) => {
      if (!value) cb(new Error('请再次输入新密码'))
      else if (value !== pwForm.value.newPassword) cb(new Error('两次输入不一致'))
      else cb()
    },
    trigger: 'blur'
  }]
}

async function submitPw() {
  await pwFormRef.value.validate()
  pwSaving.value = true
  try {
    await securityAPI.changePassword(pwForm.value.oldPassword, pwForm.value.newPassword)
    ElMessage.success('密码修改成功，请重新登录')
    setTimeout(() => {
      userStore.logout()
      window.location.href = '/login'
    }, 1200)
  } catch (e) {
    ElMessage.error('修改失败：' + (e.message || '网络错误'))
  } finally {
    pwSaving.value = false
  }
}

// ---------- 复制 ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch (_) {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

onMounted(() => {
  twoFaEnabled.value = !!userStore.user?.two_fa_enabled
})
</script>

<style scoped>
.account-security {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px;
}
.page-head h2 { margin: 0 0 6px; font-size: 20px; color: #303133; }
.page-head p { margin: 0 0 20px; color: #909399; font-size: 13px; }
.sec-card { margin-bottom: 16px; }
.card-head { display: flex; align-items: center; gap: 8px; }
.vam { vertical-align: -2px; }
.mb16 { margin-bottom: 16px; }
.mb24 { margin-bottom: 24px; }
.enabled-tip { display: flex; align-items: center; gap: 6px; color: #67C23A; margin-bottom: 12px; }
.pw-form { max-width: 460px; }
.bind-empty { text-align: center; padding: 24px 0; }
.secret-box { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #f5f7fa; border-radius: 6px; margin-bottom: 10px; }
.secret-label { color: #909399; font-size: 12px; width: 110px; flex-shrink: 0; }
.secret-value { flex: 1; color: #303133; }
.mono { font-family: Menlo, Consolas, monospace; letter-spacing: 1px; }
.uri-box { padding: 10px 14px; background: #f5f7fa; border-radius: 6px; }
.uri-text { font-size: 12px; color: #606266; word-break: break-all; margin-bottom: 6px; }
.code-input { width: 240px; }
.code-tip { color: #c0c4cc; font-size: 12px; }
</style>
