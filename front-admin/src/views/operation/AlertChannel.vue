<template>
  <div class="alert-channel-page">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#e6a23c"><BellFilled /></el-icon>
          <span>告警通道配置</span>
          <span class="subtitle">配置钉钉 / 企业微信 / 飞书群机器人 Webhook，订阅异常类型与严重级别</span>
        </div>
        <div class="toolbar-actions">
          <el-button type="primary" :icon="Plus" @click="openCreate">新建渠道</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
      </div>
    </el-card>

    <!-- 渠道列表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table v-loading="loading" :data="channels" stripe border row-key="id">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="名称" min-width="160">
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <el-tag v-if="!row.enabled" size="small" type="info" style="margin-left:6px">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="渠道" width="110">
          <template #default="{ row }">
            <el-tag :type="channelTagType(row.channel_type)" effect="plain">
              {{ channelLabel(row.channel_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Webhook（脱敏）" min-width="220">
          <template #default="{ row }">
            <code class="webhook-masked">{{ row.webhook_url_masked || '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column label="订阅级别" width="170">
          <template #default="{ row }">
            <el-tag
              v-for="s in severityBits(row.severity_mask)"
              :key="s.value"
              :type="s.tag"
              size="small"
              style="margin-right: 4px"
            >{{ s.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="限流" width="90" align="center">
          <template #default="{ row }">{{ row.rate_limit_minutes }} min</template>
        </el-table-column>
        <el-table-column label="@手机" width="120">
          <template #default="{ row }">
            <span v-if="row.mention_all" class="mention-all">@所有人</span>
            <span v-else-if="row.mention_mobiles && row.mention_mobiles.length">
              {{ row.mention_mobiles.join(', ') }}
            </span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="!!row.enabled"
              @change="(v) => toggleEnabled(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openTest(row)">测试推送</el-button>
            <el-button size="small" link type="warning" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除该渠道？" @confirm="doDelete(row)">
              <template #reference>
                <el-button size="small" link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑 对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑告警渠道' : '新建告警渠道'"
      width="640px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="130px" label-position="right">
        <el-form-item label="渠道名称" prop="name">
          <el-input v-model="form.name" placeholder="例：运营告警钉钉群" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="渠道类型" prop="channel_type">
          <el-radio-group v-model="form.channel_type">
            <el-radio-button value="dingtalk">钉钉机器人</el-radio-button>
            <el-radio-button value="wecom">企业微信</el-radio-button>
            <el-radio-button value="feishu">飞书机器人</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Webhook URL" prop="webhook_url">
          <el-input
            v-model="form.webhook_url"
            :placeholder="webhookPlaceholder"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 3 }"
          />
          <div class="form-tip">{{ webhookTip }}</div>
        </el-form-item>
        <el-form-item v-if="form.channel_type === 'dingtalk' || form.channel_type === 'feishu'" label="加签密钥">
          <el-input v-model="form.secret" placeholder="启用加签时填入，留空则不加签" />
          <div class="form-tip">钉钉/飞书机器人安全设置选"加签"时复制 secret 到此；企业微信无此功能</div>
        </el-form-item>
        <el-form-item label="严重级别">
          <el-checkbox-group v-model="severityChecked">
            <el-checkbox value="1">Critical（严重）</el-checkbox>
            <el-checkbox value="2">Warning（警告）</el-checkbox>
            <el-checkbox value="4">Info（信息）</el-checkbox>
          </el-checkbox-group>
          <div class="form-tip">多选 → 后端 severity_mask = 所选项之和（1/2/4）</div>
        </el-form-item>
        <el-form-item label="异常类型">
          <el-select v-model="typeSelected" multiple filterable placeholder="留空 = 订阅全部类型" style="width:100%">
            <el-option
              v-for="t in anomalyTypes"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
          <div class="form-tip">不选 = type_mask="*"，订阅所有异常类型</div>
        </el-form-item>
        <el-form-item label="@手机号">
          <el-input
            v-model="mentionInput"
            placeholder="多个手机号用逗号或空格分隔，如 13800000000, 13900000000"
          />
        </el-form-item>
        <el-form-item label="@所有人">
          <el-switch v-model="form.mention_all" />
        </el-form-item>
        <el-form-item label="限流间隔">
          <el-input-number v-model="form.rate_limit_minutes" :min="0" :max="1440" :step="1" />
          <span class="form-tip" style="margin-left:8px">分钟；同指纹告警在该间隔内只发一次（0=不限流）</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :autosize="{ minRows: 1, maxRows: 2 }" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 测试推送对话框 -->
    <el-dialog v-model="testVisible" title="测试推送" width="520px">
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
        将对该渠道发送一条模拟异常告警。若 Webhook 是真实机器人地址，群内会收到消息。
      </el-alert>
      <el-form label-width="100px">
        <el-form-item label="目标渠道">
          <el-tag>{{ testChannel?.name }}（{{ channelLabel(testChannel?.channel_type) }}）</el-tag>
        </el-form-item>
        <el-form-item label="异常类型">
          <el-select v-model="testAnomalyType" style="width:100%">
            <el-option label="负余额日志（critical）" value="neg_bal" />
            <el-option label="用户余额为负（critical）" value="userbalneg" />
            <el-option label="余额不一致（critical）" value="mismatch" />
            <el-option label="超大单笔（warning）" value="bigamt" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标 ID">
          <el-input v-model="testKeyId" placeholder="如 point_logs.id=162 或 users.id=5" />
          <div class="form-tip">拼成 anomalyId = 类型_目标ID；如 neg_bal_42</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="testVisible = false">关闭</el-button>
        <el-button type="primary" :loading="testing" @click="doTestPush">发送测试</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { BellFilled, Plus, Refresh } from '@element-plus/icons-vue'
import { alertAPI } from '@/api/alertChannels'

const loading = ref(false)
const channels = ref([])

// ---------- 常量映射 ----------
const channelTypes = [
  { value: 'dingtalk', label: '钉钉机器人' },
  { value: 'wecom',    label: '企业微信' },
  { value: 'feishu',   label: '飞书机器人' }
]
function channelLabel(t) {
  return channelTypes.find((c) => c.value === t)?.label || t
}
function channelTagType(t) {
  if (t === 'dingtalk') return 'primary'
  if (t === 'wecom')    return 'success'
  if (t === 'feishu')   return 'warning'
  return 'info'
}

const anomalyTypes = [
  { value: 'negative_balance',      label: '日志余额为负' },
  { value: 'negative_user_balance', label: '用户余额为负' },
  { value: 'huge_amount',           label: '单笔积分超大' },
  { value: 'balance_jump',          label: '余额跳变异常' },
  { value: 'balance_mismatch',      label: '用户-日志不一致' }
]

const severityOptions = [
  { value: 1, label: 'Critical', tag: 'danger' },
  { value: 2, label: 'Warning',  tag: 'warning' },
  { value: 4, label: 'Info',     tag: 'info' }
]
function severityBits(mask) {
  const m = Number(mask) || 0
  return severityOptions.filter((s) => (m & s.value) !== 0).map((s) => ({ ...s }))
}

// ---------- Webhook placeholder ----------
const webhookPlaceholder = computed(() => {
  if (form.channel_type === 'dingtalk') return 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
  if (form.channel_type === 'wecom')    return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx'
  if (form.channel_type === 'feishu')   return 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
  return ''
})
const webhookTip = computed(() => {
  if (form.channel_type === 'dingtalk') return '钉钉：群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook'
  if (form.channel_type === 'wecom')    return '企业微信：群聊 → 右键 → 添加群机器人 → 自定义 → 复制 Webhook 地址'
  if (form.channel_type === 'feishu')   return '飞书：群设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook'
  return ''
})

// ---------- 列表加载 ----------
async function loadList() {
  loading.value = true
  try {
    const data = await alertAPI.listChannels()
    channels.value = Array.isArray(data) ? data : []
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

// ---------- 新建/编辑 ----------
const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const formRef = ref(null)
const form = reactive({
  name: '',
  channel_type: 'dingtalk',
  webhook_url: '',
  secret: '',
  mention_all: false,
  rate_limit_minutes: 5,
  enabled: true,
  remark: ''
})
const severityChecked = ref(['1', '2', '4']) // 默认全选
const typeSelected = ref([])
const mentionInput = ref('')

const formRules = {
  name: [{ required: true, message: '请输入渠道名称', trigger: 'blur' }],
  channel_type: [{ required: true, message: '请选择渠道类型', trigger: 'change' }],
  webhook_url: [{ required: true, message: '请输入 Webhook URL', trigger: 'blur' }]
}

function resetForm() {
  form.name = ''
  form.channel_type = 'dingtalk'
  form.webhook_url = ''
  form.secret = ''
  form.mention_all = false
  form.rate_limit_minutes = 5
  form.enabled = true
  form.remark = ''
  severityChecked.value = ['1', '2', '4']
  typeSelected.value = []
  mentionInput.value = ''
  editingId.value = null
}

function openCreate() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  resetForm()
  editingId.value = row.id
  form.name = row.name || ''
  form.channel_type = row.channel_type || 'dingtalk'
  form.webhook_url = row.webhook_url || '' // 后端返回脱敏，用户可重新填
  form.secret = '' // 安全考虑不回显
  form.mention_all = !!row.mention_all
  form.rate_limit_minutes = Number(row.rate_limit_minutes) || 0
  form.enabled = !!row.enabled
  form.remark = row.remark || ''
  // severity_mask → checked
  const m = Number(row.severity_mask) || 0
  severityChecked.value = severityOptions
    .filter((s) => (m & s.value) !== 0)
    .map((s) => String(s.value))
  // type_mask
  const tm = String(row.type_mask || '*').trim()
  typeSelected.value = tm === '*' || tm === '' ? [] : tm.split(/[,，\s]+/).filter(Boolean)
  // mention_mobiles
  mentionInput.value = Array.isArray(row.mention_mobiles) ? row.mention_mobiles.join(', ') : ''
  dialogVisible.value = true
}

function parseMentions(str) {
  if (!str) return []
  return String(str).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
}

async function doSave() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const severityMask = severityChecked.value.reduce((sum, v) => sum + Number(v), 0) || 7
    const body = {
      name: form.name,
      channel_type: form.channel_type,
      webhook_url: form.webhook_url,
      secret: form.secret,
      mention_all: form.mention_all,
      mention_mobiles: parseMentions(mentionInput.value),
      severity_mask: severityMask,
      type_mask: typeSelected.value.length ? typeSelected.value.join(',') : '*',
      rate_limit_minutes: form.rate_limit_minutes,
      enabled: form.enabled,
      remark: form.remark
    }
    if (editingId.value) {
      await alertAPI.updateChannel(editingId.value, body)
      ElMessage.success('更新成功')
    } else {
      await alertAPI.createChannel(body)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// ---------- 启停 ----------
async function toggleEnabled(row, v) {
  try {
    await alertAPI.updateChannel(row.id, { enabled: v })
    row.enabled = v ? 1 : 0
    ElMessage.success(v ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

// ---------- 删除 ----------
async function doDelete(row) {
  try {
    await alertAPI.deleteChannel(row.id)
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

// ---------- 测试推送 ----------
const testVisible = ref(false)
const testChannel = ref(null)
const testAnomalyType = ref('neg_bal')
const testKeyId = ref('')
const testing = ref(false)

function openTest(row) {
  testChannel.value = row
  testAnomalyType.value = 'neg_bal'
  testKeyId.value = ''
  testVisible.value = true
}

async function doTestPush() {
  if (!testKeyId.value || !Number(testKeyId.value)) {
    ElMessage.warning('请输入目标 ID（数字）')
    return
  }
  testing.value = true
  try {
    const anomalyId = `${testAnomalyType.value}_${testKeyId.value}`
    const r = await alertAPI.dispatchForAnomaly(anomalyId, {})
    const total = r?.total || 0
    const ok = (r?.results || []).filter((x) => x.ok).length
    const failed = total - ok
    if (ok > 0) {
      ElMessage.success(`测试推送完成：${ok} 成功${failed ? ' / ' + failed + ' 失败' : ''}`)
    } else if (total === 0) {
      ElMessage.info('未匹配到启用的渠道，请检查该渠道是否 enabled=1')
    } else {
      ElMessage.warning(`推送失败（${failed} 条），请到"告警历史"查看错误详情`)
    }
    testVisible.value = false
  } catch (e) {
    ElMessage.error(e?.message || '测试失败')
  } finally {
    testing.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.alert-channel-page {
  padding: 16px;
}
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-title .subtitle {
  color: #909399;
  font-size: 13px;
  margin-left: 8px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.webhook-masked {
  font-family: monospace;
  font-size: 12px;
  color: #606266;
}
.mention-all {
  color: #e6a23c;
  font-weight: 600;
}
.text-muted {
  color: #c0c4cc;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
  margin-top: 2px;
}
</style>
