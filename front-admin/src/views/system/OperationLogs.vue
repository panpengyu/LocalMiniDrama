<template>
  <div class="audit-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Document /></el-icon>
          <span>操作日志</span>
          <span class="subtitle">全站管理端敏感操作审计（创建 / 更新 / 删除等写操作），含操作者、路径、状态码、来源 IP</span>
        </div>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
      </div>

      <el-row :gutter="16" v-if="stats">
        <el-col :span="8"><div class="stat-card total"><div class="label">审计总量</div><div class="value">{{ fmtInt(stats.total) }}</div></div></el-col>
        <el-col :span="8"><div class="stat-card danger"><div class="label">失败操作(状态码≥400)</div><div class="value">{{ fmtInt(stats.failures) }}</div></div></el-col>
        <el-col :span="8"><div class="stat-card action"><div class="label">Top 操作类型</div><div class="value sm">{{ topAction }}</div></div></el-col>
      </el-row>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>审计明细</span>
          <div class="filters">
            <el-input v-model="filters.keyword" placeholder="操作者/路径/动作" clearable style="width: 200px" @keyup.enter="reload" />
            <el-input v-model="filters.action" placeholder="动作(如 finance.billing-rules.create)" clearable style="width: 240px" @keyup.enter="reload" />
            <el-button type="primary" @click="reload">查询</el-button>
          </div>
        </div>
      </template>

      <el-table :data="rows" v-loading="loading" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="操作者" min-width="130">
          <template #default="{ row }">
            <span>{{ row.actor_name || '-' }}</span>
            <el-tag v-if="row.actor_role" size="small" class="ml6">{{ roleLabel(row.actor_role) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="动作" min-width="200" show-overflow-tooltip />
        <el-table-column label="方法" width="80">
          <template #default="{ row }"><el-tag :type="methodType(row.method)" size="small">{{ row.method }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="path" label="路径" min-width="220" show-overflow-tooltip />
        <el-table-column label="状态码" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="Number(row.status_code) >= 400 ? 'danger' : 'success'" size="small">{{ row.status_code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="来源 IP" width="140" show-overflow-tooltip />
        <el-table-column prop="created_at" label="时间" width="170" show-overflow-tooltip />
        <el-table-column label="详情" width="80" align="center">
          <template #default="{ row }">
            <el-button v-if="row.detail" link type="primary" size="small" @click="showDetail(row)">查看</el-button>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination background layout="total, prev, pager, next" :total="total"
          :page-size="filters.page_size" :current-page="filters.page" @current-change="onPage" />
      </div>
    </el-card>

    <el-dialog v-model="detailDialog" title="操作详情（已脱敏）" width="560px">
      <pre class="detail-json">{{ detailText }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import { securityAPI } from '@/api/security'

const loading = ref(false)
const stats = ref(null)
const rows = ref([])
const total = ref(0)
const filters = reactive({ keyword: '', action: '', page: 1, page_size: 20 })
const detailDialog = ref(false)
const detailText = ref('')

const topAction = computed(() => {
  const a = stats.value?.by_action?.[0]
  return a ? `${a.action}（${a.c}）` : '-'
})

function fmtInt(n) { return (Number(n) || 0).toLocaleString('zh-CN') }
function roleLabel(r) { return { super_admin: '超管', admin: '管理员', team_admin: '团队管理', user: '用户' }[r] || r }
function methodType(m) { return { POST: 'success', PUT: 'warning', PATCH: 'warning', DELETE: 'danger' }[m] || 'info' }

function showDetail(row) {
  try { detailText.value = JSON.stringify(JSON.parse(row.detail), null, 2) }
  catch { detailText.value = row.detail || '' }
  detailDialog.value = true
}

async function loadStats() { stats.value = await securityAPI.auditStats() }
async function loadList() {
  loading.value = true
  try {
    const params = { page: filters.page, page_size: filters.page_size }
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.action) params.action = filters.action
    const res = await securityAPI.auditLogs(params)
    rows.value = res.items || []
    total.value = res.pagination?.total || 0
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}
async function loadAll() { await Promise.all([loadStats(), loadList()]) }
function reload() { filters.page = 1; loadList() }
function onPage(p) { filters.page = p; loadList() }

loadAll()
</script>

<style scoped>
.audit-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.stat-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.stat-card.danger { background: linear-gradient(135deg, #f56c6c, #f89898); }
.stat-card.action { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card .label { font-size: 13px; opacity: 0.9; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.stat-card .value.sm { font-size: 16px; }
.list-header { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
.ml6 { margin-left: 6px; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
.detail-json { background: #f5f7fa; padding: 12px; border-radius: 6px; max-height: 400px; overflow: auto; font-size: 12px; }
</style>
