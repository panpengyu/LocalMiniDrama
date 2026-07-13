<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h2>欢迎回来，{{ userStore.user?.nickname || userStore.user?.username }}</h2>
      <p>以下是系统概览数据</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon user-icon">
          <el-icon><Users /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalUsers }}</div>
          <div class="stat-label">总用户数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon project-icon">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalProjects }}</div>
          <div class="stat-label">总项目数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon enterprise-icon">
          <el-icon><Box /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalEnterprises }}</div>
          <div class="stat-label">企业数量</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon team-icon">
          <el-icon><VideoPlay /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalTeams }}</div>
          <div class="stat-label">团队数量</div>
        </div>
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <h3>用户类型分布</h3>
        <div class="pie-chart">
          <div class="pie-container">
            <svg viewBox="0 0 100 100" class="pie-svg">
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#6366f1" stroke-width="20" :stroke-dasharray="`${individualPercent * 2.51} 251`" />
              <circle cx="50" cy="50" r="40" fill="transparent" stroke="#8b5cf6" stroke-width="20" :stroke-dasharray="`${enterprisePercent * 2.51} 251`" :stroke-dashoffset="`-${individualPercent * 2.51}`" />
            </svg>
          </div>
          <div class="pie-legend">
            <div class="legend-item">
              <span class="legend-dot" style="background: #6366f1"></span>
              <span>个人用户 {{ individualPercent }}%</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot" style="background: #8b5cf6"></span>
              <span>企业用户 {{ enterprisePercent }}%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <h3>项目状态分布</h3>
        <div class="bar-chart">
          <div class="bar-item">
            <span class="bar-label">草稿</span>
            <div class="bar-track">
              <div class="bar-fill draft" :style="{ width: `${(stats.draftProjects / stats.totalProjects) * 100 || 0}%` }"></div>
            </div>
            <span class="bar-value">{{ stats.draftProjects }}</span>
          </div>
          <div class="bar-item">
            <span class="bar-label">已发布</span>
            <div class="bar-track">
              <div class="bar-fill published" :style="{ width: `${(stats.publishedProjects / stats.totalProjects) * 100 || 0}%` }"></div>
            </div>
            <span class="bar-value">{{ stats.publishedProjects }}</span>
          </div>
          <div class="bar-item">
            <span class="bar-label">生成中</span>
            <div class="bar-track">
              <div class="bar-fill generating" :style="{ width: `${(stats.generatingProjects / stats.totalProjects) * 100 || 0}%` }"></div>
            </div>
            <span class="bar-value">{{ stats.generatingProjects }}</span>
          </div>
          <div class="bar-item">
            <span class="bar-label">已归档</span>
            <div class="bar-track">
              <div class="bar-fill archived" :style="{ width: `${(stats.archivedProjects / stats.totalProjects) * 100 || 0}%` }"></div>
            </div>
            <span class="bar-value">{{ stats.archivedProjects }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="recent-section">
      <h3>最近创建的项目</h3>
      <el-table :data="recentProjects" border stripe>
        <el-table-column prop="title" label="项目名称" min-width="200" />
        <el-table-column prop="creator" label="创建者" width="120">
          <template #default="{ row }">{{ row.creator?.nickname || row.creator?.username || '未知' }}</template>
        </el-table-column>
        <el-table-column prop="updated_at" label="创建时间" width="180">
          <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">{{ formatStatus(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { User, FolderOpened, Box, VideoPlay } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const loading = ref(false)
const stats = ref({
  totalUsers: 0,
  totalProjects: 0,
  totalEnterprises: 0,
  totalTeams: 0,
  draftProjects: 0,
  publishedProjects: 0,
  generatingProjects: 0,
  archivedProjects: 0,
  individualUsers: 0,
  enterpriseUsers: 0
})
const recentProjects = ref([])

const individualPercent = computed(() => {
  const total = stats.value.individualUsers + stats.value.enterpriseUsers
  return total ? Math.round((stats.value.individualUsers / total) * 100) : 0
})

const enterprisePercent = computed(() => 100 - individualPercent.value)

async function loadStats() {
  loading.value = true
  try {
    const response = await fetch('/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      stats.value = data.data
    }
  } catch (error) {
    console.error('加载统计数据失败', error)
  } finally {
    loading.value = false
  }
}

async function loadRecentProjects() {
  try {
    const response = await fetch('/api/v1/dramas?page=1&page_size=5', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      recentProjects.value = data.data.items
    }
  } catch (error) {
    console.error('加载最近项目失败', error)
  }
}

function formatStatus(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档', generating: '生成中' }
  return map[status] || status || '草稿'
}

function getStatusType(status) {
  const map = { draft: 'info', published: 'success', archived: 'warning', generating: 'primary' }
  return map[status] || 'info'
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN')
}

loadStats()
loadRecentProjects()
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.dashboard-header {
  margin-bottom: 24px;
}

.dashboard-header h2 {
  margin: 0;
  font-size: 24px;
  color: #1e1b4b;
}

.dashboard-header p {
  margin: 8px 0 0;
  color: #64748b;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #fff;
}

.user-icon { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); }
.project-icon { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
.enterprise-icon { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
.team-icon { background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%); }

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #1e1b4b;
}

.stat-label {
  font-size: 14px;
  color: #64748b;
  margin-top: 4px;
}

.charts-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.chart-card h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: #334155;
}

.pie-chart {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.pie-container {
  width: 120px;
  height: 120px;
}

.pie-svg {
  transform: rotate(-90deg);
}

.pie-legend {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bar-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bar-label {
  width: 60px;
  font-size: 13px;
  color: #64748b;
}

.bar-track {
  flex: 1;
  height: 16px;
  background: #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 8px;
  transition: width 0.3s;
}

.bar-fill.draft { background: #3b82f6; }
.bar-fill.published { background: #22c55e; }
.bar-fill.generating { background: #f59e0b; }
.bar-fill.archived { background: #94a3b8; }

.bar-value {
  width: 40px;
  text-align: right;
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}

.recent-section {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.recent-section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: #334155;
}
</style>