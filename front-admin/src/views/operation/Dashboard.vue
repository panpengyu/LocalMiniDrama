<template>
  <div class="custom-dashboard">
    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <div>
          <h3 class="page-title">自定义仪表盘</h3>
          <p class="page-desc">拖拽排序组件，布局按管理员持久化；保存后下次进入自动恢复。</p>
        </div>
        <div class="toolbar-actions">
          <el-button @click="addWidget">
            <el-icon style="margin-right: 4px"><Plus /></el-icon>添加组件
          </el-button>
          <el-button @click="resetLayout">恢复默认</el-button>
          <el-button type="primary" :loading="saving" @click="saveLayout">
            <el-icon style="margin-right: 4px"><Check /></el-icon>保存布局
          </el-button>
        </div>
      </div>

      <el-alert
        v-if="!layout.length"
        type="info"
        :closable="false"
        title="当前没有组件，点击「添加组件」开始搭建仪表盘"
        class="empty-tip"
      />

      <div v-else class="widget-grid">
        <draggable
          v-model="layout"
          item-key="id"
          class="grid-inner"
          :animation="200"
          handle=".widget-header"
          ghost-class="ghost-card"
        >
          <template #item="{ element }">
            <div
              class="widget-card"
              :style="{ width: element.width === 12 ? 'calc(50% - 8px)' : '100%' }"
            >
              <div class="widget-header">
                <span class="widget-title">{{ element.title }}</span>
                <div class="widget-ops">
                  <el-button link size="small" @click="toggleWidth(element)">
                    {{ element.width === 12 ? '扩展' : '缩半' }}
                  </el-button>
                  <el-button link type="danger" size="small" @click="removeWidget(element)">移除</el-button>
                </div>
              </div>
              <div class="widget-body" :ref="(el) => setChartEl(element.id, el)">
                <div v-if="!chartData[element.type]" class="widget-loading">
                  <el-icon class="is-loading"><Loading /></el-icon> 加载中…
                </div>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Check, Loading } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import * as echarts from 'echarts'
import { dashboardAPI } from '@/api/dashboard'
import { analyticsAPI } from '@/api/analytics'

const layout = ref([])
const saving = ref(false)
const chartData = reactive({})
const chartEls = reactive({})
const charts = {}

const WIDGET_TYPES = [
  { type: 'dau', title: '活跃用户趋势' },
  { type: 'events', title: '事件每日趋势' },
  { type: 'funnel', title: '创作转化漏斗' },
  { type: 'model', title: '模型效果' },
]

function setChartEl(id, el) {
  if (el) chartEls[id] = el
}

function widgetTitle(type) {
  return WIDGET_TYPES.find((w) => w.type === type)?.title || type
}

async function loadLayout() {
  const res = await dashboardAPI.getLayout()
  layout.value = res.layout
  // 补全新组件类型默认标题
  layout.value.forEach((w) => {
    if (!w.title && WIDGET_TYPES.find((x) => x.type === w.type)) w.title = widgetTitle(w.type)
  })
  await loadChartData()
  await nextTick()
  renderCharts()
}

async function loadChartData() {
  const types = [...new Set(layout.value.map((w) => w.type))]
  if (!types.length) return
  const overview = await analyticsAPI.overview(30)
  if (types.includes('dau')) chartData.dau = overview.behavior
  if (types.includes('events')) {
    const ev = await analyticsAPI.eventOverview({ steps: ['page_view', 'login'], days: 30 })
    chartData.events = ev
  }
  if (types.includes('funnel')) chartData.funnel = overview.funnel
  if (types.includes('model')) chartData.model = overview.model_effect
}

function renderCharts() {
  Object.keys(charts).forEach((k) => {
    charts[k].dispose()
    delete charts[k]
  })
  layout.value.forEach((w) => {
    const el = chartEls[w.id]
    if (!el || !chartData[w.type]) return
    const chart = echarts.init(el)
    charts[w.id] = chart
    chart.setOption(buildOption(w.type, chartData[w.type]))
  })
}

function buildOption(type, data) {
  const grid = { left: 48, right: 20, top: 30, bottom: 30 }
  if (type === 'dau') {
    return {
      grid,
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: (data.daily || []).map((d) => d.date) },
      yAxis: { type: 'value' },
      series: [
        { name: 'DAU', type: 'line', smooth: true, data: (data.daily || []).map((d) => d.dau), areaStyle: { opacity: 0.15 } },
      ],
    }
  }
  if (type === 'events') {
    const daily = data.daily || []
    return {
      grid,
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: { type: 'category', data: daily.map((d) => d.date) },
      yAxis: { type: 'value' },
      series: [
        { name: '事件量', type: 'bar', data: daily.map((d) => d.events) },
        { name: '活跃用户', type: 'line', smooth: true, data: daily.map((d) => d.users) },
      ],
    }
  }
  if (type === 'funnel') {
    const stages = data.stages || []
    return {
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'funnel',
          left: '10%',
          width: '80%',
          label: { formatter: '{b}：{c}（{d}%）' },
          data: stages.map((s) => ({ name: s.label, value: s.count })),
        },
      ],
    }
  }
  if (type === 'model') {
    const rows = data || []
    return {
      grid,
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: { type: 'category', data: rows.map((r) => r.task_type) },
      yAxis: { type: 'value' },
      series: [
        { name: '成功', type: 'bar', stack: 't', data: rows.map((r) => r.success) },
        { name: '失败', type: 'bar', stack: 't', data: rows.map((r) => r.failed) },
      ],
    }
  }
  return {}
}

async function saveLayout() {
  saving.value = true
  try {
    const payload = layout.value.map((w, i) => ({
      type: w.type,
      title: w.title,
      width: Number(w.width) || 24,
      order: i,
      opts: w.opts || {},
    }))
    await dashboardAPI.saveLayout(payload)
    ElMessage.success('布局已保存')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function resetLayout() {
  await ElMessageBox.confirm('确认恢复为默认布局？当前自定义布局将被覆盖。', '恢复默认', { type: 'warning' })
  await dashboardAPI.resetLayout()
  ElMessage.success('已恢复默认布局')
  loadLayout()
}

function addWidget() {
  const existing = new Set(layout.value.map((w) => w.type))
  const next = WIDGET_TYPES.find((w) => !existing.has(w.type))
  if (!next) {
    ElMessage.warning('所有组件类型已添加')
    return
  }
  layout.value.push({ id: `w_${Date.now()}`, type: next.type, title: next.title, width: 24, opts: {} })
  refresh()
}

function removeWidget(w) {
  layout.value = layout.value.filter((x) => x.id !== w.id)
  if (charts[w.id]) {
    charts[w.id].dispose()
    delete charts[w.id]
  }
}

function toggleWidth(w) {
  w.width = w.width === 12 ? 24 : 12
  refresh()
}

async function refresh() {
  await loadChartData()
  await nextTick()
  renderCharts()
}

function onResize() {
  Object.values(charts).forEach((c) => c && c.resize())
}

onMounted(() => {
  loadLayout()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  Object.values(charts).forEach((c) => c && c.dispose())
})

// 供 E2E/自检脚本使用
window.__dashboardPreview = {
  loadLayout,
  saveLayout,
  resetLayout,
  addWidget,
}
</script>

<style scoped>
.custom-dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-card {
  border-radius: 10px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 10px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.page-desc {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.empty-tip {
  margin-top: 8px;
}

.widget-grid {
  min-height: 120px;
}

.grid-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.widget-card {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  transition: box-shadow 0.2s;
}

.widget-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.ghost-card {
  opacity: 0.5;
  background: #ecf5ff;
  border: 1px dashed #409eff;
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f0f2f5;
  border-radius: 10px 10px 0 0;
  cursor: grab;
  user-select: none;
}

.widget-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.widget-ops {
  display: flex;
  align-items: center;
}

.widget-body {
  height: 280px;
  padding: 8px;
}

.widget-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
  gap: 6px;
}
</style>
