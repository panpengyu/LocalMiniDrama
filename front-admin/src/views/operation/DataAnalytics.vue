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
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { DataAnalysis } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { analyticsAPI } from '@/api/analytics'

const loading = ref(false)
const days = ref(30)
const behavior = ref(null)
const funnel = ref(null)
const modelEffect = ref(null)
const retention = ref(null)

const actionChartRef = ref(null)
const dauChartRef = ref(null)
const funnelChartRef = ref(null)
let actionChart = null
let dauChart = null
let funnelChart = null

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

async function loadAll() {
  loading.value = true
  try {
    const res = await analyticsAPI.overview(days.value)
    behavior.value = res.behavior
    funnel.value = res.funnel
    modelEffect.value = res.model_effect
    retention.value = res.retention
    renderCharts()
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onResize() {
  actionChart && actionChart.resize()
  dauChart && dauChart.resize()
  funnelChart && funnelChart.resize()
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
