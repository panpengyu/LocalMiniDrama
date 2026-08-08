<template>
  <div class="alert-events-page">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#f56c6c"><AlarmClock /></el-icon>
          <span>告警发送历史</span>
          <span class="subtitle">查看每次告警推送的状态、错误详情，支持手动重发</span>
        </div>
        <div class="toolbar-actions">
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
      </div>

      <!-- 筛选 -->
      <el-form :inline="true" :model="filter" size="default" style="margin-top: 12px">
        <el-form-item label="状态">
          <el-select v-model="filter.status" placeholder="全部" clearable style="width: 140px">
            <el-option label="已发送（sent）" value="sent" />
            <el-option label="发送失败（failed）" value="failed" />
            <el-option label="已节流（suppressed）" value="suppressed" />
            <el-option label="待发送（pending）" value="pending" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重级别">
          <el-select v-model="filter.severity" placeholder="全部" clearable style="width: 140px">
            <el-option label="Critical" value="critical" />
            <el-option label="Warning" value="warning" />
            <el-option label="Info" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="渠道">
          <el-select v-model="filter.channel_id" placeholder="全部" clearable style="width: 180px">
            <el-option
              v-for="c in channels"
              :key="c.id"
              :label="`${c.name}（${channelLabel(c.channel_type)}）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="条数">
          <el-input-number v-model="filter.limit" :min="10" :max="500" :step="50" style="width: 120px" />
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 事件列表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table v-loading="loading" :data="events" stripe border row-key="id" height="65vh">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" effect="dark" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="severityTag(row.severity)" size="small">{{ row.severity }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="异常类型" width="180">
          <template #default="{ row }">
            <span>{{ typeLabel(row.anomaly_type) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="渠道" width="100">
          <template #default="{ row }">{{ row.channel_id }}#{{ channelName(row.channel_id) }}</template>
        </el-table-column>
        <el-table-column label="摘要" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.summary }}</span>
          </template>
        </el-table-column>
        <el-table-column label="错误详情" min-width="280">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.error_msg"
              :content="row.error_msg"
              placement="top"
              :show-after="300"
            >
              <code class="error-cell">{{ truncate(row.error_msg, 80) }}</code>
            </el-tooltip>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">
            <div>{{ fmtTime(row.sent_at) || '-' }}</div>
            <div class="text-muted" style="font-size:11px">创建: {{ fmtTime(row.created_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canResend(row)"
              size="small"
              link
              type="primary"
              :loading="resending[row.id]"
              @click="doResend(row)"
            >重发</el-button>
            <el-button size="small" link @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center">
        <span class="text-muted" style="font-size: 12px">
          共 {{ events.length }} 条（最多返回 {{ filter.limit }} 条，调整上方"条数"可加载更多）
        </span>
      </div>
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="告警事件详情" size="600px">
      <template v-if="detailRow">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="事件 ID">{{ detailRow.id }}</el-descriptions-item>
          <el-descriptions-item label="渠道">{{ detailRow.channel_id }}#{{ channelName(detailRow.channel_id) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTag(detailRow.status)" size="small">{{ statusLabel(detailRow.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="严重级别">{{ detailRow.severity }}</el-descriptions-item>
          <el-descriptions-item label="异常类型">{{ typeLabel(detailRow.anomaly_type) }}</el-descriptions-item>
          <el-descriptions-item label="摘要">{{ detailRow.summary }}</el-descriptions-item>
          <el-descriptions-item label="指纹">{{ detailRow.fingerprint }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ fmtTime(detailRow.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="发送时间">{{ fmtTime(detailRow.sent_at) || '-' }}</el-descriptions-item>
          <el-descriptions-item label="错误信息">
            <code class="error-full" v-if="detailRow.error_msg">{{ detailRow.error_msg }}</code>
            <span v-else class="text-muted">无</span>
          </el-descriptions-item>
          <el-descriptions-item label="原始 Payload">
            <pre class="payload-json">{{ JSON.stringify(detailRow.payload, null, 2) }}</pre>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlarmClock, Refresh } from '@element-plus/icons-vue'
import { alertAPI } from '@/api/alertChannels'

const loading = ref(false)
const events = ref([])
const channels = ref([])
const resending = reactive({})

const filter = reactive({
  status: '',
  severity: '',
  channel_id: '',
  limit: 100
})

// ---------- 常量 ----------
const typeLabels = {
  negative_balance:      '日志余额为负',
  negative_user_balance: '用户余额为负',
  huge_amount:           '单笔积分超大',
  balance_jump:          '余额跳变异常',
  balance_mismatch:      '用户-日志不一致'
}
function typeLabel(t) { return typeLabels[t] || t || '-' }

const statusLabels = {
  sent:       '已发送',
  failed:     '发送失败',
  suppressed: '已节流',
  pending:    '待发送'
}
function statusLabel(s) { return statusLabels[s] || s }
function statusTag(s) {
  if (s === 'sent')       return 'success'
  if (s === 'failed')     return 'danger'
  if (s === 'suppressed') return 'info'
  if (s === 'pending')    return 'warning'
  return ''
}
function severityTag(s) {
  if (s === 'critical') return 'danger'
  if (s === 'warning')  return 'warning'
  return 'info'
}

const channelTypeLabels = { dingtalk: '钉钉', wecom: '企微', feishu: '飞书' }
function channelLabel(t) { return channelTypeLabels[t] || t }
function channelName(id) {
  const c = channels.value.find((x) => x.id === id)
  return c ? `${c.name}` : '?'
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
function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

// ---------- 加载 ----------
async function loadChannels() {
  try {
    const data = await alertAPI.listChannels()
    channels.value = Array.isArray(data) ? data : []
  } catch { /* 忽略，渠道加载失败不影响事件列表 */ }
}

async function loadList() {
  loading.value = true
  try {
    const params = { limit: filter.limit }
    if (filter.status)     params.status = filter.status
    if (filter.severity)   params.severity = filter.severity
    if (filter.channel_id) params.channel_id = filter.channel_id
    const data = await alertAPI.listEvents(params)
    events.value = Array.isArray(data) ? data : []
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// 筛选变化时自动刷新
watch([() => filter.status, () => filter.severity, () => filter.channel_id, () => filter.limit], () => {
  loadList()
})

// ---------- 详情 ----------
const detailVisible = ref(false)
const detailRow = ref(null)
function openDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

// ---------- 重发 ----------
function canResend(row) {
  // 只对 failed / suppressed 的事件允许重发；sent 不需要重发
  return row.status === 'failed' || row.status === 'suppressed'
}

async function doResend(row) {
  // 从 payload 里取出原始 anomalyId
  const payload = row.payload
  const anomalyId = payload?.id
  if (!anomalyId) {
    ElMessage.warning('该事件缺少原始异常 ID，无法重发（请人工核查）')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认重发告警？\n\n异常 ID：${anomalyId}\n目标渠道：${channelName(row.channel_id)}\n\n重发会再次调用所有"已启用"渠道发送，不限于原渠道。`,
      '重发确认',
      { type: 'warning', confirmButtonText: '确认重发', cancelButtonText: '取消' }
    )
  } catch { return }

  resending[row.id] = true
  try {
    const r = await alertAPI.dispatchForAnomaly(anomalyId, {})
    const total = r?.total || 0
    const ok = (r?.results || []).filter((x) => x.ok).length
    if (ok > 0) {
      ElMessage.success(`重发完成：${ok} 成功${total - ok ? ' / ' + (total - ok) + ' 失败' : ''}`)
    } else if (total === 0) {
      ElMessage.info('未匹配到启用的渠道')
    } else {
      ElMessage.warning(`重发失败（${total - ok} 条），请查看最新事件`)
    }
    // 刷新列表
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '重发失败')
  } finally {
    resending[row.id] = false
  }
}

onMounted(async () => {
  await loadChannels()
  await loadList()
})
</script>

<style scoped>
.alert-events-page {
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
.error-cell {
  font-family: monospace;
  font-size: 11px;
  color: #f56c6c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 260px;
}
.error-full {
  font-family: monospace;
  font-size: 12px;
  color: #f56c6c;
  white-space: pre-wrap;
  word-break: break-all;
}
.payload-json {
  font-family: monospace;
  font-size: 12px;
  background: #f5f7fa;
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}
.text-muted {
  color: #c0c4cc;
}
</style>
