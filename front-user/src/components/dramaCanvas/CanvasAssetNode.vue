<template>
  <!-- S5-T01: 资产节点三视图模式 compact / normal / detailed -->
  <div class="canvas-node-stack" :class="'vm-' + viewMode">
    <Handle id="in" type="target" :position="Position.Left" />
    <Handle id="out" type="source" :position="Position.Right" />

    <!-- Compact: zoom<=0.2 色条+图标 -->
    <div
      v-if="viewMode === 'compact'"
      class="asset-compact"
      :class="[
        'kind-' + data.kind,
        { highlighted: data.highlighted, dimmed: data.dimmed },
      ]"
      :style="{ borderLeftColor: kindAccent }"
    >
      <span class="a-c-ico">{{ kindMiniIcon }}</span>
      <span class="a-c-name">{{ truncate(displayName, 8) }}</span>
    </div>

    <!-- Normal: 0.2<zoom<=0.8 -->
    <div
      v-else-if="viewMode === 'normal'"
      class="canvas-asset-node vm-normal"
      :class="[
        'kind-' + data.kind,
        {
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          processing: isNodeBusy || entityStatus === 'processing',
        },
      ]"
    >
      <div v-if="renderDensity?.showThumbnail !== false" class="cover cover-s">
        <img v-if="thumbUrl && !isNodeBusy" :src="thumbUrl" alt="" />
        <div v-else-if="!isNodeBusy" class="cover-placeholder">{{ kindIcon }}</div>
        <CanvasNodeStatusOverlay :node-id="id" />
      </div>
      <div class="info">
        <div class="name-row">
          <span class="name">{{ truncate(displayName, 14) }}</span>
          <span v-if="statusChip" class="status-chip" :class="'st-' + statusChip.key">{{ statusChip.label }}</span>
        </div>
        <div v-if="renderDensity?.showMetadata !== false" class="kind">{{ kindLabel }}</div>
      </div>
    </div>

    <!-- Detailed: zoom>0.8 -->
    <div
      v-else
      class="canvas-asset-node vm-detailed"
      :class="[
        'kind-' + data.kind,
        {
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          focused: showPanel,
          processing: isNodeBusy || entityStatus === 'processing',
        },
      ]"
    >
      <div class="cover">
        <img v-if="thumbUrl && !isNodeBusy" :src="thumbUrl" alt="" />
        <div v-else-if="!isNodeBusy" class="cover-placeholder">{{ kindIcon }}</div>
        <CanvasNodeStatusOverlay :node-id="id" />
      </div>
      <div class="info">
        <div class="name-row">
          <span class="name">{{ displayName }}</span>
          <span v-if="statusChip" class="status-chip" :class="'st-' + statusChip.key">{{ statusChip.label }}</span>
        </div>
        <div class="kind">{{ kindLabel }}</div>
        <div v-if="renderDensity?.showMetadata" class="meta">
          <span v-for="(m, i) in metaChips" :key="i" class="meta-chip">{{ m }}</span>
        </div>
      </div>
    </div>

    <CanvasAssetPanel
      v-if="showPanel && viewMode !== 'compact'"
      :kind="data.kind"
      :entity="data.entity"
      :node-id="id"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { assetImageUrl } from '@/utils/mediaUrl'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasAssetPanel from './CanvasAssetPanel.vue'
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

const kindLabel = computed(() => {
  const map = { character: '角色', scene: '场景', prop: '道具' }
  return map[props.data.kind] || '素材'
})
const kindIcon = computed(() => {
  const map = { character: '👤', scene: '🏞', prop: '🎭' }
  return map[props.data.kind] || '📦'
})
const kindMiniIcon = computed(() => {
  const map = { character: '人', scene: '景', prop: '具' }
  return map[props.data.kind] || '物'
})
const kindAccent = computed(() => {
  const map = { character: '#10b981', scene: '#3b82f6', prop: '#8b5cf6' }
  return map[props.data.kind] || '#64748b'
})

const displayName = computed(() => {
  const e = props.data.entity || {}
  return e.name || e.location || '未命名'
})

const thumbUrl = computed(() => assetImageUrl(props.data.entity))
const entityStatus = computed(() => props.data.entity?.status || '')

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const statusChip = computed(() => {
  const map = ctx?.nodeStatus?.map
  const busy = map?.[props.id]
  if (busy) return { key: 'busy', label: busy.message?.slice(0, 8) || '处理中' }
  const s = entityStatus.value
  if (s === 'processing') return { key: 'processing', label: '生成中' }
  if (s === 'failed') return { key: 'failed', label: '失败' }
  if (thumbUrl.value) return { key: 'ready', label: '有图' }
  return null
})

const metaChips = computed(() => {
  const list = []
  const e = props.data.entity || {}
  if (e.gender) list.push(e.gender)
  if (e.age) list.push(e.age + '岁')
  if (e.personality) list.push(truncate(e.personality, 8))
  if (e.location_type) list.push(e.location_type)
  if (e.time_of_day) list.push(e.time_of_day)
  if (e.category) list.push(e.category)
  if (e.material) list.push(e.material)
  return list.slice(0, 3)
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
  position: relative;
  z-index: 10;
}
.canvas-node-stack:has(.canvas-asset-node.focused) {
  z-index: 2000 !important;
}

/* Compact */
.asset-compact {
  width: 78px;
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 6px 0 0;
  border-left: 4px solid #64748b;
  border-radius: 4px;
  background: rgba(24, 24, 27, 0.95);
  font-size: 11px;
  color: #cbd5e1;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.asset-compact.highlighted { background: rgba(52, 211, 153, 0.22); }
.asset-compact.dimmed { opacity: 0.3; }
.asset-compact.kind-character { border-left-color: #10b981; }
.asset-compact.kind-scene { border-left-color: #3b82f6; }
.asset-compact.kind-prop { border-left-color: #8b5cf6; }
.a-c-ico {
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: 3px;
  margin: 0 4px 0 0;
  background: rgba(255,255,255,0.06);
  color: #e5e7eb;
}
.a-c-name { font-size: 10px; color: #d1d5db; overflow: hidden; text-overflow: ellipsis; }

/* Common */
.canvas-asset-node {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-muted, #3f3f46);
  background: var(--bg-card, #18181b);
  box-shadow: var(--shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, width 0.2s ease;
}
.canvas-asset-node.focused {
  border-color: #34d399;
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35);
}
.canvas-asset-node.processing {
  border-color: #60a5fa;
  animation: asset-pulse 1.4s ease-in-out infinite;
}

/* Normal 尺寸 */
.vm-normal { width: 148px; }
.vm-normal .cover-s { height: 84px; }

/* Detailed 尺寸 */
.vm-detailed { width: 188px; }
.cover {
  position: relative;
  height: 108px;
  background: #09090b;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  font-size: 28px;
  opacity: 0.7;
}
.info {
  padding: 8px 10px 10px;
}
.vm-detailed .info { padding: 10px 12px 12px; }
.name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright, #fafafa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-chip {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
}
.status-chip.st-busy,
.status-chip.st-processing { color: #60a5fa; background: rgba(96, 165, 250, 0.15); }
.status-chip.st-ready { color: #34d399; background: rgba(52, 211, 153, 0.12); }
.status-chip.st-failed { color: #f87171; background: rgba(248, 113, 113, 0.12); }
.kind {
  font-size: 11px;
  color: var(--text-subtle, #71717a);
  margin-top: 2px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 6px;
}
.meta-chip {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.05);
  color: #94a3b8;
}
.kind-character { border-color: rgba(52, 211, 153, 0.45); }
.kind-scene { border-color: rgba(96, 165, 250, 0.45); }
.kind-prop { border-color: rgba(251, 191, 36, 0.45); }
.highlighted {
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.65), 0 8px 24px rgba(52, 211, 153, 0.2);
}
.dimmed {
  opacity: 0.28;
  filter: grayscale(0.35);
}
@keyframes asset-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.25); }
  50% { box-shadow: 0 0 0 5px rgba(96, 165, 250, 0.06); }
}
</style>
