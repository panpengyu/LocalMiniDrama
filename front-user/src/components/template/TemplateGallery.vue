<template>
  <el-dialog
    v-model="visible"
    title="选择模板"
    width="900px"
    :close-on-click-modal="false"
    @open="onOpen"
  >
    <div class="template-gallery" v-loading="loading">
      <!-- 筛选标签 -->
      <div class="tg-filters">
        <el-radio-group v-model="filterGenre" size="small">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="urban_romance">都市爱情</el-radio-button>
          <el-radio-button label="ancient_fantasy">古风仙侠</el-radio-button>
          <el-radio-button label="mystery">悬疑推理</el-radio-button>
          <el-radio-button label="scifi">科幻未来</el-radio-button>
          <el-radio-button label="campus">校园青春</el-radio-button>
          <el-radio-button label="structure">剧本结构</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 模板卡片网格 -->
      <div class="tg-grid">
        <div
          v-for="tpl in filteredTemplates"
          :key="tpl.id"
          class="tg-card"
          :class="{ selected: selectedId === tpl.id }"
          @click="selectTemplate(tpl)"
        >
          <div class="tg-card-cover" :style="{ background: getGradient(tpl.genre_type) }">
            <span class="tg-card-icon">{{ getGenreIcon(tpl.genre_type, tpl.category) }}</span>
            <span v-if="selectedId === tpl.id" class="tg-card-check">
              <el-icon><Check /></el-icon>
            </span>
          </div>
          <div class="tg-card-body">
            <h4>{{ tpl.name }}</h4>
            <p>{{ tpl.description || '暂无描述' }}</p>
            <div class="tg-card-tags">
              <el-tag v-if="tpl.genre_type" size="small">{{ getGenreLabel(tpl.genre_type) }}</el-tag>
              <el-tag size="small" type="info">{{ getCategoryLabel(tpl.category) }}</el-tag>
            </div>
          </div>
          <div class="tg-card-actions" @click.stop>
            <el-button size="small" link type="primary" @click="openPreview(tpl)">
              <el-icon><View /></el-icon>预览
            </el-button>
          </div>
        </div>
        <div v-if="!loading && filteredTemplates.length === 0" class="tg-empty">
          <el-empty description="暂无可用模板" />
        </div>
      </div>

      <!-- 项目标题输入 -->
      <div v-if="selectedTemplate" class="tg-title-bar">
        <span class="tg-title-label">已选：{{ selectedTemplate.name }}</span>
        <el-input
          v-model="projectTitle"
          placeholder="项目标题（留空则使用模板名称）"
          maxlength="100"
          show-word-limit
          style="max-width: 360px"
          @click.stop
        />
        <el-select v-model="projectRatio" style="width: 140px">
          <el-option label="16:9 横屏" value="16:9" />
          <el-option label="9:16 竖屏" value="9:16" />
          <el-option label="3:4 竖版" value="3:4" />
          <el-option label="1:1 方形" value="1:1" />
        </el-select>
      </div>

      <!-- 预览面板 -->
      <el-drawer v-model="showPreview" title="模板预览" size="50%" append-to-body>
        <div v-if="previewTemplate" class="tg-preview">
          <div class="tg-preview-head">
            <h2>{{ previewTemplate.name }}</h2>
            <p class="tg-preview-desc">{{ previewTemplate.description }}</p>
            <div class="tg-preview-tags">
              <el-tag v-if="previewTemplate.genre_type">{{ getGenreLabel(previewTemplate.genre_type) }}</el-tag>
              <el-tag type="info">{{ getCategoryLabel(previewTemplate.category) }}</el-tag>
              <el-tag v-if="previewTemplate.is_active !== undefined" :type="previewTemplate.is_active ? 'success' : 'info'">
                {{ previewTemplate.is_active ? '启用' : '禁用' }}
              </el-tag>
            </div>
          </div>

          <!-- 角色预设 -->
          <h3>角色预设</h3>
          <div v-if="parseJSON(previewTemplate.character_presets).length" class="preview-list">
            <div v-for="(char, i) in parseJSON(previewTemplate.character_presets)" :key="i" class="preview-char">
              <div class="preview-char-head">
                <strong>{{ char.name }}</strong>
                <el-tag size="small" type="info">{{ char.role || '角色' }}</el-tag>
              </div>
              <p v-if="char.personality">{{ char.personality }}</p>
              <p v-if="char.appearance" class="muted">{{ char.appearance }}</p>
            </div>
          </div>
          <el-empty v-else description="无角色预设" :image-size="60" />

          <!-- 场景预设 -->
          <h3>场景预设</h3>
          <div v-if="parseJSON(previewTemplate.scene_presets).length" class="preview-list">
            <div v-for="(scene, i) in parseJSON(previewTemplate.scene_presets)" :key="i" class="preview-scene">
              <div class="preview-char-head">
                <strong>{{ scene.name }}</strong>
                <el-tag size="small" type="info">{{ scene.location || '场景' }}</el-tag>
              </div>
              <p v-if="scene.time" class="muted">{{ scene.time }}</p>
              <p v-if="scene.description">{{ scene.description }}</p>
            </div>
          </div>
          <el-empty v-else description="无场景预设" :image-size="60" />

          <!-- 风格配置 -->
          <h3>风格配置</h3>
          <pre v-if="parseJSON(previewTemplate.style_config) && Object.keys(parseJSON(previewTemplate.style_config)).length" class="preview-json">{{ JSON.stringify(parseJSON(previewTemplate.style_config), null, 2) }}</pre>
          <el-empty v-else description="无风格配置" :image-size="60" />

          <!-- 系统提示词 -->
          <h3 v-if="previewTemplate.prompt_system">系统提示词</h3>
          <pre v-if="previewTemplate.prompt_system" class="preview-json preview-prompt">{{ previewTemplate.prompt_system }}</pre>
        </div>
      </el-drawer>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!selectedId" :loading="applying" @click="onApply">
        应用模板创建项目
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, View } from '@element-plus/icons-vue'
import { templateAPI } from '@/api/template'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'applied'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const applying = ref(false)
const templates = ref([])
const filterGenre = ref('')
const selectedId = ref(null)
const selectedTemplate = ref(null)
const previewTemplate = ref(null)
const showPreview = ref(false)
const projectTitle = ref('')
const projectRatio = ref('16:9')

const filteredTemplates = computed(() => {
  if (!filterGenre.value) return templates.value
  return templates.value.filter((t) => t.genre_type === filterGenre.value)
})

function onOpen() {
  selectedId.value = null
  selectedTemplate.value = null
  projectTitle.value = ''
  projectRatio.value = '16:9'
  loadTemplates()
}

async function loadTemplates() {
  loading.value = true
  try {
    const res = await templateAPI.list({ is_active: 1, page_size: 100 })
    templates.value = res?.items ?? (Array.isArray(res) ? res : [])
  } catch (e) {
    templates.value = []
  } finally {
    loading.value = false
  }
}

function selectTemplate(tpl) {
  selectedId.value = tpl.id
  selectedTemplate.value = tpl
  if (!projectTitle.value) projectTitle.value = tpl.name || ''
}

function openPreview(tpl) {
  previewTemplate.value = tpl
  showPreview.value = true
}

async function onApply() {
  if (!selectedId.value) return
  applying.value = true
  try {
    const drama = await templateAPI.apply(selectedId.value, {
      title: projectTitle.value?.trim() || selectedTemplate.value?.name || undefined,
      aspect_ratio: projectRatio.value || '16:9'
    })
    ElMessage.success('项目已创建')
    emit('applied', drama)
    visible.value = false
  } catch (e) {
    // request 拦截器已提示错误
  } finally {
    applying.value = false
  }
}

function parseJSON(val) {
  if (val == null) return []
  if (typeof val === 'object') return Array.isArray(val) ? val : (val || {})
  try {
    const parsed = JSON.parse(val)
    return parsed == null ? [] : parsed
  } catch {
    return []
  }
}

function getGenreLabel(genre) {
  const map = {
    urban_romance: '都市爱情',
    ancient_fantasy: '古风仙侠',
    mystery: '悬疑推理',
    scifi: '科幻未来',
    campus: '校园青春',
    structure: '剧本结构',
    family: '家庭伦理',
    action: '动作热血',
    other: '其他'
  }
  return map[genre] || genre || '未分类'
}

function getCategoryLabel(category) {
  const map = { genre: '类型', structure: '结构', style: '风格' }
  return map[category] || category || '模板'
}

function getGenreIcon(genre, category) {
  if (category === 'structure') return '📋'
  const map = {
    urban_romance: '🏙️',
    ancient_fantasy: '⚔️',
    mystery: '🔍',
    scifi: '🚀',
    campus: '🎓',
    family: '🏡',
    action: '🔥'
  }
  return map[genre] || '🎬'
}

function getGradient(genre) {
  const map = {
    urban_romance: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
    ancient_fantasy: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
    mystery: 'linear-gradient(135deg, #6366f1 0%, #1e1b4b 100%)',
    scifi: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
    campus: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
    structure: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    family: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
    action: 'linear-gradient(135deg, #ef4444 0%, #7c3aed 100%)'
  }
  return map[genre] || 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
}
</script>

<style scoped>
.template-gallery {
  min-height: 360px;
}

.tg-filters {
  margin-bottom: 16px;
}
.tg-filters .el-radio-group {
  flex-wrap: wrap;
}

.tg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  max-height: 420px;
  overflow-y: auto;
  padding: 2px;
}

.tg-card {
  position: relative;
  background: rgba(24, 24, 30, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.tg-card:hover {
  border-color: rgba(99, 102, 241, 0.55);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.15);
}
.tg-card.selected {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.45), 0 8px 24px rgba(99, 102, 241, 0.2);
}

.tg-card-cover {
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.tg-card-icon {
  font-size: 34px;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
}
.tg-card-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.tg-card-body {
  padding: 10px 12px 12px;
}
.tg-card-body h4 {
  margin: 0 0 4px;
  font-size: 0.95rem;
  color: #fafafa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tg-card-body p {
  margin: 0 0 8px;
  font-size: 0.78rem;
  color: #a1a1aa;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.2em;
}
.tg-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tg-card-actions {
  position: absolute;
  bottom: 8px;
  right: 8px;
}

.tg-empty {
  grid-column: 1 / -1;
  padding: 30px 0;
}

.tg-title-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 14px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 10px;
  flex-wrap: wrap;
}
.tg-title-label {
  font-size: 0.88rem;
  color: #c7d2fe;
  font-weight: 600;
}

/* 预览抽屉 */
.tg-preview {
  padding: 0 4px;
}
.tg-preview-head h2 {
  margin: 0 0 6px;
  font-size: 1.2rem;
}
.tg-preview-desc {
  color: #a1a1aa;
  font-size: 0.88rem;
  margin: 0 0 8px;
}
.tg-preview-tags {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.tg-preview h3 {
  margin: 18px 0 8px;
  font-size: 1rem;
  color: #c7d2fe;
  border-left: 3px solid #6366f1;
  padding-left: 8px;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview-char,
.preview-scene {
  background: rgba(24, 24, 30, 0.6);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 8px;
  padding: 10px 12px;
}
.preview-char-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.preview-char p {
  margin: 2px 0 0;
  font-size: 0.85rem;
  color: #d4d4d8;
  line-height: 1.5;
}
.preview-char p.muted {
  color: #71717a;
}
.preview-json {
  background: rgba(8, 8, 13, 0.8);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 8px;
  padding: 12px;
  font-size: 0.8rem;
  color: #a5b4fc;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.preview-prompt {
  color: #d4d4d8;
  max-height: 280px;
  overflow-y: auto;
}
</style>
