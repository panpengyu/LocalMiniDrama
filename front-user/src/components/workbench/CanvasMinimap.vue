<template>
  <!-- S5-T04: 画布小地图导航器组件
       验收：右下角缩略图显示全局节点分布+当前视口框，点击/拖拽跳转视口
       实现：Canvas2D 绘制，RAF 节流；节点按类型用不同颜色；支持折叠 -->
  <div
    class="s5-minimap"
    :class="{ collapsed, 'is-dark': isDark }"
    @mousedown.stop
  >
    <!-- 工具栏 -->
    <div class="mm-toolbar">
      <span class="mm-title">
        <el-icon><Compass /></el-icon>
        {{ collapsed ? '' : '导航' }}
      </span>
      <span class="mm-stats" v-if="!collapsed">
        {{ visibleCount }} / {{ totalCount }}
      </span>
      <el-button class="mm-toggle" size="small" link @click.stop="toggle">
        <el-icon>
          <component :is="collapsed ? 'ArrowLeft' : 'ArrowRight'" />
        </el-icon>
      </el-button>
    </div>

    <div v-show="!collapsed" class="mm-canvas-wrap" ref="wrapRef">
      <canvas
        ref="canvasRef"
        class="mm-canvas"
        :width="canvasW" :height="canvasH"
        @click.stop="onClick"
        @mousedown.stop="onDragStart"
      />
      <!-- 分区背景 -->
      <div v-for="z in zones" :key="z.key"
           class="mm-zone-bg"
           :style="zoneStyle(z)"
           :title="z.label"
      />
      <!-- 当前视口框 -->
      <div
        class="mm-viewport-box"
        :style="viewportBoxStyle"
        @mousedown.stop="onDragStart"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * 数据流：
 *   props.nodes + props.viewport → props 变化触发 redraw() → 写 canvas
 *   用户点击/拖拽 canvas → emit center(x, y) → 父组件 useVueFlow.setViewport
 *
 * 坐标系：
 *   world: 节点原始 position (x,y)
 *   local:  canvas 内像素坐标 (0..canvasW) x (0..canvasH)
 *   world2local = 先减去 worldMin, 再乘 scale
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compass, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const log = useWorkbenchLogger('CanvasMinimap')

const nodeTypeColors = {
  canvasStoryboard: '#3b82f6',   // 蓝
  canvasEpisode:    '#8b5cf6',   // 紫
  canvasScript:     '#f59e0b',   // 橙
  canvasAsset:      '#10b981',   // 绿（角色/场景/道具统一）
  canvasMedia:      '#ec4899',   // 粉
  canvasDramaHeader:'#1e293b',
  canvasAddButton:  '#94a3b8',
  canvasLabel:      '#475569',
}
const nodeDefaultColor = '#cbd5e1'

const props = defineProps({
  nodes:        { type: Array,  default: () => [] },
  viewport:     { type: Object, default: () => ({ x: 0, y: 0, zoom: 1 }) },
  canvasRect:   { type: Object, default: () => ({ w: 1000, h: 800 }) },  // 主画布尺寸（px）
  zones:        { type: Array,  default: () => [] },  // S5-T05 分区
  isDark:       { type: Boolean, default: true },
  defaultCollapsed: { type: Boolean, default: false },
})
const emit = defineEmits(['center'])  // (x, y, zoom?)

const collapsed = ref(props.defaultCollapsed)
const wrapRef = ref(null)
const canvasRef = ref(null)
const canvasW = 220
const canvasH = 176

let rafRedraw = null
let rafLayout = null
let dragging = false
let dragMoved = false

// ---- 世界坐标范围 ----
const worldBound = computed(() => {
  const nodes = props.nodes || []
  if (!nodes.length) {
    return { minX: -500, minY: -500, maxX: 500, maxY: 500 }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    const px = n.position?.x ?? 0
    const py = n.position?.y ?? 0
    const w = n.measured?.width ?? n.data?.width ?? 220
    const h = n.measured?.height ?? n.data?.height ?? 160
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px + w > maxX) maxX = px + w
    if (py + h > maxY) maxY = py + h
  }
  const margin = Math.max(400, Math.max(maxX - minX, maxY - minY) * 0.12)
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  }
})
const totalCount = computed(() => props.nodes?.length ?? 0)
const visibleCount = computed(() => {
  const b = worldBound.value
  const vp = props.viewport || {}
  const w = props.canvasRect.w || 0
  const h = props.canvasRect.h || 0
  if (!w || !h || !vp.zoom) return 0
  const vMinX = -vp.x / vp.zoom
  const vMinY = -vp.y / vp.zoom
  const vMaxX = vMinX + w / vp.zoom
  const vMaxY = vMinY + h / vp.zoom
  let c = 0
  for (const n of (props.nodes || [])) {
    const nx = n.position?.x ?? 0, ny = n.position?.y ?? 0
    if (nx >= vMinX && nx <= vMaxX && ny >= vMinY && ny <= vMaxY) c++
  }
  return c
})

const scale = computed(() => {
  const b = worldBound.value
  const sx = canvasW / (b.maxX - b.minX)
  const sy = canvasH / (b.maxY - b.minY)
  return Math.min(sx, sy)
})
function worldToLocal(wx, wy) {
  const b = worldBound.value
  const s = scale.value
  return {
    x: (wx - b.minX) * s,
    y: (wy - b.minY) * s,
  }
}
function localToWorld(lx, ly) {
  const b = worldBound.value
  const s = scale.value
  return {
    x: b.minX + lx / s,
    y: b.minY + ly / s,
  }
}

// 当前视口框在小地图中的样式
const viewportBoxStyle = computed(() => {
  const vp = props.viewport || {}
  const w = props.canvasRect.w || 0
  const h = props.canvasRect.h || 0
  if (!w || !h || !vp.zoom) return { display: 'none' }
  // 主画布视口在世界坐标中的范围
  const vMinX = -vp.x / vp.zoom
  const vMinY = -vp.y / vp.zoom
  const vMaxX = vMinX + w / vp.zoom
  const vMaxY = vMinY + h / vp.zoom
  const p1 = worldToLocal(vMinX, vMinY)
  const p2 = worldToLocal(vMaxX, vMaxY)
  return {
    left: p1.x + 'px',
    top: p1.y + 'px',
    width: Math.max(4, p2.x - p1.x) + 'px',
    height: Math.max(4, p2.y - p1.y) + 'px',
  }
})

// ---- 分区背景（S5-T05 联动） ----
function zoneStyle(z) {
  if (!z || !z.worldBounds) return { display: 'none' }
  const p1 = worldToLocal(z.worldBounds.x, z.worldBounds.y)
  const p2 = worldToLocal(
    z.worldBounds.x + (z.worldBounds.w || 0),
    z.worldBounds.y + (z.worldBounds.h || 0),
  )
  return {
    left: p1.x + 'px',
    top: p1.y + 'px',
    width: Math.max(0, p2.x - p1.x) + 'px',
    height: Math.max(0, p2.y - p1.y) + 'px',
    background: z.color,
    borderRadius: 2 + 'px',
    opacity: 0.08,
  }
}

// ---- 绘制 ----
let _redrawCount = 0
function redraw() {
  const t0 = performance.now()
  const cvs = canvasRef.value
  if (!cvs) return
  const ctx = cvs.getContext('2d')
  if (!ctx) return
  const nodes = props.nodes || []
  const dark = props.isDark
  _redrawCount++

  // 清屏
  ctx.clearRect(0, 0, canvasW, canvasH)

  // 背景
  ctx.fillStyle = dark ? '#0b1326' : '#f8fafc'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // 网格（淡）
  const gridT0 = performance.now()
  ctx.strokeStyle = dark ? '#1e293b' : '#e2e8f0'
  ctx.lineWidth = 1
  const gridStep = Math.max(10, Math.round(40 / scale.value))
  const b = worldBound.value
  for (let x = Math.ceil(b.minX / gridStep) * gridStep; x < b.maxX; x += gridStep) {
    const p = worldToLocal(x, 0); ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, canvasH); ctx.stroke()
  }
  for (let y = Math.ceil(b.minY / gridStep) * gridStep; y < b.maxY; y += gridStep) {
    const p = worldToLocal(0, y); ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(canvasW, p.y); ctx.stroke()
  }
  const gridMs = Math.round((performance.now() - gridT0) * 1000) / 1000

  // 节点
  const nodeT0 = performance.now()
  ctx.save()
  for (const n of nodes) {
    const pos = worldToLocal(n.position?.x ?? 0, n.position?.y ?? 0)
    const color = nodeTypeColors[n.type] ?? nodeDefaultColor
    ctx.fillStyle = color
    const nodeW = Math.max(2, Math.round(220 * scale.value))
    const nodeH = Math.max(2, Math.round(160 * scale.value))
    // 半透明填充
    ctx.globalAlpha = 0.82
    ctx.fillRect(pos.x, pos.y, nodeW, nodeH)
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, nodeW, nodeH)
    // 选中：白边
    if (n.selected) {
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 2
      ctx.strokeRect(pos.x - 1, pos.y - 1, nodeW + 2, nodeH + 2)
    }
  }
  ctx.restore()
  const nodeMs = Math.round((performance.now() - nodeT0) * 1000) / 1000
  const totalMs = Math.round((performance.now() - t0) * 1000) / 1000

  // 每 5 次重绘输出一次采样，避免日志刷屏
  if (_redrawCount % 5 === 0 || totalMs > 16) {
    log.debug('[Redraw] 小地图 Canvas2D 重绘', {
      count: _redrawCount,
      nodes: nodes.length,
      gridMs, nodeMs, totalMs,
      scale: Number(scale.value.toFixed(5)),
      viewportZoom: Number(props.viewport?.zoom?.toFixed(3)),
    })
  }
  // 单次重绘超过 16ms（一帧）时输出 WARN
  if (totalMs > 16) {
    log.warn('[Redraw] 小地图重绘超过单帧 16ms', { totalMs, nodes: nodes.length, gridMs, nodeMs })
  }
}

function scheduleRedraw() {
  if (rafRedraw) cancelAnimationFrame(rafRedraw)
  rafRedraw = requestAnimationFrame(redraw)
}

// ---- 交互 ----
function toggle() {
  collapsed.value = !collapsed.value
  log.debug('[Toggle] 小地图折叠状态切换', { collapsed: collapsed.value })
}

function onClick(e) {
  if (dragMoved) return  // 拖动结束不触发
  const t0 = performance.now()
  const rect = e.currentTarget.getBoundingClientRect()
  const lx = e.clientX - rect.left
  const ly = e.clientY - rect.top
  if (lx < 0 || lx > canvasW || ly < 0 || ly > canvasH) return
  const { x, y } = localToWorld(lx, ly)
  // 居中到当前视口
  const vp = props.viewport || {}
  const w = props.canvasRect.w || 0
  const h = props.canvasRect.h || 0
  const zoom = vp.zoom || 1
  // VueFlow 变换：screenX = worldX * zoom + vp.x
  // 要让 worldX 出现在屏幕中心 (w/2)，则：w/2 = x * zoom + vp.x
  // → vp.x = w/2 - x * zoom（屏幕空间平移量）
  const targetX = (w / 2) - x * zoom
  const targetY = (h / 2) - y * zoom

  // === 排查日志：小地图点击 → 视口坐标映射全过程 ===
  console.log('[Minimap onClick] 坐标映射链路:', {
    '1.minimap像素': { lx: Math.round(lx), ly: Math.round(ly) },
    '2.世界坐标': { worldX: Math.round(x), worldY: Math.round(y) },
    '3.当前vp': { vpX: Math.round(vp.x), vpY: Math.round(vp.y), zoom: Number(zoom.toFixed(4)) },
    '4.画布尺寸': { w, h },
    '5.目标vp(屏幕空间)': { targetX: Math.round(targetX), targetY: Math.round(targetY) },
    '6.验证': `screenX=${Math.round(x * zoom + targetX)} 应等于 w/2=${Math.round(w / 2)}`,
  })

  log.info('[Click] 小地图点击跳转', {
    localX: Math.round(lx), localY: Math.round(ly),
    worldX: Math.round(x), worldY: Math.round(y),
    targetVpX: Math.round(targetX), targetVpY: Math.round(targetY),
    zoom: Number(zoom.toFixed(3)),
    ms: Math.round((performance.now() - t0) * 1000) / 1000,
  })
  emit('center', { x: targetX, y: targetY })
}

function onDragStart(e) {
  const t0 = performance.now()
  dragging = true
  dragMoved = false
  let moveCount = 0
  const rect = wrapRef.value.getBoundingClientRect()
  let lastX = e.clientX - rect.left
  let lastY = e.clientY - rect.top
  log.debug('[Drag] 小地图拖拽开始', { startX: Math.round(lastX), startY: Math.round(lastY) })
  function onMove(ev) {
    const nx = ev.clientX - rect.left
    const ny = ev.clientY - rect.top
    if (Math.abs(nx - lastX) + Math.abs(ny - lastY) < 2) return
    dragMoved = true
    moveCount++
    const deltaLocalX = nx - lastX
    const deltaLocalY = ny - lastY
    lastX = nx; lastY = ny
    const s = scale.value
    const deltaWorldX = deltaLocalX / s
    const deltaWorldY = deltaLocalY / s
    const vp = props.viewport || {}
    const zoom = vp.zoom || 1
    emit('center', {
      x: vp.x - deltaWorldX * zoom,
      y: vp.y - deltaWorldY * zoom,
    })
  }
  function onUp() {
    dragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    log.debug('[Drag] 小地图拖拽结束', {
      moveCount, totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
    })
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ---- 监听数据源重绘 ----
let _watchCount = 0
watch([
  () => props.nodes,
  () => props.nodes.map(n => n.position?.x + ',' + n.position?.y).join('|'),
  () => props.nodes.map(n => String(n.type || '')).join('|'),
  () => props.nodes.map(n => String(n.selected)).join('|'),
], () => {
  _watchCount++
  if (_watchCount <= 3 || _watchCount % 20 === 0) {
    log.debug('[Watch] 数据源变化 → 触发重绘', {
      triggerCount: _watchCount,
      nodeCount: props.nodes?.length || 0,
      viewportZoom: Number(props.viewport?.zoom?.toFixed(3)),
    })
  }
  scheduleRedraw()
}, { deep: true })

onMounted(() => {
  log.info('[Lifecycle] CanvasMinimap 已挂载', {
    canvasW, canvasH,
    nodeCount: props.nodes?.length || 0,
  })
  nextTick(scheduleRedraw)
  window.addEventListener('resize', scheduleRedraw)
})
onBeforeUnmount(() => {
  log.info('[Lifecycle] CanvasMinimap 即将卸载', { totalRedraws: _redrawCount, totalWatchTriggers: _watchCount })
  if (rafRedraw) cancelAnimationFrame(rafRedraw)
  if (rafLayout) cancelAnimationFrame(rafLayout)
  window.removeEventListener('resize', scheduleRedraw)
})
</script>

<style scoped>
.s5-minimap {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 20;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: #e2e8f0;
  font-size: 12px;
  user-select: none;
}
.s5-minimap.collapsed {
  width: 72px;
}
.mm-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}
.mm-title {
  font-weight: 600;
  font-size: 12px;
  display: flex; align-items: center; gap: 4px;
}
.mm-stats {
  margin-left: auto;
  color: #94a3b8;
  font-size: 11px;
  opacity: 0.8;
}
.mm-toggle {
  color: #cbd5e1 !important;
}
.mm-canvas-wrap {
  position: relative;
  width: 220px;
  height: 176px;
  padding: 6px;
  box-sizing: content-box;
}
.mm-canvas {
  display: block;
  width: 220px;
  height: 176px;
  border-radius: 4px;
  cursor: grab;
}
.mm-canvas:active { cursor: grabbing; }
.mm-zone-bg {
  position: absolute;
  pointer-events: none;
}
.mm-viewport-box {
  position: absolute;
  top: 0; left: 0;
  border: 2px solid #22d3ee;
  border-radius: 2px;
  background: rgba(34, 211, 238, 0.08);
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.35);
  cursor: move;
  transition: border-color 120ms ease;
}
.mm-viewport-box:hover {
  border-color: #06b6d4;
  background: rgba(34, 211, 238, 0.18);
}
.is-dark .s5-minimap:not(.collapsed) {
  background: rgba(15, 23, 42, 0.9);
}
</style>
