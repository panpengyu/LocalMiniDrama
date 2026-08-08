<template>
  <div class="dashboard">
    <!-- 顶部统计卡片 -->
    <div class="stat-cards">
      <el-card
        v-for="card in statCards"
        :key="card.title"
        class="stat-card"
        shadow="hover"
        v-loading="statsLoading"
      >
        <div class="stat-card-body">
          <div class="stat-icon" :style="{ background: card.color }">
            <el-icon><component :is="card.icon" /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ card.value }}</div>
            <div class="stat-title">{{ card.title }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 图表区 -->
    <div class="chart-row">
      <el-card class="chart-card" v-loading="trendLoading">
        <template #header>
          <span class="chart-title">积分收支趋势（近 {{ trendDays }} 天）</span>
        </template>
        <div v-if="hasTrend" ref="lineChartRef" class="chart-box"></div>
        <el-empty v-else description="暂无积分收支数据" :image-size="80" />
      </el-card>
      <el-card class="chart-card" v-loading="consumptionLoading">
        <template #header>
          <span class="chart-title">消费构成（按业务）</span>
        </template>
        <div v-if="hasConsumption" ref="pieChartRef" class="chart-box"></div>
        <el-empty v-else description="暂无消费构成数据" :image-size="80" />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { User, UserFilled, Connection, Film, Wallet, Coin } from '@element-plus/icons-vue'
import { dashboardAPI } from '@/api/dashboard'
import {
  fmtInt,
  fmtYuan,
  fmtBigNumber,
  fmtTooltipPoints
} from '@/utils/format'

const lineChartRef = ref(null)
const pieChartRef = ref(null)
let lineChart = null
let pieChart = null

// ============== 状态 ==============
const statsLoading = ref(false)
const trendLoading = ref(false)
const consumptionLoading = ref(false)
const trendDays = ref(7)

// 接口原始数据
const statsData = reactive({
  totalUsers: 0,
  totalTeams: 0,
  totalChannels: 0,
  totalStoryboards: 0,
  totalRechargeAmount: 0,
  totalConsumePoints: 0
})
const trendData = reactive({
  dates: [],
  consumePoints: [],
  rechargePoints: []
})
const consumptionItems = ref([])

// ============== 工具 ==============
// fmtInt / fmtYuan / fmtBigNumber 已统一封装在 @/utils/format
// 卡片使用千分位 / 金额，图表 Y 轴使用中文大数缩写，Tooltip 使用完整千分位，保证：
//   - 数据量小时 < 1 万显示千分位整数
//   - ≥ 1 万 → "X.X 万" / ≥ 1 亿 → "X.XX 亿" / ≥ 1 万亿 → "X.XX 万亿"
//   - 负值保留负号，NaN 兜底为 0

// 顶部 6 个统计卡片（按真实数据实时计算）
const statCards = computed(() => [
  {
    title: '用户总数',
    value: fmtInt(statsData.totalUsers),
    icon: User,
    color: 'linear-gradient(135deg, #667eea, #764ba2)'
  },
  {
    title: '团队总数',
    value: fmtInt(statsData.totalTeams),
    icon: UserFilled,
    color: 'linear-gradient(135deg, #f093fb, #f5576c)'
  },
  {
    title: '渠道总数',
    value: fmtInt(statsData.totalChannels),
    icon: Connection,
    color: 'linear-gradient(135deg, #4facfe, #00f2fe)'
  },
  {
    title: '画布总数',
    value: fmtInt(statsData.totalStoryboards),
    icon: Film,
    color: 'linear-gradient(135deg, #43e97b, #38f9d7)'
  },
  {
    title: '充值金额总计',
    value: fmtYuan(statsData.totalRechargeAmount),
    icon: Wallet,
    color: 'linear-gradient(135deg, #fa709a, #fee140)'
  },
  {
    title: '消费积分总计',
    value: fmtInt(statsData.totalConsumePoints),
    icon: Coin,
    color: 'linear-gradient(135deg, #30cfd0, #330867)'
  }
])

const hasTrend = computed(() => trendData.dates.length > 0)
const hasConsumption = computed(() =>
  consumptionItems.value.some((it) => it.value > 0)
)

// ============== 数据拉取 ==============
async function loadStats() {
  statsLoading.value = true
  try {
    const d = await dashboardAPI.getStats()
    Object.assign(statsData, {
      totalUsers: d?.totalUsers ?? 0,
      totalTeams: d?.totalTeams ?? 0,
      totalChannels: d?.totalChannels ?? 0,
      totalStoryboards: d?.totalStoryboards ?? 0,
      totalRechargeAmount: d?.totalRechargeAmount ?? 0,
      totalConsumePoints: d?.totalConsumePoints ?? 0
    })
  } catch (e) {
    ElMessage.error('运营统计加载失败：' + (e.message || '网络错误'))
  } finally {
    statsLoading.value = false
  }
}

async function loadTrend() {
  trendLoading.value = true
  try {
    const d = await dashboardAPI.getStatsTrend(trendDays.value)
    trendData.dates = d?.dates || []
    trendData.consumePoints = d?.consumePoints || []
    trendData.rechargePoints = d?.rechargePoints || []
    await nextTick()
    initLineChart()
  } catch (e) {
    ElMessage.error('收支趋势加载失败：' + (e.message || '网络错误'))
  } finally {
    trendLoading.value = false
  }
}

async function loadConsumption() {
  consumptionLoading.value = true
  try {
    const d = await dashboardAPI.getConsumptionBreakdown()
    consumptionItems.value = d?.items || []
    await nextTick()
    initPieChart()
  } catch (e) {
    ElMessage.error('消费构成加载失败：' + (e.message || '网络错误'))
  } finally {
    consumptionLoading.value = false
  }
}

// ============== 图表渲染 ==============
function initLineChart() {
  if (!lineChartRef.value) return
  if (!lineChart) {
    lineChart = echarts.init(lineChartRef.value)
  }
  const xAxis = trendData.dates.map((s) => s.slice(5)) // MM-DD
  lineChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!Array.isArray(params) || !params.length) return ''
          const lines = []
          lines.push(params[0].axisValueLabel || params[0].axisValue)
          params.forEach((p) => {
            const marker = p.marker || ''
            const v = Number(p.value) || 0
            const absBig = fmtBigNumber(v)
            const full = fmtTooltipPoints(v)
            // Tooltip 里同时显示缩写和完整千分位，既紧凑又不丢失业务精度
            lines.push(`${marker}${p.seriesName}：${full}（${absBig}）`)
          })
          return lines.join('<br/>')
        }
      },
      legend: { data: ['消费积分', '充值积分'], bottom: 0 },
      grid: { left: 56, right: 32, top: 30, bottom: 44 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: xAxis
      },
      yAxis: {
        type: 'value',
        name: '积分',
        nameTextStyle: { color: '#909399', fontSize: 12, padding: [0, 0, 0, 36] },
        // 关键：对 Y 轴刻度做中文大数缩写，兼容 万 / 亿 / 万亿 / 负值
        axisLabel: {
          formatter: (value) => fmtBigNumber(value)
        },
        splitLine: { lineStyle: { type: 'dashed', color: '#EBEEF5' } }
      },
      series: [
        {
          name: '消费积分',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 7,
          data: trendData.consumePoints,
          itemStyle: { color: '#f5576c' },
          lineStyle: { width: 3 },
          areaStyle: { color: 'rgba(245, 87, 108, 0.18)' }
        },
        {
          name: '充值积分',
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 7,
          data: trendData.rechargePoints,
          itemStyle: { color: '#667eea' },
          lineStyle: { width: 3 },
          areaStyle: { color: 'rgba(102, 126, 234, 0.18)' }
        }
      ]
    },
    true
  )
}

function initPieChart() {
  if (!pieChartRef.value) return
  if (!pieChart) {
    pieChart = echarts.init(pieChartRef.value)
  }
  const palette = ['#667eea', '#f5576c', '#43e97b', '#f6d365', '#4facfe']
  const items = consumptionItems.value.filter((it) => it.value > 0)
  pieChart.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const total = p.data?.total ?? 0
          const pct = total ? ((p.value / total) * 100).toFixed(1) : 0
          return [
            `${p.marker}${p.name}`,
            `积分：${fmtInt(p.value)}（${fmtBigNumber(p.value)}）`,
            `占比：${pct}%`
          ].join('<br/>')
        }
      },
      legend: { bottom: 0, type: 'scroll' },
      series: [
        {
          name: '消费构成',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' }
          },
          color: palette,
          data: items.map((it, idx) => ({
            value: it.value,
            name: it.name,
            total: items.reduce((s, x) => s + x.value, 0),
            itemStyle: { color: palette[idx % palette.length] }
          }))
        }
      ]
    },
    true
  )
}

function handleResize() {
  lineChart && lineChart.resize()
  pieChart && pieChart.resize()
}

// 数据驱动时重新渲染图表
watch(hasTrend, (v) => {
  if (v) nextTick(() => initLineChart())
})
watch(hasConsumption, (v) => {
  if (v) nextTick(() => initPieChart())
})

onMounted(async () => {
  await Promise.all([loadStats(), loadTrend(), loadConsumption()])
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  lineChart && lineChart.dispose()
  pieChart && pieChart.dispose()
  lineChart = null
  pieChart = null
})
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.stat-card {
  border-radius: 12px;
}

.stat-card-body {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
  flex-shrink: 0;
}

.stat-info {
  min-width: 0;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-bright);
  line-height: 1.2;
}

.stat-title {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
}

.chart-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}

.chart-card {
  border-radius: 12px;
}

.chart-title {
  font-weight: 600;
  color: var(--text-bright);
}

.chart-box {
  width: 100%;
  height: 320px;
}

@media (max-width: 1100px) {
  .chart-row {
    grid-template-columns: 1fr;
  }
}
</style>
