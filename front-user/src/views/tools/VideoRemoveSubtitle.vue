<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">视频去字幕</h2>
      <p class="tool-desc">自动识别并去除视频中的字幕</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="上传视频">
            <el-upload
              class="upload-demo"
              drag
              :auto-upload="false"
              :on-change="handleFileChange"
            >
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">将视频文件拖到此处，或<em>点击上传</em></div>
              <template #tip>
                <div class="el-upload__tip">支持 MP4、AVI、MOV 格式</div>
              </template>
            </el-upload>
          </el-form-item>
          <el-form-item v-if="fileName" label="已选文件">
            <span>{{ fileName }}</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="remove">去除字幕</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'

const fileName = ref('')
const loading = ref(false)

function handleFileChange(file) {
  fileName.value = file.name
}

function remove() {
  if (!fileName.value) {
    ElMessage.warning('请上传视频文件')
    return
  }
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('字幕去除成功')
  }, 8000)
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