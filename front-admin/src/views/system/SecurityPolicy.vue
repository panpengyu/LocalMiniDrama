<template>
  <div class="security-policy-page">
    <!-- 顶部状态卡 -->
    <el-row :gutter="16">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card" :class="{ active: form.enabled }">
          <div class="stat-title">安全策略</div>
          <div class="stat-value">{{ form.enabled ? '已开启' : '已关闭' }}</div>
          <el-switch v-model="form.enabled" size="small" @change="onSwitchChange" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-title">密码最短长度</div>
          <div class="stat-value">{{ form.password.min_length }} 位</div>
          <div class="stat-sub">含大写/小写/数字要求</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-title">登录失败锁定</div>
          <div class="stat-value">{{ form.lock.max_attempts }} 次</div>
          <div class="stat-sub">锁定 {{ form.lock.lock_minutes }} 分钟</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-title">IP 白名单</div>
          <div class="stat-value">{{ form.ip_whitelist.length }} 条</div>
          <div class="stat-sub">2FA 强制：{{ form.two_fa.required ? '是' : '否' }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 策略编辑表单 -->
    <el-card shadow="never" class="mt16">
      <template #header>
        <div class="card-header">
          <span>安全策略配置</span>
          <div>
            <el-button size="small" @click="loadPolicy">刷新</el-button>
            <el-button size="small" type="danger" plain :loading="resetting" @click="handleReset">重置为默认</el-button>
            <el-button size="small" type="primary" :loading="saving" @click="handleSave">保存策略</el-button>
          </div>
        </div>
      </template>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="mb16"
        title="策略默认关闭。开启后将强制生效：弱密码注册/改密被拒绝、连续失败锁定账户、白名单外 IP 拒绝登录、2FA 强制登录校验。"
      />

      <el-form :model="form" label-width="130px" label-position="left">
        <el-divider content-position="left">密码策略</el-divider>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="最小长度">
              <el-input-number v-model="form.password.min_length" :min="6" :max="32" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="要求大写字母">
              <el-switch v-model="form.password.require_upper" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="要求小写字母">
              <el-switch v-model="form.password.require_lower" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="要求数字">
              <el-switch v-model="form.password.require_digit" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="要求特殊符号">
              <el-switch v-model="form.password.require_symbol" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="密码有效期(天)">
              <el-input-number v-model="form.password.expire_days" :min="0" :max="3650" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">登录锁定</el-divider>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="最大失败次数">
              <el-input-number v-model="form.lock.max_attempts" :min="1" :max="20" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="锁定分钟数">
              <el-input-number v-model="form.lock.lock_minutes" :min="1" :max="1440" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">IP 白名单与 2FA</el-divider>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="IP 白名单">
              <el-select
                v-model="form.ip_whitelist"
                multiple
                filterable
                allow-create
                default-first-option
                no-data-text="输入 IP 后回车添加（留空则不限制）"
                placeholder="如 127.0.0.1 / 192.168.1.0/24"
                class="w100"
              >
                <el-option v-for="ip in form.ip_whitelist" :key="ip" :label="ip" :value="ip" />
              </el-select>
              <div class="tip">配置后仅白名单内 IP 可登录；清空表示不限制。</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="强制 2FA">
              <el-switch v-model="form.two_fa.required" />
              <div class="tip">开启后，未绑定 TOTP 的用户首次登录将引导绑定，绑定后每次登录需动态验证码。</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { securityAPI } from '@/api/security'

const defaultPolicy = {
  enabled: false,
  password: { min_length: 8, require_upper: true, require_lower: true, require_digit: true, require_symbol: false, expire_days: 90 },
  lock: { max_attempts: 5, lock_minutes: 30 },
  ip_whitelist: [],
  two_fa: { required: false }
}

const form = ref(JSON.parse(JSON.stringify(defaultPolicy)))
const saving = ref(false)
const resetting = ref(false)

async function loadPolicy() {
  try {
    const res = await securityAPI.getPolicy()
    form.value = JSON.parse(JSON.stringify(res || defaultPolicy))
  } catch (e) {
    ElMessage.error('读取安全策略失败：' + (e.message || '网络错误'))
  }
}

async function handleSave() {
  saving.value = true
  try {
    const res = await securityAPI.updatePolicy(form.value)
    form.value = res
    ElMessage.success('安全策略已保存，即时生效')
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

async function handleReset() {
  try {
    await ElMessageBox.confirm('将安全策略重置为默认值（默认关闭），确定继续？', '重置确认', { type: 'warning' })
  } catch (_) {
    return
  }
  resetting.value = true
  try {
    const res = await securityAPI.resetPolicy()
    form.value = res
    ElMessage.success('已重置为默认策略')
  } catch (e) {
    ElMessage.error('重置失败：' + (e.message || '网络错误'))
  } finally {
    resetting.value = false
  }
}

function onSwitchChange(v) {
  ElMessage.info(v ? '安全策略已开启，登录/注册/改密将强制校验' : '安全策略已关闭')
}

onMounted(loadPolicy)
</script>

<style scoped>
.security-policy-page {
  padding: 4px;
}
.mt16 { margin-top: 16px; }
.mb16 { margin-bottom: 16px; }
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-card .stat-title { color: #909399; font-size: 13px; }
.stat-card .stat-value { font-size: 22px; font-weight: 600; margin: 8px 0 6px; color: #303133; }
.stat-card.active .stat-value { color: #67C23A; }
.stat-card .stat-sub { color: #909399; font-size: 12px; }
.tip { color: #909399; font-size: 12px; line-height: 1.6; margin-top: 4px; }
.w100 { width: 100%; }
</style>
