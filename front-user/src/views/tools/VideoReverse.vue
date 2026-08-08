<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">反推视频</h2>
      <p class="tool-desc">从视频反推剧情文案和分镜脚本</p>
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
            <el-button type="primary" :loading="loading" @click="reverse">开始反推</el-button>
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

function reverse() {
  if (!fileName.value) {
    ElMessage.warning('请上传视频文件')
    return
  }
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('视频反推成功')
  }, 10000)
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