<template>
  <div class="analytics-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><DataAnalysis /></el-icon>
          <span>数据分析平台</span>
          <span class="subtitle">用户行为分析 · 创作漏斗 · 模型效果 · 留存分析（数据均来自真实业务库）</span>
        </div>
        <div class="toolbar-actions">
          <el-select v-model="days" style="width: 130px" @change="loadAll">
            <el-option :value="7" label="近 7 天" />
            <el-option :value="30" label="近 30 天" />
            <el-option :value="90" label="近 90 天" />
          </el-select>
          <el-dropdown v-if="days" trigger="click" @command="handleExport">
            <el-button type="primary" plain :loading="exporting">
              <el-icon style="margin-right: 4px"><Download /></el-icon>数据导出
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="behavior">行为日报（CSV）</el-dropdown-item>
                <el-dropdown-item command="events">事件明细（CSV）</el-dropdown-item>
                <el-dropdown-item command="events_dist">事件分布（CSV）</el-dropdown-item>
                <el-dropdown-item divided command="behavior_xlsx">行为日报（XLSX）</el-dropdown-item>
                <el-dropdown-item command="events_xlsx">事件明细（XLSX）</el-dropdown-item>
                <el-dropdown-item command="events_dist_xlsx">事件分布（XLSX）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
        </div>
      </div>

      <el-row :gutter="16">
        <el-col :span="6"><div class="stat-card total"><div class="label">活跃用户数</div><div class="value">{{ fmtInt(behavior?.active_users) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card action"><div class="label">总行为数</div><div class="value">{{ fmtInt(behavior?.total_actions) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card funnel"><div class="label">创作整体转化率</div><div class="value">{{ funnel ? funnel.overall_rate + '%' : '-' }}</div></div></el-col>
        <el-col :span="6"><div class="stat-card retention"><div class="label">平均次日留存</div><div class="value">{{ retention ? retention.summary.avg_d1 + '%' : '-' }}</div></div></el-col>
      </el-row>
    </el-card>

    <!-- 用户行为分析 -->
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never" class="chart-card">
          <template #header><span>用户行为分布（Top 20）</span></template>
          <div ref="actionChartRef" class="chart" v-loading="loading"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" class="chart-card">
          <template #header><span>每日活跃用户（DAU）与行为量趋势</span></template>
          <div ref="dauChartRef" class="chart" v-loading="loading"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 创作漏斗 -->
    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never" class="chart-card">
          <template #header><span>创作漏斗分析</span></template>
          <div ref="funnelChartRef" class="chart" v-loading="loading"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" class="chart-card">
          <template #header><span>创作环节转化明细</span></template>
          <el-table :data="funnel?.stages || []" size="small" border stripe style="width: 100%">
            <el-table-column prop="label" label="环节" min-width="120" />
            <el-table-column prop="count" label="数量" width="110" align="right">
              <template #default="{ row }">{{ fmtInt(row.count) }}</template>
            </el-table-column>
            <el-table-column label="环比转化率" width="130" align="right">
              <template #default="{ row }">
                <el-tag :type="rateType(row.conversion_rate)" size="small">{{ row.conversion_rate }}%</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 模型效果 -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="list-header">
          <span>模型效果分析</span>
          <span class="hint" v-if="modelEffect">
            共 {{ modelEffect.summary.total_models }} 个模型 · 累计 {{ fmtInt(modelEffect.summary.total_calls) }} 次调用 ·
            总成本 ¥{{ modelEffect.summary.total_cost }} · 平均成功率 {{ modelEffect.summary.avg_success_rate }}%
          </span>
        </div>
      </template>
      <el-table :data="modelEffect?.items || []" v-loading="loading" size="small" border stripe style="width: 100%">
        <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
        <el-table-column prop="service_type" label="业务类型" width="110" />
        <el-table-column prop="provider" label="供应商" width="120" show-overflow-tooltip />
        <el-table-column prop="total_calls" label="调用量" width="100" align="right">
          <template #default="{ row }">{{ fmtInt(row.total_calls) }}</template>
        </el-table-column>
        <el-table-column label="成功率" width="120" align="right">
          <template #default="{ row }">
            <el-tag :type="rateType(row.success_rate)" size="small">{{ row.success_rate }}%</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="avg_latency" label="平均耗时(ms)" width="130" align="right" />
        <el-table-column label="总成本" width="120" align="right">
          <template #default="{ row }">¥{{ row.total_cost }}</template>
        </el-table-column>
        <el-table-column label="质量分" width="100" align="right">
          <template #default="{ row }">{{ row.avg_quality != null ? row.avg_quality : '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 留存分析 -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="list-header">
          <span>留存分析（按注册日分群）</span>
          <span class="hint" v-if="retention">
            平均 次日 {{ retention.summary.avg_d1 }}% · 7日 {{ retention.summary.avg_d7 }}% · 30日 {{ retention.summary.avg_d30 }}%
          </span>
        </div>
      </template>
      <el-table :data="retention?.cohorts || []" v-loading="loading" size="small" border stripe style="width: 100%">
        <el-table-column prop="cohort_date" label="注册日" min-width="130" />
        <el-table-column prop="new_users" label="新增用户" width="120" align="right">
          <template #default="{ row }">{{ fmtInt(row.new_users) }}</template>
        </el-table-column>
        <el-table-column label="次日留存" width="140" align="right">
          <template #default="{ row }"><span v-if="row.d1 == null">-</span><el-tag v-else :type="rateType(row.d1)" size="small">{{ row.d1 }}%</el-tag></template>
        </el-table-column>
        <el-table-column label="7日留存" width="140" align="right">
          <template #default="{ row }"><span v-if="row.d7 == null">-</span><el-tag v-else :type="rateType(row.d7)" size="small">{{ row.d7 }}%</el-tag></template>
        </el-table-column>
        <el-table-column label="30日留存" width="140" align="right">
          <template #default="{ row }"><span v-if="row.d30 == null">-</span><el-tag v-else :type="rateType(row.d30)" size="small">{{ row.d30 }}%</el-tag></template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 事件埋点分析（S18-T01） -->
    <el-card shadow="never" class="chart-card">
      <template #header>
        <div class="list-header">
          <span>事件埋点分析</span>
          <span class="hint" v-if="eventStats">
            近 {{ eventStats.days }} 天 事件量 {{ fmtInt(eventStats.total_events) }} · 独立用户 {{ fmtInt(eventStats.users) }}
          </span>
          <div class="toolbar-actions">
            <el-select v-model="funnelTemplate" style="width: 160px" @change="loadEventOverview">
              <el-option v-for="t in FUNNEL_TEMPLATES" :key="t.key" :label="t.label" :value="t.key" />
            </el-select>
          </div>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-card shadow="never" class="chart-card" style="margin-bottom: 0">
            <template #header><span>事件分布（Top 10）</span></template>
            <div ref="eventDistChartRef" class="chart" v-loading="loading" style="height: 280px"></div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="never" class="chart-card" style="margin-bottom: 0">
            <template #header><span>事件每日趋势</span></template>
            <div ref="eventTrendChartRef" class="chart" v-loading="loading" style="height: 280px"></div>
          </el-card>
        </el-col>
      </el-row>
      <el-row :gutter="16" style="margin-top: 16px">
        <el-col :span="12">
          <el-card shadow="never" class="chart-card" style="margin-bottom: 0">
            <template #header><span>事件转化漏斗（{{ currentFunnelLabel }}）</span></template>
            <div ref="eventFunnelChartRef" class="chart" v-loading="loading" style="height: 280px"></div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="never" class="chart-card" style="margin-bottom: 0">
            <template #header><span>漏斗步骤明细</span></template>
            <el-table :data="eventFunnel?.steps || []" size="small" border stripe style="width: 100%">
              <el-table-column prop="label" label="事件" min-width="140" />
              <el-table-column prop="users" label="用户数" width="110" align="right">
                <template #default="{ row }">{{ fmtInt(row.users) }}</template>
              </el-table-column>
              <el-table-column label="步骤转化率" width="130" align="right">
                <template #default="{ row }">
                  <el-tag :type="rateType(row.conversion_rate)" size="small">{{ row.conversion_rate }}%</el-tag>
                </template>
              </el-table-column>
            </el-table>
            <div class="hint" style="padding: 10px 0 0; font-size: 12px; color: #909399">
              整体转化率：{{ eventFunnel ? eventFunnel.overall_rate + '%' : '-' }}
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { DataAnalysis, Download } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { analyticsAPI } from '@/api/analytics'
import { reportsAPI } from '@/api/reports'

const loading = ref(false)
const exporting = ref(false)
const days = ref(30)
const behavior = ref(null)
const funnel = ref(null)
const modelEffect = ref(null)
const retention = ref(null)
const eventStats = ref(null)
const eventFunnel = ref(null)
const funnelTemplate = ref('login')

// S18-T01 事件转化漏斗预置模板（对应真实业务事件名）
const FUNNEL_TEMPLATES = [
  { key: 'login', label: '登录转化', steps: [{ event: 'page_view', label: '浏览页面' }, { event: 'login', label: '登录成功' }] },
  { key: 'create', label: '创作转化', steps: [{ event: 'page_view', label: '浏览页面' }, { event: 'create_drama', label: '创建项目' }, { event: 'publish_drama', label: '发布成品' }] },
  { key: 'pay', label: '支付转化', steps: [{ event: 'page_view', label: '浏览页面' }, { event: 'open_membership', label: '打开会员中心' }, { event: 'pay_success', label: '支付成功' }] },
]
const currentFunnelLabel = computed(() => {
  const t = FUNNEL_TEMPLATES.find((x) => x.key === funnelTemplate.value)
  return t ? t.label : ''
})

const actionChartRef = ref(null)
const dauChartRef = ref(null)
const funnelChartRef = ref(null)
const eventDistChartRef = ref(null)
const eventTrendChartRef = ref(null)
const eventFunnelChartRef = ref(null)
let actionChart = null
let dauChart = null
let funnelChart = null
let eventDistChart = null
let eventTrendChart = null
let eventFunnelChart = null

function fmtInt(n) { return (Number(n) || 0).toLocaleString('zh-CN') }
function rateType(r) {
  const v = Number(r) || 0
  if (v >= 80) return 'success'
  if (v >= 50) return 'warning'
  return 'danger'
}

function renderActionChart() {
  if (!actionChartRef.value) return
  actionChart = actionChart || echarts.init(actionChartRef.value)
  const list = (behavior.value?.by_action || []).slice(0, 12).reverse()
  actionChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 30, top: 20, bottom: 20 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: list.map((r) => r.action) },
    series: [{
      type: 'bar', data: list.map((r) => r.count), barMaxWidth: 20,
      itemStyle: { color: '#409eff', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right' }
    }]
  }, true)
}

function renderDauChart() {
  if (!dauChartRef.value) return
  dauChart = dauChart || echarts.init(dauChartRef.value)
  const daily = behavior.value?.daily || []
  dauChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '行为量'], top: 0 },
    grid: { left: 50, right: 50, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: daily.map((r) => r.date) },
    yAxis: [
      { type: 'value', name: '活跃用户' },
      { type: 'value', name: '行为量' }
    ],
    series: [
      { name: '活跃用户', type: 'line', smooth: true, data: daily.map((r) => r.dau), itemStyle: { color: '#67c23a' }, areaStyle: { opacity: 0.1 } },
      { name: '行为量', type: 'line', yAxisIndex: 1, smooth: true, data: daily.map((r) => r.actions), itemStyle: { color: '#e6a23c' } }
    ]
  }, true)
}

function renderFunnelChart() {
  if (!funnelChartRef.value) return
  funnelChart = funnelChart || echarts.init(funnelChartRef.value)
  const stages = funnel.value?.stages || []
  funnelChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    series: [{
      type: 'funnel', left: '10%', right: '10%', top: 20, bottom: 20,
      minSize: '20%', maxSize: '100%', sort: 'descending', gap: 2,
      label: { show: true, position: 'inside', formatter: '{b}\n{c}' },
      data: stages.map((s) => ({ value: s.count, name: s.label }))
    }]
  }, true)
}

function renderCharts() {
  nextTick(() => {
    renderActionChart()
    renderDauChart()
    renderFunnelChart()
  })
}

function renderEventDistChart() {
  if (!eventDistChartRef.value) return
  eventDistChart = eventDistChart || echarts.init(eventDistChartRef.value)
  const list = (eventStats.value?.by_event || []).slice(0, 10).reverse()
  eventDistChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 120, right: 30, top: 20, bottom: 20 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: list.map((r) => r.event) },
    series: [{
      type: 'bar', data: list.map((r) => r.count), barMaxWidth: 18,
      itemStyle: { color: '#409eff', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right' }
    }]
  }, true)
}

function renderEventTrendChart() {
  if (!eventTrendChartRef.value) return
  eventTrendChart = eventTrendChart || echarts.init(eventTrendChartRef.value)
  const daily = eventStats.value?.daily || []
  eventTrendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['事件量', '活跃用户'], top: 0 },
    grid: { left: 50, right: 50, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: daily.map((r) => r.date) },
    yAxis: [
      { type: 'value', name: '事件量' },
      { type: 'value', name: '活跃用户' }
    ],
    series: [
      { name: '事件量', type: 'line', smooth: true, data: daily.map((r) => r.events), itemStyle: { color: '#409eff' }, areaStyle: { opacity: 0.1 } },
      { name: '活跃用户', type: 'line', yAxisIndex: 1, smooth: true, data: daily.map((r) => r.users), itemStyle: { color: '#67c23a' } }
    ]
  }, true)
}

function renderEventFunnelChart() {
  if (!eventFunnelChartRef.value) return
  eventFunnelChart = eventFunnelChart || echarts.init(eventFunnelChartRef.value)
  const steps = eventFunnel.value?.steps || []
  eventFunnelChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 人' },
    series: [{
      type: 'funnel', left: '10%', right: '10%', top: 20, bottom: 20,
      minSize: '20%', maxSize: '100%', sort: 'descending', gap: 2,
      label: { show: true, position: 'inside', formatter: '{b}\n{c} 人' },
      data: steps.map((s) => ({ value: s.users, name: s.label }))
    }]
  }, true)
}

async function loadEventOverview() {
  const t = FUNNEL_TEMPLATES.find((x) => x.key === funnelTemplate.value)
  const steps = t ? t.steps : []
  try {
    const res = await analyticsAPI.eventOverview(steps, days.value)
    eventStats.value = res.stats
    eventFunnel.value = res.funnel
    nextTick(() => {
      renderEventDistChart()
      renderEventTrendChart()
      renderEventFunnelChart()
    })
  } catch (e) {
    ElMessage.error(e?.message || '事件分析加载失败')
  }
}

async function loadAll() {
  loading.value = true
  try {
    const res = await analyticsAPI.overview(days.value)
    behavior.value = res.behavior
    funnel.value = res.funnel
    modelEffect.value = res.model_effect
    retention.value = res.retention
    renderCharts()
    loadEventOverview()
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function handleExport(cmd) {
  exporting.value = true
  try {
    const [data, type] = cmd.split('_')
    await reportsAPI.exportFile(type || 'csv', data, days.value)
    ElMessage.success('导出成功，已开始下载')
  } catch (e) {
    ElMessage.error(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

function onResize() {
  actionChart && actionChart.resize()
  dauChart && dauChart.resize()
  funnelChart && funnelChart.resize()
  eventDistChart && eventDistChart.resize()
  eventTrendChart && eventTrendChart.resize()
  eventFunnelChart && eventFunnelChart.resize()
}

onMounted(() => {
  loadAll()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  actionChart && actionChart.dispose()
  dauChart && dauChart.dispose()
  funnelChart && funnelChart.dispose()
  eventDistChart && eventDistChart.dispose()
  eventTrendChart && eventTrendChart.dispose()
  eventFunnelChart && eventFunnelChart.dispose()
})
</script>

<style scoped>
.analytics-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.toolbar-actions { display: flex; gap: 8px; align-items: center; }
.stat-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.stat-card.action { background: linear-gradient(135deg, #e6a23c, #f3c17b); }
.stat-card.funnel { background: linear-gradient(135deg, #9254de, #b37feb); }
.stat-card.retention { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card .label { font-size: 13px; opacity: 0.9; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.chart-card { margin-bottom: 16px; }
.chart { height: 320px; width: 100%; }
.list-header { display: flex; justify-content: space-between; align-items: center; }
.list-header .hint { font-size: 12px; color: #909399; font-weight: 400; }
</style>
