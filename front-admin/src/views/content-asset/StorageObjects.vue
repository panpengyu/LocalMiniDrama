<template>
  <div class="storage-page">
    <!-- 顶部：统计卡片 + 后端健康 + 操作 -->
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Files /></el-icon>
          <span>存储对象管理</span>
          <span class="subtitle">统一追踪本地 / 对象存储中的所有素材文件，支持生命周期归档与后端健康检查</span>
        </div>
        <div class="actions">
          <el-tag v-if="health" :type="health.ok ? 'success' : 'danger'" effect="dark">
            后端：{{ health.type }} · {{ health.ok ? '健康' : '不可用' }}
          </el-tag>
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
          <el-popconfirm
            title="将超期未访问的活跃对象标记为归档（不删物理文件），确认执行？"
            @confirm="doLifecycleScan"
          >
            <template #reference>
              <el-button type="warning" :loading="scanning">生命周期扫描</el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>

      <el-row :gutter="16" v-if="stats">
        <el-col :span="6">
          <div class="stat-card total">
            <div class="label">对象总数（有效）</div>
            <div class="value">{{ fmtInt(stats.total.objects) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card size">
            <div class="label">占用空间</div>
            <div class="value">{{ fmtBytes(stats.total.bytes) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card archived">
            <div class="label">归档对象</div>
            <div class="value">{{ fmtInt(lifecycleCount('archived')) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card deleted">
            <div class="label">已删除记录</div>
            <div class="value">{{ fmtInt(lifecycleCount('deleted')) }}</div>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="16" v-if="stats && stats.by_backend.length" style="margin-top:8px">
        <el-col :span="24">
          <div class="backend-line">
            <span class="backend-title">各后端分布：</span>
            <el-tag
              v-for="b in stats.by_backend"
              :key="b.backend"
              class="backend-tag"
              type="info"
              effect="plain"
            >
              {{ b.backend }}：{{ fmtInt(b.objects) }} 个 / {{ fmtBytes(b.bytes) }}
            </el-tag>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 过滤 + 列表 -->
    <el-card class="list-card" shadow="never">
      <el-form :inline="true" :model="filters" size="default">
        <el-form-item label="后端">
          <el-select v-model="filters.backend" placeholder="全部" clearable style="width: 140px" @change="reload">
            <el-option v-for="b in backendOptions" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="生命周期">
          <el-select v-model="filters.lifecycle" placeholder="全部" clearable style="width: 140px" @change="reload">
            <el-option label="活跃 active" value="active" />
            <el-option label="归档 archived" value="archived" />
            <el-option label="已删除 deleted" value="deleted" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目 ID">
          <el-input v-model="filters.drama_id" placeholder="drama_id" clearable style="width: 120px" @keyup.enter="reload" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reload">查询</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="rows" v-loading="loading" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="backend" label="后端" width="90" />
        <el-table-column prop="category" label="分类" width="110" />
        <el-table-column prop="object_key" label="对象路径" min-width="260" show-overflow-tooltip />
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ fmtBytes(row.size_bytes) }}</template>
        </el-table-column>
        <el-table-column prop="mime_type" label="类型" width="130" show-overflow-tooltip />
        <el-table-column label="生命周期" width="110">
          <template #default="{ row }">
            <el-tag :type="lifecycleTagType(row.lifecycle)" size="small">{{ row.lifecycle }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="drama_id" label="项目" width="80" />
        <el-table-column prop="last_access_at" label="最近访问" width="170" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="preview(row)">预览</el-button>
            <el-popconfirm title="逻辑删除该对象记录（不删物理文件）？" @confirm="doDelete(row)">
              <template #reference>
                <el-button link type="danger" size="small" :disabled="row.lifecycle === 'deleted'">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :total="total"
          :page-size="filters.page_size"
          :current-page="filters.page"
          :page-sizes="[20, 50, 100]"
          @current-change="onPage"
          @size-change="onSize"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Files } from '@element-plus/icons-vue'
import { storageAPI } from '@/api/storage'

const loading = ref(false)
const scanning = ref(false)
const stats = ref(null)
const health = ref(null)
const rows = ref([])
const total = ref(0)

const filters = reactive({
  backend: '',
  lifecycle: '',
  drama_id: '',
  page: 1,
  page_size: 20
})

const backendOptions = computed(() => {
  if (!stats.value) return ['local', 'minio', 'oss', 'cos']
  const set = new Set(stats.value.by_backend.map((b) => b.backend))
  ;['local', 'minio', 'oss', 'cos'].forEach((b) => set.add(b))
  return Array.from(set)
})

function fmtInt(n) {
  return (Number(n) || 0).toLocaleString('zh-CN')
}
function fmtBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB'
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
function lifecycleCount(life) {
  if (!stats.value) return 0
  const hit = stats.value.by_lifecycle.find((x) => x.lifecycle === life)
  return hit ? hit.objects : 0
}
function lifecycleTagType(life) {
  return life === 'active' ? 'success' : life === 'archived' ? 'warning' : 'info'
}

async function loadStats() {
  const res = await storageAPI.getStats()
  stats.value = res.data
}
async function loadHealth() {
  try {
    const res = await storageAPI.health()
    health.value = res.data
  } catch (e) {
    health.value = { type: 'unknown', ok: false }
  }
}
async function loadList() {
  loading.value = true
  try {
    const params = { page: filters.page, page_size: filters.page_size }
    if (filters.backend) params.backend = filters.backend
    if (filters.lifecycle) params.lifecycle = filters.lifecycle
    if (filters.drama_id) params.drama_id = filters.drama_id
    const res = await storageAPI.listObjects(params)
    rows.value = res.data.items || []
    total.value = res.data.pagination?.total || 0
  } finally {
    loading.value = false
  }
}
async function loadAll() {
  await Promise.all([loadStats(), loadHealth(), loadList()])
}
function reload() {
  filters.page = 1
  loadList()
  loadStats()
}
function onPage(p) {
  filters.page = p
  loadList()
}
function onSize(s) {
  filters.page_size = s
  filters.page = 1
  loadList()
}
async function doLifecycleScan() {
  scanning.value = true
  try {
    const res = await storageAPI.lifecycleScan(90)
    ElMessage.success(`扫描完成：共 ${res.data.scanned} 个，归档 ${res.data.archived} 个`)
    await loadAll()
  } catch (e) {
    ElMessage.error(e?.message || '扫描失败')
  } finally {
    scanning.value = false
  }
}
async function doDelete(row) {
  try {
    await storageAPI.deleteObject(row.id)
    ElMessage.success('已逻辑删除')
    await loadAll()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}
function preview(row) {
  if (row.url) window.open(row.url, '_blank')
  else ElMessage.warning('该对象无可访问 URL')
}

onMounted(loadAll)
</script>

<style scoped>
.storage-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 16px;
}
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stat-card {
  border-radius: 10px;
  padding: 16px;
  color: #fff;
  background: linear-gradient(135deg, #409eff, #66b1ff);
}
.stat-card.size {
  background: linear-gradient(135deg, #67c23a, #85ce61);
}
.stat-card.archived {
  background: linear-gradient(135deg, #e6a23c, #ebb563);
}
.stat-card.deleted {
  background: linear-gradient(135deg, #909399, #a6a9ad);
}
.stat-card .label {
  font-size: 13px;
  opacity: 0.9;
}
.stat-card .value {
  font-size: 26px;
  font-weight: 700;
  margin-top: 6px;
}
.backend-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.backend-title {
  color: #606266;
  font-size: 13px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
