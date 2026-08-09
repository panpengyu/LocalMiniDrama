<template>
  <!-- S5-T01: 剧本节点三视图模式 compact / normal / detailed -->
  <div class="canvas-node-stack" :class="'vm-' + viewMode">
    <!-- Compact: zoom<=0.2 只显图标+集数 -->
    <div
      v-if="viewMode === 'compact'"
      class="script-compact"
      :class="{ empty: !hasScript }"
    >
      <span class="s-c-ico">📜</span>
      <span class="s-c-ep">E{{ data.episode?.episode_number ?? '?' }}</span>
    </div>

    <!-- Normal / Detailed -->
    <div
      v-else
      class="canvas-script-node"
      :class="{
        focused: showPanel,
        empty: !hasScript,
        processing: isNodeBusy,
        'vm-normal': viewMode === 'normal',
        'vm-detailed': viewMode === 'detailed',
      }"
    >
      <Handle type="source" :position="Position.Right" />
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="head">
        <span class="badge">📜 剧本</span>
        <span class="ep">第 {{ data.episode?.episode_number ?? '?' }} 集</span>
      </div>
      <div class="preview">{{ previewText }}</div>
      <!-- Normal: 只显示角色数；Detailed: 显示全部统计 + hint -->
      <div v-if="renderDensity?.showMetadata !== false" class="meta">
        <span>{{ charCount }} 角色</span>
        <span v-if="viewMode === 'detailed'">{{ sceneCount }} 场景</span>
        <span v-if="viewMode === 'detailed'">{{ propCount }} 道具</span>
      </div>
      <div v-if="renderDensity?.showHint" class="hint">{{ showPanel ? '下方可编辑与提取' : '单击展开 · 创作起点' }}</div>
    </div>

    <CanvasScriptPanel
      v-if="showPanel && viewMode !== 'compact'"
      :episode="data.episode"
      :node-id="id"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasScriptPanel from './CanvasScriptPanel.vue'
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

const hasScript = computed(() => !!(props.data.episode?.script_content || '').trim())
const previewText = computed(() => {
  if (props.data.summary) return props.data.summary
  return hasScript.value ? '（剧本已填写）' : '暂无剧本，点击编辑'
})

const charCount = computed(() => (ctx?.drama?.value?.characters || []).length)
const sceneCount = computed(() => (ctx?.drama?.value?.scenes || []).length)
const propCount = computed(() => (ctx?.drama?.value?.props || []).length)

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})
</script>

<style scoped>
.canvas-node-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.canvas-node-stack:has(.canvas-script-node.focused) {
  z-index: 2000 !important;
}

/* ========== Compact ========== */
.script-compact {
  width: 78px;
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
  background: rgba(120, 53, 15, 0.65);
  font-size: 11px;
  color: #fcd34d;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.script-compact.empty { opacity: 0.5; border-left-style: dashed; }
.s-c-ico { font-size: 10px; }
.s-c-ep { font-size: 10px; font-weight: 700; color: #fcd34d; }

/* ========== Normal / Detailed ========== */
.canvas-script-node {
  position: relative;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(120, 53, 15, 0.35);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, width 0.2s ease;
}
.vm-normal { width: 200px; }
.vm-detailed { width: 240px; }
.canvas-script-node.focused {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
}
.canvas-script-node.empty {
  border-style: dashed;
  opacity: 0.92;
}
.canvas-script-node.processing {
  border-color: #60a5fa;
  animation: script-pulse 1.4s ease-in-out infinite;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.badge {
  font-size: 12px;
  font-weight: 700;
  color: #fcd34d;
}
.ep {
  font-size: 11px;
  color: #d4d4d8;
}
.preview {
  font-size: 11px;
  line-height: 1.45;
  color: #e4e4e7;
  max-height: 56px;
  overflow: hidden;
  margin-bottom: 8px;
}
.meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.meta span {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
}
.hint {
  font-size: 10px;
  color: #71717a;
}
@keyframes script-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.25); }
  50% { box-shadow: 0 0 0 5px rgba(96, 165, 250, 0.06); }
}
</style>
