<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">音频生成</h2>
      <p class="tool-desc">使用AI生成背景音乐和音效</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="音频风格">
            <el-select v-model="style" placeholder="选择风格">
              <el-option label="欢快" value="happy" />
              <el-option label="悲伤" value="sad" />
              <el-option label="紧张" value="tense" />
              <el-option label="轻松" value="relaxed" />
              <el-option label="悬疑" value="mysterious" />
            </el-select>
          </el-form-item>
          <el-form-item label="时长">
            <el-select v-model="duration" placeholder="选择时长">
              <el-option label="30秒" value="30" />
              <el-option label="1分钟" value="60" />
              <el-option label="2分钟" value="120" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="generate">生成音频</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const style = ref('')
const duration = ref('60')
const loading = ref(false)

function generate() {
  if (!style.value) {
    ElMessage.warning('请选择音频风格')
    return
  }
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('音频生成成功')
  }, 3000)
}
</script>

<style scoped>
.tool-page {
  padding: 24px;
}

.tool-header {
  margin-bottom: 24px;
}

.tool-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
  color: #303133;
}

.tool-desc {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.tool-content {
  max-width: 800px;
}

.tool-card {
  border-radius: 12px;
}
</style>