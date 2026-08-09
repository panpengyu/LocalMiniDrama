<template>
  <!-- S5-T01: 节点三视图模式 compact / normal / detailed -->
  <div class="canvas-node-stack" :class="'vm-' + viewMode">
    <Handle id="chain-in" type="target" :position="Position.Top" />
    <Handle id="asset-in" type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
    <Handle id="chain-out" type="source" :position="Position.Bottom" />

    <!-- ========== Compact: zoom<=0.2 只显编号+色条 ========== -->
    <div
      v-if="viewMode === 'compact'"
      class="sb-compact"
      :class="{ selected, highlighted: data.highlighted, dimmed: data.dimmed }"
      :style="{ borderLeftColor: statusAccent }"
    >
      <span class="sb-c-num">#{{ data.storyboard?.storyboard_number ?? data.index }}</span>
      <span class="sb-c-seg" v-if="data.storyboard?.segment_title">{{ truncate(data.storyboard.segment_title, 10) }}</span>
    </div>

    <!-- ========== Normal: 0.2<zoom<=0.8 标题+缩略图+基础tag ========== -->
    <div
      v-else-if="viewMode === 'normal'"
      class="canvas-sb-node vm-normal"
      :class="{ selected, highlighted: data.highlighted, dimmed: data.dimmed, processing: isProcessing || isNodeBusy }"
    >
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="head">
        <span class="num">#{{ data.storyboard?.storyboard_number ?? data.index }}</span>
        <span v-if="data.storyboard?.segment_title" class="seg">{{ truncate(data.storyboard.segment_title, 12) }}</span>
        <span :class="'st-' + (data.storyboard?.status || 'pending')" class="st">{{ statusMiniLabel }}</span>
      </div>
      <div v-if="renderDensity?.showThumbnail !== false" class="sb-thumb">
        <img v-if="thumbUrl" :src="thumbUrl" alt="" class="sb-thumb-img" />
        <div v-else class="sb-thumb-placeholder">🎬</div>
      </div>
      <div class="title">{{ truncate(data.storyboard?.title || '分镜', 22) }}</div>
      <div v-if="renderDensity?.showMetadata !== false" class="chips">
        <span v-if="data.storyboard?.shot_type">{{ data.storyboard.shot_type }}</span>
        <span v-if="data.storyboard?.duration">{{ data.storyboard.duration }}s</span>
      </div>
    </div>

    <!-- ========== Detailed: zoom>0.8 完整大图+参数+操作按钮 ========== -->
    <div
      v-else
      class="canvas-sb-node vm-detailed"
      :class="{ selected, highlighted: data.highlighted, dimmed: data.dimmed, processing: isProcessing || isNodeBusy, focused: showPanel }"
    >
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="head">
        <span class="num">#{{ data.storyboard?.storyboard_number ?? data.index }}</span>
        <span v-if="data.workflowGroup?.title" class="wf-badge">{{ data.workflowGroup.title }}</span>
        <span v-if="data.storyboard?.segment_title" class="seg">{{ data.storyboard.segment_title }}</span>
        <span v-if="data.storyboard?.creation_mode === 'universal'" class="mode-badge">全能</span>
      </div>
      <div class="title">{{ data.storyboard?.title || '分镜' }}</div>
      <div v-if="renderDensity?.showThumbnail !== false" class="sb-thumb sb-thumb-lg">
        <img v-if="thumbUrl" :src="thumbUrl" alt="" class="sb-thumb-img" />
        <div v-else class="sb-thumb-placeholder">🎬 待生成</div>
      </div>
      <div v-if="renderDensity?.showMetadata !== false" class="chips">
        <span v-if="data.storyboard?.shot_type">{{ data.storyboard.shot_type }}</span>
        <span v-if="data.storyboard?.camera_move">{{ data.storyboard.camera_move }}</span>
        <span v-if="data.storyboard?.duration">{{ data.storyboard.duration }}s</span>
        <span :class="'st-' + (data.storyboard?.status || 'pending')">{{ statusLabel }}</span>
      </div>
      <div v-if="renderDensity?.showDialogue" class="dialogue">
        {{ truncate(data.storyboard?.description || data.storyboard?.dialogue || '', 60) }}
      </div>
      <div v-if="renderDensity?.showHint" class="hint">{{ showPanel ? '下方可编辑与生成' : '单击展开操作 · 双击进列表' }}</div>
    </div>

    <CanvasStoryboardPanel
      v-if="showPanel && viewMode !== 'compact'"
      :storyboard="data.storyboard"
      :episode-id="data.episodeId"
      :node-id="id"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { assetImageUrl } from '@/utils/mediaUrl'
import CanvasStoryboardPanel from './CanvasStoryboardPanel.vue'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

// S5-T01: 从 data._viewMode / data._renderDensity 读取注入的视图模式
const viewMode = computed(() => props.data?._viewMode || 'normal')
const renderDensity = computed(() => props.data?._renderDensity || {
  showThumbnail: true, showMetadata: true, showActions: true, showDialogue: false, showHint: true,
})

const thumbUrl = computed(() => {
  const sb = props.data?.storyboard
  if (!sb) return ''
  if (sb.image?.url) return assetImageUrl(sb.image) || ''
  if (sb.image_url) return assetImageUrl({ url: sb.image_url }) || ''
  return ''
})

const statusLabel = computed(() => {
  const s = props.data.storyboard?.status || 'pending'
  const map = { pending: '待处理', processing: '生成中', completed: '已完成', failed: '失败' }
  return map[s] || s
})
const statusMiniLabel = computed(() => {
  const s = props.data.storyboard?.status || 'pending'
  const map = { pending: '待', processing: '中', completed: '完', failed: '败' }
  return map[s] || s
})
const statusAccent = computed(() => {
  const s = props.data.storyboard?.status || 'pending'
  const map = { pending: '#64748b', processing: '#60a5fa', completed: '#34d399', failed: '#f87171' }
  return map[s] || '#64748b'
})
const isProcessing = computed(() => props.data.storyboard?.status === 'processing')
const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

function truncate(str, n) {
  if (!str) return ''
  if (str.length <= n) return str
  return str.slice(0, n) + '…'
}
</script>

<style scoped>
.canvas-node-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.canvas-node-stack:has(.canvas-sb-node.focused) {
  z-index: 2000 !important;
}

/* ========== Compact（鸟瞰） ========== */
.sb-compact {
  width: 88px;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 6px 0 0;
  border-left: 4px solid #64748b;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.92);
  font-size: 11px;
  color: #cbd5e1;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.sb-compact.selected {
  background: rgba(79, 70, 229, 0.35);
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.6);
}
.sb-compact.highlighted {
  background: rgba(129, 140, 248, 0.35);
}
.sb-compact.dimmed { opacity: 0.35; }
.sb-c-num {
  font-weight: 700;
  color: #a5b4fc;
  font-size: 10px;
  padding: 0 4px;
  background: rgba(129, 140, 248, 0.15);
  border-radius: 3px;
  margin: 0 4px;
}
.sb-c-seg {
  font-size: 10px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ========== 通用 Node 样式 ========== */
.canvas-sb-node {
  position: relative;
  border-radius: 12px;
  border: 1px solid rgba(129, 140, 248, 0.35);
  background: var(--bg-card, #18181b);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, width 0.2s ease;
}
.canvas-sb-node:hover,
.canvas-sb-node.selected,
.canvas-sb-node.focused {
  border-color: #818cf8;
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35);
}

/* Normal 宽度 */
.vm-normal {
  width: 200px;
  padding: 10px 12px;
}
/* Detailed 宽度略大 */
.vm-detailed {
  width: 240px;
  padding: 12px 14px;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.num {
  font-size: 12px;
  font-weight: 700;
  color: #a5b4fc;
}
.wf-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seg {
  font-size: 10px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mode-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(167, 139, 250, 0.2);
  color: #c4b5fd;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright, #fafafa);
  margin-bottom: 6px;
  line-height: 1.35;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.chips span {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: #a1a1aa;
}
.chips .st {
  font-weight: 600;
}
.st-completed { color: #34d399 !important; background: rgba(52, 211, 153, 0.12) !important; }
.st-processing { color: #60a5fa !important; }
.st-failed { color: #f87171 !important; }
.processing {
  animation: sb-pulse 1.4s ease-in-out infinite;
  border-color: #60a5fa;
}
.highlighted {
  box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.75), 0 8px 28px rgba(99, 102, 241, 0.25);
}
.dimmed {
  opacity: 0.28;
}
@charset "UTF-8";

@keyframes sb-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.35); }
  50% { box-shadow: 0 0 0 6px rgba(96, 165, 250, 0.08); }
}
.hint {
  font-size: 10px;
  color: #52525b;
}
.dialogue {
  font-size: 11px;
  color: #94a3b8;
  background: rgba(0,0,0,0.2);
  padding: 6px 8px;
  border-radius: 6px;
  line-height: 1.45;
  margin-bottom: 6px;
}

/* 缩略图 */
.sb-thumb {
  width: 100%;
  background: #09090b;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vm-normal .sb-thumb {
  height: 84px;
}
.vm-detailed .sb-thumb {
  height: 120px;
}
.sb-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sb-thumb-placeholder {
  color: #64748b;
  font-size: 22px;
  opacity: 0.6;
}
</style>
