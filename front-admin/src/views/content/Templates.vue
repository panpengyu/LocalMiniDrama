<template>
  <div class="admin-templates">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#a78bfa"><Document /></el-icon>
          <span>模板管理</span>
          <span class="subtitle">管理剧本模板：类型 / 结构 / 风格，预设角色与场景</span>
        </div>
        <div class="toolbar-actions">
          <el-button type="primary" :icon="Plus" @click="showCreateDialog">新建模板</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
      </div>
    </el-card>

    <!-- 筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filters">
        <el-select v-model="filterCategory" placeholder="分类" clearable style="width: 140px" @change="onFilterChange">
          <el-option label="类型" value="genre" />
          <el-option label="结构" value="structure" />
          <el-option label="风格" value="style" />
        </el-select>
        <el-select v-model="filterGenreType" placeholder="题材" clearable style="width: 150px" @change="onFilterChange">
          <el-option label="都市爱情" value="urban_romance" />
          <el-option label="古风仙侠" value="ancient_fantasy" />
          <el-option label="悬疑推理" value="mystery" />
          <el-option label="科幻未来" value="scifi" />
          <el-option label="校园青春" value="campus" />
          <el-option label="剧本结构" value="structure" />
        </el-select>
        <el-select v-model="filterActive" placeholder="状态" clearable style="width: 120px" @change="onFilterChange">
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="搜索模板名称"
          clearable
          style="width: 220px"
          @keyup.enter="onFilterChange"
          @clear="onFilterChange"
        />
        <el-button :icon="Search" @click="onFilterChange">搜索</el-button>
      </div>
    </el-card>

    <!-- 表格 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table :data="templates" v-loading="loading" stripe border row-key="id">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="模板名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="90">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ getCategoryLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="genre_type" label="题材" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.genre_type" size="small">{{ getGenreLabel(row.genre_type) }}</el-tag>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
        <el-table-column prop="is_active" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
              {{ row.is_active ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="showPreview(row)">预览</el-button>
            <el-button size="small" link type="warning" @click="showEditDialog(row)">编辑</el-button>
            <el-popconfirm title="确认删除该模板？" @confirm="onDelete(row)">
              <template #reference>
                <el-button size="small" link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadList"
          @size-change="onSizeChange"
        />
      </div>
    </el-card>

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑模板' : '新建模板'"
      width="720px"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="formData.name" placeholder="如：都市甜宠模板" maxlength="128" show-word-limit />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="formData.category" placeholder="选择分类" style="width: 100%">
            <el-option label="类型" value="genre" />
            <el-option label="结构" value="structure" />
            <el-option label="风格" value="style" />
          </el-select>
        </el-form-item>
        <el-form-item label="题材" prop="genre_type">
          <el-select v-model="formData.genre_type" placeholder="选择题材（结构类可留空）" clearable style="width: 100%">
            <el-option label="都市爱情" value="urban_romance" />
            <el-option label="古风仙侠" value="ancient_fantasy" />
            <el-option label="悬疑推理" value="mystery" />
            <el-option label="科幻未来" value="scifi" />
            <el-option label="校园青春" value="campus" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="2" placeholder="模板用途说明" />
        </el-form-item>
        <el-form-item label="系统提示词">
          <el-input v-model="formData.prompt_system" type="textarea" :rows="4" placeholder="AI 生成剧本时使用的 system prompt" />
        </el-form-item>
        <el-form-item label="角色预设">
          <el-input
            v-model="formData.character_presets"
            type="textarea"
            :rows="4"
            placeholder='[{"name":"角色名","role":"protagonist","personality":"性格","appearance":"外貌"}]'
          />
        </el-form-item>
        <el-form-item label="场景预设">
          <el-input
            v-model="formData.scene_presets"
            type="textarea"
            :rows="4"
            placeholder='[{"name":"场景名","location":"地点","time":"时间","description":"描述"}]'
          />
        </el-form-item>
        <el-form-item label="风格配置">
          <el-input
            v-model="formData.style_config"
            type="textarea"
            :rows="3"
            placeholder='{"globalStyle":"realistic","colorPalette":["#333","#666"],"renderStyle":"cinematic"}'
          />
        </el-form-item>
        <el-form-item label="分镜节奏">
          <el-input
            v-model="formData.storyboard_rhythm"
            type="textarea"
            :rows="2"
            placeholder='{"avgShotsPerEpisode":20,"pacing":"fast","transitionStyle":"cut"}'
          />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="formData.is_active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewVisible" title="模板预览" width="640px">
      <div v-if="previewTemplate" class="preview-content">
        <div class="preview-head">
          <h3>{{ previewTemplate.name }}</h3>
          <div class="preview-tags">
            <el-tag size="small" type="info">{{ getCategoryLabel(previewTemplate.category) }}</el-tag>
            <el-tag v-if="previewTemplate.genre_type" size="small">{{ getGenreLabel(previewTemplate.genre_type) }}</el-tag>
            <el-tag :type="previewTemplate.is_active ? 'success' : 'info'" size="small">
              {{ previewTemplate.is_active ? '启用' : '禁用' }}
            </el-tag>
          </div>
          <p v-if="previewTemplate.description" class="preview-desc">{{ previewTemplate.description }}</p>
        </div>

        <el-divider content-position="left">角色预设</el-divider>
        <div v-if="parseJSON(previewTemplate.character_presets).length" class="preview-list">
          <div v-for="(char, i) in parseJSON(previewTemplate.character_presets)" :key="'c' + i" class="preview-item">
            <strong>{{ char.name }}</strong>
            <el-tag v-if="char.role" size="small" type="info" style="margin-left: 6px">{{ char.role }}</el-tag>
            <p v-if="char.personality">{{ char.personality }}</p>
            <p v-if="char.appearance" class="muted">{{ char.appearance }}</p>
          </div>
        </div>
        <el-empty v-else description="无角色预设" :image-size="50" />

        <el-divider content-position="left">场景预设</el-divider>
        <div v-if="parseJSON(previewTemplate.scene_presets).length" class="preview-list">
          <div v-for="(scene, i) in parseJSON(previewTemplate.scene_presets)" :key="'s' + i" class="preview-item">
            <strong>{{ scene.name }}</strong>
            <el-tag v-if="scene.location" size="small" type="info" style="margin-left: 6px">{{ scene.location }}</el-tag>
            <p v-if="scene.time" class="muted">{{ scene.time }}</p>
            <p v-if="scene.description">{{ scene.description }}</p>
          </div>
        </div>
        <el-empty v-else description="无场景预设" :image-size="50" />

        <el-divider content-position="left">风格配置</el-divider>
        <pre v-if="hasKeys(previewTemplate.style_config)" class="preview-json">{{ formatJSON(previewTemplate.style_config) }}</pre>
        <el-empty v-else description="无风格配置" :image-size="50" />

        <template v-if="previewTemplate.prompt_system">
          <el-divider content-position="left">系统提示词</el-divider>
          <pre class="preview-json preview-prompt">{{ previewTemplate.prompt_system }}</pre>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { templateAPI } from '@/api/template'

const loading = ref(false)
const templates = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

// 筛选
const filterCategory = ref('')
const filterGenreType = ref('')
const filterActive = ref('')
const keyword = ref('')

function onFilterChange() {
  page.value = 1
  loadList()
}
function onSizeChange() {
  page.value = 1
  loadList()
}

async function loadList() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value
    }
    if (filterCategory.value) params.category = filterCategory.value
    if (filterGenreType.value) params.genre_type = filterGenreType.value
    if (filterActive.value !== '' && filterActive.value !== null) params.is_active = filterActive.value
    if (keyword.value) params.keyword = keyword.value
    const res = await templateAPI.list(params)
    templates.value = res?.items ?? (Array.isArray(res) ? res : [])
    total.value = res?.pagination?.total ?? templates.value.length
  } catch (e) {
    templates.value = []
  } finally {
    loading.value = false
  }
}

// ---------- 常量映射 ----------
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

// ---------- JSON 安全解析 ----------
function parseJSON(val) {
  if (val == null) return []
  if (typeof val === 'object') return Array.isArray(val) ? val : (val || [])
  try {
    const parsed = JSON.parse(val)
    return parsed == null ? [] : parsed
  } catch {
    return []
  }
}
function hasKeys(val) {
  const parsed = parseJSON(val)
  if (Array.isArray(parsed)) return parsed.length > 0
  return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
}
function formatJSON(val) {
  if (val == null) return ''
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  try {
    return JSON.stringify(JSON.parse(val), null, 2)
  } catch {
    return String(val)
  }
}

// ---------- 创建/编辑 ----------
const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const formRef = ref(null)
const formData = reactive({
  name: '',
  category: 'genre',
  genre_type: '',
  description: '',
  prompt_system: '',
  character_presets: '',
  scene_presets: '',
  style_config: '',
  storyboard_rhythm: '',
  is_active: true
})
const formRules = {
  name: [{ required: true, message: '请输入模板名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }]
}

function resetForm() {
  formData.name = ''
  formData.category = 'genre'
  formData.genre_type = ''
  formData.description = ''
  formData.prompt_system = ''
  formData.character_presets = ''
  formData.scene_presets = ''
  formData.style_config = ''
  formData.storyboard_rhythm = ''
  formData.is_active = true
  editingId.value = null
  formRef.value?.clearValidate?.()
}

function showCreateDialog() {
  resetForm()
  dialogVisible.value = true
}

function showEditDialog(row) {
  resetForm()
  editingId.value = row.id
  formData.name = row.name || ''
  formData.category = row.category || 'genre'
  formData.genre_type = row.genre_type || ''
  formData.description = row.description || ''
  formData.prompt_system = row.prompt_system || ''
  // JSON 字段：后端可能返回对象或字符串，统一转为字符串便于编辑
  formData.character_presets = stringifyJSON(row.character_presets)
  formData.scene_presets = stringifyJSON(row.scene_presets)
  formData.style_config = stringifyJSON(row.style_config)
  formData.storyboard_rhythm = stringifyJSON(row.storyboard_rhythm)
  formData.is_active = !!row.is_active
  dialogVisible.value = true
}

function stringifyJSON(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') return val
  try {
    return JSON.stringify(val, null, 2)
  } catch {
    return ''
  }
}

async function onSave() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const body = {
      name: formData.name,
      category: formData.category,
      genre_type: formData.genre_type || null,
      description: formData.description || null,
      prompt_system: formData.prompt_system || null,
      character_presets: formData.character_presets || null,
      scene_presets: formData.scene_presets || null,
      style_config: formData.style_config || null,
      storyboard_rhythm: formData.storyboard_rhythm || null,
      is_active: formData.is_active ? 1 : 0
    }
    if (editingId.value) {
      await templateAPI.update(editingId.value, body)
      ElMessage.success('更新成功')
    } else {
      await templateAPI.create(body)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    // request 拦截器已提示错误
  } finally {
    saving.value = false
  }
}

// ---------- 删除 ----------
async function onDelete(row) {
  try {
    await templateAPI.delete(row.id)
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    // request 拦截器已提示错误
  }
}

// ---------- 预览 ----------
const previewVisible = ref(false)
const previewTemplate = ref(null)
function showPreview(row) {
  previewTemplate.value = row
  previewVisible.value = true
}

onMounted(loadList)
</script>

<style scoped>
.admin-templates {
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
  color: var(--text-subtle);
  font-size: 13px;
  margin-left: 8px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}

.filter-card {
  margin-top: 16px;
}
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.text-muted {
  color: var(--text-subtle);
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

/* 预览 */
.preview-content {
  padding: 0 4px;
}
.preview-head h3 {
  margin: 0 0 8px;
  font-size: 1.15rem;
  color: var(--text-bright);
}
.preview-tags {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.preview-desc {
  color: var(--text-muted);
  font-size: 0.88rem;
  margin: 0;
  line-height: 1.5;
}
.preview-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview-item {
  background: var(--bg-inner);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
}
.preview-item p {
  margin: 4px 0 0;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.5;
}
.preview-item p.muted {
  color: var(--text-subtle);
}
.preview-json {
  background: var(--bg-page);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  max-height: 280px;
  overflow-y: auto;
}
.preview-prompt {
  color: var(--text-primary);
}
</style>
