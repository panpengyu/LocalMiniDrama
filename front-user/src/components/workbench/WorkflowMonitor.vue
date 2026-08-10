<template>
  <!-- S7-T04 工作流执行监控面板：实时展示工作流实例执行进度与步骤状态 -->
  <el-dialog
    v-model="visible"
    title="工作流执行监控"
    width="800px"
    append-to-body
    destroy-on-close
    class="workflow-monitor-dialog"
    @close="onClose"
  >
    <div v-loading="loadingDetail" class="workflow-monitor">
      <!-- a. 实例选择器 -->
      <div class="monitor-section">
        <div class="section-label">执行实例</div>
        <div class="instance-selector">
          <el-select
            v-model="currentInstanceId"
            :loading="loadingList"
            placeholder="选择工作流实例"
            filterable
            style="flex: 1; min-width: 0"
            @change="onSelectInstance"
          >
            <el-option
              v-for="ins in instances"
              :key="ins.id"
              :label="`#${ins.id} · ${ins.definition_name || ins.definition_id || '未命名'}`"
              :value="ins.id"
            >
              <div class="instance-option">
                <span class="instance-option-id">#{{ ins.id }}</span>
                <span class="instance-option-name">{{ ins.definition_name || ins.definition_id || '未命名' }}</span>
                <span
                  class="instance-option-dot"
                  :style="{ background: STATUS_COLORS[ins.status] || '#909399' }"
                ></span>
              </div>
            </el-option>
          </el-select>
          <el-tag
            v-if="status"
            :type="STATUS_TAG_TYPE[status] || 'info'"
            effect="dark"
            size="default"
            :class="{ 'status-running': status === 'running' }"
          >
            {{ statusLabel(status) }}
          </el-tag>
        </div>
      </div>

      <el-empty
        v-if="!instance && !loadingDetail"
        description="选择一个工作流实例以查看执行详情"
        :image-size="80"
      />

      <template v-else-if="instance">
        <!-- b. 进度概览 -->
        <div class="monitor-section progress-overview">
          <div class="progress-header">
            <div class="progress-meta">
              <span class="step-count">
                步骤进度：{{ instance.completed_steps || 0 }} / {{ instance.total_steps || 0 }}
              </span>
              <span v-if="instance.started_at" class="started-at">
                开始：{{ formatTime(instance.started_at) }}
              </span>
            </div>
            <div class="progress-actions">
              <el-button
                v-if="status === 'running'"
                size="small"
                :loading="acting"
                @click="onPause"
              >暂停</el-button>
              <el-button
                v-if="status === 'paused'"
                size="small"
                type="primary"
                :loading="acting"
                @click="onResume"
              >继续</el-button>
              <el-button
                v-if="!['completed', 'cancelled'].includes(status)"
                size="small"
                type="danger"
                plain
                :loading="acting"
                @click="onCancel"
              >取消</el-button>
            </div>
          </div>
          <el-progress
            :percentage="progressPercent"
            :color="statusColor"
            :status="progressStatus"
            :stroke-width="14"
            text-inside
          />
          <div v-if="instance.error_message" class="error-message">
            错误：{{ instance.error_message }}
          </div>
        </div>

        <!-- c. 步骤时间线 -->
        <div class="monitor-section">
          <div class="section-label">步骤时间线</div>
          <el-timeline v-if="stepLogs.length" class="step-timeline">
            <el-timeline-item
              v-for="log in stepLogs"
              :key="log.id || log.step_index"
              placement="top"
              :timestamp="formatTime(log.completed_at || log.started_at)"
            >
              <template #icon>
                <el-icon
                  class="step-status-icon"
                  :class="{ 'is-spinning': log.status === 'running' }"
                  :style="{ color: stepColor(log.status) }"
                >
                  <component :is="stepIcon(log.status)" />
                </el-icon>
              </template>
              <div class="step-card">
                <div class="step-head">
                  <span class="step-name">
                    {{ log.step_name || stepTypeLabel(log.step_type) }}
                  </span>
                  <el-tag size="small" type="info" effect="plain">
                    {{ stepTypeLabel(log.step_type) }}
                  </el-tag>
                  <el-tag
                    v-if="log.retry_count && log.retry_count > 0"
                    size="small"
                    type="warning"
                    effect="plain"
                  >重试 {{ log.retry_count }}</el-tag>
                  <span
                    class="step-status-text"
                    :style="{ color: stepColor(log.status) }"
                  >{{ statusLabel(log.status) }}</span>
                </div>
                <div class="step-meta">
                  <span v-if="log.duration_ms != null" class="step-duration">
                    耗时 {{ formatDuration(log.duration_ms) }}
                  </span>
                </div>
                <div v-if="log.error_message" class="step-error">
                  {{ log.error_message }}
                </div>
                <div class="step-actions">
                  <template v-if="log.status === 'reviewing'">
                    <el-button size="small" type="success" :loading="acting" @click="onApprove(log)">通过</el-button>
                    <el-button size="small" type="warning" :loading="acting" @click="onReject(log)">驳回</el-button>
                  </template>
                  <template v-else-if="log.status === 'failed'">
                    <el-button size="small" :loading="acting" @click="onRetry(log)">重试</el-button>
                    <el-button size="small" :loading="acting" @click="onSkip(log)">跳过</el-button>
                  </template>
                  <template v-else-if="log.status === 'pending' && log.step_index !== instance.current_step_index">
                    <el-button size="small" :loading="acting" @click="onSkip(log)">跳过</el-button>
                  </template>
                </div>
              </div>
            </el-timeline-item>
          </el-timeline>
          <div v-else class="empty-tip">暂无步骤日志</div>
        </div>

        <!-- d. 上下文查看器 -->
        <div class="monitor-section">
          <el-collapse v-model="contextCollapsed">
            <el-collapse-item title="执行上下文 (Context)" name="ctx">
              <pre class="context-pre">{{ formatContext(instance.context) }}</pre>
            </el-collapse-item>
          </el-collapse>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Clock,
  Loading,
  CircleCheck,
  CircleClose,
  Minus,
  View
} from '@element-plus/icons-vue'
import { workflowAPI } from '@/api/workflow'

const props = defineProps({
  dramaId: { type: Number, required: true },
  instanceId: { type: Number, default: null }
})
const emit = defineEmits(['close'])

// 步骤类型中文标签
const STEP_TYPE_LABELS = {
  generate_outline: '生成剧本大纲',
  generate_characters: '生成角色档案',
  generate_episodes: '拆分分集剧情',
  generate_storyboard: '生成分镜脚本',
  generate_images: '生成分镜图片',
  generate_tts: '批量配音',
  auto_edit: '智能剪辑'
}

// 状态中文标签
const STATUS_LABELS = {
  pending: '待执行',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
  reviewing: '待审核',
  skipped: '已跳过'
}

// 状态颜色
const STATUS_COLORS = {
  pending: '#909399',
  running: '#409eff',
  paused: '#e6a23c',
  completed: '#67c23a',
  failed: '#f56c6c',
  cancelled: '#909399',
  reviewing: '#e6a23c',
  skipped: '#909399'
}

// el-tag type 映射
const STATUS_TAG_TYPE = {
  pending: 'info',
  running: 'primary',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'info',
  reviewing: 'warning',
  skipped: 'info'
}

// 步骤状态图标
const STEP_ICONS = {
  pending: Clock,
  running: Loading,
  completed: CircleCheck,
  failed: CircleClose,
  skipped: Minus,
  reviewing: View
}

const visible = ref(true)
const instances = ref([])
const currentInstanceId = ref(null)
const instance = ref(null)
const loadingList = ref(false)
const loadingDetail = ref(false)
const acting = ref(false)
const contextCollapsed = ref([])
let pollTimer = null

const status = computed(() => instance.value?.status || null)
const stepLogs = computed(() => instance.value?.step_logs || [])
const statusColor = computed(() => STATUS_COLORS[status.value] || '#909399')

const progressPercent = computed(() => {
  const total = Number(instance.value?.total_steps) || 0
  const completed = Number(instance.value?.completed_steps) || 0
  if (total <= 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
})

const progressStatus = computed(() => {
  if (status.value === 'completed') return 'success'
  if (status.value === 'failed') return 'exception'
  return undefined
})

function stepTypeLabel(t) {
  return STEP_TYPE_LABELS[t] || t || '未知'
}
function stepColor(s) {
  return STATUS_COLORS[s] || '#909399'
}
function stepIcon(s) {
  return STEP_ICONS[s] || Clock
}
function statusLabel(s) {
  return STATUS_LABELS[s] || s || '-'
}
function formatDuration(ms) {
  if (ms == null) return '-'
  const n = Number(ms)
  if (isNaN(n)) return '-'
  return (n / 1000).toFixed(1) + 's'
}
function formatTime(t) {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(t)
  return d.toLocaleString()
}
function formatContext(ctx) {
  if (ctx == null) return '{}'
  if (typeof ctx === 'string') {
    try {
      return JSON.stringify(JSON.parse(ctx), null, 2)
    } catch {
      return ctx
    }
  }
  try {
    return JSON.stringify(ctx, null, 2)
  } catch {
    return String(ctx)
  }
}

async function loadInstances() {
  loadingList.value = true
  try {
    const list = await workflowAPI.listInstances({ drama_id: props.dramaId, limit: 50 })
    instances.value = Array.isArray(list) ? list : []
    // 若传入的 instanceId 不在列表中，补一条以保证可选择
    if (
      props.instanceId != null &&
      !instances.value.some((i) => Number(i.id) === Number(props.instanceId))
    ) {
      try {
        const inst = await workflowAPI.getInstance(props.instanceId)
        if (inst) instances.value.unshift(inst)
      } catch {
        /* 忽略，后续选择时再加载详情 */
      }
    }
  } catch {
    instances.value = []
  } finally {
    loadingList.value = false
  }
}

async function loadInstanceDetail() {
  if (!currentInstanceId.value) {
    instance.value = null
    return
  }
  loadingDetail.value = true
  try {
    const data = await workflowAPI.getInstance(currentInstanceId.value)
    instance.value = data || null
  } catch {
    instance.value = null
  } finally {
    loadingDetail.value = false
  }
}

async function onSelectInstance(id) {
  currentInstanceId.value = id
  await loadInstanceDetail()
}

// 自动刷新：状态为 running 时每 2s 轮询
function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (currentInstanceId.value && !acting.value) {
      loadInstanceDetail()
    }
  }, 2000)
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(
  () => instance.value?.status,
  (s) => {
    if (s === 'running') startPolling()
    else stopPolling()
  }
)

onMounted(async () => {
  await loadInstances()
  if (props.instanceId != null) {
    currentInstanceId.value = Number(props.instanceId)
  } else if (instances.value.length) {
    currentInstanceId.value = instances.value[0].id
  }
  if (currentInstanceId.value) await loadInstanceDetail()
})

onBeforeUnmount(() => {
  stopPolling()
})

function onClose() {
  stopPolling()
  emit('close')
}

// ========== 操作 ==========
async function onPause() {
  acting.value = true
  try {
    await workflowAPI.pauseInstance(currentInstanceId.value)
    ElMessage.success('已暂停')
    await loadInstanceDetail()
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    acting.value = false
  }
}

async function onResume() {
  acting.value = true
  try {
    await workflowAPI.runInstance(currentInstanceId.value)
    ElMessage.success('已继续执行')
    await loadInstanceDetail()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}

async function onCancel() {
  try {
    await ElMessageBox.confirm('确认取消该工作流实例？取消后不可恢复。', '取消工作流', {
      confirmButtonText: '确认取消',
      cancelButtonText: '再想想',
      type: 'warning'
    })
  } catch {
    return
  }
  acting.value = true
  try {
    await workflowAPI.cancelInstance(currentInstanceId.value)
    ElMessage.success('已取消')
    await loadInstanceDetail()
    await loadInstances()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}

async function onSkip(log) {
  try {
    await ElMessageBox.confirm(
      `确认跳过步骤「${log.step_name || stepTypeLabel(log.step_type)}」？`,
      '跳过步骤',
      {
        confirmButtonText: '跳过',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }
  acting.value = true
  try {
    await workflowAPI.skipStep(currentInstanceId.value, log.step_index)
    ElMessage.success('已跳过')
    await loadInstanceDetail()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}

async function onRetry(log) {
  acting.value = true
  try {
    await workflowAPI.retryStep(currentInstanceId.value, log.step_index)
    ElMessage.success('已发起重试')
    await loadInstanceDetail()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}

async function onApprove(log) {
  acting.value = true
  try {
    await workflowAPI.reviewStep(currentInstanceId.value, log.step_index, {
      approved: true,
      note: ''
    })
    ElMessage.success('已通过审核')
    await loadInstanceDetail()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}

async function onReject(log) {
  let note = ''
  try {
    const res = await ElMessageBox.prompt('请输入驳回原因', '驳回步骤', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPattern: /.+/,
      inputErrorMessage: '请输入驳回原因'
    })
    note = res.value
  } catch {
    return
  }
  acting.value = true
  try {
    await workflowAPI.reviewStep(currentInstanceId.value, log.step_index, {
      approved: false,
      note
    })
    ElMessage.success('已驳回')
    await loadInstanceDetail()
  } catch {
    /* ignore */
  } finally {
    acting.value = false
  }
}
</script>

<style scoped>
.workflow-monitor-dialog :deep(.el-dialog__body) {
  background: rgba(24, 24, 30, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #e5e7eb;
  max-height: 70vh;
  overflow-y: auto;
}

.workflow-monitor-dialog :deep(.el-dialog__header) {
  background: rgba(24, 24, 30, 0.95);
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
}

.workflow-monitor-dialog :deep(.el-dialog__title) {
  color: #f3f4f6;
}

.workflow-monitor-dialog :deep(.el-dialog__headerbtn .el-dialog__close) {
  color: #cbd5e1;
}

.workflow-monitor-dialog :deep(.el-dialog__footer) {
  background: rgba(24, 24, 30, 0.95);
  border-top: 1px solid rgba(99, 102, 241, 0.2);
}

.workflow-monitor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: #e5e7eb;
}

.monitor-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #a5b4fc;
  letter-spacing: 0.5px;
}

/* 实例选择器 */
.instance-selector {
  display: flex;
  align-items: center;
  gap: 10px;
}

.instance-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.instance-option-id {
  color: #c7d2fe;
  font-weight: 600;
  flex-shrink: 0;
}

.instance-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e5e7eb;
}

.instance-option-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-running {
  animation: status-pulse 1.4s ease-in-out infinite;
}

@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.6);
  }
  50% {
    opacity: 0.7;
    box-shadow: 0 0 0 6px rgba(64, 158, 255, 0);
  }
}

/* 进度概览 */
.progress-overview {
  background: rgba(30, 30, 40, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  padding: 14px 16px;
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.progress-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-count {
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
}

.started-at {
  font-size: 12px;
  color: #9ca3af;
}

.progress-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.error-message {
  margin-top: 10px;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

/* 时间线 */
.step-timeline {
  padding-left: 4px;
}

/* 节点透明，仅显示状态图标 */
.step-timeline :deep(.el-timeline-item__node) {
  background: transparent !important;
  border: none !important;
  width: 22px !important;
  height: 22px !important;
  left: -3px !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-timeline :deep(.el-timeline-item__tail) {
  border-left: 2px solid rgba(99, 102, 241, 0.25);
}

.step-timeline :deep(.el-timeline-item__timestamp) {
  color: #9ca3af;
  font-size: 12px;
}

.step-status-icon {
  font-size: 18px;
}

.step-status-icon.is-spinning {
  animation: icon-spin 1s linear infinite;
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}

.step-card {
  background: rgba(30, 30, 40, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.step-name {
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
}

.step-status-text {
  font-size: 12px;
  margin-left: auto;
  font-weight: 600;
}

.step-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #9ca3af;
}

.step-error {
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
  background: rgba(245, 108, 108, 0.08);
  border-radius: 4px;
  padding: 4px 6px;
}

.step-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.empty-tip {
  color: #6b7280;
  font-size: 13px;
  padding: 8px 0;
}

/* 上下文查看器 */
.workflow-monitor :deep(.el-collapse) {
  border-top: 1px solid rgba(99, 102, 241, 0.2);
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
}

.workflow-monitor :deep(.el-collapse-item__header) {
  background: transparent;
  color: #a5b4fc;
  font-weight: 600;
  border-bottom: none;
}

.workflow-monitor :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}

.workflow-monitor :deep(.el-collapse-item__content) {
  color: #e5e7eb;
  padding-bottom: 12px;
}

.context-pre {
  background: rgba(15, 15, 20, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 0;
  max-height: 240px;
  overflow: auto;
  color: #c7d2fe;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

/* el-select / input 暗色适配 */
.workflow-monitor :deep(.el-select .el-input__wrapper),
.workflow-monitor :deep(.el-input__wrapper) {
  background-color: rgba(30, 30, 40, 0.8);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3) inset;
}

.workflow-monitor :deep(.el-select .el-input__inner),
.workflow-monitor :deep(.el-input__inner) {
  color: #e5e7eb;
}

.workflow-monitor :deep(.el-empty__description) {
  color: #9ca3af;
}
</style>
