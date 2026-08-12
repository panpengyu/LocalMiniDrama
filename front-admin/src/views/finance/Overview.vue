<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Money /></el-icon>
          <span>财务与计费中心</span>
          <span class="subtitle">基于真实充值订单、模型调用成本、积分收支数据实时核算收入 / 成本 / 利润</span>
        </div>
        <div class="actions">
          <el-select v-model="days" style="width: 130px" @change="loadAll">
            <el-option :value="7" label="近 7 天" />
            <el-option :value="14" label="近 14 天" />
            <el-option :value="30" label="近 30 天" />
            <el-option :value="90" label="近 90 天" />
          </el-select>
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
          <el-button type="primary" :loading="reporting" @click="generateReport">生成今日日报</el-button>
        </div>
      </div>

      <el-row :gutter="16" v-if="ov">
        <el-col :span="6">
          <div class="stat-card revenue"><div class="label">累计收入(元)</div><div class="value">¥{{ fmtYuan(ov.revenue.total) }}</div>
            <div class="sub">近{{ ov.days }}天 ¥{{ fmtYuan(ov.revenue.recent) }} · {{ fmtInt(ov.revenue.orders) }} 单</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card cost"><div class="label">模型成本(元)</div><div class="value">¥{{ fmtYuan(ov.cost.model_cost) }}</div>
            <div class="sub">{{ fmtInt(ov.cost.model_calls) }} 次调用</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card profit"><div class="label">毛利(元)</div><div class="value">¥{{ fmtYuan(ov.profit.gross_profit) }}</div>
            <div class="sub">毛利率 {{ ov.profit.gross_margin }}%</div></div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card arpu"><div class="label">付费用户 / ARPU</div><div class="value">{{ fmtInt(ov.paying_users) }}</div>
            <div class="sub">ARPU ¥{{ fmtYuan(ov.arpu) }}</div></div>
        </el-col>
      </el-row>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="16">
        <el-card shadow="never" v-loading="loading">
          <template #header><span>收入 / 成本 / 利润趋势（近 {{ days }} 天）</span></template>
          <div v-show="hasTrend" ref="trendChartRef" class="chart-lg"></div>
          <el-empty v-show="!hasTrend" description="暂无收支数据" :image-size="80" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" v-loading="loading">
          <template #header><span>模型成本构成（按类型）</span></template>
          <div v-show="hasCost" ref="costChartRef" class="chart-lg"></div>
          <el-empty v-show="!hasCost" description="暂无模型调用成本" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="mt16">
      <el-col :span="12">
        <el-card shadow="never" v-loading="loading">
          <template #header>
            <div class="card-header">
              <span>欠费 / 低额预警</span>
              <el-input-number v-model="arrearsThreshold" :min="-100000" :step="100" size="small"
                controls-position="right" style="width: 140px" @change="loadArrears" />
            </div>
          </template>
          <el-table :data="arrears" size="small" stripe border max-height="320" style="width: 100%">
            <el-table-column prop="user_id" label="ID" width="70" />
            <el-table-column label="用户" min-width="140">
              <template #default="{ row }">{{ row.nickname || row.username }}<span class="uname">@{{ row.username }}</span></template>
            </el-table-column>
            <el-table-column label="积分余额" width="130">
              <template #default="{ row }"><span :class="row.level === 'arrears' ? 'neg' : 'low'">{{ fmtInt(row.balance) }}</span></template>
            </el-table-column>
            <el-table-column label="级别" width="90">
              <template #default="{ row }">
                <el-tag :type="row.level === 'arrears' ? 'danger' : 'warning'" size="small">
                  {{ row.level === 'arrears' ? '欠费' : '低额' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!arrears.length" description="无欠费 / 低额用户" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" v-loading="loading">
          <template #header><span>财务日报（近 {{ days }} 天）</span></template>
          <el-table :data="reports" size="small" stripe border max-height="320" style="width: 100%">
            <el-table-column prop="report_date" label="日期" width="110" />
            <el-table-column label="收入(元)" width="100">
              <template #default="{ row }">¥{{ fmtYuan(row.revenue) }}</template>
            </el-table-column>
            <el-table-column label="成本(元)" width="100">
              <template #default="{ row }">¥{{ fmtYuan(row.model_cost) }}</template>
            </el-table-column>
            <el-table-column label="毛利(元)" width="100">
              <template #default="{ row }"><span :class="Number(row.gross_profit) < 0 ? 'neg' : ''">¥{{ fmtYuan(row.gross_profit) }}</span></template>
            </el-table-column>
            <el-table-column prop="paying_users" label="付费用户" width="90" align="center" />
            <el-table-column label="ARPU" min-width="90">
              <template #default="{ row }">¥{{ fmtYuan(row.arpu) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!reports.length" description="暂无日报，点击「生成今日日报」" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 智能计费规则 -->
    <el-card shadow="never" class="mt16">
      <template #header>
        <div class="card-header">
          <span>智能计费规则</span>
          <el-button type="primary" size="small" @click="openRuleDialog()">新增规则</el-button>
        </div>
      </template>
      <el-table :data="rules" v-loading="rulesLoading" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="规则名称" min-width="150" show-overflow-tooltip />
        <el-table-column label="业务类型" width="100">
          <template #default="{ row }"><el-tag size="small">{{ businessLabel(row.business_type) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="用户等级" width="100">
          <template #default="{ row }">{{ levelLabel(row.user_level) }}</template>
        </el-table-column>
        <el-table-column prop="unit_points" label="单价(积分)" width="100" align="center" />
        <el-table-column label="折扣" width="80" align="center">
          <template #default="{ row }">{{ (Number(row.discount) * 10).toFixed(1) }} 折</template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="!!row.enabled" @change="(v) => toggleRule(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openRuleDialog(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeRule(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 规则编辑弹窗 -->
    <el-dialog v-model="ruleDialog" :title="ruleForm.id ? '编辑计费规则' : '新增计费规则'" width="520px">
      <el-form :model="ruleForm" label-width="100px">
        <el-form-item label="规则名称" required>
          <el-input v-model="ruleForm.name" placeholder="如：图片生成-企业用户折扣" />
        </el-form-item>
        <el-form-item label="业务类型">
          <el-select v-model="ruleForm.business_type" style="width: 100%">
            <el-option v-for="b in businessOptions" :key="b.value" :label="b.label" :value="b.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户等级">
          <el-select v-model="ruleForm.user_level" style="width: 100%">
            <el-option v-for="l in levelOptions" :key="l.value" :label="l.label" :value="l.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="单价(积分)">
          <el-input-number v-model="ruleForm.unit_points" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="折扣(0-1)">
          <el-input-number v-model="ruleForm.discount" :min="0" :max="1" :step="0.05" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="ruleForm.priority" :min="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="ruleForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialog = false">取消</el-button>
        <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Money } from '@element-plus/icons-vue'
import { financeAPI } from '@/api/finance'

const loading = ref(false)
const reporting = ref(false)
const days = ref(14)
const ov = ref(null)
const trend = ref({ dates: [], revenue: [], cost: [], profit: [] })
const costItems = ref([])
const arrears = ref([])
const arrearsThreshold = ref(0)
const reports = ref([])

const trendChartRef = ref(null)
const costChartRef = ref(null)
let trendChart = null
let costChart = null

const rules = ref([])
const rulesLoading = ref(false)
const ruleDialog = ref(false)
const ruleSaving = ref(false)
const ruleForm = reactive({ id: null, name: '', business_type: 'text', user_level: 'all', unit_points: 0, discount: 1, priority: 0, enabled: true, remark: '' })

const businessOptions = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'other', label: '其他' }
]
const levelOptions = [
  { value: 'all', label: '全部' },
  { value: 'individual', label: '个人' },
  { value: 'enterprise', label: '企业' },
  { value: 'vip', label: 'VIP' }
]

const hasTrend = computed(() => trend.value.dates.length > 0)
const hasCost = computed(() => costItems.value.some((x) => Number(x.cost) > 0))

function fmtInt(n) { return (Number(n) || 0).toLocaleString('zh-CN') }
function fmtYuan(n) { return (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function businessLabel(v) { return (businessOptions.find((x) => x.value === v) || {}).label || v }
function levelLabel(v) { return (levelOptions.find((x) => x.value === v) || {}).label || v }

function renderTrend() {
  if (!hasTrend.value) return
  nextTick(() => {
    if (!trendChartRef.value) return
    trendChart = trendChart || echarts.init(trendChartRef.value)
    trendChart.setOption({
      tooltip: { trigger: 'axis', valueFormatter: (v) => '¥' + fmtYuan(v) },
      legend: { data: ['收入', '成本', '利润'], bottom: 0 },
      grid: { left: 56, right: 24, top: 24, bottom: 44 },
      xAxis: { type: 'category', boundaryGap: false, data: trend.value.dates.map((d) => d.slice(5)) },
      yAxis: { type: 'value', name: '元', splitLine: { lineStyle: { type: 'dashed', color: '#EBEEF5' } } },
      series: [
        { name: '收入', type: 'line', smooth: true, data: trend.value.revenue, itemStyle: { color: '#409eff' }, areaStyle: { color: 'rgba(64,158,255,0.15)' } },
        { name: '成本', type: 'line', smooth: true, data: trend.value.cost, itemStyle: { color: '#f56c6c' }, areaStyle: { color: 'rgba(245,108,108,0.12)' } },
        { name: '利润', type: 'line', smooth: true, data: trend.value.profit, itemStyle: { color: '#67c23a' }, areaStyle: { color: 'rgba(103,194,58,0.12)' } }
      ]
    }, true)
  })
}
function renderCost() {
  if (!hasCost.value) return
  nextTick(() => {
    if (!costChartRef.value) return
    costChart = costChart || echarts.init(costChartRef.value)
    costChart.setOption({
      tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>成本：¥${fmtYuan(p.value)}（${p.percent}%）` },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie', radius: ['40%', '68%'], center: ['50%', '45%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        data: costItems.value.filter((x) => Number(x.cost) > 0).map((x) => ({ name: businessLabel(x.service_type), value: +Number(x.cost).toFixed(4) }))
      }]
    }, true)
  })
}

async function loadOverview() { ov.value = await financeAPI.overview(days.value) }
async function loadTrend() { trend.value = await financeAPI.dailyTrend(days.value); renderTrend() }
async function loadCost() { const r = await financeAPI.costBreakdown(); costItems.value = r.items || []; renderCost() }
async function loadArrears() { const r = await financeAPI.arrears({ threshold: arrearsThreshold.value, limit: 100 }); arrears.value = r.items || [] }
async function loadReports() { const r = await financeAPI.dailyReports(days.value); reports.value = r.items || [] }
async function loadRules() {
  rulesLoading.value = true
  try { const r = await financeAPI.listBillingRules(); rules.value = r.items || [] }
  finally { rulesLoading.value = false }
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadTrend(), loadCost(), loadArrears(), loadReports()])
  } catch (e) {
    ElMessage.error(e?.message || '财务数据加载失败')
  } finally {
    loading.value = false
  }
}

async function generateReport() {
  reporting.value = true
  try {
    await financeAPI.generateDailyReport()
    ElMessage.success('今日财务日报已生成')
    await loadReports()
  } catch (e) {
    ElMessage.error(e?.message || '日报生成失败')
  } finally {
    reporting.value = false
  }
}

function openRuleDialog(row) {
  if (row) {
    Object.assign(ruleForm, { ...row, enabled: !!row.enabled, discount: Number(row.discount) })
  } else {
    Object.assign(ruleForm, { id: null, name: '', business_type: 'text', user_level: 'all', unit_points: 0, discount: 1, priority: 0, enabled: true, remark: '' })
  }
  ruleDialog.value = true
}
async function saveRule() {
  if (!ruleForm.name.trim()) return ElMessage.warning('请填写规则名称')
  ruleSaving.value = true
  try {
    const payload = { ...ruleForm }
    if (ruleForm.id) await financeAPI.updateBillingRule(ruleForm.id, payload)
    else await financeAPI.createBillingRule(payload)
    ElMessage.success('保存成功')
    ruleDialog.value = false
    await loadRules()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    ruleSaving.value = false
  }
}
async function toggleRule(row, val) {
  try {
    await financeAPI.updateBillingRule(row.id, { enabled: val })
    row.enabled = val ? 1 : 0
    ElMessage.success(val ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}
async function removeRule(row) {
  try {
    await ElMessageBox.confirm(`确认删除规则「${row.name}」？`, '提示', { type: 'warning' })
    await financeAPI.deleteBillingRule(row.id)
    ElMessage.success('已删除')
    await loadRules()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e?.message || '删除失败')
  }
}

function onResize() { trendChart && trendChart.resize(); costChart && costChart.resize() }

onMounted(() => { loadAll(); loadRules(); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  trendChart && trendChart.dispose()
  costChart && costChart.dispose()
})
</script>

<style scoped>
.finance-page { padding: 16px; }
.top-card { margin-bottom: 16px; }
.top-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
.toolbar-title .subtitle { font-size: 12px; font-weight: 400; color: #909399; }
.actions { display: flex; gap: 10px; }
.stat-card { border-radius: 10px; padding: 16px; color: #fff; background: linear-gradient(135deg, #409eff, #66b1ff); }
.stat-card.cost { background: linear-gradient(135deg, #f56c6c, #f89898); }
.stat-card.profit { background: linear-gradient(135deg, #67c23a, #85ce61); }
.stat-card.arpu { background: linear-gradient(135deg, #e6a23c, #ebb563); }
.stat-card .label { font-size: 13px; opacity: 0.9; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.stat-card .sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
.chart-lg { height: 300px; }
.mt16 { margin-top: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.uname { color: #909399; font-size: 12px; margin-left: 6px; }
.neg { color: #f56c6c; font-weight: 600; }
.low { color: #e6a23c; font-weight: 600; }
</style>
