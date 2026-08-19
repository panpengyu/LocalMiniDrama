<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>版本日志</span>
          <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
      <el-alert type="info" :closable="false" style="margin-bottom: 12px"
        title="此处展示仓库 CHANGELOG.md 内容，发布流程中由维护者更新，仅只读预览。" />
      <div v-if="content" class="md-view">{{ content }}</div>
      <el-skeleton v-else-if="loading" :rows="12" animated />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { siteAPI } from '@/api/site'

const content = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await siteAPI.getChangelog()
    content.value = res?.content || ''
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap { padding: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.md-view { white-space: pre-wrap; font-size: 13px; line-height: 1.8; color: #303133; background: #fafafa; border: 1px solid #ebeef5; border-radius: 6px; padding: 16px; max-height: 70vh; overflow: auto; }
</style>
