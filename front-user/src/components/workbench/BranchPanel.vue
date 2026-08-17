<template>
  <div class="branch-panel">
    <div class="bp-header">
      <el-icon class="bp-title-icon"><Share /></el-icon>
      <span class="bp-title">分支叙事</span>
      <el-button text :icon="Close" class="bp-close" @click="close" />
    </div>

    <div class="bp-body">
      <!-- 分支列表 -->
      <div class="bp-section">
        <div class="bp-section-title">
          <el-icon><List /></el-icon>分支列表
        </div>
        <el-table :data="branches" size="small" v-loading="loading" class="bp-table">
          <el-table-column label="名称" min-width="120">
            <template #default="{ row }">
              <template v-if="editingId === row.id">
                <el-input v-model="editName" size="small" @keyup.enter="saveRename(row)" />
              </template>
              <template v-else>
                <el-tag v-if="row.type === 'main'" type="primary" size="small" effect="plain">主线</el-tag>
                <span v-else class="bp-branch-name">{{ row.name }}</span>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="集数" width="56" align="center">
            <template #default="{ row }">{{ row.episodeCount }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="right">
            <template #default="{ row }">
              <template v-if="editingId === row.id">
                <el-button text size="small" type="primary" @click="saveRename(row)">保存</el-button>
                <el-button text size="small" @click="editingId = null">取消</el-button>
              </template>
              <template v-else>
                <el-button v-if="row.type !== 'main'" text size="small" :icon="Edit" @click="startRename(row)">重命名</el-button>
                <el-button v-if="row.type !== 'main'" text size="small" type="danger" :icon="Delete" @click="removeBranch(row)" />
              </template>
            </template>
          </el-table-column>
        </el-table>
        <p class="bp-tip">主线为主线剧本；新建分支会从所选集复制分镜，各分支独立演进。</p>
      </div>

      <!-- 新建分支 -->
      <div class="bp-section">
        <div class="bp-section-title">
          <el-icon><Plus /></el-icon>新建分支
        </div>
        <div class="bp-row">
          <el-select v-model="newForm.sourceEpisodeId" size="small" placeholder="选择源集（主线剧集）" style="width: 46%">
            <el-option
              v-for="ep in mainEpisodes"
              :key="ep.id"
              :label="`第 ${ep.episode_number} 集：${ep.title || ''}`"
              :value="ep.id"
            />
          </el-select>
          <el-input v-model="newForm.name" size="small" placeholder="分支名称，如：亲情线" style="width: 30%" />
          <el-button size="small" type="primary" :loading="creating" @click="createBranch">创建</el-button>
        </div>
      </div>

      <!-- 条件连线 -->
      <div class="bp-section">
        <div class="bp-section-title">
          <el-icon><Connection /></el-icon>条件连线（分支叙事节点）
        </div>
        <div class="bp-row">
          <el-select
            v-model="cond.sceneId"
            size="small"
            placeholder="源分镜（带 scene_id）"
            style="width: 100%"
            @change="onSceneChange"
          >
            <el-option
              v-for="s in sceneOptions"
              :key="s.scene_id"
              :label="s.label"
              :value="s.scene_id"
            />
          </el-select>
        </div>
        <div class="bp-row">
          <el-input
            v-model="cond.condition"
            size="small"
            type="textarea"
            :rows="2"
            placeholder="观众选择条件，如：若主角犹豫则进入亲情支线"
          />
        </div>
        <div class="bp-row">
          <el-select v-model="cond.targetSceneId" size="small" placeholder="跳转目标分镜（可选）" style="width: 100%" clearable>
            <el-option
              v-for="s in sceneOptions"
              :key="s.scene_id"
              :label="s.label"
              :value="s.scene_id"
            />
          </el-select>
        </div>
        <div class="bp-row">
          <el-button size="small" type="primary" :disabled="!cond.sceneId || !cond.condition.trim()" :loading="savingCond" @click="saveCondition">
            保存条件
          </el-button>
          <el-button size="small" @click="resetCond">清空</el-button>
        </div>
        <p class="bp-tip">画布中带条件的分镜会显示「分支标记」，导出剧本时自动标注跳转关系。</p>
      </div>

      <!-- 导出剧本 -->
      <div class="bp-section">
        <div class="bp-section-title">
          <el-icon><Download /></el-icon>按分支导出剧本
        </div>
        <div class="bp-row">
          <el-select v-model="exportBranchId" size="small" style="width: 46%">
            <el-option label="主线" :value="null" />
            <el-option v-for="b in branches.filter((x) => x.type !== 'main')" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
          <el-button size="small" @click="previewExport">预览</el-button>
          <el-button size="small" type="primary" @click="downloadExport">下载 .txt</el-button>
        </div>
      </div>
    </div>

    <!-- 导出预览 -->
    <el-dialog v-model="exportPreviewVisible" title="剧本预览" width="680px" append-to-body>
      <div class="bp-preview">{{ exportPreviewText }}</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Share, Close, List, Plus, Connection, Download, Edit, Delete,
} from '@element-plus/icons-vue'
import branchAPI from '@/api/branch'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], required: true },
  // 画布加载的 drama 详情（含 episodes.storyboards），用于场景下拉
  drama: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const loading = ref(false)
const branches = ref([])
const editingId = ref(null)
const editName = ref('')
const creating = ref(false)
const newForm = ref({ sourceEpisodeId: null, name: '' })
const cond = ref({ sceneId: null, condition: '', targetSceneId: null })
const savingCond = ref(false)
const exportBranchId = ref(null)
const exportPreviewVisible = ref(false)
const exportPreviewText = ref('')

function close() {
  emit('update:modelValue', false)
}

/** 主线剧集（未挂分支） */
const mainEpisodes = computed(() => {
  const eps = props.drama?.episodes || []
  return eps.filter((e) => e.branch_id == null || e.branch_type === 'main')
})

/** 全剧集带 scene_id 的分镜，用于源/目标场景下拉 */
const sceneOptions = computed(() => {
  const eps = props.drama?.episodes || []
  const list = []
  for (const ep of eps) {
    for (const sb of ep.storyboards || []) {
      if (sb.scene_id != null) {
        list.push({
          scene_id: sb.scene_id,
          episode_number: ep.episode_number,
          title: sb.title || '',
          label: `第${ep.episode_number}集·分镜${sb.scene_id}：${sb.title || sb.dialogue || ''}`.slice(0, 40),
          branchType: ep.branch_type === 'branch' ? `分支:${ep.branch_name || ''}` : '主线',
        })
      }
    }
  }
  return list
})

async function loadBranches() {
  loading.value = true
  try {
    const res = await branchAPI.list(props.dramaId)
    branches.value = res?.data || res || []
  } finally {
    loading.value = false
  }
}

function startRename(row) {
  editingId.value = row.id
  editName.value = row.name || ''
}
async function saveRename(row) {
  const name = editName.value.trim()
  if (!name) return ElMessage.warning('分支名不能为空')
  try {
    await branchAPI.rename(props.dramaId, row.id, name)
    ElMessage.success('已重命名')
    editingId.value = null
    await loadBranches()
    emit('changed')
  } catch (e) { /* 错误已由拦截器提示 */ }
}

async function createBranch() {
  if (!newForm.value.sourceEpisodeId) return ElMessage.warning('请选择源集')
  const name = newForm.value.name.trim()
  if (!name) return ElMessage.warning('请输入分支名称')
  creating.value = true
  try {
    await branchAPI.create(props.dramaId, { source_episode_id: newForm.value.sourceEpisodeId, name })
    ElMessage.success('分支已创建，源集分镜已复制')
    newForm.value = { sourceEpisodeId: null, name: '' }
    await loadBranches()
    emit('changed')
  } catch (e) { /* 拦截器已提示 */ } finally {
    creating.value = false
  }
}

async function removeBranch(row) {
  try {
    await ElMessageBox.confirm(
      `删除分支「${row.name}」将同时删除该分支下的 ${row.episodeCount} 个剧集及其分镜，此操作不可恢复。`,
      '删除分支',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch (_) { return }
  try {
    const res = await branchAPI.remove(props.dramaId, row.id)
    ElMessage.success(`已删除分支，清理 ${res?.deletedEpisodes ?? 0} 集 / ${res?.deletedStoryboards ?? 0} 分镜`)
    await loadBranches()
    emit('changed')
  } catch (e) { /* 拦截器已提示 */ }
}

function onSceneChange(sceneId) {
  const target = sceneOptions.value.find((s) => s.scene_id === sceneId)
  const sb = findStoryboard(sceneId)
  if (sb?.branch_condition) {
    try {
      const c = JSON.parse(sb.branch_condition)
      cond.value.condition = c.condition || ''
      cond.value.targetSceneId = c.target_scene_id ?? null
      return
    } catch (_) { /* fallthrough */ }
  }
  if (target?.branchType !== '主线') {
    cond.value.condition = ''
    cond.value.targetSceneId = null
  } else {
    cond.value.condition = ''
    cond.value.targetSceneId = null
  }
}

function findStoryboard(sceneId) {
  for (const ep of props.drama?.episodes || []) {
    const sb = (ep.storyboards || []).find((x) => x.scene_id === sceneId)
    if (sb) return sb
  }
  return null
}

function resetCond() {
  cond.value = { sceneId: null, condition: '', targetSceneId: null }
}

async function saveCondition() {
  if (!cond.value.sceneId || !cond.value.condition.trim()) return
  savingCond.value = true
  try {
    await branchAPI.setCondition(cond.value.sceneId, cond.value.condition.trim(), cond.value.targetSceneId)
    ElMessage.success('条件已保存')
    emit('changed')
  } catch (e) { /* 拦截器已提示 */ } finally {
    savingCond.value = false
  }
}

async function previewExport() {
  exportPreviewText.value = ''
  exportPreviewVisible.value = true
  try {
    const res = await branchAPI.exportScript(props.dramaId, exportBranchId.value)
    const text = typeof res === 'string' ? res : (res?.data ?? '')
    exportPreviewText.value = text
  } catch (e) { exportPreviewText.value = `导出失败：${e?.message || ''}` }
}

async function downloadExport() {
  try {
    const res = await branchAPI.exportScript(props.dramaId, exportBranchId.value)
    const text = typeof res === 'string' ? res : (res?.data ?? '')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `剧本导出_${props.dramaId}_${exportBranchId.value == null ? '主线' : String(exportBranchId.value)}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ElMessage.success('已开始下载')
  } catch (e) {
    ElMessage.error('导出失败：' + (e?.message || ''))
  }
}

watch(() => props.modelValue, (v) => {
  if (v) {
    loadBranches()
    // 打开时同步一次分支导出选项
    exportBranchId.value = null
  }
})
</script>

<style scoped>
.branch-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}
.bp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid #eef2f7;
}
.bp-title-icon { color: #6366f1; font-size: 18px; }
.bp-title { font-weight: 600; font-size: 15px; color: #1e1b4b; }
.bp-close { margin-left: auto; }
.bp-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.bp-section { margin-bottom: 22px; }
.bp-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 10px;
}
.bp-table { width: 100%; }
.bp-branch-name { font-size: 13px; }
.bp-row { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bp-tip { font-size: 12px; color: #94a3b8; margin-top: 8px; line-height: 1.6; }
.bp-preview {
  white-space: pre-wrap;
  font-family: 'PingFang SC', 'Microsoft YaHei', monospace;
  font-size: 13px;
  line-height: 1.8;
  max-height: 60vh;
  overflow-y: auto;
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  color: #334155;
}
</style>
