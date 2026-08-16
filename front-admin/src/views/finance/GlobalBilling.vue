<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><DataAnalysis /></el-icon>
          <span>全局计费与收支看板</span>
          <span class="subtitle">S17-T05：智能计费规则 CRUD + 全局收入/成本聚合，数据全部来自 MySQL（无 mock）</span>
        </div>
        <div class="actions">
          <el-select v-model="trendDays" style="width: 120px" @change="loadOverview">
            <el-option :label="'近 ' + d + ' 天'" :value="d" v-for="d in [7, 14, 30, 90]" :key="d" />
          </el-select>
          <el-button :loading="loading" @click="loadAll">刷新</el-button>
          <el-button type="primary" @click="openRuleDialog()">新增计费规则</el-button>
        </div>
      </div>
    </el-card>

    <el-row :gutter="12" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计收入</div>
            <div class="stat-value" style="color: #67c23a">¥{{ overview.revenue?.total?.toFixed(2) || '0.00' }}</div>
            <div class="stat-sub">近 {{ trendDays }} 天 +¥{{ overview.revenue?.recent?.toFixed(2) || '0.00' }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">累计成本(模型)</div>
            <div class="stat-value" style="color: #e6a23c">¥{{ overview.cost?.model_cost?.toFixed(2) || '0.00' }}</div>
            <div class="stat-sub">{{ overview.cost?.model_calls || 0 }} 次调用</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">毛利 / 毛利率</div>
            <div class="stat-value" :style="{ color: (overview.profit?.gross_profit || 0) >= 0 ? '#409eff' : '#f56c6c' }">
              ¥{{ overview.profit?.gross_profit?.toFixed(2) || '0.00' }}
            </div>
            <div class="stat-sub">毛利率 {{ overview.profit?.gross_margin || 0 }}%</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">付费用户 / ARPU</div>
            <div class="stat-value" style="color: #409eff">{{ overview.paying_users || 0 }}</div>
            <div class="stat-sub">ARPU ¥{{ overview.arpu?.toFixed(2) || '0.00' }} · 消耗积分 {{ overview.consumed_points || 0 }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="chart-card">
      <div class="card-title">
        <span>收入 / 成本趋势</span>
        <span class="subtitle">按日聚合 recharges(paid) 与 ai_model_call_logs</span>
      </div>
      <div ref="trendRef" class="chart" />
    </el-card>

    <el-card shadow="never">
      <div class="table-head">
        <div class="card-title">
          <span>智能计费规则</span>
          <span class="subtitle">按业务类型/用户等级配置单价与折扣，计费时按优先级命中</span>
        </div>
      </div>
      <el-table :data="rules" stripe border v-loading="loading" style="width: 100%">
        <el-table-column prop="name" label="规则名" min-width="130" />
        <el-table-column label="业务类型" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small">{{ row.business_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="适用等级" width="100" align="center">
          <template #default="{ row }">{{ row.user_level || '全部' }}</template>
        </el-table-column>
        <el-table-column label="单价(积分)" width="110" align="right">
          <template #default="{ row }">{{ row.unit_points }}</template>
        </el-table-column>
        <el-table-column label="折扣" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="Number(row.discount) >= 1 ? 'info' : 'success'">{{ Number(row.discount).toFixed(2) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="80" align="center" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openRuleDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="removeRule(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="ruleVisible" :title="ruleForm.id ? '编辑计费规则' : '新增计费规则'" width="600px" destroy-on-close>
      <el-form ref="ruleFormRef" :model="ruleForm" :rules="ruleRules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="规则名" prop="name">
              <el-input v-model="ruleForm.name" placeholder="如 文生图标准价" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="业务类型" prop="business_type">
              <el-select v-model="ruleForm.business_type" style="width: 100%">
                <el-option v-for="t in ['image', 'video', 'text', 'audio', 'other']" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="适用等级">
              <el-select v-model="ruleForm.user_level" clearable placeholder="全部" style="width: 100%">
                <el-option v-for="l in ['free', 'basic', 'pro', 'vip']" :key="l" :label="l" :value="l" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="单次积分" prop="unit_points">
              <el-input-number v-model="ruleForm.unit_points" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="折扣系数">
              <el-input-number v-model="ruleForm.discount" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="优先级">
              <el-input-number v-model="ruleForm.priority" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="启用状态">
              <el-switch v-model="ruleForm.enabled" active-text="启用" inactive-text="停用" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="ruleForm.remark" type="textarea" :rows="2" placeholder="运营备注（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DataAnalysis } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import financeAPI from '@/api/finance'

const loading = ref(false)
const saving = ref(false)
const trendDays = ref(14)
const overview = ref({})
const rules = ref([])

const trendRef = ref()
let trendChart = null

const ruleVisible = ref(false)
const ruleFormRef = ref()
const emptyRule = () => ({
  id: null, name: '', business_type: 'image', user_level: '', unit_points: 10, discount: 1, priority: 0, enabled: true, remark: '',
})
const ruleForm = reactive(emptyRule())
const ruleRules = {
  name: [{ required: true, message: '请输入规则名', trigger: 'blur' }],
  business_type: [{ required: true, message: '请选择业务类型', trigger: 'change' }],
  unit_points: [{ required: true, message: '请输入单次积分', trigger: 'blur' }],
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadRules()])
  } finally {
    loading.value = false
  }
}

async function loadOverview() {
  try {
    const [ov, trend] = await Promise.all([
      financeAPI.overview(trendDays.value),
      financeAPI.dailyTrend(trendDays.value),
    ])
    overview.value = ov || {}
    renderTrend(trend || {})
  } catch (e) {
    ElMessage.error(e?.message || '加载收支数据失败')
  }
}

async function loadRules() {
  try {
    const res = await financeAPI.listBillingRules()
    rules.value = (res && res.items) || []
  } catch (e) {
    ElMessage.error(e?.message || '加载计费规则失败')
  }
}

function renderTrend(trend) {
  if (!trendRef.value) return
  if (!trendChart) trendChart = echarts.init(trendRef.value)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['收入(元)', '成本(元)'] },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: trend.dates || [] },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${v}` } },
    series: [
      { name: '收入(元)', type: 'line', smooth: true, areaStyle: { opacity: 0.08 }, data: trend.revenue || [], itemStyle: { color: '#67c23a' } },
      { name: '成本(元)', type: 'line', smooth: true, data: trend.cost || [], itemStyle: { color: '#e6a23c' } },
    ],
  })
}

function openRuleDialog(row) {
  if (row) {
    Object.assign(ruleForm, emptyRule(), {
      id: row.id, name: row.name, business_type: row.business_type,
      user_level: row.user_level || '', unit_points: Number(row.unit_points),
      discount: Number(row.discount), priority: Number(row.priority),
      enabled: !!row.enabled, remark: row.remark || '',
    })
  } else {
    Object.assign(ruleForm, emptyRule())
  }
  ruleVisible.value = true
}

async function saveRule() {
  try {
    await ruleFormRef.value.validate()
  } catch (_) {
    return
  }
  saving.value = true
  try {
    const payload = {
      name: ruleForm.name.trim(),
      business_type: ruleForm.business_type,
      user_level: ruleForm.user_level || null,
      unit_points: ruleForm.unit_points,
      discount: ruleForm.discount,
      priority: ruleForm.priority || 0,
      enabled: ruleForm.enabled,
      remark: ruleForm.remark || null,
    }
    if (ruleForm.id) {
      await financeAPI.updateBillingRule(ruleForm.id, payload)
      ElMessage.success('计费规则已更新')
    } else {
      await financeAPI.createBillingRule(payload)
      ElMessage.success('计费规则已创建')
    }
    ruleVisible.value = false
    await loadRules()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeRule(row) {
  try {
    await ElMessageBox.confirm(`确认删除计费规则「${row.name}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await financeAPI.deleteBillingRule(row.id)
    ElMessage.success('已删除')
    await loadRules()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

function resizeChart() {
  trendChart && trendChart.resize()
}

onMounted(async () => {
  await nextTick()
  await loadAll()
  window.addEventListener('resize', resizeChart)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart)
  trendChart && trendChart.dispose()
})
</script>

<style scoped>
.finance-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 12px;
}
.top-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.actions {
  display: flex;
  gap: 8px;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-card {
  text-align: center;
  padding: 4px 0;
}
.stat-label {
  font-size: 13px;
  color: #909399;
}
.stat-value {
  font-size: 20px;
  font-weight: 600;
  margin: 4px 0;
}
.stat-sub {
  font-size: 12px;
  color: #606266;
}
.chart-card {
  margin-bottom: 12px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}
.card-title .subtitle {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.chart {
  height: 300px;
}
.table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
</style>
