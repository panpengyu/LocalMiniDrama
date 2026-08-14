<template>
  <div class="developer-center">
    <!-- 顶部概览 -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="hero-title-row">
          <el-icon class="hero-icon"><Key /></el-icon>
          <div>
            <h2 class="hero-title">开发者控制台</h2>
            <p class="hero-sub">创建应用与 API 密钥，接入 LocalMiniDrama 开放平台能力</p>
          </div>
        </div>

        <!-- 统计卡片 -->
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">累计调用</div>
            <div class="stat-value">{{ overview?.total_calls ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">今日调用</div>
            <div class="stat-value">{{ overview?.today_calls ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">今日错误</div>
            <div class="stat-value" :class="{ danger: (overview?.today_errors ?? 0) > 0 }">
              {{ overview?.today_errors ?? 0 }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">应用数</div>
            <div class="stat-value">{{ apps.length }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 主体：标签页 -->
    <div class="body-tabs">
      <el-tabs v-model="activeTab">
        <!-- ================= 密钥管理 ================= -->
        <el-tab-pane label="密钥管理" name="keys">
          <div class="pane-head">
            <h3>我的应用与密钥</h3>
            <el-button type="primary" @click="openCreateApp">
              <el-icon><Plus /></el-icon>&nbsp;创建应用
            </el-button>
          </div>

          <div v-if="apps.length === 0" class="empty">
            <el-empty description="还没有开发者应用，点击右上角创建第一个应用" />
          </div>

          <div v-for="app in apps" :key="app.app_id" class="app-card">
            <div class="app-head">
              <div class="app-title">
                <span class="app-name">{{ app.name }}</span>
                <el-tag
                  size="small"
                  :type="app.status === 'approved' ? 'success' : (app.status === 'rejected' ? 'danger' : 'warning')"
                  effect="dark"
                >{{ statusText(app.status) }}</el-tag>
              </div>
              <div class="app-meta">
                <span class="app-id">{{ app.app_id }}</span>
                <span v-if="app.reject_reason" class="reject-reason">驳回原因：{{ app.reject_reason }}</span>
                <el-button
                  v-if="app.status === 'approved'"
                  size="small"
                  type="primary"
                  plain
                  @click="openCreateKey(app)"
                >
                  <el-icon><Plus /></el-icon>&nbsp;创建密钥
                </el-button>
              </div>
            </div>

            <div v-if="app.status === 'approved'" class="key-table">
              <el-table :data="keysByApp(app.app_id)" size="small">
                <el-table-column label="密钥 ID" width="210">
                  <template #default="{ row }">
                    <span class="mono">{{ row.key_prefix }}••••••••</span>
                  </template>
                </el-table-column>
                <el-table-column label="名称" prop="name" width="120" />
                <el-table-column label="权限范围">
                  <template #default="{ row }">
                    <el-tag v-for="s in parseScopes(row.scopes)" :key="s" size="small" class="mr4">{{ scopeText(s) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="限流/配额" width="140">
                  <template #default="{ row }">
                    <span class="mono">{{ row.rate_limit_per_min }}/分 · {{ row.daily_quota }}/日</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="90">
                  <template #default="{ row }">
                    <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
                      {{ row.status === 'active' ? '启用' : '已吊销' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="过期时间" width="110">
                  <template #default="{ row }">{{ formatDate(row.expires_at) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="170" fixed="right">
                  <template #default="{ row }">
                    <template v-if="row.status === 'active'">
                      <el-button link type="primary" @click="renewKey(row)">续期</el-button>
                      <el-button link type="danger" @click="revokeKey(row)">吊销</el-button>
                    </template>
                    <el-button link type="info" @click="showKeyUsage(row)">用量</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <!-- ================= 调用统计 ================= -->
        <el-tab-pane label="调用统计" name="stats">
          <div class="pane-head">
            <h3>调用趋势（近 {{ trendDays }} 天）</h3>
            <el-select v-model="trendDays" size="small" style="width: 120px" @change="loadTrend">
              <el-option :value="7" label="近 7 天" />
              <el-option :value="14" label="近 14 天" />
              <el-option :value="30" label="近 30 天" />
            </el-select>
          </div>

          <!-- 配额监控 -->
          <div class="quota-panel">
            <div class="quota-title">当日配额使用率</div>
            <div v-if="overview?.quota_usage?.length" class="quota-list">
              <div v-for="q in overview.quota_usage" :key="q.key_id" class="quota-row">
                <div class="quota-meta">
                  <span class="quota-key">{{ q.key_name || q.key_id }}</span>
                  <span class="quota-count">{{ q.call_count }} / {{ q.quota_limit }}</span>
                </div>
                <el-progress
                  :percentage="q.usage_rate"
                  :status="q.usage_rate >= 100 ? 'exception' : (q.usage_rate >= 80 ? 'warning' : '')"
                  :stroke-width="8"
                />
              </div>
            </div>
            <el-empty v-else description="今日暂无配额用量数据" :image-size="60" />
          </div>

          <!-- 趋势条形图（轻量 CSS 实现） -->
          <div class="trend-panel">
            <div v-if="trend.points?.length" class="bars">
              <div v-for="p in trend.points" :key="p.date" class="bar-col">
                <div class="bar-wrap">
                  <div
                    class="bar bar-calls"
                    :style="{ height: barHeight(p.calls) }"
                    :title="`${p.date} 调用 ${p.calls}`"
                  ></div>
                  <div
                    class="bar bar-errors"
                    :style="{ height: barHeight(p.errors) }"
                    :title="`${p.date} 失败 ${p.errors}`"
                  ></div>
                </div>
                <div class="bar-label">{{ shortDate(p.date) }}</div>
              </div>
            </div>
            <el-empty v-else description="近期内暂无调用数据" :image-size="80" />
            <div class="legend">
              <span><i class="dot dot-calls"></i>调用</span>
              <span><i class="dot dot-errors"></i>失败</span>
            </div>
          </div>
        </el-tab-pane>

        <!-- ================= 错误日志 ================= -->
        <el-tab-pane label="错误日志" name="errors">
          <div class="pane-head">
            <h3>调用错误日志</h3>
            <el-button size="small" @click="loadErrors">刷新</el-button>
          </div>
          <el-table :data="errors.items" size="small">
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.status_code >= 500 ? 'danger' : 'warning'" size="small">{{ row.status_code }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="错误码" prop="error_code" width="180" />
            <el-table-column label="端点" prop="endpoint" min-width="160" />
            <el-table-column label="密钥" width="180">
              <template #default="{ row }">
                <span class="mono">{{ row.key_id }}</span>
              </template>
            </el-table-column>
            <el-table-column label="耗时(ms)" width="90">
              <template #default="{ row }">{{ row.latency_ms ?? '-' }}</template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              layout="total, prev, pager, next"
              :total="errors.total"
              :page-size="errors.pageSize"
              :current-page="errors.page"
              background
              @current-change="onErrorPage"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- ================= 创建应用对话框 ================= -->
    <el-dialog v-model="createAppVisible" title="创建开发者应用" width="460px">
      <el-form :model="appForm" label-width="90px">
        <el-form-item label="应用名称" required>
          <el-input v-model="appForm.name" placeholder="例如：我的小说助手" maxlength="60" />
        </el-form-item>
        <el-form-item label="应用描述">
          <el-input v-model="appForm.description" type="textarea" :rows="3" placeholder="描述应用用途（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createAppVisible = false">取消</el-button>
        <el-button type="primary" :loading="appLoading" @click="submitCreateApp">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- ================= 创建密钥对话框 ================= -->
    <el-dialog v-model="createKeyVisible" :title="`为「${currentApp?.name}」创建密钥`" width="560px">
      <el-form :model="keyForm" label-width="100px">
        <el-form-item label="密钥名称">
          <el-input v-model="keyForm.name" placeholder="例如：生产环境" maxlength="40" />
        </el-form-item>
        <el-form-item label="权限范围" required>
          <el-checkbox-group v-model="keyForm.scopes">
            <el-checkbox v-for="s in SCOPE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="限流(次/分)">
          <el-input-number v-model="keyForm.rate_limit_per_min" :min="1" :max="10000" />
        </el-form-item>
        <el-form-item label="配额(次/日)">
          <el-input-number v-model="keyForm.daily_quota" :min="1" :max="1000000" />
        </el-form-item>
        <el-form-item label="有效天数">
          <el-input-number v-model="keyForm.expires_in_days" :min="1" :max="3650" />
        </el-form-item>
        <el-form-item label="IP 白名单">
          <el-input
            v-model="ipWhitelistText"
            placeholder="每行一个 IP / 通配(192.168.*.*) / CIDR(10.0.0.0/8)，留空则不限制"
            type="textarea"
            :rows="2"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createKeyVisible = false">取消</el-button>
        <el-button type="primary" :loading="keyLoading" @click="submitCreateKey">生成密钥</el-button>
      </template>
    </el-dialog>

    <!-- ================= 新密钥提示对话框（明文仅此一次） ================= -->
    <el-dialog v-model="secretVisible" title="密钥已生成（请立即保存）" width="560px">
      <el-alert type="warning" :closable="false" show-icon>
        安全提示：密钥明文仅在创建时展示一次，关闭后无法再次查看。请妥善保管。
      </el-alert>
      <div class="secret-box">
        <span class="mono">{{ newSecret }}</span>
        <el-button link type="primary" @click="copySecret">复制</el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Plus } from '@element-plus/icons-vue'
import { openPlatformAPI } from '@/api/openPlatform'

// 权限范围白名单（与后端 API_SCOPES 保持一致）
const SCOPE_OPTIONS = [
  { value: 'drama:read', label: '项目管理-读' },
  { value: 'drama:write', label: '项目管理-写' },
  { value: 'screenplay:generate', label: '剧本生成' },
  { value: 'image:generate', label: '图片生成' },
  { value: 'asset:read', label: '素材查询' }
]

const activeTab = ref('keys')
const apps = ref([])
const keys = ref([])
const overview = ref(null)
const trend = ref({ points: [] })
const trendDays = ref(7)
const errors = ref({ items: [], total: 0, page: 1, pageSize: 20 })

const createAppVisible = ref(false)
const appForm = reactive({ name: '', description: '' })
const appLoading = ref(false)

const createKeyVisible = ref(false)
const currentApp = ref(null)
const keyForm = reactive({
  name: '',
  scopes: [],
  rate_limit_per_min: 60,
  daily_quota: 1000,
  expires_in_days: 30
})
const ipWhitelistText = ref('')
const keyLoading = ref(false)

const secretVisible = ref(false)
const newSecret = ref('')

// ---------- 数据加载 ----------
async function loadAll() {
  await Promise.allSettled([loadApps(), loadOverview(), loadTrend(), loadErrors()])
}

async function loadApps() {
  try {
    apps.value = await openPlatformAPI.listApps()
  } catch (e) {
    ElMessage.error(e.message || '加载应用失败')
  }
}

async function loadOverview() {
  try {
    overview.value = await openPlatformAPI.getStatsOverview()
  } catch (e) {
    ElMessage.error(e.message || '加载统计失败')
  }
}

async function loadTrend() {
  try {
    trend.value = await openPlatformAPI.getStatsTrend(trendDays.value)
  } catch (e) {
    ElMessage.error(e.message || '加载趋势失败')
  }
}

async function loadErrors(page = 1) {
  try {
    const data = await openPlatformAPI.getErrorLogs({ page, page_size: errors.value.pageSize })
    errors.value = { items: data.items, total: data.total, page: data.page, pageSize: data.pageSize }
  } catch (e) {
    ElMessage.error(e.message || '加载错误日志失败')
  }
}

async function loadKeysByApp(appId) {
  try {
    const list = await openPlatformAPI.listKeys()
    // 后端返回全部密钥，前端按应用过滤展示
    keys.value = list
  } catch (e) {
    ElMessage.error(e.message || '加载密钥失败')
  }
}

function keysByApp(appId) {
  return keys.value.filter((k) => k.app_id === appId)
}

// ---------- 应用 ----------
function openCreateApp() {
  appForm.name = ''
  appForm.description = ''
  createAppVisible.value = true
}

async function submitCreateApp() {
  if (!appForm.name || !appForm.name.trim()) {
    ElMessage.warning('请填写应用名称')
    return
  }
  appLoading.value = true
  try {
    await openPlatformAPI.createApp({ name: appForm.name.trim(), description: appForm.description })
    ElMessage.success('应用申请已提交，等待审核')
    createAppVisible.value = false
    await loadApps()
  } catch (e) {
    ElMessage.error(e.message || '提交失败')
  } finally {
    appLoading.value = false
  }
}

// ---------- 密钥 ----------
async function openCreateKey(app) {
  currentApp.value = app
  keyForm.name = ''
  keyForm.scopes = []
  keyForm.rate_limit_per_min = 60
  keyForm.daily_quota = 1000
  keyForm.expires_in_days = 30
  ipWhitelistText.value = ''
  createKeyVisible.value = true
}

async function submitCreateKey() {
  if (keyForm.scopes.length === 0) {
    ElMessage.warning('请至少选择一个权限范围')
    return
  }
  const ipWhitelist = ipWhitelistText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  keyLoading.value = true
  try {
    const result = await openPlatformAPI.createKey(currentApp.value.app_id, {
      name: keyForm.name || undefined,
      scopes: keyForm.scopes,
      rate_limit_per_min: keyForm.rate_limit_per_min,
      daily_quota: keyForm.daily_quota,
      expires_in_days: keyForm.expires_in_days,
      ip_whitelist: ipWhitelist.length ? ipWhitelist : undefined
    })
    newSecret.value = result.secret
    createKeyVisible.value = false
    secretVisible.value = true
    await loadKeysByApp(currentApp.value.app_id)
    await loadOverview()
  } catch (e) {
    ElMessage.error(e.message || '生成密钥失败')
  } finally {
    keyLoading.value = false
  }
}

function copySecret() {
  navigator.clipboard?.writeText(newSecret.value).then(() => {
    ElMessage.success('已复制')
  })
}

async function revokeKey(row) {
  try {
    await ElMessageBox.confirm(`确定吊销密钥 ${row.key_prefix}••••？吊销后立即失效。`, '吊销确认', {
      type: 'warning'
    })
    await openPlatformAPI.revokeKey(row.key_id)
    ElMessage.success('密钥已吊销')
    await loadKeysByApp()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '吊销失败')
  }
}

async function renewKey(row) {
  try {
    const { value } = await ElMessageBox.prompt('续期天数', '续期密钥', {
      inputValue: '30',
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入正整数'
    })
    await openPlatformAPI.renewKey(row.key_id, Number(value))
    ElMessage.success('续期成功')
    await loadKeysByApp()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '续期失败')
  }
}

function showKeyUsage(row) {
  activeTab.value = 'stats'
  loadOverview()
}

// ---------- 分页 ----------
function onErrorPage(p) {
  loadErrors(p)
}

// ---------- 格式化 ----------
function parseScopes(str) {
  if (Array.isArray(str)) return str
  try { return JSON.parse(str || '[]') } catch (_) { return [] }
}

function scopeText(s) {
  const opt = SCOPE_OPTIONS.find((o) => o.value === s)
  return opt ? opt.label : s
}

function statusText(s) {
  return { approved: '已通过', pending: '审核中', rejected: '已驳回' }[s] || s
}

function formatDate(v) {
  if (!v) return '-'
  return String(v).slice(0, 10)
}

function formatDateTime(v) {
  if (!v) return '-'
  return String(v).replace('T', ' ').slice(0, 19)
}

function shortDate(d) {
  return String(d).slice(5)
}

// 趋势条高度（相对最大值）
function barHeight(v) {
  const max = Math.max(...trend.value.points.map((p) => p.calls), 1)
  const h = Math.round((Number(v) / max) * 100)
  return `${Math.max(h, 2)}%`
}

onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.developer-center {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.hero {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(135deg, #1e1b4b, #4c1d95, #7c3aed);
  color: #fff;
}
.hero-bg {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 20% 20%, rgba(168,85,247,.4), transparent 45%),
    radial-gradient(circle at 80% 80%, rgba(236,72,153,.3), transparent 40%);
}
.hero-inner {
  position: relative;
  padding: 28px 28px 24px;
}
.hero-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.hero-icon {
  font-size: 34px;
  color: #c084fc;
}
.hero-title {
  margin: 0;
  font-size: 24px;
}
.hero-sub {
  margin: 6px 0 0;
  color: rgba(255,255,255,.75);
  font-size: 13px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: 22px;
}
.stat-card {
  background: rgba(255,255,255,.1);
  border: 1px solid rgba(255,255,255,.15);
  border-radius: 12px;
  padding: 14px 16px;
  backdrop-filter: blur(6px);
}
.stat-label { font-size: 12px; color: rgba(255,255,255,.7); }
.stat-value { font-size: 28px; font-weight: 700; margin-top: 4px; }
.stat-value.danger { color: #fca5a5; }

.body-tabs {
  margin-top: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 16px 20px;
}
.pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.pane-head h3 { margin: 0; font-size: 16px; }

.app-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
}
.app-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
}
.app-title { display: flex; align-items: center; gap: 8px; }
.app-name { font-weight: 600; font-size: 15px; }
.app-meta { display: flex; align-items: center; gap: 10px; }
.app-id { color: var(--el-text-color-secondary); font-size: 12px; }
.reject-reason { color: var(--el-color-danger); font-size: 12px; }

.key-table { padding: 8px 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.mr4 { margin-right: 4px; }

.empty { padding: 20px 0; }

.quota-panel {
  margin-top: 4px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}
.quota-title { font-weight: 600; margin-bottom: 12px; }
.quota-list { display: flex; flex-direction: column; gap: 12px; }
.quota-row { display: flex; flex-direction: column; gap: 6px; }
.quota-meta { display: flex; justify-content: space-between; font-size: 13px; }
.quota-count { color: var(--el-text-color-secondary); }

.trend-panel {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 200px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.bar-wrap {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 170px;
  width: 100%;
}
.bar {
  flex: 1;
  border-radius: 4px 4px 0 0;
  min-height: 2px;
}
.bar-calls { background: linear-gradient(180deg, #a78bfa, #7c3aed); }
.bar-errors { background: linear-gradient(180deg, #fca5a5, #ef4444); }
.bar-label { font-size: 11px; color: var(--el-text-color-secondary); }
.legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.dot-calls { background: #7c3aed; }
.dot-errors { background: #ef4444; }

.pager { display: flex; justify-content: flex-end; margin-top: 14px; }

.secret-box {
  margin-top: 14px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  word-break: break-all;
}
</style>
