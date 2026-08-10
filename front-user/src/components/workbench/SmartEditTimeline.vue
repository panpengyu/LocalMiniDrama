<template>
  <!-- S7-T07 智能剪辑前端交互：时间线式视频剪辑工作台
       - 顶部工具栏：分集/分辨率/帧率/默认转场/节奏匹配/开始剪辑/配音对齐
       - 时间线编辑器：可拖拽重排的片段卡片，片段间转场选择
       - 底部：任务历史 + 视频预览 -->
  <el-dialog
    v-model="visible"
    title="智能剪辑工作台"
    width="900px"
    append-to-body
    destroy-on-close
    class="smart-edit-dialog"
    @open="onDialogOpen"
    @close="onDialogClose"
  >
    <div class="smart-edit-workbench">
      <!-- ============ 顶部工具栏 ============ -->
      <div class="edit-toolbar">
        <el-select
          v-model="selectedEpisodeId"
          placeholder="选择分集（可选）"
          clearable
          size="small"
          class="toolbar-select"
        >
          <el-option
            v-for="ep in episodes"
            :key="ep.id"
            :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
            :value="ep.id"
          />
        </el-select>
        <el-select v-model="resolution" size="small" class="toolbar-select-sm">
          <el-option label="1080x1920" value="1080x1920" />
          <el-option label="1920x1080" value="1920x1080" />
          <el-option label="720x1280" value="720x1280" />
        </el-select>
        <el-select v-model="fps" size="small" class="toolbar-select-xs">
          <el-option label="24 fps" :value="24" />
          <el-option label="30 fps" :value="30" />
          <el-option label="60 fps" :value="60" />
        </el-select>
        <el-select v-model="transitionDefault" size="small" class="toolbar-select-sm" placeholder="默认转场">
          <el-option
            v-for="t in transitions"
            :key="t.key"
            :label="t.name"
            :value="t.key"
          />
        </el-select>
        <div class="beat-sync-wrap">
          <span class="beat-label">节奏匹配</span>
          <el-switch v-model="beatSync" size="small" />
        </div>
        <el-button
          type="primary"
          size="small"
          :loading="editing"
          @click="startAutoEdit"
        >
          <el-icon v-if="!editing"><VideoPlay /></el-icon>开始智能剪辑
        </el-button>
        <el-button size="small" :loading="aligning" @click="alignAudio">
          <el-icon v-if="!aligning"><VideoCamera /></el-icon>配音对齐
        </el-button>
      </div>

      <!-- ============ 时间线编辑器 ============ -->
      <div class="timeline-editor">
        <div v-if="loadingClips" class="timeline-loading">
          <el-icon class="loading-icon is-loading"><Loading /></el-icon>
          <span>加载片段中...</span>
        </div>
        <div v-else-if="!clips.length" class="timeline-empty">
          <el-icon class="empty-icon"><Picture /></el-icon>
          <span>暂无分镜片段，请先确保项目有分镜图片</span>
        </div>
        <div v-else class="timeline-track">
          <template v-for="(clip, idx) in clips" :key="(clip.storyboard_id || '') + '-' + idx">
            <div
              class="clip-card"
              :class="{ selected: selectedClipIndex === idx, dragging: dragIndex === idx }"
              draggable="true"
              @click="selectClip(idx)"
              @dragstart="onDragStart(idx, $event)"
              @dragover.prevent="onDragOver($event)"
              @drop.prevent="onDrop(idx)"
              @dragend="onDragEnd"
            >
              <div class="clip-thumb">
                <img
                  v-if="clip.image_url"
                  :src="resolveUrl(clip.image_url)"
                  alt="thumbnail"
                  draggable="false"
                />
                <div v-else class="clip-thumb-placeholder">
                  <el-icon><Picture /></el-icon>
                </div>
                <span class="clip-index">#{{ idx + 1 }}</span>
              </div>
              <div class="clip-info">
                <span class="clip-duration">{{ formatDuration(clip.duration) }}</span>
                <span
                  v-if="clip.shot_type"
                  class="shot-badge"
                  :style="{ background: shotTypeColor(clip.shot_type) }"
                >{{ shotTypeLabel(clip.shot_type) }}</span>
              </div>
            </div>
            <!-- 转场选择器（片段 i 与 i+1 之间） -->
            <div
              v-if="idx < clips.length - 1"
              class="clip-transition"
              @click.stop
            >
              <el-icon class="transition-icon"><Sort /></el-icon>
              <el-select
                v-model="clip.transition_type"
                size="small"
                class="transition-select"
                :teleported="false"
              >
                <el-option
                  v-for="t in transitions"
                  :key="t.key"
                  :label="t.name"
                  :value="t.key"
                />
              </el-select>
            </div>
          </template>
        </div>
      </div>

      <!-- ============ 选中片段详情面板 ============ -->
      <div v-if="selectedClip" class="clip-detail-panel">
        <div class="detail-header">
          <span class="detail-title">
            <el-icon><VideoCamera /></el-icon>
            片段 #{{ (selectedClipIndex ?? 0) + 1 }} 详情
          </span>
          <el-button text size="small" @click="selectedClipIndex = null">关闭</el-button>
        </div>
        <div class="detail-body">
          <div class="detail-row">
            <label class="detail-label">时长</label>
            <div class="detail-slider">
              <el-slider
                v-model="selectedClip.duration"
                :min="1"
                :max="10"
                :step="0.1"
              />
              <span class="slider-value">{{ formatDuration(selectedClip.duration) }}</span>
            </div>
          </div>
          <div class="detail-row">
            <label class="detail-label">镜头类型</label>
            <span
              v-if="selectedClip.shot_type"
              class="shot-badge"
              :style="{ background: shotTypeColor(selectedClip.shot_type) }"
            >{{ shotTypeLabel(selectedClip.shot_type) }}</span>
            <span v-else class="detail-empty">未指定</span>
          </div>
          <div v-if="selectedClip.narration" class="detail-row">
            <label class="detail-label">旁白</label>
            <div class="detail-text">{{ selectedClip.narration }}</div>
          </div>
          <div v-if="selectedClip.dialogue" class="detail-row">
            <label class="detail-label">对白</label>
            <div class="detail-text">{{ selectedClip.dialogue }}</div>
          </div>
          <div v-if="!selectedClip.narration && !selectedClip.dialogue" class="detail-row">
            <label class="detail-label">文本</label>
            <span class="detail-empty">暂无旁白/对白</span>
          </div>
        </div>
      </div>

      <!-- ============ 底部：任务历史 + 预览 ============ -->
      <div class="bottom-section">
        <el-collapse v-model="historyCollapse" class="history-collapse">
          <el-collapse-item name="history">
            <template #title>
              <div class="collapse-title">
                <el-icon><Sort /></el-icon>
                <span>任务历史</span>
                <span class="collapse-count">{{ tasks.length }}</span>
              </div>
            </template>
            <div class="history-list">
              <div
                v-for="task in tasks"
                :key="task.id"
                class="history-item"
                :class="{ active: currentTask && currentTask.id === task.id }"
                @click="selectTask(task)"
              >
                <div class="history-item-main">
                  <span class="history-title">{{ task.title || '任务 #' + task.id }}</span>
                  <span
                    class="status-tag"
                    :class="'status-' + task.status"
                  >{{ statusLabel(task.status) }}</span>
                </div>
                <div class="history-item-meta">
                  <span v-if="task.status === 'processing'">进度 {{ task.progress || 0 }}%</span>
                  <span v-else-if="task.status === 'completed' && task.output_duration">
                    时长 {{ formatDuration(task.output_duration) }}
                  </span>
                  <span v-else-if="task.status === 'failed'" class="history-error">
                    {{ truncate(task.error_message, 40) }}
                  </span>
                  <span class="history-time">{{ formatTime(task.created_at) }}</span>
                </div>
                <el-progress
                  v-if="task.status === 'processing'"
                  :percentage="task.progress || 0"
                  :stroke-width="4"
                  :show-text="false"
                />
              </div>
              <div v-if="!tasks.length" class="history-empty">暂无剪辑任务</div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <div
          v-if="currentTask && currentTask.status === 'completed' && currentTask.output_url"
          class="preview-section"
        >
          <div class="preview-header">
            <el-icon><VideoPlay /></el-icon>
            <span>预览：{{ currentTask.title || '任务 #' + currentTask.id }}</span>
          </div>
          <div class="preview-wrapper">
            <video
              :src="resolveUrl(currentTask.output_url)"
              controls
              class="preview-video"
            ></video>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
/**
 * SmartEditTimeline.vue — S7-T07 智能剪辑前端交互
 *
 * 数据流：
 *   - 打开弹窗 → 加载分集列表 / 转场效果 / 历史任务
 *   - 若最近任务为 completed/processing，加载其 source_clips 到时间线
 *   - 用户调整片段顺序/时长/转场后点击「开始智能剪辑」→ autoEdit
 *   - 处理中的任务每 3s 轮询 getTask 直到完成/失败
 *
 * 说明：后端 autoEdit 为同步阻塞式（等待 ffmpeg 执行完毕才返回），
 *      但轮询逻辑同时兼容异步返回 processing 的场景。
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { VideoPlay, VideoCamera, Picture, Sort, Loading } from '@element-plus/icons-vue'
import { editAPI } from '@/api/edit'
import { dramaAPI } from '@/api/drama'

const props = defineProps({
  dramaId: { type: Number, required: true },
})
const emit = defineEmits(['edit-completed'])

/* ---------- 响应式状态 ---------- */
const visible = ref(false)
const episodes = ref([])
const selectedEpisodeId = ref(null)
const resolution = ref('1080x1920')
const fps = ref(30)
const transitionDefault = ref('fade')
const beatSync = ref(true)
const transitions = ref([])
const clips = ref([])
const selectedClipIndex = ref(null)
const tasks = ref([])
const currentTask = ref(null)
const editing = ref(false)
const aligning = ref(false)
const loadingClips = ref(false)
const historyCollapse = ref(['history'])

let pollTimer = null
let dragIndex = null

const selectedClip = computed(() => {
  if (selectedClipIndex.value == null) return null
  return clips.value[selectedClipIndex.value] || null
})

/* ---------- 对外方法 ---------- */
function open() {
  visible.value = true
}
function close() {
  visible.value = false
}
defineExpose({ open, close })

/* ---------- 弹窗生命周期 ---------- */
async function onDialogOpen() {
  // 并行加载分集、转场、任务
  await Promise.all([loadEpisodes(), loadTransitions(), loadTasks()])
  // 加载最近任务的片段到时间线
  await loadLatestClips()
  // 若存在处理中的任务，启动轮询
  const processing = tasks.value.find(
    (t) => t.status === 'processing' || t.status === 'pending'
  )
  if (processing) startPolling(processing.id)
}

function onDialogClose() {
  stopPolling()
  selectedClipIndex.value = null
  currentTask.value = null
}

/* ---------- 数据加载 ---------- */
async function loadEpisodes() {
  try {
    const drama = await dramaAPI.get(props.dramaId)
    episodes.value = drama?.episodes || []
  } catch (e) {
    // 分集加载失败不阻断主流程
    episodes.value = []
  }
}

async function loadTransitions() {
  try {
    const list = await editAPI.listTransitions()
    transitions.value = Array.isArray(list) ? list : []
    if (transitions.value.length) {
      const exists = transitions.value.some((t) => t.key === transitionDefault.value)
      if (!exists) transitionDefault.value = transitions.value[0].key
    }
  } catch (e) {
    // 兜底转场列表
    transitions.value = [
      { key: 'hard_cut', name: '硬切', description: '直接切换', duration: 0 },
      { key: 'fade', name: '淡入淡出', description: '淡入淡出', duration: 0.5 },
      { key: 'dissolve', name: '叠化', description: '叠化', duration: 0.5 },
      { key: 'slide', name: '滑动', description: '滑动', duration: 0.5 },
      { key: 'zoom', name: '缩放', description: '缩放', duration: 0.5 },
      { key: 'rotate', name: '旋转', description: '旋转', duration: 0.5 },
    ]
  }
}

async function loadTasks() {
  try {
    const list = await editAPI.listTasks({ drama_id: props.dramaId, limit: 20 })
    tasks.value = Array.isArray(list) ? list : []
  } catch (e) {
    tasks.value = []
  }
}

async function loadLatestClips() {
  const latest = tasks.value[0]
  if (!latest) {
    clips.value = []
    return
  }
  if (latest.status !== 'completed' && latest.status !== 'processing') {
    clips.value = []
    return
  }
  loadingClips.value = true
  try {
    const detail = await editAPI.getTask(latest.id)
    if (detail && Array.isArray(detail.source_clips)) {
      clips.value = normalizeClips(detail.source_clips)
    }
  } catch (e) {
    // 静默失败
  } finally {
    loadingClips.value = false
  }
}

/** 规范化片段数据：保证 index / duration / transition_type 字段存在 */
function normalizeClips(list) {
  return (list || []).map((c, i) => ({
    ...c,
    index: i,
    duration: Number(c.duration) || 3,
    transition_type: c.transition_type || (i === 0 ? 'hard_cut' : transitionDefault.value || 'fade'),
  }))
}

/* ---------- 智能剪辑 ---------- */
async function startAutoEdit() {
  if (editing.value) return
  editing.value = true
  try {
    const payload = {
      drama_id: props.dramaId,
      title: '智能剪辑 ' + new Date().toLocaleString('zh-CN', { hour12: false }),
      resolution: resolution.value,
      fps: fps.value,
      transition_default: transitionDefault.value,
      beat_sync: beatSync.value,
    }
    if (selectedEpisodeId.value) payload.episode_id = selectedEpisodeId.value

    const result = await editAPI.autoEdit(payload)

    // 后端 autoEdit 阻塞返回，正常情况下已完成或失败
    const taskId = result?.task_id || result?.id
    if (taskId) {
      // 拉取任务详情以加载 source_clips
      try {
        const detail = await editAPI.getTask(taskId)
        if (detail && Array.isArray(detail.source_clips) && detail.source_clips.length) {
          clips.value = normalizeClips(detail.source_clips)
        }
      } catch (_) {}
    }

    await loadTasks()

    const status = result?.status
    if (status === 'completed') {
      if (result.output_url) {
        emit('edit-completed', result.output_url)
      }
      ElMessage.success('智能剪辑已完成')
    } else if (status === 'processing' || status === 'pending') {
      // 兼容异步后端：启动轮询
      if (taskId) startPolling(taskId)
      ElMessage.info('智能剪辑任务已启动，正在处理中...')
    } else if (status === 'failed') {
      ElMessage.error(result?.error_message || '智能剪辑失败')
    }
  } catch (e) {
    ElMessage.error(e?.message || '智能剪辑启动失败')
  } finally {
    editing.value = false
  }
}

/* ---------- 配音对齐 ---------- */
async function alignAudio() {
  if (aligning.value) return
  aligning.value = true
  try {
    const payload = { drama_id: props.dramaId, strategy: 'stretch' }
    if (selectedEpisodeId.value) payload.episode_id = selectedEpisodeId.value
    const res = await editAPI.alignAudio(payload)
    const aligned = res?.aligned || res?.count || 0
    ElMessage.success('配音对齐已完成' + (aligned ? `（${aligned} 条）` : ''))
  } catch (e) {
    ElMessage.error(e?.message || '配音对齐失败')
  } finally {
    aligning.value = false
  }
}

/* ---------- 任务轮询 ---------- */
function startPolling(taskId) {
  if (!taskId) return
  stopPolling()
  const tick = async () => {
    try {
      const detail = await editAPI.getTask(taskId)
      if (!detail) {
        stopPolling()
        return
      }
      // 更新历史列表中对应任务
      const idx = tasks.value.findIndex((t) => t.id === taskId)
      if (idx >= 0) {
        tasks.value[idx] = detail
      } else {
        tasks.value.unshift(detail)
      }
      // 同步当前预览任务
      if (currentTask.value && currentTask.value.id === taskId) {
        currentTask.value = detail
      }
      if (detail.status === 'processing' || detail.status === 'pending') {
        pollTimer = setTimeout(tick, 3000)
      } else {
        stopPolling()
        if (detail.status === 'completed') {
          if (Array.isArray(detail.source_clips) && detail.source_clips.length) {
            clips.value = normalizeClips(detail.source_clips)
          }
          if (detail.output_url) {
            emit('edit-completed', detail.output_url)
          }
          ElMessage.success('智能剪辑已完成')
          await loadTasks()
        } else if (detail.status === 'failed') {
          ElMessage.error(detail.error_message || '智能剪辑失败')
          await loadTasks()
        }
      }
    } catch (e) {
      // 网络异常时延迟重试
      pollTimer = setTimeout(tick, 3000)
    }
  }
  pollTimer = setTimeout(tick, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

onBeforeUnmount(() => {
  stopPolling()
})

/* ---------- 片段交互 ---------- */
function selectClip(idx) {
  selectedClipIndex.value = selectedClipIndex.value === idx ? null : idx
}

function onDragStart(idx, e) {
  dragIndex = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', String(idx))
    } catch (_) {}
  }
}

function onDragOver(e) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(idx) {
  if (dragIndex == null || dragIndex === idx) {
    dragIndex = null
    return
  }
  const arr = clips.value.slice()
  const [moved] = arr.splice(dragIndex, 1)
  arr.splice(idx, 0, moved)
  // 重排后重新计算 index
  arr.forEach((c, i) => { c.index = i })
  clips.value = arr
  // 同步选中索引
  if (selectedClipIndex.value === dragIndex) {
    selectedClipIndex.value = idx
  } else if (selectedClipIndex.value != null) {
    if (dragIndex < selectedClipIndex.value && idx >= selectedClipIndex.value) {
      selectedClipIndex.value -= 1
    } else if (dragIndex > selectedClipIndex.value && idx <= selectedClipIndex.value) {
      selectedClipIndex.value += 1
    }
  }
  dragIndex = null
}

function onDragEnd() {
  dragIndex = null
}

function selectTask(task) {
  currentTask.value = task
}

/* ---------- 工具函数 ---------- */
function resolveUrl(url) {
  if (!url) return ''
  // /static/ 与 /api/ 开头已是相对路径，无需拼接
  if (url.startsWith('/static/') || url.startsWith('/api/')) return url
  return url
}

const SHOT_COLOR_MAP = {
  close_up: '#f56c6c',
  '特写': '#f56c6c',
  wide: '#67c23a',
  '全景': '#67c23a',
  medium: '#e6a23c',
  '中景': '#e6a23c',
}
const SHOT_LABEL_MAP = {
  close_up: '特写',
  '特写': '特写',
  wide: '全景',
  '全景': '全景',
  medium: '中景',
  '中景': '中景',
}

function shotTypeColor(shotType) {
  return SHOT_COLOR_MAP[shotType] || '#909399'
}

function shotTypeLabel(shotType) {
  if (!shotType) return '默认'
  return SHOT_LABEL_MAP[shotType] || String(shotType)
}

function formatDuration(d) {
  const n = Number(d) || 0
  return n.toFixed(1) + 's'
}

function formatTime(t) {
  if (!t) return ''
  try {
    const str = String(t).replace(' ', 'T')
    const d = new Date(str)
    if (isNaN(d.getTime())) return String(t)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(t)
  }
}

function statusLabel(s) {
  const map = {
    pending: '等待中',
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
  }
  return map[s] || s
}

function truncate(str, len) {
  if (!str) return ''
  const s = String(str)
  return s.length > len ? s.slice(0, len) + '...' : s
}
</script>

<style scoped>
.smart-edit-workbench {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ============ 顶部工具栏 ============ */
.edit-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: rgba(30, 30, 40, 0.6);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
}
.toolbar-select { width: 180px; }
.toolbar-select-sm { width: 130px; }
.toolbar-select-xs { width: 92px; }
.beat-sync-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #a1a1aa;
  font-size: 12px;
}
.beat-label { white-space: nowrap; }

/* ============ 时间线编辑器 ============ */
.timeline-editor {
  min-height: 300px;
  background: rgba(15, 15, 22, 0.6);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 10px;
  padding: 14px;
  overflow-x: auto;
}
.timeline-empty,
.timeline-loading {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #71717a;
  font-size: 14px;
}
.empty-icon { font-size: 40px; color: #4b5563; }
.loading-icon { font-size: 32px; color: #6366f1; }
.timeline-track {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 180px;
  padding-bottom: 6px;
}

/* ============ 片段卡片 ============ */
.clip-card {
  flex: 0 0 160px;
  width: 160px;
  background: rgba(30, 30, 40, 0.9);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.clip-card:hover {
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-2px);
}
.clip-card.selected {
  border: 2px solid #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}
.clip-card.dragging {
  opacity: 0.5;
}
.clip-card:active { cursor: grabbing; }

.clip-thumb {
  position: relative;
  width: 100%;
  height: 90px;
  background: rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.clip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.clip-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4b5563;
  font-size: 28px;
}
.clip-index {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #e4e4e7;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 600;
}
.clip-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  gap: 4px;
}
.clip-duration {
  font-size: 12px;
  color: #e4e4e7;
  font-weight: 600;
}

/* 镜头类型徽章 */
.shot-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: #fff;
  white-space: nowrap;
  font-weight: 500;
}

/* ============ 转场选择器 ============ */
.clip-transition {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 70px;
  gap: 2px;
}
.transition-icon {
  font-size: 14px;
  color: #6366f1;
}
.transition-select { width: 60px; }
.transition-select :deep(.el-input__wrapper) {
  padding: 0 4px;
  background: rgba(20, 20, 28, 0.8);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3) inset;
}
.transition-select :deep(.el-input__inner) {
  font-size: 11px;
  text-align: center;
  color: #e4e4e7;
}

/* ============ 片段详情面板 ============ */
.clip-detail-panel {
  background: rgba(30, 30, 40, 0.9);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 10px;
  padding: 12px 14px;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #e4e4e7;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.detail-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.detail-label {
  flex: 0 0 70px;
  color: #a1a1aa;
  font-size: 12px;
  padding-top: 2px;
}
.detail-slider {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail-slider :deep(.el-slider) {
  flex: 1;
}
.slider-value {
  flex: 0 0 42px;
  text-align: right;
  color: #6366f1;
  font-size: 12px;
  font-weight: 600;
}
.detail-text {
  flex: 1;
  color: #d4d4d8;
  font-size: 12px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 8px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.detail-empty {
  color: #52525b;
  font-size: 12px;
}

/* ============ 底部：任务历史 + 预览 ============ */
.bottom-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.history-collapse {
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  background: rgba(20, 20, 28, 0.6);
}
.history-collapse :deep(.el-collapse-item__header) {
  background: transparent;
  border-bottom: 1px solid rgba(99, 102, 241, 0.15);
  color: #e4e4e7;
  padding: 0 12px;
}
.history-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}
.history-collapse :deep(.el-collapse-item__content) {
  padding: 10px 12px;
}
.collapse-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.collapse-count {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  background: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
  border-radius: 9px;
  font-size: 11px;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}
.history-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(30, 30, 40, 0.6);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.history-item:hover {
  border-color: rgba(99, 102, 241, 0.4);
}
.history-item.active {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.12);
}
.history-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.history-title {
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.status-tag {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
}
.status-pending { background: rgba(144, 147, 153, 0.2); color: #909399; }
.status-processing { background: rgba(230, 162, 60, 0.2); color: #e6a23c; }
.status-completed { background: rgba(103, 194, 58, 0.2); color: #67c23a; }
.status-failed { background: rgba(245, 108, 108, 0.2); color: #f56c6c; }
.history-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #71717a;
}
.history-error { color: #f56c6c; }
.history-time {
  font-size: 11px;
  color: #52525b;
  white-space: nowrap;
}
.history-empty {
  text-align: center;
  color: #52525b;
  font-size: 12px;
  padding: 16px;
}

/* ============ 视频预览 ============ */
.preview-section {
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  padding: 12px;
}
.preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #e4e4e7;
  font-size: 13px;
  margin-bottom: 10px;
}
.preview-wrapper {
  display: flex;
  justify-content: center;
}
.preview-video {
  max-width: 100%;
  max-height: 360px;
  border-radius: 6px;
  background: #000;
}
</style>

<!-- 非 scoped：el-dialog 通过 append-to-body 挂载到 body，需全局样式定制暗色玻璃态 -->
<style>
.smart-edit-dialog.el-dialog {
  background: rgba(20, 20, 28, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.smart-edit-dialog .el-dialog__header {
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
  margin-right: 0;
  padding: 16px 20px;
}
.smart-edit-dialog .el-dialog__title {
  color: #f4f4f5;
  font-weight: 600;
}
.smart-edit-dialog .el-dialog__headerbtn .el-dialog__close {
  color: #a1a1aa;
}
.smart-edit-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: #6366f1;
}
.smart-edit-dialog .el-dialog__body {
  color: #e4e4e7;
  padding: 16px 20px;
}
.smart-edit-dialog .el-dialog__footer {
  border-top: 1px solid rgba(99, 102, 241, 0.2);
  padding: 12px 20px;
}
</style>
