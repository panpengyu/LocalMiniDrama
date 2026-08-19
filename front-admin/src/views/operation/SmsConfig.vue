<template>
  <div class="page-wrap">
    <el-card shadow="never" class="form-card">
      <template #header>
        <div class="card-head">
          <span>短信服务配置</span>
          <el-button type="primary" size="small" :loading="saving" @click="save">保存配置</el-button>
        </div>
      </template>
      <el-form v-if="ready" :model="form" label-width="120px" style="max-width: 640px">
        <el-form-item label="启用短信">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="服务商">
          <el-select v-model="form.provider" size="small" style="width: 220px">
            <el-option label="未接入" value="none" />
            <el-option label="阿里云短信" value="aliyun" />
            <el-option label="腾讯云短信" value="tencent" />
            <el-option label="自定义 HTTP" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="Access Key">
          <el-input v-model="form.access_key" size="small" placeholder="已保存密钥不回显，**** 表示沿用" />
        </el-form-item>
        <el-form-item label="Access Secret">
          <el-input v-model="form.access_secret" type="password" show-password size="small" placeholder="已保存密钥不回显，**** 表示沿用" />
        </el-form-item>
        <el-form-item label="短信签名">
          <el-input v-model="form.sign" size="small" placeholder="如 【本地短剧助手】" />
        </el-form-item>
        <el-form-item label="验证码模板 ID">
          <el-input v-model="form.template_id" size="small" placeholder="验证码短信模板编号" />
        </el-form-item>
        <el-form-item label="验证码有效期(秒)">
          <el-input-number v-model="form.verify_code_expire_sec" :min="60" :max="3600" size="small" />
        </el-form-item>
        <el-alert type="info" :closable="false" title="说明：短信验证码用于用户注册/找回密码等场景；未接入时系统自动降级为邮箱验证或验证码日志展示。" style="margin-top: 8px" />
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { siteAPI } from '@/api/site'

const form = ref({})
const ready = ref(false)
const saving = ref(false)

async function load() {
  try {
    const res = await siteAPI.getSms()
    form.value = {
      provider: res?.provider || 'none',
      enabled: !!res?.enabled,
      sign: res?.sign || '',
      template_id: res?.template_id || '',
      access_key: res?.access_key || '',
      access_secret: res?.access_secret || '',
      verify_code_expire_sec: res?.verify_code_expire_sec || 300
    }
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    ready.value = true
  }
}

async function save() {
  saving.value = true
  try {
    await siteAPI.saveSms(form.value)
    ElMessage.success('短信配置已保存')
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap { padding: 16px; }
.form-card { max-width: 860px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
</style>
