<template>
  <div class="page-wrap">
    <el-card shadow="never" class="form-card">
      <template #header>
        <div class="card-head">
          <span>站点品牌设置</span>
          <el-button type="primary" size="small" :loading="saving" @click="save">保存设置</el-button>
        </div>
      </template>
      <el-form v-if="ready" :model="form" label-width="110px" style="max-width: 640px">
        <el-form-item label="站点名称" required>
          <el-input v-model="form.name" size="small" placeholder="站点显示名称" />
        </el-form-item>
        <el-form-item label="Logo URL">
          <el-input v-model="form.logo" size="small" placeholder="Logo 图片地址（留空使用默认）" />
        </el-form-item>
        <el-form-item label="站点 Slogan">
          <el-input v-model="form.slogan" size="small" placeholder="一句话介绍" />
        </el-form-item>
        <el-form-item label="ICP 备案号">
          <el-input v-model="form.icp" size="small" placeholder="如 粤ICP备xxxxxxxx号" />
        </el-form-item>
        <el-form-item label="版权信息">
          <el-input v-model="form.copyright" size="small" />
        </el-form-item>
        <el-form-item label="联系邮箱">
          <el-input v-model="form.contact_email" size="small" />
        </el-form-item>
        <el-form-item label="客服电话">
          <el-input v-model="form.service_phone" size="small" />
        </el-form-item>
        <el-form-item label="页脚文案">
          <el-input v-model="form.footer_text" type="textarea" :rows="2" size="small" />
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
    const res = await siteAPI.getBrand()
    form.value = { ...res }
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    ready.value = true
  }
}

async function save() {
  if (!form.value.name || !form.value.name.trim()) return ElMessage.warning('站点名称不能为空')
  saving.value = true
  try {
    await siteAPI.saveBrand(form.value)
    ElMessage.success('站点品牌已保存')
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
