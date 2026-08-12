<template>
  <div class="monitor-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Monitor /></el-icon>
          <span>系统监控大屏</span>
          <span class="subtitle">实时采集 CPU / 内存 / 磁盘 / 负载 / 队列 / API / 数据库 运行指标</span>
        </div>
        <div class="actions">
          <el-switch v-model="autoRefresh" active-text="自动刷新" @change="toggleAuto" />
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
        </div>
      </div>
    </el-card>

    <!-- 资源仪表盘 -->
    <el-row :gutter="16" v-loading="loading">
      <el-col :span="6">
        <el-card shadow="never" class="gauge-card">
          <div class="gauge-title">CPU 使用率</div>
          <el-progress type="dashboard" :percentage="cpuPct" :color="gaugeColor(cpuPct)" :width="140" />
          <div class="gauge-foot">{{ snap?.cpu?.cores || 0 }} 核 · 负载 {{ snap?.load_avg ?? 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="gauge-card">
          <div class="gauge-title">内存使用率</div>
          <el-progress type="dashboard" :percentage="memPct" :color="gaugeColor(memPct)" :width="140" />
          <div class="gauge-foot">{{ fmtGB(snap?.memory?.used) }} / {{ fmtGB(snap?.memory?.total) }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="gauge-card">
          <div class="gauge-title">磁盘使用率</div>
          <el-progress type="dashboard" :percentage="diskPct" :color="gaugeColor(diskPct)" :width="140" />
          <div class="gauge-foot">存储根目录</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="gauge-card">
          <div class="gauge-title">API 错误率(近1min)</div>
          <el-progress type="dashboard" :percentage="apiErrPct" :color="gaugeColor(apiErrPct)" :width="140" />
          <div class="gauge-foot">QPM {{ snap?.api?.qpm ?? 0 }} · 均耗 {{ snap?.api?.avg_latency_ms ?? 0 }}ms</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 状态卡片 -->
    <el-row :gutter="16" class="mt16">
      <el-col :span="6">
        <div class="mini-card" :class="snap?.database?.ok ? 'ok' : 'bad'">
          <div class="mini-label">数据库</div>
          <div class="mini-value">{{ snap?.database?.ok ? '正常' : '异常' }}</div>
          <div class="mini-sub">{{ (snap?.database?.type || '').toUpperCase() }} · {{ snap?.database?.latency_ms ?? '-' }}ms</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="mini-card" :class="queueHealthy ? 'ok' : 'warn'">
          <div class="mini-label">任务队列</div>
          <div class="mini-value">等待 {{ snap?.queue?.waiting ?? 0 }} / 执行 {{ snap?.queue?.active ?? 0 }}</div>
          <div class="mini-sub">{{ snap?.queue?.redis_ok ? 'Redis' : '内存降级' }} · 失败 {{ snap?.queue?.failed ?? 0 }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="mini-card ok">
          <div class="mini-label">进程内存(RSS)</div>
          <div class="mini-value">{{ fmtMB(snap?.memory?.process_rss) }}</div>
          <div class="mini-sub">堆 {{ fmtMB(snap?.memory?.process_heap_used) }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="mini-card ok">
          <div class="mini-label">运行时长</div>
          <div class="mini-value">{{ fmtUptime(snap?.uptime?.process_seconds) }}</div>
          <div class="mini-sub">{{ snap?.platform?.type }} · Node {{ snap?.platform?.node }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 历史曲线 -->
    <el-row :gutter="16" class="mt16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>CPU / 内存 / 磁盘 历史曲线</span></template>
          <div v-show="hasHistory" ref="resChartRef" class="chart-lg"></div>
          <el-empty v-show="!hasHistory" description="采样数据累积中，请稍候" :image-size="80" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>API QPM / 错误率 · 队列积压 历史曲线</span></template>
          <div v-show="hasHistory" ref="apiChartRef" class="chart-lg"></div>
          <el-empty v-show="!hasHistory" description="采样数据累积中，请稍候" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { Monitor } from '@element-plus/icons-vue'
import { monitorAPI } from '@/api/monitor'

const loading = ref(false)
const autoRefresh = ref(true)
const snap = ref(null)
const historyRows = ref([])

const resChartRef = ref(null)
const apiChartRef = ref(null)
let resChart = null
let apiChart = null
let timer = null

const cpuPct = computed(() => Math.round(snap.value?.cpu?.percent || 0))
const memPct = computed(() => Math.round(snap.value?.memory?.percent || 0))
const diskPct = computed(() => Math.round(snap.value?.disk?.percent || 0))
const apiErrPct = computed(() => Math.round(snap.value?.api?.error_rate || 0))
const queueHealthy = computed(() => (snap.value?.queue?.waiting || 0) < 50 && (snap.value?.queue?.failed || 0) < 10)
const hasHistory = computed(() => historyRows.value.length > 1)

function gaugeColor(v) { return v >= 90 ? '#f56c6c' : v >= 70 ? '#e6a23c' : '#67c23a' }
function fmtGB(bytes) { return ((Number(bytes) || 0) / 1024 / 1024 / 1024).toFixed(1) + ' GB' }
function fmtMB(bytes) { return ((Number(bytes) || 0) / 1024 / 1024).toFixed(0) + ' MB' }
function fmtUptime(sec) {
  const s = Number(sec) || 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return (d ? d + '天' : '') + (h ? h + '时' : '') + m + '分'
}

function renderCharts() {
  if (!hasHistory.value) return
  nextTick(() => {
    const labels = historyRows.value.map((r) => (r.created_at || '').slice(11, 16))
    if (resChartRef.value) {
      resChart = resChart || echarts.init(resChartRef.value)
      resChart.setOption({
        tooltip: { trigger: 'axis', valueFormatter: (v) => v + '%' },
        legend: { data: ['CPU', '内存', '磁盘'], bottom: 0 },
        grid: { left: 44, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: { type: 'value', max: 100, splitLine: { lineStyle: { type: 'dashed', color: '#EBEEF5' } } },
        series: [
          { name: 'CPU', type: 'line', smooth: true, data: historyRows.value.map((r) => r.cpu_percent), itemStyle: { color: '#409eff' } },
          { name: '内存', type: 'line', smooth: true, data: historyRows.value.map((r) => r.mem_percent), itemStyle: { color: '#e6a23c' } },
          { name: '磁盘', type: 'line', smooth: true, data: historyRows.value.map((r) => r.disk_percent), itemStyle: { color: '#909399' } }
        ]
      }, true)
    }
    if (apiChartRef.value) {
      apiChart = apiChart || echarts.init(apiChartRef.value)
      apiChart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['QPM', '错误率(%)', '队列等待'], bottom: 0 },
        grid: { left: 44, right: 44, top: 20, bottom: 40 },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: [
          { type: 'value', name: '次/积压' },
          { type: 'value', name: '%', max: 100, position: 'right' }
        ],
        series: [
          { name: 'QPM', type: 'bar', data: historyRows.value.map((r) => r.api_qpm), itemStyle: { color: '#67c23a' } },
          { name: '错误率(%)', type: 'line', yAxisIndex: 1, smooth: true, data: historyRows.value.map((r) => r.api_error_rate), itemStyle: { color: '#f56c6c' } },
          { name: '队列等待', type: 'line', smooth: true, data: historyRows.value.map((r) => r.queue_waiting), itemStyle: { color: '#409eff' } }
        ]
      }, true)
    }
  })
}

async function loadSnapshot() { snap.value = await monitorAPI.snapshot() }
async function loadHistory() { const r = await monitorAPI.history(60); historyRows.value = r.items || []; renderCharts() }

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadSnapshot(), loadHistory()])
  } catch (e) {
    ElMessage.error(e?.message || '监控数据加载失败')
  } finally {
    loading.value = false
  }
}

function toggleAuto(v) {
  if (v) startTimer()
  else stopTimer()
}
function startTimer() {
  stopTimer()
  timer = setInterval(async () => {
    try { await loadSnapshot(); await loadHistory() } catch (_) { /* 静默 */ }
  }, 10000)
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null } }

function onResize() { resChart && resChart.resize(); apiChart && apiChart.resize() }

onMounted(() => {
  loadAll()
  if (autoRefresh.value) startTimer()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('resize', onResize)
  resChart && resChart.dispose()
  apiChart && apiChart.dispose()
})
</script>

<style scoped>
.monitor-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.actions { display: flex; gap: 12px; align-items: center; }
.gauge-card { text-align: center; }
.gauge-title { font-size: 14px; color: #606266; margin-bottom: 8px; }
.gauge-foot { font-size: 12px; color: #909399; margin-top: 6px; }
.mt16 { margin-top: 16px; }
.mini-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.mini-card.ok { background: linear-gradient(135deg, #409eff, #66b1ff); }
.mini-card.warn { background: linear-gradient(135deg, #e6a23c, #ebb563); }
.mini-card.bad { background: linear-gradient(135deg, #f56c6c, #f89898); }
.mini-label { font-size: 13px; opacity: 0.9; }
.mini-value { font-size: 22px; font-weight: 700; margin-top: 6px; }
.mini-sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
.chart-lg { height: 300px; }
</style>
