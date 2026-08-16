<template>
  <div class="report-subscribe">
    <el-card shadow="never" class="page-card">
      <el-tabs v-model="activeTab">
        <!-- 订阅管理 -->
        <el-tab-pane label="报表订阅" name="subs">
          <div class="toolbar">
            <div class="toolbar-actions">
              <el-button type="primary" @click="openSubDialog()">
                <el-icon style="margin-right: 4px"><Plus /></el-icon>新建订阅
              </el-button>
            </div>
          </div>
          <el-table :data="subs" v-loading="loadingSubs" border stripe>
            <el-table-column prop="name" label="订阅名称" min-width="160" show-overflow-tooltip />
            <el-table-column label="周期" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="typeTag(row.report_type)">{{ typeLabel(row.report_type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="模板" min-width="150">
              <template #default="{ row }">{{ templateName(row.template_id) }}</template>
            </el-table-column>
            <el-table-column label="接收渠道" min-width="150">
              <template #default="{ row }">
                <div v-for="r in row.recipients" :key="r.type + r.target" class="recipient-line">
                  <el-tag size="small" :type="r.type === 'dingtalk' ? 'success' : 'primary'">{{ r.type }}</el-tag>
                  <span class="recipient-target">{{ r.target }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="80">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="(v) => toggleSub(row, v)" />
              </template>
            </el-table-column>
            <el-table-column label="最近运行" width="170">
              <template #default="{ row }">{{ fmtTime(row.last_run_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="runSub(row)">立即运行</el-button>
                <el-button link type="primary" size="small" @click="openSubDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="delSub(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 模板管理 -->
        <el-tab-pane label="报表模板" name="tpls">
          <div class="toolbar">
            <div class="toolbar-actions">
              <el-button type="primary" @click="openTplDialog()">
                <el-icon style="margin-right: 4px"><Plus /></el-icon>新建模板
              </el-button>
            </div>
          </div>
          <el-table :data="templates" v-loading="loadingTpls" border stripe>
            <el-table-column prop="name" label="模板名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
            <el-table-column label="分析模块" min-width="180">
              <template #default="{ row }">
                <el-tag v-for="s in row.sections" :key="s" size="small" class="tpl-section">{{ s }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="天数参数" width="100">
              <template #default="{ row }">{{ row.params?.days ?? '默认' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openTplDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="delTpl(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 发送日志 -->
        <el-tab-pane label="发送日志" name="logs">
          <div class="toolbar">
            <div class="filter-row">
              <el-select v-model="logFilter.status" placeholder="状态" clearable style="width: 120px">
                <el-option label="成功" value="success" />
                <el-option label="失败" value="failed" />
              </el-select>
              <el-select v-model="logFilter.channel" placeholder="渠道" clearable style="width: 120px">
                <el-option label="邮件" value="email" />
                <el-option label="钉钉" value="dingtalk" />
              </el-select>
              <el-button @click="loadLogs(1)">查询</el-button>
              <el-button type="warning" plain :loading="retryingBatch" @click="retryBatch">重试失败项</el-button>
            </div>
          </div>
          <el-table :data="logs" v-loading="loadingLogs" border stripe>
            <el-table-column prop="title" label="标题" min-width="240" show-overflow-tooltip />
            <el-table-column label="渠道" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.channel === 'dingtalk' ? 'success' : 'primary'">{{ row.channel }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="接收方" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.recipient }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'">
                  {{ row.status === 'success' ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="重试" width="70" prop="retry_count" />
            <el-table-column label="发送时间" width="170">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" :disabled="row.status === 'success'" @click="retryOne(row)">重试</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              layout="prev, pager, next, total"
              :total="logTotal"
              :page-size="20"
              :current-page="logPage"
              @current-change="loadLogs"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 订阅表单 -->
    <el-dialog v-model="subDialog.visible" :title="subDialog.form.id ? '编辑订阅' : '新建订阅'" width="560px" destroy-on-close>
      <el-form :model="subDialog.form" label-width="90px">
        <el-form-item label="订阅名称" required>
          <el-input v-model="subDialog.form.name" placeholder="如：每日运营日报" />
        </el-form-item>
        <el-form-item label="报告周期" required>
          <el-radio-group v-model="subDialog.form.report_type">
            <el-radio-button label="daily">每日</el-radio-button>
            <el-radio-button label="weekly">每周</el-radio-button>
            <el-radio-button label="monthly">每月</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="报表模板">
          <el-select v-model="subDialog.form.template_id" placeholder="选择模板" clearable style="width: 100%">
            <el-option v-for="t in templates" :key="t.id" :value="t.id" :label="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="接收人">
          <div v-for="(r, i) in subDialog.form.recipients" :key="i" class="recipient-editor">
            <el-select v-model="r.type" style="width: 110px">
              <el-option label="邮件" value="email" />
              <el-option label="钉钉" value="dingtalk" />
            </el-select>
            <el-input v-model="r.target" placeholder="邮箱地址或钉钉 webhook" class="recipient-input" />
            <el-button link type="danger" @click="subDialog.form.recipients.splice(i, 1)">删除</el-button>
          </div>
          <el-button size="small" @click="subDialog.form.recipients.push({ type: 'email', target: '' })">
            + 添加接收人
          </el-button>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="subDialog.form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="savingSub" @click="saveSub">保存</el-button>
      </template>
    </el-dialog>

    <!-- 模板表单 -->
    <el-dialog v-model="tplDialog.visible" :title="tplDialog.form.id ? '编辑模板' : '新建模板'" width="560px" destroy-on-close>
      <el-form :model="tplDialog.form" label-width="90px">
        <el-form-item label="模板名称" required>
          <el-input v-model="tplDialog.form.name" placeholder="如：运营日报模板" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="tplDialog.form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="分析模块">
          <el-checkbox-group v-model="tplDialog.form.sections">
            <el-checkbox label="overview">概览</el-checkbox>
            <el-checkbox label="behavior">行为</el-checkbox>
            <el-checkbox label="funnel">漏斗</el-checkbox>
            <el-checkbox label="retention">留存</el-checkbox>
            <el-checkbox label="events">事件</el-checkbox>
            <el-checkbox label="model">模型</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="天数参数">
          <el-input-number v-model="tplDialog.form.params.days" :min="1" :max="90" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tplDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="savingTpl" @click="saveTpl">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { reportsAPI } from '@/api/reports'

const activeTab = ref('subs')
const subs = ref([])
const templates = ref([])
const logs = ref([])
const loadingSubs = ref(false)
const loadingTpls = ref(false)
const loadingLogs = ref(false)
const logPage = ref(1)
const logTotal = ref(0)
const logFilter = reactive({ status: '', channel: '' })
const savingSub = ref(false)
const savingTpl = ref(false)
const retryingBatch = ref(false)

const typeLabel = (t) => ({ daily: '每日', weekly: '每周', monthly: '每月' }[t] || t)
const typeTag = (t) => ({ daily: 'primary', weekly: 'warning', monthly: 'success' }[t] || 'info')
const templateName = (id) => templates.value.find((t) => t.id === id)?.name || `#${id}`
const fmtTime = (s) => (s ? new Date(s).toLocaleString('zh-CN') : '—')

const subDialog = reactive({
  visible: false,
  form: {},
})

const tplDialog = reactive({
  visible: false,
  form: {},
})

function emptySub() {
  return { name: '', report_type: 'daily', template_id: null, recipients: [{ type: 'email', target: '' }], enabled: true }
}

function emptyTpl() {
  return { name: '', description: '', sections: ['overview', 'behavior', 'funnel', 'retention', 'events'], params: { days: 30 } }
}

async function loadSubs() {
  loadingSubs.value = true
  try {
    subs.value = await reportsAPI.listSubscriptions()
  } catch (e) {
    ElMessage.error(e?.message || '订阅列表加载失败')
  } finally {
    loadingSubs.value = false
  }
}

async function loadTpls() {
  loadingTpls.value = true
  try {
    templates.value = await reportsAPI.listTemplates()
  } catch (e) {
    ElMessage.error(e?.message || '模板列表加载失败')
  } finally {
    loadingTpls.value = false
  }
}

async function loadLogs(page = 1) {
  loadingLogs.value = true
  try {
    const res = await reportsAPI.listSendLogs({
      page,
      page_size: 20,
      status: logFilter.status || undefined,
      channel: logFilter.channel || undefined,
    })
    logs.value = res.items
    logTotal.value = res.total
    logPage.value = res.page
  } catch (e) {
    ElMessage.error(e?.message || '发送日志加载失败')
  } finally {
    loadingLogs.value = false
  }
}

function openSubDialog(row) {
  subDialog.form = row ? { ...row, recipients: (row.recipients || []).map((r) => ({ ...r })) } : emptySub()
  subDialog.visible = true
}

async function saveSub() {
  const f = subDialog.form
  if (!f.name || !f.recipients.some((r) => r.target)) {
    ElMessage.warning('请填写订阅名称与至少一位接收人')
    return
  }
  savingSub.value = true
  try {
    if (f.id) await reportsAPI.updateSubscription(f.id, f)
    else await reportsAPI.createSubscription(f)
    ElMessage.success('订阅已保存')
    subDialog.visible = false
    loadSubs()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    savingSub.value = false
  }
}

async function toggleSub(row, enabled) {
  try {
    await reportsAPI.updateSubscription(row.id, { enabled })
    row.enabled = enabled ? 1 : 0
    ElMessage.success(enabled ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

async function runSub(row) {
  try {
    const out = await reportsAPI.runSubscription(row.id)
    const okCount = out.results.filter((r) => r.ok).length
    ElMessage.success(`已运行，发送 ${okCount}/${out.results.length} 成功`)
    loadSubs()
    loadLogs(1)
  } catch (e) {
    ElMessage.error(e?.message || '运行失败')
  }
}

async function delSub(row) {
  await ElMessageBox.confirm(`确认删除订阅「${row.name}」？`, '删除确认', { type: 'warning' })
  await reportsAPI.deleteSubscription(row.id)
  ElMessage.success('已删除')
  loadSubs()
}

function openTplDialog(row) {
  tplDialog.form = row
    ? { ...row, sections: [...(row.sections || [])], params: { ...(row.params || {}) } }
    : emptyTpl()
  tplDialog.visible = true
}

async function saveTpl() {
  const f = tplDialog.form
  if (!f.name) {
    ElMessage.warning('请填写模板名称')
    return
  }
  savingTpl.value = true
  try {
    if (f.id) await reportsAPI.updateTemplate(f.id, f)
    else await reportsAPI.createTemplate(f)
    ElMessage.success('模板已保存')
    tplDialog.visible = false
    loadTpls()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    savingTpl.value = false
  }
}

async function delTpl(row) {
  await ElMessageBox.confirm(`确认删除模板「${row.name}」？`, '删除确认', { type: 'warning' })
  await reportsAPI.deleteTemplate(row.id)
  ElMessage.success('已删除')
  loadTpls()
}

async function retryOne(row) {
  try {
    const out = await reportsAPI.retrySendLog(row.id)
    ElMessage.success(`重试完成（检查 ${out.checked} 条）`)
    loadLogs(logPage.value)
  } catch (e) {
    ElMessage.error(e?.message || '重试失败')
  }
}

async function retryBatch() {
  retryingBatch.value = true
  try {
    const out = await reportsAPI.retryFailed(20)
    ElMessage.success(`批量重试完成（检查 ${out.checked} 条）`)
    loadLogs(logPage.value)
  } catch (e) {
    ElMessage.error(e?.message || '批量重试失败')
  } finally {
    retryingBatch.value = false
  }
}

onMounted(() => {
  loadSubs()
  loadTpls()
  loadLogs(1)
})

// 供 E2E/自检脚本使用
window.__reportsPreview = {
  loadSubs,
  loadTpls,
  loadLogs,
}
</script>

<style scoped>
.report-subscribe {
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
  margin-bottom: 14px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.recipient-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0;
}

.recipient-target {
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}

.tpl-section {
  margin-right: 6px;
}

.recipient-editor {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
}

.recipient-input {
  flex: 1;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
