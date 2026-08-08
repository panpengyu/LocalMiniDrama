<template>
  <div class="data-anomalies-page">
    <!-- 顶部：阈值 + 扫描按钮 + 汇总卡片 -->
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#ef4444"><WarningFilled /></el-icon>
          <span>数据异常检测</span>
          <span class="subtitle">
            自动扫描积分余额为负、单笔积分为巨值、余额跳变异常、用户余额与日志不一致等问题
          </span>
        </div>
        <div class="thresholds">
          <el-form :inline="true" :model="form" size="default" label-position="right">
            <el-form-item label="单笔积分阈值">
              <el-input-number
                v-model="form.amount_threshold"
                :min="10000"
                :step="100000"
                :controls="false"
                style="width: 200px"
              />
              <span class="help-tip">≥ 该值即报异常（默认 2 亿）</span>
            </el-form-item>
            <el-form-item label="余额跳变阈值">
              <el-input-number
                v-model="form.balance_threshold"
                :min="50000"
                :step="500000"
                :controls="false"
                style="width: 200px"
              />
              <span class="help-tip">相邻日志 Δbalance ≥ 该值即报异常（默认 5 亿）</span>
            </el-form-item>
            <el-button type="primary" :loading="loading" @click="loadData">
              {{ loading ? '扫描中…' : '立即扫描' }}
            </el-button>
          </el-form>
        </div>
      </div>

      <el-row :gutter="16" v-if="summary">
        <el-col :span="6">
          <div class="stat-card total">
            <div class="label">异常总数</div>
            <div class="value">{{ fmtInt(summary.total) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card critical">
            <div class="label">严重（critical）</div>
            <div class="value">{{ fmtInt(summary.bySeverity.critical) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card warning">
            <div class="label">警告（warning）</div>
            <div class="value">{{ fmtInt(summary.bySeverity.warning) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card info">
            <div class="label">信息 / 其它</div>
            <div class="value">{{ fmtInt(summary.bySeverity.info) }}</div>
          </div>
        </el-col>
      </el-row>

      <el-row v-if="summary && byTypeEntries.length" :gutter="16" style="margin-top:8px">
        <el-col :span="24">
          <div class="bytype-chip-row">
            <span class="bytype-label">按类型：</span>
            <el-tag
              v-for="[type, count] in byTypeEntries"
              :key="type"
              effect="light"
              :type="typeTag(type)"
              style="margin-right:8px"
            >
              {{ typeLabel(type) }}: {{ fmtInt(count) }}
            </el-tag>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 筛选：severity / type -->
    <el-card shadow="never" style="margin-top:16px">
      <el-form :inline="true" :model="filter" size="default">
        <el-form-item label="严重级别">
          <el-select v-model="filter.severity" placeholder="全部" clearable style="width:160px">
            <el-option label="严重 critical" value="critical" />
            <el-option label="警告 warning"   value="warning"  />
            <el-option label="信息 info"      value="info"     />
          </el-select>
        </el-form-item>
        <el-form-item label="异常类型">
          <el-select v-model="filter.type" placeholder="全部" clearable style="width:240px">
            <el-option
              v-for="t in knownTypes"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input
            v-model="filter.keyword"
            placeholder="搜索 reason / 手机号 / 昵称 / user_id"
            clearable
            style="width: 340px"
          />
        </el-form-item>
      </el-form>

      <el-table
        v-loading="loading"
        :data="pagedItems"
        stripe
        border
        height="62vh"
        row-key="id"
      >
        <el-table-column prop="id" label="ID" width="200" show-overflow-tooltip />
        <el-table-column label="级别" width="110">
          <template #default="{ row }">
            <el-tag
              :type="row.severity === 'critical' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'"
              effect="dark"
            >
              {{ row.severity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="180">
          <template #default="{ row }">
            <span>{{ typeLabel(row.type) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="原因 / 说明" min-width="360">
          <template #default="{ row }">
            <span>{{ row.reason }}</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="260">
          <template #default="{ row }">
            <code class="row-json">{{ row._short || '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="fixable(row.type)"
              type="primary"
              size="small"
              link
              @click="doFix(row)"
            >
              托底修复
            </el-button>
            <el-tooltip v-else content="该类异常需人工核对，不支持自动修复" placement="top">
              <el-button type="info" size="small" disabled>人工处理</el-button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 12px; display: flex; justify-content: flex-end">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="filteredItems.length"
          :page-sizes="[20, 50, 100, 200]"
          :page-size="form.page_size"
          :current-page="form.page"
          @size-change="(v) => { form.page_size = v; form.page = 1 }"
          @current-change="(v) => (form.page = v)"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import { dataAnomaliesAPI } from '@/api/dataAnomalies'
import { fmtInt } from '@/utils/format'

// ------------ 防抖（独立实现，避免额外依赖）------------
function debounce(fn, wait = 250) {
  let t = null
  const wrapped = function (...args) {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      fn.apply(this, args)
    }, wait)
  }
  wrapped.cancel = () => { if (t) { clearTimeout(t); t = null } }
  return wrapped
}

const loading = ref(false)
const summary = ref(null)
const items = ref([])

// 初始硬编码兜底值（页面加载时会用后端 /config 覆盖，保证无网络时输入框仍有合理默认）
const form = reactive({
  amount_threshold: 200000000,
  balance_threshold: 500000000,
  page: 1,
  page_size: 50
})
const serverDefaults = ref({ amountThreshold: null, balanceThreshold: null, logLevel: null })

const filter = reactive({
  severity: '',
  type: '',
  keyword: ''
})
// keyword 防抖副本：真正用于 computed 过滤的输入（避免每打一个字都 O(N) 重排）
const debouncedKeyword = ref('')
const applyKeyword = debounce((v) => { debouncedKeyword.value = v; form.page = 1 }, 220)
watch(() => filter.keyword, (nv) => applyKeyword(nv))
// severity / type 切换时立刻翻到第 1 页
watch([() => filter.severity, () => filter.type], () => { form.page = 1 })

const knownTypes = [
  { value: 'negative_balance',        label: '日志余额为负 (point_logs.balance_after < 0)' },
  { value: 'negative_user_balance',   label: '用户余额为负 (users.balance < 0)' },
  { value: 'huge_amount',             label: '单笔积分绝对值超大' },
  { value: 'balance_jump',            label: '余额跳变 Δbalance 超大或与 amount 不一致' },
  { value: 'balance_mismatch',        label: '用户 balance ≠ 最后一条日志 balance_after' }
]
function typeLabel(t) {
  const hit = knownTypes.find((x) => x.value === t)
  return hit ? hit.label : t
}
function typeTag(t) {
  if (t === 'negative_balance' || t === 'negative_user_balance') return 'danger'
  if (t === 'balance_mismatch') return 'danger'
  if (t === 'huge_amount') return 'warning'
  if (t === 'balance_jump') return 'warning'
  return 'info'
}
function fixable(t) {
  return t === 'negative_balance' || t === 'negative_user_balance' || t === 'balance_mismatch'
}

const byTypeEntries = computed(() =>
  summary.value ? Object.entries(summary.value.byType || {}) : []
)

// 把 JSON.stringify 放到 scan 后一次性算好（避免 table render 时 O(N) 反复序列化）
function attachShortDetail(list) {
  if (!Array.isArray(list)) return
  for (const r of list) {
    if (r._short != null) continue
    if (!r.row) { r._short = ''; continue }
    try {
      const s = JSON.stringify(r.row)
      r._short = s.length <= 180 ? s : s.slice(0, 177) + '...'
    } catch {
      r._short = String(r.row)
    }
  }
}

const filteredItems = computed(() => {
  let arr = items.value.slice()
  if (filter.severity) arr = arr.filter((r) => r.severity === filter.severity)
  if (filter.type)     arr = arr.filter((r) => r.type === filter.type)
  const kw = String(debouncedKeyword.value || '').toLowerCase()
  if (kw) {
    // 复用"预计算 haystack"缓存（挂到 item 上，避免每次重新 String.concat）
    arr = arr.filter((r) => {
      if (!r._kw) {
        r._kw = [
          r.reason, r.id,
          r.row && r.row.user_id,
          r.row && r.row.phone,
          r.row && r.row.nickname
        ].map((x) => (x == null ? '' : String(x).toLowerCase())).join(' | ')
      }
      return r._kw.includes(kw)
    })
  }
  return arr
})

const pagedItems = computed(() => {
  const start = (form.page - 1) * form.page_size
  return filteredItems.value.slice(start, start + form.page_size)
})

let scanAbort = null
async function loadDefaults() {
  try {
    const cfg = await dataAnomaliesAPI.getConfig()
    if (!cfg) return
    serverDefaults.value = cfg
    if (Number(cfg.amountThreshold) > 0) {
      form.amount_threshold = Number(cfg.amountThreshold)
    }
    if (Number(cfg.balanceThreshold) > 0) {
      form.balance_threshold = Number(cfg.balanceThreshold)
    }
  } catch (e) {
    // 失败则沿用前端硬编码默认值，不中断页面
  }
}

// 阈值变化防抖触发 scan（仅在"已经手动扫过一次/页面已加载完后"触发。初次 onMounted 明确调用 loadData 不走这里）
let _readyForAutoDebounce = false
const debouncedScan = debounce(() => { if (_readyForAutoDebounce) loadData() }, 500)
watch([() => form.amount_threshold, () => form.balance_threshold], () => {
  debouncedScan()
})

async function loadData() {
  // 取消上一次还在飞的扫描请求（避免"慢前一次覆盖快后一次"的时序问题）
  if (scanAbort) { try { scanAbort.abort?.() } catch {} scanAbort = null }
  loading.value = true
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  scanAbort = ctrl
  try {
    const res = await dataAnomaliesAPI.scan({
      amount_threshold: form.amount_threshold,
      balance_threshold: form.balance_threshold,
      limit: 400
    }, ctrl?.signal)
    if (ctrl?.signal?.aborted) return
    summary.value = res?.summary || { total: 0, bySeverity: { critical: 0, warning: 0, info: 0 }, byType: {} }
    items.value = res?.items || []
    attachShortDetail(items.value)
    form.page = 1
    if (summary.value.total === 0) {
      ElMessage.success('未检测到异常，数据库状态良好 ✅')
    } else {
      ElMessage.warning(`检测到 ${summary.value.total} 条异常记录`)
    }
  } catch (e) {
    if (ctrl?.signal?.aborted) return
    ElMessage.error(e?.message || '扫描失败')
  } finally {
    if (scanAbort === ctrl) scanAbort = null
    loading.value = false
  }
}

async function doFix(row) {
  try {
    await ElMessageBox.confirm(
      `确认执行"托底修复"？\n\n${row.reason}\n\n操作会自动写入数据库，请先核对 row 详情。`,
      '危险操作确认',
      { type: 'warning', confirmButtonText: '确认修复', cancelButtonText: '再看看' }
    )
  } catch {
    return
  }
  try {
    const r = await dataAnomaliesAPI.fix(row.id)
    ElMessage.success(r?.message || '修复完成')
    // 去掉已修复项并立即刷新 summary
    items.value = items.value.filter((x) => x.id !== row.id)
    if (summary.value) {
      summary.value.total -= 1
      summary.value.bySeverity[row.severity] = Math.max(0, (summary.value.bySeverity[row.severity] || 0) - 1)
      summary.value.byType[row.type] = Math.max(0, (summary.value.byType[row.type] || 0) - 1)
    }
  } catch (e) {
    ElMessage.error(e?.message || '修复失败')
  }
}

onBeforeUnmount(() => {
  if (scanAbort) { try { scanAbort.abort?.() } catch {} scanAbort = null }
  applyKeyword.cancel()
  debouncedScan.cancel()
})

onMounted(async () => {
  await loadDefaults()
  await loadData()
  _readyForAutoDebounce = true
})
</script>

<style scoped>
.data-anomalies-page {
  padding: 16px;
}
.top-card :deep(.el-card__body) { padding: 16px 20px 20px; }
.top-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
}
.toolbar-title .subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
  margin-left: 6px;
}
.help-tip { margin-left: 6px; color: #94a3b8; font-size: 12px; }

.stat-card {
  border-radius: 10px;
  padding: 14px 16px;
  color: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.stat-card .label { font-size: 12px; opacity: 0.88; }
.stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; letter-spacing: 0.2px; }
.stat-card.total    { background: linear-gradient(135deg, #4f46e5, #7c3aed); }
.stat-card.critical { background: linear-gradient(135deg, #dc2626, #ef4444); }
.stat-card.warning  { background: linear-gradient(135deg, #d97706, #f59e0b); }
.stat-card.info     { background: linear-gradient(135deg, #2563eb, #38bdf8); }

.bytype-chip-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-height: 36px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
}
.bytype-label { color: #475569; font-size: 13px; margin-right: 6px; }
.row-json {
  display: inline-block;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  max-width: 100%;
  word-break: break-all;
}
</style>
