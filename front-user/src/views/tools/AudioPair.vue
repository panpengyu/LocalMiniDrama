<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">音频成对</h2>
      <p class="tool-desc">为视频匹配最合适的音频素材</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="视频描述">
            <el-input v-model="videoDesc" type="textarea" :rows="3" placeholder="描述视频内容..." />
          </el-form-item>
          <el-form-item label="情感风格">
            <el-select v-model="emotion" placeholder="选择情感">
              <el-option label="欢乐" value="joy" />
              <el-option label="悲伤" value="sadness" />
              <el-option label="激动" value="excited" />
              <el-option label="平静" value="calm" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="match">匹配音频</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const videoDesc = ref('')
const emotion = ref('')
const loading = ref(false)

function match() {
  if (!videoDesc.value) {
    ElMessage.warning('请输入视频描述')
    return
  }
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('音频匹配成功')
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