<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">视频生成</h2>
      <p class="tool-desc">使用AI生成短视频</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="视频描述">
            <el-input v-model="description" type="textarea" :rows="4" placeholder="输入视频内容描述..." />
          </el-form-item>
          <el-form-item label="视频时长">
            <el-select v-model="duration" placeholder="选择时长">
              <el-option label="5秒" value="5" />
              <el-option label="10秒" value="10" />
              <el-option label="15秒" value="15" />
              <el-option label="30秒" value="30" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="generate">生成视频</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const description = ref('')
const duration = ref('10')
const loading = ref(false)

function generate() {
  if (!description.value) {
    ElMessage.warning('请输入视频描述')
    return
  }
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('视频生成成功')
  }, 5000)
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