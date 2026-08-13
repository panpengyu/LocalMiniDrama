<template>
  <div class="creator-center">
    <!-- 未入驻 / 待审核 / 已认证 三态 -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="creator-brief">
          <div class="avatar">
            <img v-if="creatorAvatar" :src="creatorAvatar" alt="avatar" @error="onImgError" />
            <el-icon v-else><UserFilled /></el-icon>
          </div>
          <div class="brief-text">
            <h2>{{ creator?.display_name || '成为创作者' }}</h2>
            <div class="brief-status">
              <el-tag v-if="creator" :type="verifyTag(creator.verify_status)" effect="dark" size="small">
                {{ verifyLabel(creator.verify_status) }}
              </el-tag>
              <span v-else class="brief-hint">入驻后即可发布模板、获得销售分成</span>
              <span v-if="creator?.verify_remark && creator.verify_status === 'rejected'" class="reject-remark">
                驳回原因：{{ creator.verify_remark }}
              </span>
            </div>
          </div>
        </div>
        <el-button class="apply-btn" @click="openApply">
          <el-icon><EditPen /></el-icon>{{ creator ? '编辑资料' : '立即入驻' }}
        </el-button>
      </div>
    </section>

    <!-- 已认证：收益 + 模板管理 -->
    <template v-if="creator && creator.verify_status === 'approved'">
      <!-- 收益卡片 -->
      <div class="earnings-grid">
        <div class="earn-card">
          <div class="earn-label">可提现余额（元）</div>
          <div class="earn-num primary">{{ fmtMoney(earnings?.balance) }}</div>
          <el-button size="small" type="primary" plain @click="openWithdraw">申请提现</el-button>
        </div>
        <div class="earn-card">
          <div class="earn-label">累计收益（元）</div>
          <div class="earn-num">{{ fmtMoney(earnings?.total_income) }}</div>
        </div>
        <div class="earn-card">
          <div class="earn-label">已提现（元）</div>
          <div class="earn-num">{{ fmtMoney(earnings?.total_withdrawn) }}</div>
        </div>
        <div class="earn-card">
          <div class="earn-label">销售订单 / 上架模板</div>
          <div class="earn-num">{{ earnings?.sales?.orders ?? 0 }} / {{ earnings?.template_count ?? 0 }}</div>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="creator-tabs">
        <!-- 我的模板 -->
        <el-tab-pane label="我的模板" name="templates">
          <div class="tab-toolbar">
            <el-select v-model="tplStatus" placeholder="状态" clearable class="mini-select" @change="loadMyTemplates">
              <el-option label="全部" value="" />
              <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
            <el-button type="primary" @click="openTemplateEditor()">
              <el-icon><Plus /></el-icon>新建模板
            </el-button>
          </div>
          <el-table v-loading="loadingTemplates" :data="myTemplates" class="data-table" empty-text="还没有模板，点击右上角创建">
            <el-table-column label="模板" min-width="220">
              <template #default="{ row }">
                <div class="tpl-cell">
                  <div class="tpl-cell-title">{{ row.title }}</div>
                  <div class="tpl-cell-sub">{{ row.template_no }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="分类" width="90">
              <template #default="{ row }">{{ categoryLabel(row.category) }}</template>
            </el-table-column>
            <el-table-column label="定价" width="100">
              <template #default="{ row }">{{ priceLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" size="small" effect="light">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="获取 / 评分" width="120">
              <template #default="{ row }">{{ row.download_count || 0 }} / {{ (Number(row.rating_avg) || 0).toFixed(1) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="280" fixed="right">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="openReviewLogs(row)">审核轨迹</el-button>
                <el-button
                  v-if="canEdit(row)"
                  size="small" text type="primary"
                  @click="openTemplateEditor(row)"
                >编辑</el-button>
                <el-button
                  v-if="canSubmit(row)"
                  size="small" text type="success"
                  :loading="submittingId === row.id"
                  @click="submitReview(row)"
                >提交审核</el-button>
                <el-button
                  v-if="canDelete(row)"
                  size="small" text type="danger"
                  @click="deleteTemplate(row)"
                >删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 收益流水 -->
        <el-tab-pane label="收益流水" name="ledger">
          <el-table v-loading="loadingLedger" :data="ledger" class="data-table" empty-text="暂无流水">
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="ledgerTag(row.entry_type)" size="small">{{ ledgerLabel(row.entry_type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额（元）" width="120">
              <template #default="{ row }">
                <span :class="Number(row.amount) >= 0 ? 'amt-in' : 'amt-out'">
                  {{ Number(row.amount) >= 0 ? '+' : '' }}{{ fmtMoney(row.amount) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="变更后余额" width="120">
              <template #default="{ row }">{{ fmtMoney(row.balance_after) }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="220" />
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 提现记录 -->
        <el-tab-pane label="提现记录" name="withdrawals">
          <el-table v-loading="loadingWithdrawals" :data="withdrawals" class="data-table" empty-text="暂无提现记录">
            <el-table-column prop="withdraw_no" label="提现单号" min-width="200" />
            <el-table-column label="金额（元）" width="120">
              <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="收款渠道" width="120">
              <template #default="{ row }">{{ accountTypeLabel(row.account_type) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="withdrawTag(row.status)" size="small">{{ withdrawLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="review_remark" label="审核备注" min-width="160" />
            <el-table-column label="申请时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <!-- 入驻/编辑资料对话框 -->
    <el-dialog v-model="applyVisible" :title="creator ? '编辑创作者资料' : '申请成为创作者'" width="560px">
      <el-form :model="applyForm" label-width="96px" class="apply-form">
        <el-form-item label="创作者名" required>
          <el-input v-model="applyForm.display_name" maxlength="64" placeholder="展示给用户的创作者昵称" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="applyForm.bio" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="介绍你的创作风格与擅长题材" />
        </el-form-item>
        <el-form-item label="实名">
          <el-input v-model="applyForm.real_name" maxlength="64" placeholder="用于身份核验（不对外展示）" />
        </el-form-item>
        <el-form-item label="联系方式">
          <el-input v-model="applyForm.contact" maxlength="128" placeholder="邮箱或手机号" />
        </el-form-item>
        <el-form-item label="收款渠道">
          <el-select v-model="applyForm.settle_account_type" placeholder="选择收款渠道" clearable style="width: 100%">
            <el-option label="支付宝" value="alipay" />
            <el-option label="微信" value="wechat" />
            <el-option label="银行卡" value="bank" />
          </el-select>
        </el-form-item>
        <el-form-item label="收款账号">
          <el-input v-model="applyForm.settle_account" maxlength="128" placeholder="提现打款账号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="applyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applying" @click="submitApply">提交</el-button>
      </template>
    </el-dialog>

    <!-- 模板编辑器 -->
    <el-dialog v-model="editorVisible" :title="editorForm.id ? '编辑模板' : '新建模板'" width="720px" top="6vh">
      <el-form :model="editorForm" label-width="96px" class="editor-form">
        <el-form-item label="标题" required>
          <el-input v-model="editorForm.title" maxlength="128" placeholder="模板标题" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="editorForm.summary" maxlength="255" placeholder="一句话介绍" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="分类">
              <el-select v-model="editorForm.category" style="width: 100%">
                <el-option v-for="(label, value) in CATEGORY_LABELS" :key="value" :label="label" :value="value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="题材">
              <el-input v-model="editorForm.genre_type" maxlength="32" placeholder="如：爽文 / 甜宠" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="定价">
              <el-radio-group v-model="editorForm.pricing_type">
                <el-radio-button label="free">免费</el-radio-button>
                <el-radio-button label="paid">付费</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item v-if="editorForm.pricing_type === 'paid'" label="售价(元)">
              <el-input-number v-model="editorForm.price" :min="0.01" :step="1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="封面图URL">
          <el-input v-model="editorForm.cover_image" placeholder="封面图地址（可为 /static/ 相对路径或 http 绝对地址）" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="editorForm.tags"
            multiple filterable allow-create default-first-option
            placeholder="输入后回车添加标签" style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="详细介绍">
          <el-input v-model="editorForm.description" type="textarea" :rows="3" maxlength="2000" show-word-limit />
        </el-form-item>

        <el-divider content-position="left">模板内容体（应用到项目的预设）</el-divider>

        <!-- 角色预设 -->
        <div class="preset-block">
          <div class="preset-head">
            <span>角色预设（{{ editorForm.character_presets.length }}）</span>
            <el-button size="small" text type="primary" @click="addCharacter"><el-icon><Plus /></el-icon>添加角色</el-button>
          </div>
          <div v-for="(c, i) in editorForm.character_presets" :key="'c' + i" class="preset-row">
            <el-input v-model="c.name" placeholder="角色名" class="pr-name" />
            <el-input v-model="c.role" placeholder="定位（如主角）" class="pr-role" />
            <el-input v-model="c.description" placeholder="人物描述" class="pr-desc" />
            <el-button size="small" text type="danger" @click="editorForm.character_presets.splice(i, 1)"><el-icon><Delete /></el-icon></el-button>
          </div>
        </div>

        <!-- 场景预设 -->
        <div class="preset-block">
          <div class="preset-head">
            <span>场景预设（{{ editorForm.scene_presets.length }}）</span>
            <el-button size="small" text type="primary" @click="addScene"><el-icon><Plus /></el-icon>添加场景</el-button>
          </div>
          <div v-for="(s, i) in editorForm.scene_presets" :key="'s' + i" class="preset-row">
            <el-input v-model="s.name" placeholder="场景名" class="pr-name" />
            <el-input v-model="s.location" placeholder="地点" class="pr-role" />
            <el-input v-model="s.description" placeholder="场景描述" class="pr-desc" />
            <el-button size="small" text type="danger" @click="editorForm.scene_presets.splice(i, 1)"><el-icon><Delete /></el-icon></el-button>
          </div>
        </div>

        <!-- 风格配置 -->
        <el-form-item label="全局风格">
          <el-input v-model="editorForm.style_global" placeholder="如 realistic / anime，作为项目全局风格" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingTemplate" @click="saveTemplate">保存草稿</el-button>
      </template>
    </el-dialog>

    <!-- 提现对话框 -->
    <el-dialog v-model="withdrawVisible" title="申请提现" width="420px">
      <div class="withdraw-form">
        <p class="withdraw-hint">可提现余额：<strong>{{ fmtMoney(earnings?.balance) }}</strong> 元</p>
        <el-form-item label="提现金额(元)">
          <el-input-number v-model="withdrawAmount" :min="0.01" :max="Number(earnings?.balance) || 0" :step="10" :precision="2" style="width: 100%" />
        </el-form-item>
        <p v-if="creator?.settle_account" class="withdraw-account">
          打款至：{{ accountTypeLabel(creator.settle_account_type) }} · {{ creator.settle_account }}
        </p>
        <el-alert v-else type="warning" :closable="false" title="请先在「编辑资料」中填写收款账户" />
      </div>
      <template #footer>
        <el-button @click="withdrawVisible = false">取消</el-button>
        <el-button type="primary" :loading="withdrawing" :disabled="!creator?.settle_account" @click="submitWithdraw">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- 审核轨迹抽屉 -->
    <el-drawer v-model="logsVisible" title="审核轨迹" size="440px">
      <el-timeline v-if="reviewLogs.length">
        <el-timeline-item
          v-for="log in reviewLogs"
          :key="log.id"
          :timestamp="formatDateTime(log.created_at)"
          :type="logDotType(log.action)"
          placement="top"
        >
          <div class="log-item">
            <div class="log-action">{{ actionLabel(log.action) }}</div>
            <div class="log-flow">{{ statusLabel(log.from_status) }} → {{ statusLabel(log.to_status) }}</div>
            <div v-if="log.score != null" class="log-score">AI 合规分：{{ Number(log.score).toFixed(1) }}</div>
            <div v-if="log.remark" class="log-remark">{{ log.remark }}</div>
          </div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无审核记录" />
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UserFilled, EditPen, Plus, Delete } from '@element-plus/icons-vue'
import { marketplaceAPI } from '@/api/marketplace'

const CATEGORY_LABELS = {
  general: '通用', urban: '都市', ancient: '古装', scifi: '科幻',
  campus: '校园', suspense: '悬疑', fantasy: '玄幻', romance: '言情',
  history: '历史', comedy: '喜剧'
}
const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审核' },
  { value: 'ai_passed', label: 'AI通过待复审' },
  { value: 'rejected', label: '已驳回' },
  { value: 'listed', label: '已上架' },
  { value: 'delisted', label: '已下架' }
]

const creator = ref(null)
const earnings = ref(null)
const activeTab = ref('templates')

const applyVisible = ref(false)
const applying = ref(false)
const applyForm = reactive({
  display_name: '', bio: '', real_name: '', contact: '',
  settle_account_type: '', settle_account: ''
})

const myTemplates = ref([])
const loadingTemplates = ref(false)
const tplStatus = ref('')
const submittingId = ref(null)

const ledger = ref([])
const loadingLedger = ref(false)
const withdrawals = ref([])
const loadingWithdrawals = ref(false)

const editorVisible = ref(false)
const savingTemplate = ref(false)
const editorForm = reactive(defaultEditorForm())

const withdrawVisible = ref(false)
const withdrawing = ref(false)
const withdrawAmount = ref(10)

const logsVisible = ref(false)
const reviewLogs = ref([])

const creatorAvatar = computed(() => {
  const a = creator.value?.avatar
  if (!a) return ''
  return a.startsWith('http') ? a : '/static/' + String(a).replace(/^\//, '')
})

function defaultEditorForm() {
  return {
    id: null, title: '', summary: '', description: '', category: 'general',
    genre_type: '', tags: [], cover_image: '', pricing_type: 'free', price: 1,
    character_presets: [], scene_presets: [], style_global: ''
  }
}

// ---------- 标签/格式化 ----------
function categoryLabel(c) { return CATEGORY_LABELS[c] || c || '通用' }
function verifyLabel(s) { return { pending: '认证审核中', approved: '已认证', rejected: '认证被驳回' }[s] || s }
function verifyTag(s) { return { pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info' }
function statusLabel(s) {
  return {
    draft: '草稿', pending: '待审核', ai_reviewing: 'AI预审中', ai_passed: 'AI通过待复审',
    rejected: '已驳回', listed: '已上架', delisted: '已下架'
  }[s] || s || '-'
}
function statusTag(s) {
  return {
    draft: 'info', pending: 'warning', ai_reviewing: 'warning', ai_passed: 'warning',
    rejected: 'danger', listed: 'success', delisted: 'info'
  }[s] || 'info'
}
function ledgerLabel(t) { return { income: '收益入账', withdraw: '提现出账', withdraw_refund: '提现退回' }[t] || t }
function ledgerTag(t) { return { income: 'success', withdraw: 'warning', withdraw_refund: 'info' }[t] || 'info' }
function withdrawLabel(s) { return { pending: '待审核', approved: '待打款', paid: '已打款', rejected: '已驳回' }[s] || s }
function withdrawTag(s) { return { pending: 'warning', approved: 'primary', paid: 'success', rejected: 'danger' }[s] || 'info' }
function accountTypeLabel(t) { return { alipay: '支付宝', wechat: '微信', bank: '银行卡' }[t] || (t || '-') }
function actionLabel(a) {
  return {
    submit: '提交审核', resubmit: '重新提交', ai_pass: 'AI预审通过', ai_reject: 'AI预审驳回',
    approve: '人工复审通过', reject: '人工复审驳回', delist: '下架', relist: '恢复上架'
  }[a] || a
}
function logDotType(a) {
  if (['ai_pass', 'approve', 'relist'].includes(a)) return 'success'
  if (['ai_reject', 'reject', 'delist'].includes(a)) return 'danger'
  return 'primary'
}
function isPaid(t) { return t?.pricing_type === 'paid' && Number(t?.price) > 0 }
function priceLabel(t) { return isPaid(t) ? `¥${Number(t.price).toFixed(2)}` : '免费' }
function fmtMoney(v) { return (Number(v) || 0).toFixed(2) }
function onImgError(e) { if (e?.target) e.target.style.display = 'none' }
function formatDateTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function canEdit(row) { return ['draft', 'rejected', 'delisted'].includes(row.status) }
function canSubmit(row) { return ['draft', 'rejected', 'delisted'].includes(row.status) }
function canDelete(row) { return !['pending', 'ai_reviewing', 'ai_passed'].includes(row.status) }

// ---------- 加载 ----------
async function loadCreator() {
  try {
    creator.value = await marketplaceAPI.getCreator()
    if (creator.value?.verify_status === 'approved') {
      await Promise.all([loadEarnings(), loadMyTemplates()])
    }
  } catch (e) { /* 拦截器已提示 */ }
}
async function loadEarnings() {
  try { earnings.value = await marketplaceAPI.earnings() } catch (e) { /* 拦截器已提示 */ }
}
async function loadMyTemplates() {
  loadingTemplates.value = true
  try {
    const res = await marketplaceAPI.myTemplates({ status: tplStatus.value || undefined, page: 1, page_size: 50 })
    myTemplates.value = res?.items || []
  } finally { loadingTemplates.value = false }
}
async function loadLedger() {
  loadingLedger.value = true
  try {
    const res = await marketplaceAPI.ledger({ limit: 50, offset: 0 })
    ledger.value = res?.items || []
  } finally { loadingLedger.value = false }
}
async function loadWithdrawals() {
  loadingWithdrawals.value = true
  try {
    const res = await marketplaceAPI.myWithdrawals({ limit: 50, offset: 0 })
    withdrawals.value = res?.items || []
  } finally { loadingWithdrawals.value = false }
}

// ---------- 入驻 ----------
function openApply() {
  if (creator.value) {
    applyForm.display_name = creator.value.display_name || ''
    applyForm.bio = creator.value.bio || ''
    applyForm.real_name = creator.value.real_name || ''
    applyForm.contact = creator.value.contact || ''
    applyForm.settle_account_type = creator.value.settle_account_type || ''
    applyForm.settle_account = creator.value.settle_account || ''
  }
  applyVisible.value = true
}
async function submitApply() {
  if (!applyForm.display_name.trim()) { ElMessage.warning('请填写创作者名'); return }
  applying.value = true
  try {
    creator.value = await marketplaceAPI.applyCreator({ ...applyForm })
    ElMessage.success(creator.value.verify_status === 'approved' ? '资料已更新' : '已提交，等待平台审核')
    applyVisible.value = false
    if (creator.value.verify_status === 'approved') loadEarnings()
  } catch (e) { /* 拦截器已提示 */ } finally { applying.value = false }
}

// ---------- 模板编辑 ----------
function openTemplateEditor(row) {
  Object.assign(editorForm, defaultEditorForm())
  if (row) {
    // 编辑时需拉取完整内容体
    marketplaceAPI.getTemplate(row.id).then((full) => {
      const content = full?.content || {}
      Object.assign(editorForm, {
        id: full.id,
        title: full.title || '',
        summary: full.summary || '',
        description: full.description || '',
        category: full.category || 'general',
        genre_type: full.genre_type || '',
        tags: Array.isArray(full.tags) ? full.tags : [],
        cover_image: full.cover_image || '',
        pricing_type: full.pricing_type || 'free',
        price: Number(full.price) || 1,
        character_presets: Array.isArray(content.character_presets) ? content.character_presets.map((c) => ({ ...c })) : [],
        scene_presets: Array.isArray(content.scene_presets) ? content.scene_presets.map((s) => ({ ...s })) : [],
        style_global: content.style_config?.globalStyle || ''
      })
    }).catch(() => {})
  }
  editorVisible.value = true
}
function addCharacter() { editorForm.character_presets.push({ name: '', role: '', description: '' }) }
function addScene() { editorForm.scene_presets.push({ name: '', location: '', description: '' }) }

function buildPayload() {
  const content = {
    character_presets: editorForm.character_presets.filter((c) => c.name && c.name.trim()),
    scene_presets: editorForm.scene_presets.filter((s) => s.name && s.name.trim()),
    style_config: editorForm.style_global ? { globalStyle: editorForm.style_global } : null
  }
  return {
    title: editorForm.title,
    summary: editorForm.summary || null,
    description: editorForm.description || null,
    category: editorForm.category,
    genre_type: editorForm.genre_type || null,
    tags: editorForm.tags,
    cover_image: editorForm.cover_image || null,
    pricing_type: editorForm.pricing_type,
    price: editorForm.pricing_type === 'paid' ? editorForm.price : 0,
    content
  }
}
async function saveTemplate() {
  if (!editorForm.title.trim()) { ElMessage.warning('请填写模板标题'); return }
  if (editorForm.pricing_type === 'paid' && !(Number(editorForm.price) > 0)) {
    ElMessage.warning('付费模板售价必须大于 0'); return
  }
  savingTemplate.value = true
  try {
    const payload = buildPayload()
    if (editorForm.id) {
      await marketplaceAPI.updateTemplate(editorForm.id, payload)
      ElMessage.success('模板已更新')
    } else {
      await marketplaceAPI.createTemplate(payload)
      ElMessage.success('模板草稿已创建')
    }
    editorVisible.value = false
    loadMyTemplates()
  } catch (e) { /* 拦截器已提示 */ } finally { savingTemplate.value = false }
}

async function submitReview(row) {
  submittingId.value = row.id
  try {
    const state = await marketplaceAPI.submitReview(row.id)
    if (state?.status === 'rejected') {
      ElMessage.warning(`AI 预审未通过：${state.reject_reason || '内容存在风险'}`)
    } else {
      ElMessage.success('已提交，AI 预审通过，等待人工复审')
    }
    loadMyTemplates()
  } catch (e) { /* 拦截器已提示 */ } finally { submittingId.value = null }
}

async function deleteTemplate(row) {
  try {
    await ElMessageBox.confirm(`确认删除模板《${row.title}》？`, '删除确认', { type: 'warning' })
  } catch (e) { return }
  try {
    await marketplaceAPI.deleteTemplate(row.id)
    ElMessage.success('已删除')
    loadMyTemplates()
  } catch (e) { /* 拦截器已提示 */ }
}

// ---------- 审核轨迹 ----------
async function openReviewLogs(row) {
  logsVisible.value = true
  reviewLogs.value = []
  try {
    const res = await marketplaceAPI.reviewLogs(row.id)
    reviewLogs.value = res?.items || []
  } catch (e) { /* 拦截器已提示 */ }
}

// ---------- 提现 ----------
function openWithdraw() {
  withdrawAmount.value = Math.min(10, Number(earnings.value?.balance) || 0) || 10
  withdrawVisible.value = true
}
async function submitWithdraw() {
  if (!(withdrawAmount.value > 0)) { ElMessage.warning('请输入提现金额'); return }
  withdrawing.value = true
  try {
    await marketplaceAPI.requestWithdrawal({ amount: withdrawAmount.value })
    ElMessage.success('提现申请已提交')
    withdrawVisible.value = false
    await Promise.all([loadEarnings(), loadWithdrawals()])
    activeTab.value = 'withdrawals'
  } catch (e) { /* 拦截器已提示 */ } finally { withdrawing.value = false }
}

// tab 切换懒加载
watch(activeTab, (tab) => {
  if (tab === 'ledger' && ledger.value.length === 0) loadLedger()
  if (tab === 'withdrawals' && withdrawals.value.length === 0) loadWithdrawals()
})

onMounted(loadCreator)
</script>

<style scoped>
.creator-center {
  padding: 20px 28px 40px;
  min-height: 100vh;
  background: #f5f6fa;
}

.hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  padding: 26px 32px;
  margin-bottom: 20px;
  color: #fff;
}
.hero-bg { position: absolute; inset: 0; background: linear-gradient(120deg,#0f766e 0%,#4338ca 60%,#7c3aed 100%); }
.hero-inner { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
.creator-brief { display: flex; align-items: center; gap: 16px; }
.avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.brief-text h2 { margin: 0 0 6px; font-size: 22px; }
.brief-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brief-hint { font-size: 13px; opacity: 0.9; }
.reject-remark { font-size: 12px; color: #fecaca; }
.apply-btn { --el-button-bg-color: rgba(255,255,255,0.9); --el-button-text-color: #4338ca; font-weight: 600; }

.earnings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
.earn-card {
  background: #fff; border-radius: 14px; padding: 18px 20px;
  box-shadow: 0 2px 10px rgba(15,23,42,0.05);
  display: flex; flex-direction: column; gap: 8px;
}
.earn-label { font-size: 13px; color: #6b7280; }
.earn-num { font-size: 24px; font-weight: 700; color: #1f2937; }
.earn-num.primary { color: #4338ca; }

.creator-tabs :deep(.el-tabs__item) { font-size: 15px; }
.tab-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.mini-select { width: 160px; }
.data-table { border-radius: 10px; overflow: hidden; }
.tpl-cell-title { font-weight: 600; color: #1f2937; }
.tpl-cell-sub { font-size: 12px; color: #9ca3af; }
.amt-in { color: #059669; font-weight: 600; }
.amt-out { color: #dc2626; font-weight: 600; }

.apply-form, .editor-form { padding-right: 12px; }
.preset-block { margin-bottom: 14px; }
.preset-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; color: #4b5563; font-weight: 600; }
.preset-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
.pr-name { width: 130px; }
.pr-role { width: 150px; }
.pr-desc { flex: 1; }

.withdraw-form { display: flex; flex-direction: column; gap: 10px; }
.withdraw-hint { color: #4b5563; }
.withdraw-account { font-size: 13px; color: #6b7280; }

.log-item { padding-bottom: 4px; }
.log-action { font-weight: 600; color: #1f2937; }
.log-flow { font-size: 12px; color: #6b7280; margin: 2px 0; }
.log-score { font-size: 12px; color: #7c3aed; }
.log-remark { font-size: 13px; color: #4b5563; margin-top: 4px; }
</style>
