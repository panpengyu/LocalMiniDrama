<template>
  <div class="lifecycle-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><DataLine /></el-icon>
          <span>用户生命周期管理</span>
          <span class="subtitle">基于真实行为、消费、登录数据计算健康分 / 生命周期阶段 / 流失预警</span>
        </div>
        <div class="actions">
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
          <el-button type="primary" :loading="recomputing" @click="doRecompute">重算画像</el-button>
        </div>
      </div>

      <el-row :gutter="16" v-if="ov">
        <el-col :span="6">
          <div class="stat-card total"><div class="label">画像用户总数</div><div class="value">{{ fmtInt(ov.total) }}</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card avg"><div class="label">平均健康分</div><div class="value">{{ ov.health.avg_score }}</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card danger"><div class="label">高流失风险</div><div class="value">{{ fmtInt(riskCount('high')) }}</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card recharge"><div class="label">累计充值(积分)</div><div class="value">{{ fmtInt(ov.health.total_recharge) }}</div></div>
        </el-col>
      </el-row>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-card shadow="never"><template #header><span>生命周期阶段分布</span></template>
          <div ref="stageChartRef" class="chart"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never"><template #header><span>流失风险分布</span></template>
          <div ref="riskChartRef" class="chart"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never"><template #header><span>健康分区间分布</span></template>
          <div ref="healthChartRef" class="chart"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="list-card" shadow="never">
      <template #header>
        <div class="list-header">
          <span>用户画像明细</span>
          <div class="filters">
            <el-select v-model="filters.stage" placeholder="阶段" clearable style="width: 120px" @change="reload">
              <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-select v-model="filters.churn_risk" placeholder="风险" clearable style="width: 110px" @change="reload">
              <el-option label="高" value="high" />
              <el-option label="中" value="medium" />
              <el-option label="低" value="low" />
            </el-select>
            <el-input v-model="filters.keyword" placeholder="用户名/昵称" clearable style="width: 160px" @keyup.enter="reload" />
            <el-button type="primary" @click="reload">查询</el-button>
          </div>
        </div>
      </template>

      <el-table :data="rows" v-loading="loading" stripe border style="width: 100%">
        <el-table-column prop="user_id" label="ID" width="70" />
        <el-table-column label="用户" min-width="140">
          <template #default="{ row }">{{ row.nickname || row.username }}<span class="uname">@{{ row.username }}</span></template>
        </el-table-column>
        <el-table-column label="健康分" width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.health_score" :color="healthColor(row.health_score)" :stroke-width="14" />
          </template>
        </el-table-column>
        <el-table-column label="阶段" width="110">
          <template #default="{ row }"><el-tag :type="stageTagType(row.stage)" size="small">{{ stageLabel(row.stage) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="流失风险" width="100">
          <template #default="{ row }"><el-tag :type="riskTagType(row.churn_risk)" size="small">{{ riskLabel(row.churn_risk) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="active_days_30" label="30日活跃" width="100" />
        <el-table-column prop="total_actions" label="累计行为" width="100" />
        <el-table-column prop="total_recharge" label="累计充值" width="110" />
        <el-table-column label="画像标签" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="tag in splitTags(row.profile_tags)" :key="tag" size="small" class="pt">{{ tag }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="last_active_at" label="最近活跃" width="170" show-overflow-tooltip />
      </el-table>

      <div class="pager">
        <el-pagination background layout="total, prev, pager, next" :total="total"
          :page-size="filters.page_size" :current-page="filters.page" @current-change="onPage" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { DataLine } from '@element-plus/icons-vue'
import { lifecycleAPI } from '@/api/lifecycle'

const loading = ref(false)
const recomputing = ref(false)
const ov = ref(null)
const rows = ref([])
const total = ref(0)

const stageChartRef = ref(null)
const riskChartRef = ref(null)
const healthChartRef = ref(null)
let stageChart = null
let riskChart = null
let healthChart = null

const filters = reactive({ stage: '', churn_risk: '', keyword: '', page: 1, page_size: 20 })

const stageOptions = [
  { value: 'new', label: '新用户' },
  { value: 'active', label: '活跃' },
  { value: 'paying', label: '付费' },
  { value: 'at_risk', label: '预警' },
  { value: 'churned', label: '已流失' }
]

function fmtInt(n) { return (Number(n) || 0).toLocaleString('zh-CN') }
function riskCount(r) {
  if (!ov.value) return 0
  const hit = ov.value.by_risk.find((x) => x.churn_risk === r)
  return hit ? hit.count : 0
}
function splitTags(s) { return (s || '').split(',').filter(Boolean) }
function stageLabel(s) { return (stageOptions.find((x) => x.value === s) || {}).label || s }
function stageTagType(s) { return { new: 'info', active: 'success', paying: 'warning', at_risk: 'danger', churned: 'info' }[s] || '' }
function riskLabel(r) { return { high: '高', medium: '中', low: '低' }[r] || r }
function riskTagType(r) { return { high: 'danger', medium: 'warning', low: 'success' }[r] || '' }
function healthColor(v) { return v >= 75 ? '#67c23a' : v >= 50 ? '#e6a23c' : v >= 25 ? '#f56c6c' : '#909399' }

function renderCharts() {
  if (!ov.value) return
  nextTick(() => {
    if (stageChartRef.value) {
      stageChart = stageChart || echarts.init(stageChartRef.value)
      stageChart.setOption({
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [{
          type: 'pie', radius: ['40%', '68%'],
          data: ov.value.by_stage.map((x) => ({ name: stageLabel(x.stage), value: x.count }))
        }]
      })
    }
    if (riskChartRef.value) {
      riskChart = riskChart || echarts.init(riskChartRef.value)
      const colors = { high: '#f56c6c', medium: '#e6a23c', low: '#67c23a' }
      riskChart.setOption({
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [{
          type: 'pie', radius: ['40%', '68%'],
          data: ov.value.by_risk.map((x) => ({ name: riskLabel(x.churn_risk), value: x.count, itemStyle: { color: colors[x.churn_risk] } }))
        }]
      })
    }
    if (healthChartRef.value) {
      healthChart = healthChart || echarts.init(healthChartRef.value)
      const h = ov.value.health
      healthChart.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 40, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: ['健康(≥75)', '正常(50-74)', '偏弱(25-49)', '危险(<25)'] },
        yAxis: { type: 'value' },
        series: [{
          type: 'bar', barWidth: '46%',
          data: [
            { value: h.healthy, itemStyle: { color: '#67c23a' } },
            { value: h.normal, itemStyle: { color: '#409eff' } },
            { value: h.weak, itemStyle: { color: '#e6a23c' } },
            { value: h.danger, itemStyle: { color: '#f56c6c' } }
          ]
        }]
      })
    }
  })
}

async function loadOverview() {
  const res = await lifecycleAPI.overview()
  ov.value = res.data
  renderCharts()
}
async function loadList() {
  loading.value = true
  try {
    const params = { page: filters.page, page_size: filters.page_size }
    if (filters.stage) params.stage = filters.stage
    if (filters.churn_risk) params.churn_risk = filters.churn_risk
    if (filters.keyword) params.keyword = filters.keyword
    const res = await lifecycleAPI.profiles(params)
    rows.value = res.data.items || []
    total.value = res.data.pagination?.total || 0
  } finally {
    loading.value = false
  }
}
async function loadAll() { await Promise.all([loadOverview(), loadList()]) }
function reload() { filters.page = 1; loadList() }
function onPage(p) { filters.page = p; loadList() }
async function doRecompute() {
  recomputing.value = true
  try {
    const res = await lifecycleAPI.recompute()
    ElMessage.success(`已重算 ${res.data.computed} / ${res.data.total} 位用户`)
    await loadAll()
  } catch (e) {
    ElMessage.error(e?.message || '重算失败')
  } finally {
    recomputing.value = false
  }
}
function onResize() {
  stageChart && stageChart.resize()
  riskChart && riskChart.resize()
  healthChart && healthChart.resize()
}

onMounted(() => { loadAll(); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  stageChart && stageChart.dispose()
  riskChart && riskChart.dispose()
  healthChart && healthChart.dispose()
})
</script>

<style scoped>
.lifecycle-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.actions { display: flex; gap: 10px; }
.stat-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.stat-card.avg { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card.danger { background: linear-gradient(135deg, #f56c6c, #f89898); }
.stat-card.recharge { background: linear-gradient(135deg, #e6a23c, #ebb563); }
.stat-card .label { font-size: 13px; opacity: 0.9; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.chart { height: 260px; }
.list-card { margin-top: 16px; }
.list-header { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
.uname { color: #909399; font-size: 12px; margin-left: 6px; }
.pt { margin: 2px; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
