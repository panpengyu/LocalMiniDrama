<template>
  <!-- S5-T01: 剧集节点三视图模式 compact / normal / detailed -->
  <div :class="['canvas-episode-node', 'vm-' + viewMode]">
    <Handle type="target" :position="Position.Left" />
    <!-- Compact -->
    <template v-if="viewMode === 'compact'">
      <span class="ep-badge-c">E{{ data.episode?.episode_number ?? '?' }}</span>
    </template>
    <!-- Normal -->
    <template v-else-if="viewMode === 'normal'">
      <span class="badge">第 {{ data.episode?.episode_number ?? '?' }} 集</span>
      <span class="title-sm">{{ truncate(data.episode?.title || '未命名集', 12) }}</span>
      <span class="count-sm">{{ (data.episode?.storyboards || []).length }}镜</span>
    </template>
    <!-- Detailed -->
    <template v-else>
      <span class="badge">第 {{ data.episode?.episode_number ?? '?' }} 集</span>
      <span class="title">{{ truncate(data.episode?.title || '未命名集', 28) }}</span>
      <span class="count">{{ (data.episode?.storyboards || []).length }} 镜</span>
      <span v-if="data.episode?.duration" class="dur">⏱ {{ data.episode.duration }}分钟</span>
    </template>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
})

const viewMode = computed(() => props.data?._viewMode || 'normal')

function truncate(str, n) {
  if (!str) return ''
  if (str.length <= n) return str
  return str.slice(0, n) + '…'
}
</script>

<style scoped>
.canvas-episode-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(167, 139, 250, 0.5);
  background: rgba(76, 29, 149, 0.35);
  color: #e9d5ff;
  font-size: 13px;
  white-space: nowrap;
  transition: width 0.2s ease, padding 0.2s ease, border-radius 0.2s ease;
}

/* Compact: 最小形态 */
.vm-compact {
  padding: 2px 6px;
  border-radius: 999px;
  min-width: 0;
}
.ep-badge-c {
  font-size: 10px;
  font-weight: 800;
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.22);
  padding: 0 5px;
  border-radius: 8px;
}

/* Normal */
.vm-normal {
  padding: 6px 12px;
  border-radius: 999px;
}
.title-sm {
  font-size: 12px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #f3e8ff;
}
.count-sm {
  font-size: 10px;
  opacity: 0.8;
  background: rgba(0,0,0,0.18);
  padding: 0 6px;
  border-radius: 8px;
}

/* Detailed */
.vm-detailed {
  padding: 10px 18px;
  border-radius: 999px;
}
.badge { font-weight: 700; }
.title {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.count {
  font-size: 11px;
  opacity: 0.85;
}
.dur {
  font-size: 11px;
  opacity: 0.8;
  background: rgba(0,0,0,0.18);
  padding: 0 8px;
  border-radius: 10px;
}
</style>
