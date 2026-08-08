<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">剧情拆分</h2>
      <p class="tool-desc">将完整剧本拆分为分镜脚本</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card">
        <el-form label-width="120px">
          <el-form-item label="剧本内容">
            <el-input v-model="script" type="textarea" :rows="6" placeholder="输入剧本内容..." />
          </el-form-item>
          <el-form-item label="分镜数量">
            <el-select v-model="frameCount" placeholder="选择数量">
              <el-option label="5镜" value="5" />
              <el-option label="10镜" value="10" />
              <el-option label="15镜" value="15" />
              <el-option label="20镜" value="20" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="split">拆分剧情</el-button>
          </el-form-item>
          <el-form-item v-if="frames.length" label="分镜结果">
            <div class="frames-list">
              <div v-for="(frame, idx) in frames" :key="idx" class="frame-item">
                <span class="frame-number">{{ idx + 1 }}</span>
                <span class="frame-content">{{ frame }}</span>
              </div>
            </div>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const script = ref('')
const frameCount = ref('10')
const frames = ref([])
const loading = ref(false)

function split() {
  if (!script.value) {
    ElMessage.warning('请输入剧本内容')
    return
  }
  loading.value = true
  setTimeout(() => {
    frames.value = Array.from({ length: parseInt(frameCount.value) }, (_, i) => 
      `分镜${i + 1}：根据剧本内容生成的第${i + 1}镜画面描述`
    )
    loading.value = false
    ElMessage.success('剧情拆分成功')
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

.frames-list {
  max-height: 300px;
  overflow-y: auto;
}

.frame-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.frame-item:last-child {
  border-bottom: none;
}

.frame-number {
  font-weight: 600;
  color: #667eea;
  flex-shrink: 0;
}

.frame-content {
  font-size: 14px;
  color: #606266;
}
</style>