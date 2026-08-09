<template>
  <!-- S5-T01: 媒体节点三视图模式 compact / normal / detailed -->
  <div class="canvas-node-stack" :class="'vm-' + viewMode">
    <!-- Compact: zoom<=0.2 只显类型色条+图标 -->
    <div
      v-if="viewMode === 'compact'"
      class="media-compact"
      :class="['kind-' + data.kind, { highlighted: data.highlighted, dimmed: data.dimmed }]"
    >
      <span class="m-c-ico">{{ kindMiniIcon }}</span>
      <span class="m-c-tag">{{ truncate(kindLabel, 6) }}</span>
    </div>

    <!-- Normal / Detailed -->
    <div
      v-else
      class="canvas-media-node"
      :class="[
        'kind-' + data.kind,
        {
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          focused: showPanel,
          processing: isNodeBusy,
          'vm-normal': viewMode === 'normal',
          'vm-detailed': viewMode === 'detailed',
        },
      ]"
    >
      <Handle type="target" :position="Position.Left" />
      <Handle v-if="data.kind !== 'video' && data.kind !== 'audio'" type="source" :position="Position.Right" />
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="tag">{{ kindLabel }}</div>

      <!-- Normal: 紧凑展示，限制内容高度 -->
      <template v-if="viewMode === 'normal'">
        <template v-if="data.kind === 'text' || data.kind === 'universal'">
          <p class="text-body">{{ data.summary || '暂无脚本' }}</p>
        </template>
        <template v-else-if="data.kind === 'image'">
          <img v-if="data.url" :src="data.url" alt="" class="media-img" />
          <div v-else class="empty">无分镜图</div>
        </template>
        <template v-else-if="data.kind === 'video'">
          <video v-if="data.url" :src="data.url" class="media-vid" muted playsinline />
          <div v-else class="empty">无视频</div>
        </template>
        <template v-else-if="data.kind === 'audio'">
          <div class="audio-wrap">
            <span>🎵</span>
            <span>{{ data.audioType === 'narration' ? '旁白' : '对白' }}</span>
          </div>
        </template>
      </template>

      <!-- Detailed: 完整展示 + 更多细节 -->
      <template v-else>
        <template v-if="data.kind === 'text'">
          <p class="text-body text-body-detailed">{{ data.summary || '暂无脚本' }}</p>
        </template>
        <template v-else-if="data.kind === 'universal'">
          <p class="text-body universal-body text-body-detailed">{{ data.summary || '暂无全能分镜词' }}</p>
        </template>
        <template v-else-if="data.kind === 'image'">
          <img v-if="data.url" :src="data.url" alt="" class="media-img media-img-lg" />
          <div v-else class="empty">无分镜图</div>
        </template>
        <template v-else-if="data.kind === 'video'">
          <video v-if="data.url" :src="data.url" class="media-vid media-vid-lg" muted playsinline />
          <div v-else class="empty">无视频</div>
        </template>
        <template v-else-if="data.kind === 'audio'">
          <div class="audio-wrap audio-wrap-detailed">
            <span class="audio-icon">🎵</span>
            <div class="audio-info">
              <span>{{ data.audioType === 'narration' ? '旁白' : '对白' }}</span>
              <span v-if="data.storyboard?.duration" class="audio-dur">{{ data.storyboard.duration }}s</span>
            </div>
          </div>
        </template>
        <!-- Detailed 额外信息 -->
        <div v-if="renderDensity?.showMetadata" class="meta-detailed">
          <span v-if="data.storyboard?.shot_type">{{ data.storyboard.shot_type }}</span>
          <span v-if="data.storyboard?.duration">{{ data.storyboard.duration }}s</span>
        </div>
      </template>
    </div>

    <CanvasMediaPanel
      v-if="showPanel && viewMode !== 'compact'"
      :node-id="id"
      :kind="data.kind"
      :storyboard="data.storyboard"
      :summary="data.summary"
      :url="data.url"
      :audio-type="data.audioType"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasMediaPanel from './CanvasMediaPanel.vue'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

// S5-T01: 读取注入的视图模式和渲染密度
const viewMode = computed(() => props.data?._viewMode || 'normal')
const renderDensity = computed(() => props.data?._renderDensity || {
  showThumbnail: true, showMetadata: true, showActions: true, showDialogue: false, showHint: true,
})

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const kindLabel = computed(() => {
  if (props.data.frameLabel) return props.data.frameLabel
  const map = { text: '脚本摘要', universal: '全能分镜词', image: '分镜图', video: '视频', audio: '音频' }
  return map[props.data.kind] || props.data.kind
})

const kindMiniIcon = computed(() => {
  const map = { text: '文', universal: '全', image: '图', video: '影', audio: '音' }
  return map[props.data.kind] || '媒'
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
.canvas-node-stack:has(.canvas-media-node.focused) {
  z-index: 2000 !important;
}

/* ========== Compact ========== */
.media-compact {
  width: 72px;
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  border-left: 4px solid #818cf8;
  border-radius: 4px;
  background: rgba(24, 24, 27, 0.92);
  font-size: 11px;
  color: #cbd5e1;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.media-compact.kind-image { border-left-color: #818cf8; }
.media-compact.kind-video { border-left-color: #f472b6; }
.media-compact.kind-audio { border-left-color: #fbbf24; }
.media-compact.kind-text { border-left-color: #a1a1aa; }
.media-compact.kind-universal { border-left-color: #c4b5fd; }
.media-compact.highlighted { box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.55); }
.media-compact.dimmed { opacity: 0.28; }
.m-c-ico {
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255,255,255,0.06);
  color: #e5e7eb;
}
.m-c-tag { font-size: 10px; color: #d1d5db; overflow: hidden; text-overflow: ellipsis; }

/* ========== Normal / Detailed ========== */
.canvas-media-node {
  position: relative;
  min-height: 100px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--border-muted, #3f3f46);
  background: rgba(24, 24, 27, 0.95);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, width 0.2s ease;
}
.vm-normal { width: 168px; }
.vm-detailed { width: 200px; padding: 10px; }
.canvas-media-node.focused {
  border-color: #818cf8;
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.35);
}
.tag {
  font-size: 10px;
  font-weight: 600;
  color: #818cf8;
  margin-bottom: 6px;
}
.text-body {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: #d4d4d8;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.text-body-detailed {
  -webkit-line-clamp: 8;
  font-size: 12px;
}
.media-img {
  width: 100%;
  height: 92px;
  object-fit: cover;
  border-radius: 6px;
  background: #09090b;
}
.media-img-lg {
  height: 120px;
}
.media-vid {
  width: 100%;
  height: 92px;
  object-fit: cover;
  border-radius: 6px;
  background: #000;
}
.media-vid-lg {
  height: 120px;
}
.audio-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 8px;
  font-size: 12px;
  color: #fbbf24;
}
.audio-wrap-detailed {
  padding: 16px 8px;
}
.audio-icon { font-size: 20px; }
.audio-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.audio-dur {
  font-size: 10px;
  color: #a1a1aa;
}
.empty {
  font-size: 11px;
  color: #71717a;
  padding: 20px 0;
  text-align: center;
}
.universal-body {
  -webkit-line-clamp: 8;
}
.meta-detailed {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.meta-detailed span {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.05);
  color: #94a3b8;
}
.kind-universal { border-color: rgba(167, 139, 250, 0.5); }
.kind-universal .tag { color: #c4b5fd; }
.kind-image { border-color: rgba(129, 140, 248, 0.4); }
.kind-video { border-color: rgba(244, 114, 182, 0.4); }
.kind-audio { border-color: rgba(251, 191, 36, 0.4); }
.canvas-media-node.processing { border-color: #60a5fa; }
.highlighted { box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.55); }
.dimmed { opacity: 0.28; }
</style>
