<template>
  <!-- 项目级风格配置面板：统一管理画风、色板、线条/渲染/构图规则及角色/场景覆盖 -->
  <div v-loading="loading" class="style-config-panel">
    <!-- 头部：标题 + 启用开关 -->
    <div class="scp-header">
      <div class="scp-title-area">
        <div class="scp-title">风格配置</div>
        <div class="scp-subtitle">统一项目视觉风格，支持角色与场景级覆盖</div>
      </div>
      <div class="scp-enable">
        <span class="scp-enable-label">启用风格统一</span>
        <el-switch v-model="config.enabled" />
      </div>
    </div>

    <!-- 风格预设选择器 -->
    <div class="scp-section">
      <div class="scp-section-label">风格预设</div>
      <div v-if="presets.length === 0 && !loading" class="scp-empty-text">暂无可用风格预设</div>
      <div class="scp-preset-grid">
        <div
          v-for="preset in presets"
          :key="preset.value"
          class="scp-preset-card"
          :class="{ 'is-active': config.style_preset === preset.value }"
          @click="selectPreset(preset)"
        >
          <div class="scp-preset-name">{{ preset.label }}</div>
          <div class="scp-preset-prompt">{{ preset.prompt }}</div>
          <div v-if="config.style_preset === preset.value" class="scp-preset-check">
            <el-icon><Check /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- 色板编辑器 -->
    <div class="scp-section">
      <div class="scp-section-label">
        色板
        <span class="scp-section-hint">最多 8 个颜色，已选 {{ config.palette.length }} / 8</span>
      </div>
      <div class="scp-palette">
        <div
          v-for="(color, idx) in config.palette"
          :key="idx"
          class="scp-color-circle"
          :style="{ background: color }"
          :title="color"
        >
          <span class="scp-color-remove" @click="removeColor(idx)">
            <el-icon><Close /></el-icon>
          </span>
        </div>
        <el-color-picker
          v-if="config.palette.length < 8"
          v-model="newColor"
          size="large"
          @change="addColor"
        />
      </div>
    </div>

    <!-- 线条粗细 / 渲染风格 / 构图规则 -->
    <div class="scp-section">
      <div class="scp-row-3">
        <div class="scp-field">
          <label class="scp-field-label">线条粗细</label>
          <el-select v-model="config.line_weight" placeholder="选择线条粗细" clearable>
            <el-option
              v-for="opt in lineWeightOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="scp-field">
          <label class="scp-field-label">渲染风格</label>
          <el-select v-model="config.render_style" placeholder="选择渲染风格" clearable>
            <el-option
              v-for="opt in renderStyleOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="scp-field">
          <label class="scp-field-label">构图规则</label>
          <el-select v-model="config.composition_rule" placeholder="选择构图规则" clearable>
            <el-option
              v-for="opt in compositionRuleOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
      </div>
    </div>

    <!-- 角色覆盖列表 -->
    <div class="scp-section">
      <div class="scp-section-label">
        角色风格覆盖
        <span class="scp-section-hint">为指定角色单独设置风格</span>
      </div>
      <div v-if="config.character_overrides.length === 0" class="scp-empty-text">暂无角色覆盖</div>
      <div
        v-for="(item, idx) in config.character_overrides"
        :key="`char-${idx}`"
        class="scp-override-row"
      >
        <el-select
          v-model="item.character_id"
          placeholder="选择角色"
          filterable
          clearable
          class="scp-override-target"
        >
          <el-option
            v-for="char in characters"
            :key="char.id"
            :label="char.name || `角色#${char.id}`"
            :value="char.id"
          />
        </el-select>
        <el-select
          v-model="item.style"
          placeholder="选择风格"
          filterable
          clearable
          class="scp-override-style"
        >
          <el-option
            v-for="preset in presets"
            :key="preset.value"
            :label="preset.label"
            :value="preset.value"
          />
        </el-select>
        <el-button type="danger" text :icon="Delete" @click="removeCharOverride(idx)" />
      </div>
      <el-button
        type="primary"
        plain
        size="small"
        :icon="Plus"
        :disabled="characters.length === 0"
        @click="addCharOverride"
      >添加角色覆盖</el-button>
    </div>

    <!-- 场景覆盖列表 -->
    <div class="scp-section">
      <div class="scp-section-label">
        场景风格覆盖
        <span class="scp-section-hint">为指定场景单独设置风格</span>
      </div>
      <div v-if="config.scene_overrides.length === 0" class="scp-empty-text">暂无场景覆盖</div>
      <div
        v-for="(item, idx) in config.scene_overrides"
        :key="`scene-${idx}`"
        class="scp-override-row"
      >
        <el-select
          v-model="item.scene_id"
          placeholder="选择场景"
          filterable
          clearable
          class="scp-override-target"
        >
          <el-option
            v-for="scene in scenes"
            :key="scene.id"
            :label="scene.name || `场景#${scene.id}`"
            :value="scene.id"
          />
        </el-select>
        <el-select
          v-model="item.style"
          placeholder="选择风格"
          filterable
          clearable
          class="scp-override-style"
        >
          <el-option
            v-for="preset in presets"
            :key="preset.value"
            :label="preset.label"
            :value="preset.value"
          />
        </el-select>
        <el-button type="danger" text :icon="Delete" @click="removeSceneOverride(idx)" />
      </div>
      <el-button
        type="primary"
        plain
        size="small"
        :icon="Plus"
        :disabled="scenes.length === 0"
        @click="addSceneOverride"
      >添加场景覆盖</el-button>
    </div>

    <!-- 风格统一负面提示词 -->
    <div class="scp-section">
      <div class="scp-section-label">风格统一负面提示词</div>
      <el-input
        v-model="config.negative_prompt"
        type="textarea"
        :rows="3"
        placeholder="输入需要在生成时统一排除的负面提示词，例如：模糊, 低质量, 变形..."
      />
    </div>

    <!-- 预览对比 -->
    <div class="scp-section">
      <div class="scp-section-label">
        预览对比
        <span class="scp-section-hint">输入原始提示词，查看注入风格后的效果</span>
      </div>
      <div class="scp-preview">
        <div class="scp-preview-col">
          <div class="scp-preview-col-label">原始提示词</div>
          <el-input
            v-model="originalPrompt"
            type="textarea"
            :rows="5"
            placeholder="输入原始提示词..."
          />
        </div>
        <div class="scp-preview-arrow">→</div>
        <div class="scp-preview-col">
          <div class="scp-preview-col-label">注入风格后提示词</div>
          <el-input
            v-model="injectedPrompt"
            type="textarea"
            :rows="5"
            readonly
            placeholder="点击下方按钮生成..."
          />
        </div>
      </div>
      <el-button
        type="primary"
        :loading="previewing"
        :icon="View"
        @click="previewInjection"
      >预览对比</el-button>
    </div>

    <!-- 底部保存按钮 -->
    <div class="scp-footer">
      <el-button type="primary" size="large" :loading="saving" @click="save">保存配置</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Close, Delete, View, Check } from '@element-plus/icons-vue'
import { styleAPI } from '@/api/style'
import { dramaAPI } from '@/api/drama'
import { sceneAPI } from '@/api/scenes'

const props = defineProps({
  dramaId: { type: Number, required: true }
})

// 线条粗细选项
const lineWeightOptions = [
  { label: '细线', value: 'thin' },
  { label: '中等', value: 'medium' },
  { label: '粗线', value: 'thick' }
]

// 渲染风格选项
const renderStyleOptions = [
  { label: '平涂', value: 'flat' },
  { label: '渐变', value: 'gradient' },
  { label: '写实', value: 'realistic' },
  { label: '赛璐璐', value: 'cel' }
]

// 构图规则选项
const compositionRuleOptions = [
  { label: '三分法', value: 'rule-of-thirds' },
  { label: '黄金分割', value: 'golden-ratio' },
  { label: '对称构图', value: 'symmetry' },
  { label: '居中构图', value: 'center' },
  { label: '引导线', value: 'leading-lines' }
]

// 风格配置数据
const config = reactive({
  enabled: false,
  style_preset: '',
  palette: [],
  line_weight: '',
  render_style: '',
  composition_rule: '',
  character_overrides: [],
  scene_overrides: [],
  negative_prompt: ''
})

const presets = ref([])
const characters = ref([])
const scenes = ref([])
const newColor = ref('')
const originalPrompt = ref('')
const injectedPrompt = ref('')

const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
// 标记配置是否已存在：已存在用 PUT 更新，不存在用 POST 创建
const configExists = ref(false)

// 选中风格预设
function selectPreset(preset) {
  config.style_preset = config.style_preset === preset.value ? '' : preset.value
}

// 添加色板颜色
function addColor(color) {
  if (!color) return
  if (config.palette.length >= 8) {
    ElMessage.warning('色板最多 8 个颜色')
    return
  }
  if (config.palette.includes(color)) {
    ElMessage.warning('该颜色已存在')
    return
  }
  config.palette.push(color)
  newColor.value = ''
}

// 删除色板颜色
function removeColor(idx) {
  config.palette.splice(idx, 1)
}

// 添加角色覆盖
function addCharOverride() {
  config.character_overrides.push({ character_id: null, style: '' })
}

// 删除角色覆盖
function removeCharOverride(idx) {
  config.character_overrides.splice(idx, 1)
}

// 添加场景覆盖
function addSceneOverride() {
  config.scene_overrides.push({ scene_id: null, style: '' })
}

// 删除场景覆盖
function removeSceneOverride(idx) {
  config.scene_overrides.splice(idx, 1)
}

// 预览风格注入
async function previewInjection() {
  if (!originalPrompt.value.trim()) {
    ElMessage.warning('请输入原始提示词')
    return
  }
  previewing.value = true
  try {
    const res = await styleAPI.previewStyleInjection(props.dramaId, {
      prompt: originalPrompt.value
    })
    injectedPrompt.value = res?.injected_prompt || res?.prompt || ''
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    previewing.value = false
  }
}

// 保存配置
async function save() {
  saving.value = true
  try {
    if (configExists.value) {
      await styleAPI.updateStyleConfig(props.dramaId, config)
    } else {
      await styleAPI.createStyleConfig(props.dramaId, config)
      configExists.value = true
    }
    ElMessage.success('风格配置已保存')
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    saving.value = false
  }
}

// 加载风格预设列表
async function loadPresets() {
  try {
    const data = await styleAPI.getStylePresets()
    presets.value = Array.isArray(data) ? data : []
  } catch {
    presets.value = []
  }
}

// 加载已有风格配置
async function loadConfig() {
  try {
    const data = await styleAPI.getStyleConfig(props.dramaId)
    if (data) {
      configExists.value = true
      Object.assign(config, {
        enabled: data.enabled ?? false,
        style_preset: data.style_preset || '',
        palette: Array.isArray(data.palette) ? [...data.palette] : [],
        line_weight: data.line_weight || '',
        render_style: data.render_style || '',
        composition_rule: data.composition_rule || '',
        character_overrides: Array.isArray(data.character_overrides)
          ? data.character_overrides.map((o) => ({ ...o }))
          : [],
        scene_overrides: Array.isArray(data.scene_overrides)
          ? data.scene_overrides.map((o) => ({ ...o }))
          : [],
        negative_prompt: data.negative_prompt || ''
      })
    }
  } catch {
    /* 配置不存在时使用默认值，忽略 404 */
    configExists.value = false
  }
}

// 加载项目角色列表
async function loadCharacters() {
  try {
    const drama = await dramaAPI.get(props.dramaId)
    characters.value = Array.isArray(drama?.characters) ? drama.characters : []
  } catch {
    characters.value = []
  }
}

// 加载项目场景列表
async function loadScenes() {
  try {
    const data = await sceneAPI.list(props.dramaId)
    scenes.value = Array.isArray(data) ? data : []
  } catch {
    scenes.value = []
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadPresets(), loadConfig(), loadCharacters(), loadScenes()])
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.style-config-panel {
  background: #1a1a2e;
  color: #ffffff;
  padding: 24px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

/* 头部 */
.scp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
}

.scp-title {
  font-size: 18px;
  font-weight: 700;
  color: #f3f4f6;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.scp-subtitle {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 4px;
}

.scp-enable {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.scp-enable-label {
  font-size: 13px;
  color: #cbd5e1;
  white-space: nowrap;
}

/* 区块 */
.scp-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scp-section-label {
  font-size: 13px;
  font-weight: 600;
  color: #a5b4fc;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.scp-section-hint {
  font-size: 11px;
  font-weight: 400;
  color: #6b7280;
}

.scp-empty-text {
  font-size: 12px;
  color: #6b7280;
  padding: 4px 0;
}

/* 风格预设卡片网格 */
.scp-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.scp-preset-card {
  position: relative;
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.1s, box-shadow 0.2s;
  overflow: hidden;
}

.scp-preset-card:hover {
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-2px);
}

.scp-preset-card.is-active {
  border: 1px solid transparent;
  background:
    linear-gradient(#1e1e32, #1e1e32) padding-box,
    linear-gradient(135deg, #6366f1, #8b5cf6) border-box;
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.3);
}

.scp-preset-name {
  font-size: 14px;
  font-weight: 600;
  color: #f3f4f6;
  margin-bottom: 6px;
}

.scp-preset-prompt {
  font-size: 11px;
  color: #9ca3af;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.scp-preset-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

/* 色板编辑器 */
.scp-palette {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.scp-color-circle {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: default;
  transition: border-color 0.2s;
}

.scp-color-circle:hover {
  border-color: rgba(255, 255, 255, 0.5);
}

.scp-color-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #f56c6c;
  color: #fff;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  cursor: pointer;
  border: 1px solid #1a1a2e;
}

.scp-color-circle:hover .scp-color-remove {
  display: flex;
}

/* 三列选择器 */
.scp-row-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.scp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scp-field-label {
  font-size: 12px;
  color: #9ca3af;
}

/* 覆盖行 */
.scp-override-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scp-override-target {
  flex: 1;
  min-width: 0;
}

.scp-override-style {
  flex: 1;
  min-width: 0;
}

/* 预览对比 */
.scp-preview {
  display: flex;
  align-items: stretch;
  gap: 12px;
}

.scp-preview-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.scp-preview-col-label {
  font-size: 12px;
  color: #9ca3af;
}

.scp-preview-arrow {
  display: flex;
  align-items: center;
  font-size: 22px;
  color: #6366f1;
  flex-shrink: 0;
}

/* 底部 */
.scp-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.2);
}

/* 暗色主题 el 组件适配 */
.style-config-panel :deep(.el-input__wrapper),
.style-config-panel :deep(.el-textarea__inner),
.style-config-panel :deep(.el-select .el-input__wrapper) {
  background-color: rgba(30, 30, 50, 0.8);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3) inset;
}

.style-config-panel :deep(.el-input__inner),
.style-config-panel :deep(.el-textarea__inner) {
  color: #e5e7eb;
}

.style-config-panel :deep(.el-textarea__inner::placeholder),
.style-config-panel :deep(.el-input__inner::placeholder) {
  color: #6b7280;
}

.style-config-panel :deep(.el-select-dropdown__item) {
  color: #e5e7eb;
}

/* el-color-picker 暗色适配 */
.style-config-panel :deep(.el-color-picker__trigger) {
  border-color: rgba(99, 102, 241, 0.3);
}
</style>
