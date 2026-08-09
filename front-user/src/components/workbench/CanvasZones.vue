<template>
  <!-- S5-T05: 画布分区背景层（角色/分镜/场景/道具/参考素材）
       放 VueFlow 外层 overlay，绝对定位；折叠时区域收缩为条 -->
  <div class="s5-zones" v-if="visible">
    <div
      v-for="z in zones"
      :key="z.key"
      class="zone"
      :class="[ 'zone-' + z.key, { collapsed: z.collapsed } ]"
      :style="zoneStyle(z)"
    >
      <div
        class="zone-header"
        :style="{ background: z.color + '22', borderColor: z.color }"
        @mousedown.stop
      >
        <span class="zone-dot" :style="{ background: z.color }"></span>
        <span class="zone-name">{{ z.label }}</span>
        <span class="zone-count" v-if="countOf(z.key)">
          {{ countOf(z.key) }}
        </span>
        <el-button
          size="small"
          class="zone-toggle"
          link
          type="primary"
          @click.stop="$emit('toggle', z.key)"
        >
          <el-icon>
            <component :is="z.collapsed ? 'CaretRight' : 'CaretBottom'" />
          </el-icon>
          {{ z.collapsed ? '展开' : '折叠' }}
        </el-button>
      </div>
      <div class="zone-body" :style="zoneBodyStyle(z)"></div>
    </div>
  </div>
</template>

<script setup>
/**
 * 背景层通过"世界坐标→屏幕坐标"变换定位。
 * 缩放、平移时，父组件传入 viewport(x/y/zoom)
 * 以及画布尺寸 canvasRect(w/h)，基于这些实时计算 style。
 */
import { computed } from 'vue'

const props = defineProps({
  zones: { type: Array, default: () => [] },
  viewport: { type: Object, default: () => ({ x: 0, y: 0, zoom: 1 }) },
  canvasRect: { type: Object, default: () => ({ w: 0, h: 0 }) },
  nodeZoneCounts: { type: Object, default: () => ({}) },
  visible: { type: Boolean, default: true },
})
defineEmits(['toggle'])

function countOf(k) { return props.nodeZoneCounts[k] || 0 }

function worldToScreen(wx, wy) {
  const vp = props.viewport || {}
  return {
    x: (wx - vp.x) * vp.zoom,
    y: (wy - vp.y) * vp.zoom,
  }
}

function zoneStyle(z) {
  const b = z.worldBounds
  if (!b) return { display: 'none' }
  const p1 = worldToScreen(b.x, b.y)
  return {
    transform: `translate(${p1.x}px, ${p1.y}px)`,
  }
}

function zoneBodyStyle(z) {
  const b = z.worldBounds
  if (!b) return {}
  const zoom = (props.viewport?.zoom) || 1
  const w = b.w * zoom
  const h = z.collapsed ? Math.max(6, 40 * zoom) : b.h * zoom
  return {
    width: Math.max(1, w) + 'px',
    height: Math.max(1, h) + 'px',
    borderColor: z.color,
    background: z.color,
  }
}
</script>

<style scoped>
.s5-zones {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.zone {
  position: absolute;
  top: 0; left: 0;
  will-change: transform;
}
.zone-header {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px 6px 0 0;
  border: 1px solid;
  font-size: 12px;
  backdrop-filter: blur(4px);
  white-space: nowrap;
  user-select: none;
}
.zone-dot {
  width: 8px; height: 8px; border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
}
.zone-name { font-weight: 600; color: #e5e7eb; }
.zone-count {
  color: #9ca3af;
  font-size: 11px;
  background: rgba(0,0,0,0.25);
  padding: 0 6px;
  border-radius: 10px;
}
.zone-toggle { color: #93c5fd !important; margin-left: auto; font-size: 11px; }
.zone-body {
  border: 1px dashed;
  border-top: 0;
  border-radius: 0 0 4px 4px;
  opacity: 0.05;
  pointer-events: none;
  transition: height 220ms ease, opacity 220ms ease;
}
.zone.collapsed .zone-body {
  opacity: 0.0;
}
.zone.collapsed .zone-header {
  border-radius: 6px;
  border-bottom-width: 1px;
}
</style>
