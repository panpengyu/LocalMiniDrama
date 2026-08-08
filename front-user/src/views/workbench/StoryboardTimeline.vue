<template>
  <!-- S3-T07: 底部时间轴预览区 — 一站式工作台组成部分 -->
  <!-- 分镜时间轴：缩略图预览 + 原生 HTML5 drag & drop 排序 -->
  <div class="sb-timeline" :class="{ dragging: dragState.active }">
    <div class="sbt-head">
      <div class="sbt-title">
        <el-icon><Grid /></el-icon>
        <span>分镜时间轴</span>
        <el-tag size="small" effect="plain" style="margin-left:8px">{{ frames.length }} 镜</el-tag>
      </div>

      <div class="sbt-tools">
        <el-select
          v-model="episodeFilter"
          size="small"
          placeholder="选择集数"
          clearable
          style="width: 160px"
        >
          <el-option
            v-for="ep in episodes"
            :key="ep.id"
            :label="ep.title || `第 ${ep.episode_number || 0} 集`"
            :value="ep.id"
          />
        </el-select>
        <el-button size="small" @click="onScrollToFocused">
          <el-icon><Aim /></el-icon>
          定位当前
        </el-button>
        <el-button size="small" type="primary" :disabled="!frames.length" @click="onPlayReel">
          <el-icon><VideoPlay /></el-icon>
          预览
        </el-button>
        <el-divider direction="vertical" />
        <span class="sbt-hint">💡 拖拽卡片可调整分镜顺序；点击缩略图跳转画布对应节点</span>
      </div>
    </div>

    <div class="sbt-scroll-shell" ref="scrollRef">
      <div class="sbt-track">
        <div
          v-for="(f, idx) in frames"
          :key="f.id || `f-${idx}`"
          class="sbt-card"
          :class="{
            'is-focus': focusId === f.id,
            'is-dragging': dragState.idx === idx,
            'is-before': dragState.active && dragState.toIdx === idx && idx < dragState.idx,
            'is-after': dragState.active && dragState.toIdx === idx && idx > dragState.idx,
            'no-img': !f.image_url && !f.local_path && !f.thumbnail,
          }"
          draggable="true"
          @dragstart="onDragStart($event, idx)"
          @dragover.prevent="onDragOver($event, idx)"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop($event, idx)"
          @dragend="onDragEnd"
          @click="$emit('select', f, idx)"
        >
          <div class="sbt-order">{{ idx + 1 }}</div>

          <div class="sbt-thumb">
            <img
              v-if="f.local_path || f.image_url || f.thumbnail"
              :src="resolveImg(f)"
              :alt="f.action || f.title || `frame-${idx + 1}`"
              loading="lazy"
              draggable="false"
              @error="onImgError($event, f, idx)"
            />
            <div v-else class="sbt-noimg">
              <el-icon :size="24"><Picture /></el-icon>
              <span>{{ f.shot_type || (f.action || '').slice(0, 6) || '未生成' }}</span>
            </div>
            <div v-if="f.consistency_passed === 0" class="sbt-badge sbt-badge-danger" title="一致性未达标">
              <el-icon><WarningFilled /></el-icon>
              一致性 {{ pct(f.consistency_score) }}%
            </div>
            <div v-else-if="f.consistency_passed === 1" class="sbt-badge sbt-badge-ok" title="一致性达标">
              {{ pct(f.consistency_score) }}%
            </div>
            <div v-if="f.retry_count > 0" class="sbt-retry">R{{ f.retry_count }}</div>
          </div>

          <div class="sbt-meta">
            <div class="sbt-action" :title="f.action || f.title">
              {{ f.action || f.title || `第 ${idx + 1} 镜` }}
            </div>
            <div class="sbt-foot">
              <el-tag size="small" effect="plain" v-if="f.shot_type">{{ f.shot_type }}</el-tag>
              <el-tag size="small" effect="plain" type="warning" v-if="f.angle_s">{{ f.angle_s }}</el-tag>
              <span class="sbt-duration" v-if="f.duration_sec">{{ f.duration_sec }}s</span>
            </div>
          </div>
        </div>
        <div v-if="!frames.length" class="sbt-empty">
          <el-empty description="暂无分镜，到 AI 分镜 Tab 启动创作" :image-size="80" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { Grid, Aim, VideoPlay, Picture, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const log = useWorkbenchLogger('StoryboardTimeline')

const props = defineProps({
  frames: { type: Array, default: () => [] },
  episodes: { type: Array, default: () => [] },
  focusId: { type: [Number, String], default: null },
  episodeFilterValue: { type: [Number, String], default: null },
})
const emit = defineEmits(['update:frames', 'select', 'reorder', 'playReel', 'update:episodeFilter'])

const scrollRef = ref(null)
const episodeFilter = ref(props.episodeFilterValue)
watch(episodeFilter, (v) => {
  log.info('[Filter] 集数过滤器变更', { value: v })
  emit('update:episodeFilter', v)
})

// —— 焦点同步（画布→时间轴）：自动滚动到对应卡片 ——
let _lastFocusScrollId = null
watch(() => props.focusId, (fid, old) => {
  if (!fid || fid === _lastFocusScrollId) return
  log.info('[Sync] 画布→时间轴：聚焦分镜卡片', { storyboardId: fid, prev: old || null })
  const t0 = Date.now()
  const idx = [...(props.frames || [])].findIndex(f => f.id === fid)
  if (idx < 0) {
    log.warn('[Sync] 时间轴中未找到焦点分镜（可能被集数过滤）', { storyboardId: fid })
    return
  }
  // 延迟到下一个 tick 等 DOM 更新
  requestAnimationFrame(() => {
    try {
      const el = scrollRef.value?.querySelector(`.sbt-card:nth-child(${idx + 1})`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
        const ms = Date.now() - t0
        log.info('[Sync] 已滚动时间轴卡片到视图中心', { storyboardId: fid, idx, scrollMs: ms })
        _lastFocusScrollId = fid
      }
    } catch (e) { log.warn('[Sync] 滚动失败（DOM未就绪）', { storyboardId: fid, msg: e?.message }) }
  })
})

const dragState = reactive({ active: false, idx: -1, toIdx: -1, startAt: 0 })
const brokenIdxSet = ref(new Set())

function resolveImg(f) {
  return f.local_path ? (String(f.local_path).startsWith('/') ? '/static' + f.local_path : f.local_path)
    : f.thumbnail || f.image_url || ''
}
function onImgError(_e, f, idx) {
  log.warn('[Render] 分镜缩略图加载失败', { storyboardId: f?.id, idx, src: resolveImg(f) })
  brokenIdxSet.value.add(idx)
}
function pct(v) {
  if (v == null) return '-'
  return Math.max(0, Math.min(100, Math.round(Number(v) * 100)))
}

// ---- Drag & Drop（原生 HTML5 DnD，对齐 Sprint 2 风格） ----
function onDragStart(e, idx) {
  // 若正在处理（防抖：已有拖拽进行中则拦截）
  if (dragState.active) { log.warn('[DnD] 拖拽重复触发被拦截'); e.preventDefault(); return }
  dragState.active = true
  dragState.idx = idx
  dragState.toIdx = idx
  dragState.startAt = Date.now()
  try {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  } catch (_) {}
  document.body.classList.add('sbt-drag-active')
  log.info('[DnD] 分镜拖拽开始', {
    fromIdx: idx,
    storyboardId: props.frames?.[idx]?.id,
    title: props.frames?.[idx]?.title || props.frames?.[idx]?.action?.slice?.(0, 10),
  })
}
function onDragOver(_e, idx) {
  if (!dragState.active) return
  dragState.toIdx = idx
}
function onDragLeave() {}
function onDrop(e, idx) {
  if (!dragState.active) return
  const fromIdx = dragState.idx
  const toIdx = idx
  const dur = Date.now() - (dragState.startAt || 0)
  onDragEnd()
  if (fromIdx === toIdx) { log.debug('[DnD] 原位drop，跳过'); return }
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= props.frames.length || toIdx >= props.frames.length) {
    log.error('[DnD] drop索引越界', { fromIdx, toIdx, len: props.frames.length })
    return
  }

  try {
    const list = props.frames.slice()
    const [moved] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, moved)
    log.info('[DnD] 分镜拖拽结束 → 向上 emit 排序', {
      fromIdx, toIdx, durMs: dur,
      movedId: moved?.id,
      movedNumber: moved?.storyboard_number,
      consistency: moved?.consistency_score != null ? pct(moved.consistency_score) + '%' : null,
      retries: moved?.retry_count || 0,
    })
    emit('update:frames', list)
    emit('reorder', { fromIdx, toIdx, storyboardId: moved?.id, durMs: dur })
    ElMessage.success(`已调整分镜：${fromIdx + 1} → ${toIdx + 1}`)
  } catch (e) {
    log.error('[DnD] 拖拽排序处理异常', e, { fromIdx, toIdx })
  }
}
function onDragEnd() {
  dragState.active = false
  dragState.idx = -1
  dragState.toIdx = -1
  dragState.startAt = 0
  document.body.classList.remove('sbt-drag-active')
}

function onScrollToFocused() {
  const t0 = Date.now()
  if (scrollRef.value && props.focusId != null) {
    const idx = [...(props.frames || [])].findIndex(f => f.id === props.focusId)
    const el = scrollRef.value.querySelector(`.sbt-card:nth-child(${idx + 1})`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
      log.info('[UI] 定位当前焦点卡片成功', { storyboardId: props.focusId, idx, ms: Date.now() - t0 })
    } else {
      log.warn('[UI] 定位焦点卡片失败：DOM未找到', { storyboardId: props.focusId, idx })
    }
  } else {
    log.warn('[UI] 定位焦点卡片失败：无焦点或DOM未ready', { focusId: props.focusId })
  }
}
function onPlayReel() {
  log.info('[UI] 点击预览连播', { count: props.frames?.length || 0 })
  emit('playReel', props.frames.slice())
}
</script>

<style scoped>
.sbt-timeline {
  display: flex; flex-direction: column;
  background: #fff;
  border-top: 1px solid var(--el-border-color-lighter);
  height: 100%;
}
.sbt-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 14px; background: linear-gradient(90deg, #fff7ed, #fef3c7);
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
.sbt-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #92400e; }
.sbt-tools { display: flex; align-items: center; gap: 6px; }
.sbt-hint { font-size: 12px; color: var(--el-text-color-secondary); }

.sbt-scroll-shell {
  overflow-x: auto; overflow-y: hidden;
  padding: 10px 14px 14px;
  flex: 1;
  min-height: 0;
}
.sbt-track {
  display: flex; gap: 10px; align-items: stretch;
  min-width: max-content;
}

.sbt-empty { min-width: 100%; padding: 20px; }
.sbt-card {
  width: 168px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s;
  user-select: none;
  display: flex; flex-direction: column;
}
.sbt-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.08); border-color: #6366f1; transform: translateY(-2px); }
.sbt-card.is-focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(99, 102, 241, .18); }
.sbt-card.no-img .sbt-thumb { background: #f3f4f6; }
.sbt-card.is-dragging { opacity: 0.4; }
.sbt-card.is-before { transform: translateX(-6px); }
.sbt-card.is-after { transform: translateX(6px); }

.sbt-order {
  position: absolute; top: 6px; left: 6px; z-index: 2;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0,0,0,0.65); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.sbt-retry {
  position: absolute; top: 6px; right: 6px; z-index: 2;
  background: #f59e0b; color: #fff;
  font-size: 10px; padding: 2px 5px; border-radius: 4px; font-weight: 700;
}

.sbt-thumb {
  width: 168px; height: 96px;
  background: #0f172a;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.sbt-thumb img {
  width: 100%; height: 100%; object-fit: cover;
}
.sbt-noimg { color: #9ca3af; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; }
.sbt-badge {
  position: absolute; bottom: 4px; left: 4px; z-index: 2;
  padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
  display: flex; align-items: center; gap: 2px;
}
.sbt-badge-ok { background: #16a34a; color: #fff; }
.sbt-badge-danger { background: #dc2626; color: #fff; }

.sbt-meta { padding: 6px 8px 8px; flex: 1; display: flex; flex-direction: column; }
.sbt-action {
  font-size: 12px; line-height: 1.4;
  color: var(--el-text-color-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}
.sbt-foot {
  margin-top: 4px;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.sbt-duration { font-size: 11px; color: var(--el-text-color-secondary); margin-left: auto; }
</style>

<!-- S3-T07 全局：拖拽时防止意外文本选中（参考 Sprint 2 经验） -->
<style>
body.sbt-drag-active * { user-select: none !important; }
</style>
