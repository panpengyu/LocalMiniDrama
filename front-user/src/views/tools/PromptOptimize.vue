<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">提示词优化</h2>
      <p class="tool-desc">优化您的AI提示词，提升生成效果</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="原始提示词">
            <el-input v-model="originalPrompt" type="textarea" :rows="4" placeholder="输入原始提示词..." />
          </el-form-item>
          <el-form-item label="目标风格">
            <el-select v-model="targetStyle" placeholder="选择目标风格">
              <el-option label="写实" value="realistic" />
              <el-option label="卡通" value="cartoon" />
              <el-option label="抽象" value="abstract" />
              <el-option label="古风" value="ancient" />
              <el-option label="科幻" value="sci-fi" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="optimize">优化提示词</el-button>
          </el-form-item>
          <el-form-item v-if="optimizedPrompt" label="优化结果">
            <el-input v-model="optimizedPrompt" type="textarea" :rows="4" readonly />
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const originalPrompt = ref('')
const targetStyle = ref('')
const optimizedPrompt = ref('')
const loading = ref(false)

function optimize() {
  if (!originalPrompt.value) {
    ElMessage.warning('请输入原始提示词')
    return
  }
  loading.value = true
  setTimeout(() => {
    optimizedPrompt.value = `【优化后】${originalPrompt.value}，风格：${targetStyle.value || '默认'}，高质量，细节丰富，专业级`
    loading.value = false
    ElMessage.success('提示词优化成功')
  }, 2000)
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