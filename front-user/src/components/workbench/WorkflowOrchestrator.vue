<template>
  <!-- ============================================================
       S7-T03: 工作流前端编排界面 WorkflowOrchestrator
       可视化工作流配置面板（el-dialog 形态），嵌入 DramaWorkbench 使用
       - 上：工作流定义列表（卡片）
       - 下：步骤编辑器（可拖拽排序的垂直步骤流）
       ============================================================ -->
  <el-dialog
    :model-value="visible"
    title="智能工作流编排"
    width="720px"
    append-to-body
    destroy-on-close
    class="wf-orch-dialog"
    @update:model-value="onVisibleChange"
    @open="onDialogOpen"
  >
    <!-- ============ 顶部：工作流定义列表 ============ -->
    <div class="wf-section">
      <div class="wf-section-header">
        <span class="wf-section-title">工作流定义</span>
        <el-button type="primary" size="small" @click="startCreate">
          <el-icon><Plus /></el-icon>&nbsp;新建工作流
        </el-button>
      </div>

      <div v-loading="loading" class="wf-def-list">
        <div v-if="!loading && !definitions.length" class="wf-empty">
          暂无工作流定义，点击右上角"新建工作流"开始编排
        </div>

        <div
          v-for="def in definitions"
          :key="def.id"
          class="wf-def-card"
        >
          <div class="wf-def-info">
            <div class="wf-def-name">{{ def.name }}</div>
            <div class="wf-def-desc">{{ def.description || '暂无描述' }}</div>
            <div class="wf-def-meta">
              <el-tag size="small" effect="plain">{{ triggerTypeLabel(def.trigger_type) }}</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ countSteps(def) }} 步</el-tag>
              <el-tag v-if="def.is_active" size="small" type="success" effect="plain">启用</el-tag>
              <el-tag v-else size="small" type="warning" effect="plain">停用</el-tag>
            </div>
          </div>
          <div class="wf-def-actions">
            <el-button size="small" @click="startEdit(def)">
              <el-icon><Edit /></el-icon>&nbsp;编辑
            </el-button>
            <el-button size="small" type="danger" plain @click="onDelete(def)">
              <el-icon><Delete /></el-icon>&nbsp;删除
            </el-button>
            <el-button
              size="small"
              type="primary"
              :loading="executingId === def.id"
              @click="onExecute(def)"
            >
              <el-icon><VideoPlay /></el-icon>&nbsp;一键执行
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 底部：步骤编辑器（创建/编辑时显示） ============ -->
    <div v-if="editing" class="wf-section wf-editor">
      <div class="wf-section-header">
        <span class="wf-section-title">{{ form.id ? '编辑工作流' : '新建工作流' }}</span>
        <el-button size="small" link @click="cancelEdit">收起</el-button>
      </div>

      <el-form label-width="90px" label-position="right" class="wf-form">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="请输入工作流名称" maxlength="100" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="可选，工作流用途说明"
          />
        </el-form-item>
        <el-form-item label="触发方式">
          <el-select v-model="form.trigger_type" style="width: 200px">
            <el-option label="手动触发" value="manual" />
            <el-option label="保存后触发" value="on_save" />
            <el-option label="定时触发" value="schedule" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="form.is_active" />
        </el-form-item>
      </el-form>

      <!-- 步骤编排区 -->
      <div class="wf-steps-wrap">
        <div class="wf-steps-title">步骤编排（拖拽卡片可调整顺序）</div>

        <div class="wf-steps">
          <template v-for="(step, idx) in form.steps_config" :key="idx">
            <div
              class="wf-step-card"
              :class="{ 'is-dragging': dragIndex === idx, 'is-drop-target': dropTargetIndex === idx }"
              draggable="true"
              @dragstart="onDragStart($event, idx)"
              @dragover.prevent="onDragOver(idx)"
              @dragleave="onDragLeave(idx)"
              @drop="onDrop(idx)"
              @dragend="onDragEnd"
            >
              <div class="wf-step-header">
                <span class="wf-step-index">{{ idx + 1 }}</span>
                <span class="wf-step-type-tag">{{ stepTypeLabel(step.type) }}</span>
                <el-button
                  class="wf-step-del"
                  link
                  type="danger"
                  size="small"
                  @click="removeStep(idx)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>

              <el-form label-width="80px" label-position="right" class="wf-step-form">
                <el-form-item label="步骤类型">
                  <el-select
                    v-model="step.type"
                    style="width: 100%"
                    @change="onStepTypeChange(step)"
                  >
                    <el-option
                      v-for="opt in STEP_OPTIONS"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="步骤名称">
                  <el-input v-model="step.name" placeholder="步骤显示名称" />
                </el-form-item>
                <div class="wf-step-row">
                  <el-form-item label="需要审核">
                    <el-switch v-model="step.need_review" />
                  </el-form-item>
                  <el-form-item label="最大重试">
                    <el-input-number
                      v-model="step.max_retry"
                      :min="0"
                      :max="5"
                      controls-position="right"
                    />
                  </el-form-item>
                </div>
                <el-form-item label="执行条件">
                  <el-input
                    v-model="step.condition"
                    placeholder="条件表达式，如 generate_outline.success == true"
                  />
                </el-form-item>
              </el-form>
            </div>

            <!-- 步骤间箭头（最后一个步骤后不显示） -->
            <div v-if="idx < form.steps_config.length - 1" class="wf-step-arrow">↓</div>
          </template>
        </div>

        <el-button class="wf-add-step-btn" plain @click="addStep">
          <el-icon><Plus /></el-icon>&nbsp;添加步骤
        </el-button>
      </div>

      <div class="wf-editor-footer">
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDefinition">
          {{ form.id ? '保存修改' : '创建工作流' }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, VideoPlay } from '@element-plus/icons-vue'
import { workflowAPI } from '@/api/workflow'

const props = defineProps({
  dramaId: { type: Number, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'instance-created'])

/** 7 种步骤类型（中文标签） */
const STEP_OPTIONS = [
  { value: 'generate_outline', label: '生成剧本大纲' },
  { value: 'generate_characters', label: '生成角色档案' },
  { value: 'generate_episodes', label: '拆分分集剧情' },
  { value: 'generate_storyboard', label: '生成分镜脚本' },
  { value: 'generate_images', label: '生成分镜图片' },
  { value: 'generate_tts', label: '批量配音' },
  { value: 'auto_edit', label: '智能剪辑' },
]

const STEP_LABEL_MAP = STEP_OPTIONS.reduce((m, o) => {
  m[o.value] = o.label
  return m
}, {})

function stepTypeLabel(type) {
  return STEP_LABEL_MAP[type] || type || '未知'
}

function triggerTypeLabel(type) {
  return { manual: '手动', on_save: '保存触发', schedule: '定时' }[type] || type || '手动'
}

/** steps_config 可能为 JSON 字符串（来自 DB）或数组，统一解析为数组 */
function parseSteps(val) {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function countSteps(def) {
  return parseSteps(def?.steps_config).length
}

/* ==================== 状态 ==================== */
const loading = ref(false)
const saving = ref(false)
const editing = ref(false)
const definitions = ref([])
const executingId = ref(null)

const form = reactive({
  id: null,
  name: '',
  description: '',
  trigger_type: 'manual',
  is_active: true,
  steps_config: [],
})

/* ==================== 拖拽排序（原生 HTML5） ==================== */
const dragIndex = ref(null)
const dropTargetIndex = ref(null)

function onDragStart(e, idx) {
  dragIndex.value = idx
  // 兼容 Firefox：必须调用 setData 才能触发拖拽
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(idx) {
  if (dragIndex.value !== null && dragIndex.value !== idx) {
    dropTargetIndex.value = idx
  }
}

function onDragLeave(idx) {
  if (dropTargetIndex.value === idx) {
    dropTargetIndex.value = null
  }
}

function onDrop(idx) {
  const from = dragIndex.value
  dropTargetIndex.value = null
  if (from === null || from === idx) {
    dragIndex.value = null
    return
  }
  const steps = form.steps_config
  const [moved] = steps.splice(from, 1)
  steps.splice(idx, 0, moved)
  dragIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dropTargetIndex.value = null
}

/* ==================== 数据加载 ==================== */
async function loadDefinitions() {
  if (!props.dramaId) return
  loading.value = true
  try {
    const res = await workflowAPI.listDefinitions({ drama_id: props.dramaId })
    definitions.value = Array.isArray(res) ? res : (res?.items || [])
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    loading.value = false
  }
}

function onDialogOpen() {
  loadDefinitions()
}

/* ==================== Dialog 显隐 ==================== */
function onVisibleChange(v) {
  emit('update:visible', v)
}

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      editing.value = false
      dragIndex.value = null
      dropTargetIndex.value = null
    }
  }
)

watch(
  () => props.dramaId,
  (newId, oldId) => {
    if (newId && newId !== oldId && props.visible) {
      loadDefinitions()
    }
  }
)

/* ==================== 创建 / 编辑 ==================== */
function startCreate() {
  form.id = null
  form.name = ''
  form.description = ''
  form.trigger_type = 'manual'
  form.is_active = true
  form.steps_config = []
  editing.value = true
}

function startEdit(def) {
  form.id = def.id
  form.name = def.name || ''
  form.description = def.description || ''
  form.trigger_type = def.trigger_type || 'manual'
  form.is_active = !!def.is_active
  form.steps_config = parseSteps(def.steps_config).map((s) => ({
    type: s.type || 'generate_outline',
    name: s.name || '',
    need_review: !!s.need_review,
    max_retry: Number(s.max_retry) || 0,
    condition: s.condition || '',
    params: s.params || {},
  }))
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function addStep() {
  form.steps_config.push({
    type: 'generate_outline',
    name: '',
    need_review: false,
    max_retry: 2,
    condition: '',
    params: {},
  })
}

function removeStep(idx) {
  form.steps_config.splice(idx, 1)
}

function onStepTypeChange(step) {
  // 类型切换时，若名称为空或仍为旧类型默认名，则自动填充新类型中文名
  if (!step.name || Object.values(STEP_LABEL_MAP).includes(step.name)) {
    step.name = stepTypeLabel(step.type)
  }
}

async function saveDefinition() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写工作流名称')
    return
  }
  if (!form.steps_config.length) {
    ElMessage.warning('请至少添加一个步骤')
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      drama_id: props.dramaId,
      steps_config: form.steps_config,
      trigger_type: form.trigger_type,
      is_active: form.is_active ? 1 : 0,
    }
    if (form.id) {
      await workflowAPI.updateDefinition(form.id, payload)
      ElMessage.success('工作流已更新')
    } else {
      await workflowAPI.createDefinition(payload)
      ElMessage.success('工作流已创建')
    }
    editing.value = false
    await loadDefinitions()
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    saving.value = false
  }
}

/* ==================== 删除 ==================== */
async function onDelete(def) {
  try {
    await ElMessageBox.confirm(
      `确定删除工作流"${def.name}"吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }

  try {
    await workflowAPI.deleteDefinition(def.id)
    ElMessage.success('工作流已删除')
    await loadDefinitions()
  } catch {
    // 错误已由 request 拦截器统一提示
  }
}

/* ==================== 一键执行 ==================== */
async function onExecute(def) {
  executingId.value = def.id
  try {
    const instance = await workflowAPI.createInstance({
      definition_id: def.id,
      drama_id: props.dramaId,
      context: {},
    })
    const instanceId = instance?.id
    ElMessage.success('工作流已启动，正在异步执行')
    emit('instance-created', instanceId)
    emit('update:visible', false)
  } catch {
    // 错误已由 request 拦截器统一提示
  } finally {
    executingId.value = null
  }
}
</script>

<style>
/* ===== 非 scoped：el-dialog 使用 append-to-body 会 teleport 到 body 外，
   scoped 样式无法穿透，故通过自定义 class 前缀做暗色玻璃拟态 ===== */
.wf-orch-dialog.el-dialog {
  background: rgba(24, 24, 30, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 12px;
  color: #e5e7eb;
  overflow: hidden;
}
.wf-orch-dialog .el-dialog__header {
  margin-right: 0;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
  background: rgba(99, 102, 241, 0.06);
}
.wf-orch-dialog .el-dialog__title {
  color: #f3f4f6;
  font-size: 16px;
  font-weight: 600;
}
.wf-orch-dialog .el-dialog__headerbtn .el-dialog__close {
  color: #9ca3af;
}
.wf-orch-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: #6366f1;
}
.wf-orch-dialog .el-dialog__body {
  padding: 20px;
  color: #e5e7eb;
  max-height: 68vh;
  overflow-y: auto;
}
.wf-orch-dialog .el-dialog__body::-webkit-scrollbar {
  width: 6px;
}
.wf-orch-dialog .el-dialog__body::-webkit-scrollbar-thumb {
  background: rgba(99, 102, 241, 0.3);
  border-radius: 3px;
}

/* 暗色背景下表单控件配色 */
.wf-orch-dialog .el-form-item__label {
  color: #cbd5e1;
}
.wf-orch-dialog .el-input__wrapper,
.wf-orch-dialog .el-textarea__inner,
.wf-orch-dialog .el-select__wrapper {
  background-color: rgba(30, 30, 40, 0.8) !important;
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.2) inset !important;
}
.wf-orch-dialog .el-input__wrapper:hover,
.wf-orch-dialog .el-select__wrapper:hover {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.5) inset !important;
}
.wf-orch-dialog .el-input__wrapper.is-focus,
.wf-orch-dialog .el-select__wrapper.is-focused {
  box-shadow: 0 0 0 1px #6366f1 inset !important;
}
.wf-orch-dialog .el-input__inner,
.wf-orch-dialog .el-textarea__inner {
  color: #e5e7eb;
}
.wf-orch-dialog .el-input__inner::placeholder,
.wf-orch-dialog .el-textarea__inner::placeholder {
  color: #6b7280;
}
/* el-select 下拉面板保持默认（亮色）以保证可读性，仅选中输入框暗色 */
</style>

<style scoped>
/* ===== 通用区块 ===== */
.wf-section {
  margin-bottom: 16px;
}
.wf-section:last-child {
  margin-bottom: 0;
}
.wf-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.wf-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #a5b4fc;
  letter-spacing: 0.5px;
}

/* ===== 定义列表 ===== */
.wf-def-list {
  min-height: 60px;
}
.wf-empty {
  text-align: center;
  color: #6b7280;
  font-size: 13px;
  padding: 32px 0;
  border: 1px dashed rgba(99, 102, 241, 0.2);
  border-radius: 8px;
}
.wf-def-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: rgba(30, 30, 40, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-left: 3px solid #6366f1;
  border-radius: 8px;
  transition: border-color 0.2s, background 0.2s;
}
.wf-def-card:hover {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(34, 34, 46, 0.85);
}
.wf-def-card:last-child {
  margin-bottom: 0;
}
.wf-def-info {
  flex: 1;
  min-width: 0;
}
.wf-def-name {
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
  margin-bottom: 4px;
}
.wf-def-desc {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-def-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.wf-def-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ===== 步骤编辑器 ===== */
.wf-editor {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(99, 102, 241, 0.2);
}
.wf-form {
  margin-bottom: 8px;
}

.wf-steps-wrap {
  margin-top: 12px;
}
.wf-steps-title {
  font-size: 13px;
  color: #9ca3af;
  margin-bottom: 10px;
}
.wf-steps {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* ===== 步骤卡片 ===== */
.wf-step-card {
  background: rgba(30, 30, 40, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-left: 3px solid #6366f1;
  border-radius: 8px;
  padding: 12px 14px;
  cursor: grab;
  transition: border-color 0.2s, opacity 0.2s, transform 0.15s;
}
.wf-step-card:hover {
  border-color: rgba(99, 102, 241, 0.4);
}
.wf-step-card:active {
  cursor: grabbing;
}
.wf-step-card.is-dragging {
  opacity: 0.4;
}
.wf-step-card.is-drop-target {
  border-color: #6366f1;
  transform: scale(1.01);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.25);
}

.wf-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.wf-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.wf-step-type-tag {
  font-size: 12px;
  color: #a5b4fc;
  font-weight: 500;
}
.wf-step-del {
  margin-left: auto;
}

.wf-step-form {
  margin-top: 4px;
}
.wf-step-row {
  display: flex;
  gap: 16px;
}
.wf-step-row :deep(.el-form-item) {
  flex: 1;
}

/* ===== 步骤间箭头 ===== */
.wf-step-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  color: #6366f1;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  user-select: none;
}

/* ===== 添加步骤按钮 ===== */
.wf-add-step-btn {
  width: 100%;
  margin-top: 12px;
  border-style: dashed;
  border-color: rgba(99, 102, 241, 0.3);
  background: transparent;
  color: #a5b4fc;
}
.wf-add-step-btn:hover {
  border-color: #6366f1;
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.08);
}

/* ===== 编辑器底部操作栏 ===== */
.wf-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
}
</style>
