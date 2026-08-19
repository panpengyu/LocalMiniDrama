<template>
  <div class="page-wrap">
    <el-card shadow="never" class="form-card">
      <template #header>
        <div class="card-head">
          <span>服务条款配置</span>
          <el-button type="primary" size="small" :loading="saving" @click="save">保存条款</el-button>
        </div>
      </template>
      <el-form v-if="ready" :model="form" label-width="110px">
        <el-form-item label="条款标题" required>
          <el-input v-model="form.title" size="small" style="max-width: 420px" />
        </el-form-item>
        <el-form-item label="版本号">
          <el-input v-model="form.version" size="small" style="max-width: 180px" placeholder="如 v1.2" />
        </el-form-item>
        <el-form-item label="生效日期">
          <el-date-picker v-model="form.effective_at" type="date" value-format="YYYY-MM-DD" size="small" placeholder="选择生效日期" />
        </el-form-item>
        <el-form-item label="强制同意">
          <el-switch v-model="form.force_accept" />
          <span class="tip">开启后新用户注册/老用户登录需先勾选同意本条款</span>
        </el-form-item>
        <el-form-item label="条款内容">
          <el-input v-model="form.content" type="textarea" :rows="16" size="small" placeholder="输入条款正文（支持 Markdown 段落）" />
        </el-form-item>
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
    const res = await siteAPI.getTos()
    form.value = { ...res }
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    ready.value = true
  }
}

async function save() {
  if (!form.value.title || !form.value.title.trim()) return ElMessage.warning('条款标题不能为空')
  saving.value = true
  try {
    await siteAPI.saveTos(form.value)
    ElMessage.success('服务条款已保存')
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
.form-card { max-width: 960px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.tip { margin-left: 10px; color: #909399; font-size: 12px; }
</style>
