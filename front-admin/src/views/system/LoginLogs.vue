<template>
  <div class="login-log-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Key /></el-icon>
          <span>登录日志</span>
          <span class="subtitle">用户登录成功 / 失败审计，含来源 IP、客户端、失败原因，用于账号安全监控</span>
        </div>
        <div class="toolbar-actions">
          <el-select v-model="statsDays" style="width: 130px" @change="loadStats">
            <el-option :value="7" label="近 7 天" />
            <el-option :value="14" label="近 14 天" />
            <el-option :value="30" label="近 30 天" />
          </el-select>
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
        </div>
      </div>

      <el-row :gutter="16" v-if="stats">
        <el-col :span="6"><div class="stat-card total"><div class="label">登录总数</div><div class="value">{{ fmtInt(stats.total) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card success"><div class="label">成功登录</div><div class="value">{{ fmtInt(stats.success) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card danger"><div class="label">失败次数</div><div class="value">{{ fmtInt(stats.failed) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card user"><div class="label">去重登录用户</div><div class="value">{{ fmtInt(stats.unique_users) }}</div></div></el-col>
      </el-row>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>登录明细</span>
          <div class="filters">
            <el-input v-model="filters.username" placeholder="用户名 / 手机号" clearable style="width: 200px" @keyup.enter="reload" />
            <el-select v-model="filters.success" placeholder="登录结果" clearable style="width: 130px">
              <el-option :value="1" label="成功" />
              <el-option :value="0" label="失败" />
            </el-select>
            <el-button type="primary" @click="reload">查询</el-button>
          </div>
        </div>
      </template>

      <el-table :data="rows" v-loading="loading" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" min-width="150" show-overflow-tooltip />
        <el-table-column label="结果" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="Number(row.success) === 1 ? 'success' : 'danger'" size="small">
              {{ Number(row.success) === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="来源 IP" width="150" show-overflow-tooltip />
        <el-table-column prop="user_agent" label="客户端" min-width="240" show-overflow-tooltip />
        <el-table-column label="失败原因" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="Number(row.success) === 0" class="reason">{{ row.reason || '-' }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="登录时间" width="170" show-overflow-tooltip />
      </el-table>

      <div class="pager">
        <el-pagination background layout="total, prev, pager, next" :total="total"
          :page-size="filters.page_size" :current-page="filters.page" @current-change="onPage" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { Key } from '@element-plus/icons-vue'
import { securityAPI } from '@/api/security'

const loading = ref(false)
const stats = ref(null)
const statsDays = ref(7)
const rows = ref([])
const total = ref(0)
const filters = reactive({ username: '', success: '', page: 1, page_size: 20 })

function fmtInt(n) { return (Number(n) || 0).toLocaleString('zh-CN') }

async function loadStats() { stats.value = await securityAPI.loginStats(statsDays.value) }
async function loadList() {
  loading.value = true
  try {
    const params = { page: filters.page, page_size: filters.page_size }
    if (filters.username) params.username = filters.username
    if (filters.success !== '' && filters.success !== null) params.success = filters.success
    const res = await securityAPI.loginLogs(params)
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
.login-log-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.toolbar-actions { display: flex; gap: 8px; align-items: center; }
.stat-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.stat-card.success { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card.danger { background: linear-gradient(135deg, #f56c6c, #f89898); }
.stat-card.user { background: linear-gradient(135deg, #9254de, #b37feb); }
.stat-card .label { font-size: 13px; opacity: 0.9; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.list-header { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
.reason { color: #f56c6c; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
