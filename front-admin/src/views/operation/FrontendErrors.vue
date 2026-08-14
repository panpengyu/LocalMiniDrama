<template>
  <div class="frontend-errors-page">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#f56c6c"><Warning /></el-icon>
          <span>前端错误监控</span>
          <span class="subtitle">采集用户端 / 管理端页面 JS 运行错误，数据来自 MySQL frontend_error_logs</span>
        </div>
        <div class="toolbar-actions">
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
          <el-button type="primary" :icon="DataLine" @click="loadSummary">拉取统计</el-button>
        </div>
      </div>

      <!-- 筛选 -->
      <el-form :inline="true" :model="filter" size="default" style="margin-top: 12px">
        <el-form-item label="错误级别">
          <el-select v-model="filter.level" placeholder="全部" clearable style="width: 130px">
            <el-option label="Error" value="error" />
            <el-option label="Warning" value="warning" />
            <el-option label="Info" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="filter.category" placeholder="全部" clearable style="width: 170px">
            <el-option label="window_error（JS错误）" value="window_error" />
            <el-option label="unhandledrejection" value="unhandledrejection" />
            <el-option label="vue_error（Vue错误）" value="vue_error" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 概览统计（来自 /admin/monitor/ops 的真实数据） -->
    <el-row :gutter="16" style="margin-top: 16px" v-if="summary && (summary.frontend || summary.frontend_errors)">
      <el-col :span="8">
        <el-card shadow="never">
          <div class="stat-item">
            <div class="stat-num" style="color: #f56c6c">{{ feTotal }}</div>
            <div class="stat-label">近 1 小时前端错误总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <div class="stat-item">
            <div class="stat-num" style="color: #8b5cf6">{{ feCategories.length }}</div>
            <div class="stat-label">涉及错误类别</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <div class="stat-item">
            <div class="stat-num" style="color: #409eff">{{ topCategory }}</div>
            <div class="stat-label">最高频类别</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" style="margin-top: 16px" v-else>
      <div class="stat-item">
        <div class="stat-num" style="color: #94a3b8; font-size: 16px">暂无统计数据（点击「拉取统计」获取全链路快照）</div>
      </div>
    </el-card>

    <!-- 错误列表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table v-loading="loading" :data="items" stripe border row-key="id" height="55vh">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="levelTag(row.level)" size="small">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="170">
          <template #default="{ row }">{{ categoryLabel(row.category) }}</template>
        </el-table-column>
        <el-table-column label="错误信息" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">{{ row.message }}</template>
        </el-table-column>
        <el-table-column label="页面 URL" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-muted">{{ row.page_url || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户" width="110">
          <template #default="{ row }">{{ row.user_id ? `#${row.user_id}` : '匿名' }}</template>
        </el-table-column>
        <el-table-column label="发生时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top: 14px; justify-content: flex-end"
        background
        layout="total, prev, pager, next, sizes"
        :total="total"
        :page-size="filter.page_size"
        :page-sizes="[20, 50, 100]"
        v-model:current-page="filter.page"
        @current-change="loadList"
        @size-change="loadList"
      />
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="前端错误详情" size="560px" destroy-on-close>
      <el-descriptions v-if="current" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ current.id }}</el-descriptions-item>
        <el-descriptions-item label="级别">
          <el-tag :type="levelTag(current.level)" size="small">{{ current.level }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="类别">{{ categoryLabel(current.category) }}</el-descriptions-item>
        <el-descriptions-item label="用户">{{ current.user_id ? `#${current.user_id}` : '匿名' }}</el-descriptions-item>
        <el-descriptions-item label="页面 URL">{{ current.page_url || '-' }}</el-descriptions-item>
        <el-descriptions-item label="错误信息">{{ current.message }}</el-descriptions-item>
        <el-descriptions-item label="来源">{{ current.source || '-' }}</el-descriptions-item>
        <el-descriptions-item label="行列">{{ current.lineno ? `${current.lineno}:${current.colno}` : '-' }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{ fmtTime(current.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="堆栈">
          <pre class="stack-pre">{{ current.stack || '-' }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="元信息" v-if="current.meta">
          <pre class="stack-pre">{{ current.meta }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Refresh, Warning, DataLine } from '@element-plus/icons-vue'
import { opsAPI } from '@/api/ops'

const loading = ref(false)
const items = ref([])
const total = ref(0)
const summary = ref(null)
const filter = reactive({ page: 1, page_size: 20, level: '', category: '' })
const detailVisible = ref(false)
const current = ref(null)

function levelTag(l) {
  return { error: 'danger', warning: 'warning', info: 'info' }[l] || 'info'
}
function categoryLabel(c) {
  return { window_error: 'window_error（JS错误）', unhandledrejection: 'unhandledrejection', vue_error: 'vue_error（Vue错误）' }[c] || c
}
function fmtTime(v) { return v ? String(v).replace('T', ' ').slice(0, 19) : '-' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: filter.page, page_size: filter.page_size }
    if (filter.level) params.level = filter.level
    if (filter.category) params.category = filter.category
    const res = await opsAPI.frontendErrors(params)
    items.value = res?.items || []
    total.value = res?.total || 0
  } catch (e) { /* 拦截器已提示 */ } finally { loading.value = false }
}

const feTotal = computed(() => summary.value?.frontend?.hourly_total ?? summary.value?.frontend_errors?.hourly_total ?? 0)
const feCategories = computed(() => summary.value?.frontend?.by_category ?? summary.value?.frontend_errors?.by_category ?? [])
const topCategory = computed(() => {
  const arr = feCategories.value
  if (!arr?.length) return '-'
  return `${arr[0].category}（${arr[0].count}）`
})

async function loadSummary() {
  try {
    const res = await opsAPI.ops()
    summary.value = res
  } catch (e) { /* 拦截器已提示 */ }
}

function openDetail(row) {
  current.value = row
  detailVisible.value = true
}

onMounted(() => {
  loadList()
  loadSummary()
})
</script>

<style scoped>
.frontend-errors-page { padding: 4px; }
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 13px;
  font-weight: 400;
  color: #94a3b8;
}
.toolbar-actions { display: flex; gap: 10px; }
.text-muted { color: #94a3b8; }
.stat-item { text-align: center; padding: 8px 0; }
.stat-num { font-size: 30px; font-weight: 700; }
.stat-label { margin-top: 4px; font-size: 13px; color: #94a3b8; }
.stack-pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
