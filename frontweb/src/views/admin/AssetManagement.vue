<template>
  <div class="asset-management">
    <div class="page-header">
      <h2>资产管理</h2>
      <div class="header-actions">
        <el-input v-model="searchKeyword" placeholder="搜索文件名称" clearable style="width: 240px" @input="debouncedLoadAssets" />
        <el-select v-model="filterType" placeholder="按类型筛选" clearable style="width: 140px" @change="loadAssets">
          <el-option label="图片" value="image" />
          <el-option label="视频" value="video" />
          <el-option label="音频" value="audio" />
          <el-option label="文档" value="document" />
        </el-select>
        <el-button type="primary" @click="handleUpload">
          <el-icon><Upload /></el-icon>上传文件
        </el-button>
      </div>
    </div>

    <div class="asset-stats">
      <div class="stat-item">
        <span class="stat-num">{{ stats.total }}</span>
        <span class="stat-text">总文件</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ stats.image }}</span>
        <span class="stat-text">图片</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ stats.video }}</span>
        <span class="stat-text">视频</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ stats.audio }}</span>
        <span class="stat-text">音频</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ stats.document }}</span>
        <span class="stat-text">文档</span>
      </div>
      <div class="stat-item">
        <span class="stat-num">{{ formatSize(stats.totalSize) }}</span>
        <span class="stat-text">总大小</span>
      </div>
    </div>

    <div class="asset-grid">
      <div v-for="asset in assets" :key="asset.id" class="asset-card">
        <div class="asset-preview" @click="previewAsset(asset)">
          <el-image v-if="isImage(asset)" :src="getAssetUrl(asset)" fit="cover" />
          <div v-else class="asset-icon">
            <el-icon><VideoPlay v-if="isVideo(asset)" /><Microphone v-else-if="isAudio(asset)" /><Document v-else /></el-icon>
          </div>
        </div>
        <div class="asset-info">
          <p class="asset-name" :title="asset.filename">{{ truncate(asset.filename, 20) }}</p>
          <p class="asset-meta">{{ formatSize(asset.size) }} · {{ formatDate(asset.created_at) }}</p>
        </div>
        <div class="asset-actions">
          <el-button size="small" icon="download" @click="downloadAsset(asset)" />
          <el-button size="small" icon="delete" type="danger" @click="handleDelete(asset)" />
        </div>
      </div>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[12, 24, 48]"
      layout="total, sizes, prev, pager, next"
      @current-change="loadAssets"
      @size-change="loadAssets"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, VideoPlay, Microphone, Document } from '@element-plus/icons-vue'

const loading = ref(false)
const assets = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(24)
const searchKeyword = ref('')
const filterType = ref('')
const stats = ref({
  total: 0,
  image: 0,
  video: 0,
  audio: 0,
  document: 0,
  totalSize: 0
})

let searchTimer = null

async function loadAssets() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      page_size: pageSize.value
    })
    if (searchKeyword.value) {
      params.append('keyword', searchKeyword.value)
    }
    if (filterType.value) {
      params.append('type', filterType.value)
    }
    const response = await fetch(`/api/v1/assets?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      assets.value = data.data.items
      total.value = data.data.pagination.total
    }
  } catch (error) {
    ElMessage.error('加载资产失败')
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const response = await fetch('/api/v1/assets/stats', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      stats.value = data.data
    }
  } catch (error) {
    console.error('加载统计数据失败', error)
  }
}

function debouncedLoadAssets() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadAssets()
  }, 300)
}

function isImage(asset) {
  return asset.mime_type?.startsWith('image/')
}

function isVideo(asset) {
  return asset.mime_type?.startsWith('video/')
}

function isAudio(asset) {
  return asset.mime_type?.startsWith('audio/')
}

function getAssetUrl(asset) {
  return `/static/${asset.filepath}`
}

function previewAsset(asset) {
  if (isImage(asset)) {
    ElMessage.info(`预览图片: ${asset.filename}`)
  } else {
    ElMessage.info(`预览文件: ${asset.filename}`)
  }
}

function downloadAsset(asset) {
  window.open(getAssetUrl(asset), '_blank')
}

async function handleDelete(asset) {
  try {
    await ElMessageBox.confirm(`确定删除文件「${asset.filename}」吗？`, '删除确认', { type: 'warning' })
    await fetch(`/api/v1/assets/${asset.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    ElMessage.success('删除成功')
    loadAssets()
    loadStats()
  } catch {
  }
}

function handleUpload() {
  ElMessage.info('请使用媒体素材库页面上传文件')
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function truncate(str, len) {
  return str.length > len ? str.substring(0, len) + '...' : str
}

loadAssets()
loadStats()
</script>

<style scoped>
.asset-management {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #1e1b4b;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.asset-stats {
  display: flex;
  gap: 24px;
  padding: 16px 20px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #4f46e5;
}

.stat-text {
  font-size: 13px;
  color: #64748b;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.asset-card {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: transform 0.2s, box-shadow 0.2s;
}

.asset-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.asset-preview {
  height: 140px;
  overflow: hidden;
  cursor: pointer;
}

.asset-preview img {
  width: 100%;
  height: 100%;
}

.asset-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  font-size: 48px;
  color: #64748b;
}

.asset-info {
  padding: 12px;
}

.asset-name {
  margin: 0 0 8px;
  font-size: 13px;
  color: #1e1b4b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-meta {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
}

.asset-actions {
  padding: 0 12px 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>