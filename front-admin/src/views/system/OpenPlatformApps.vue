<template>
  <div class="open-platform-apps-page">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Key /></el-icon>
          <span>API 开放平台 · 开发者应用审批</span>
          <span class="subtitle">审批开发者应用申请、查看应用密钥，Sprint 15 - S15-T01</span>
        </div>
        <div class="toolbar-actions">
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
      </div>

      <!-- 筛选 -->
      <el-form :inline="true" :model="filter" size="default" style="margin-top: 12px" @submit.prevent="loadList">
        <el-form-item label="状态">
          <el-select v-model="filter.status" placeholder="全部" clearable style="width: 140px" @change="loadList">
            <el-option label="待审批（pending）" value="pending" />
            <el-option label="已通过（approved）" value="approved" />
            <el-option label="已驳回（rejected）" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="filter.keyword"
            placeholder="应用名 / 应用ID"
            clearable
            style="width: 220px"
            @keyup.enter="loadList"
            @clear="loadList"
          >
            <template #append>
              <el-button :icon="Search" @click="loadList">搜索</el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 应用列表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table v-loading="loading" :data="apps" stripe border row-key="app_id" height="62vh">
        <el-table-column prop="app_id" label="应用ID" width="180" show-overflow-tooltip />
        <el-table-column prop="name" label="应用名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="申请人" width="160">
          <template #default="{ row }">
            <div>{{ row.user_name || '未知用户' }}</div>
            <div class="text-muted" style="font-size: 11px">用户ID: {{ row.user_id }}</div>
          </template>
        </el-table-column>
        <el-table-column label="联系方式" width="140">
          <template #default="{ row }">
            <span v-if="row.user_phone">{{ row.user_phone }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" effect="dark" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="应用描述" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.description">{{ row.description }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="驳回原因" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.reject_reason" class="error-text">{{ row.reject_reason }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="申请时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" link type="success" @click="openReview(row)">审批</el-button>
            <el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pager-row">
        <span class="text-muted" style="font-size: 12px">共 {{ total }} 条</span>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="sizes, prev, pager, next, jumper"
          background
          @size-change="loadList"
          @current-change="loadList"
        />
      </div>
    </el-card>

    <!-- 审批对话框 -->
    <el-dialog v-model="reviewVisible" title="应用审批" width="520px">
      <template v-if="reviewRow">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="应用名称">{{ reviewRow.name }}</el-descriptions-item>
          <el-descriptions-item label="应用ID">{{ reviewRow.app_id }}</el-descriptions-item>
          <el-descriptions-item label="申请人">
            {{ reviewRow.user_name || '未知用户' }}（用户ID: {{ reviewRow.user_id }}）
          </el-descriptions-item>
          <el-descriptions-item label="联系方式">{{ reviewRow.user_phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="应用描述">{{ reviewRow.description || '-' }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ fmtTime(reviewRow.created_at) }}</el-descriptions-item>
        </el-descriptions>
      </template>
      <div class="review-actions">
        <el-button type="success" :loading="reviewing" @click="doReview(true)">通过</el-button>
        <el-button type="danger" :loading="reviewing" @click="doReview(false)">驳回</el-button>
      </div>
      <template #footer>
        <span class="text-muted" style="font-size: 12px">驳回时可填写原因（可选）</span>
      </template>
    </el-dialog>

    <!-- 详情对话框（含密钥列表） -->
    <el-dialog v-model="detailVisible" title="应用详情" width="860px">
      <template v-if="detailRow">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="应用名称">{{ detailRow.name }}</el-descriptions-item>
          <el-descriptions-item label="应用ID">{{ detailRow.app_id }}</el-descriptions-item>
          <el-descriptions-item label="申请人">{{ detailRow.user_name || '未知用户' }}（ID: {{ detailRow.user_id }}）</el-descriptions-item>
          <el-descriptions-item label="联系方式">{{ detailRow.user_phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTag(detailRow.status)" size="small">{{ statusLabel(detailRow.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ fmtTime(detailRow.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="应用描述" :span="2">{{ detailRow.description || '-' }}</el-descriptions-item>
          <el-descriptions-item v-if="detailRow.reject_reason" label="驳回原因" :span="2">
            <span class="error-text">{{ detailRow.reject_reason }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="keys-title">密钥列表（脱敏）</h4>
        <el-table v-loading="keysLoading" :data="keys" border stripe size="small" max-height="260">
          <el-table-column prop="key_id" label="密钥ID" width="170" show-overflow-tooltip />
          <el-table-column label="密钥" width="110">
            <template #default="{ row }">
              <code>{{ row.key_prefix }}****</code>
            </template>
          </el-table-column>
          <el-table-column label="权限范围" min-width="180">
            <template #default="{ row }">
              <el-tag v-for="s in parseScopes(row.scopes)" :key="s" size="small" style="margin-right: 4px">{{ s }}</el-tag>
              <span v-if="!parseScopes(row.scopes).length" class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="keyStatusTag(row.status)" size="small">{{ keyStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="限流/配额" width="130">
            <template #default="{ row }">
              <span>{{ row.rate_limit_per_min }}/min · {{ row.daily_quota }}/天</span>
            </template>
          </el-table-column>
          <el-table-column label="过期时间" width="160">
            <template #default="{ row }">{{ fmtTime(row.expires_at) }}</template>
          </el-table-column>
          <el-table-column label="最后使用" width="160">
            <template #default="{ row }">{{ fmtTime(row.last_used_at) || '-' }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Refresh, Search } from '@element-plus/icons-vue'
import { openPlatformAdminAPI } from '@/api/openPlatform'

const loading = ref(false)
const apps = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const filter = reactive({ status: '', keyword: '' })

// ---------- 常量 ----------
const statusLabels = { pending: '待审批', approved: '已通过', rejected: '已驳回' }
function statusLabel(s) { return statusLabels[s] || s }
function statusTag(s) {
  if (s === 'pending')  return 'warning'
  if (s === 'approved') return 'success'
  if (s === 'rejected') return 'danger'
  return 'info'
}
const keyStatusLabels = { active: '生效中', revoked: '已吊销', expired: '已过期' }
function keyStatusLabel(s) { return keyStatusLabels[s] || s }
function keyStatusTag(s) {
  if (s === 'active')  return 'success'
  if (s === 'revoked') return 'danger'
  if (s === 'expired') return 'info'
  return 'info'
}
function parseScopes(s) {
  try {
    const arr = JSON.parse(s || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

// ---------- 时间格式化 ----------
function fmtTime(t) {
  if (!t) return ''
  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return t
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch { return t }
}

// ---------- 加载 ----------
async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize.value }
    if (filter.status) params.status = filter.status
    if (filter.keyword) params.keyword = filter.keyword
    const data = await openPlatformAdminAPI.apps(params)
    apps.value = (data?.items) || []
    total.value = data?.total || 0
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// ---------- 审批 ----------
const reviewVisible = ref(false)
const reviewRow = ref(null)
const reviewing = ref(false)

function openReview(row) {
  reviewRow.value = row
  reviewVisible.value = true
}

async function doReview(approve) {
  const row = reviewRow.value
  if (!row) return
  let reason = ''
  if (!approve) {
    try {
      const { value } = await ElMessageBox.prompt('请输入驳回原因（可选，将展示给开发者）', '驳回应用', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '例如：应用信息不完整，请补充后重新提交'
      })
      reason = value || ''
    } catch { return }
  }

  reviewing.value = true
  try {
    const app = await openPlatformAdminAPI.review(row.app_id, { approve, reason })
    ElMessage.success(approve ? `已通过应用「${app.name}」` : '已驳回该应用')
    reviewVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '审批失败')
  } finally {
    reviewing.value = false
  }
}

// ---------- 详情（含密钥） ----------
const detailVisible = ref(false)
const detailRow = ref(null)
const keys = ref([])
const keysLoading = ref(false)

async function openDetail(row) {
  detailRow.value = row
  detailVisible.value = true
  keysLoading.value = true
  keys.value = []
  try {
    const data = await openPlatformAdminAPI.keys({ app_id: row.app_id })
    keys.value = Array.isArray(data) ? data : []
  } catch (e) {
    ElMessage.error(e?.message || '密钥加载失败')
  } finally {
    keysLoading.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.open-platform-apps-page {
  padding: 16px;
}
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-title .subtitle {
  color: #909399;
  font-size: 13px;
  margin-left: 8px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.pager-row {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.review-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
.keys-title {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.error-text {
  color: #f56c6c;
}
.text-muted {
  color: #c0c4cc;
}
</style>
