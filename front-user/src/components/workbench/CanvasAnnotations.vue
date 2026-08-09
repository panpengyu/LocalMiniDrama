<template>
  <!-- S6-T03 画布标注层：覆盖在 VueFlow 之上的 SVG overlay
       - 非标注模式下 pointer-events:none，事件穿透到 VueFlow
       - 标注模式下 pointer-events:auto，捕获鼠标创建/编辑标注
       - 标注使用世界坐标存储，渲染时 world→screen 变换 -->
  <div
    class="canvas-annotations-layer"
    :class="{ active: active }"
    :style="{ pointerEvents: active ? 'auto' : 'none' }"
  >
    <!-- 工具栏 -->
    <div class="annot-toolbar" v-if="active">
      <el-button-group>
        <el-button size="small" :type="mode === 'text' ? 'primary' : ''" @click="setMode('text')">文字</el-button>
        <el-button size="small" :type="mode === 'arrow' ? 'primary' : ''" @click="setMode('arrow')">箭头</el-button>
        <el-button size="small" :type="mode === 'box' ? 'primary' : ''" @click="setMode('box')">框选</el-button>
      </el-button-group>
      <el-color-picker v-model="color" size="small" style="margin-left: 8px" />
      <el-button size="small" style="margin-left: 8px" @click="onExit">退出</el-button>
    </div>

    <!-- SVG 标注层 -->
    <svg
      class="annot-svg"
      :width="canvasW"
      :height="canvasH"
      @mousedown="onSvgMouseDown"
      @mousemove="onSvgMouseMove"
      @mouseup="onSvgMouseUp"
      @click="onSvgClick"
    >
      <defs>
        <marker
          :id="arrowMarkerId"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" :fill="color" />
        </marker>
      </defs>

      <!-- 已有标注 -->
      <template v-for="a in annotations" :key="a.id">
        <text
          v-if="a.annotation_type === 'text'"
          :x="w2s(a.world_x, a.world_y).x"
          :y="w2s(a.world_x, a.world_y).y"
          :fill="a.color || '#3b82f6'"
          :font-size="Math.max(10, (a.font_size || 14) * zoom)"
          class="annot-el annot-text"
          @dblclick.stop="onDblClickAnnotation(a)"
        >{{ a.content }}</text>

        <line
          v-else-if="a.annotation_type === 'arrow'"
          :x1="w2s(a.world_x, a.world_y).x"
          :y1="w2s(a.world_x, a.world_y).y"
          :x2="w2s(a.world_x2, a.world_y2).x"
          :y2="w2s(a.world_x2, a.world_y2).y"
          :stroke="a.color || '#3b82f6'"
          :stroke-width="Math.max(1.5, 2 * zoom)"
          :marker-end="`url(#${arrowMarkerId})`"
          class="annot-el annot-line"
          @dblclick.stop="onDblClickAnnotation(a)"
        />

        <rect
          v-else-if="a.annotation_type === 'box'"
          :x="rectBox(a).x"
          :y="rectBox(a).y"
          :width="rectBox(a).w"
          :height="rectBox(a).h"
          :stroke="a.color || '#3b82f6'"
          :stroke-width="Math.max(1.5, 2 * zoom)"
          fill="transparent"
          class="annot-el annot-rect"
          @dblclick.stop="onDblClickAnnotation(a)"
        />
      </template>

      <!-- 正在绘制的临时标注 -->
      <line
        v-if="draft && draft.type === 'arrow'"
        :x1="draft.sx" :y1="draft.sy" :x2="draft.ex" :y2="draft.ey"
        :stroke="color" :stroke-width="Math.max(1.5, 2 * zoom)"
        :marker-end="`url(#${arrowMarkerId})`" stroke-dasharray="4 3"
      />
      <rect
        v-if="draft && draft.type === 'box'"
        :x="draftRect.x" :y="draftRect.y"
        :width="draftRect.w" :height="draftRect.h"
        :stroke="color" :stroke-width="Math.max(1.5, 2 * zoom)"
        fill="transparent" stroke-dasharray="4 3"
      />
    </svg>
  </div>
</template>

<script setup>
/**
 * 坐标系：
 *   world  : 标注存储坐标（画布世界坐标，与节点 position 同空间）
 *   screen : SVG 像素坐标
 *   变换：screenX = worldX * zoom + vp.x ; screenY = worldY * zoom + vp.y
 *   逆变换：worldX = (screenX - vp.x) / zoom
 *
 * 交互：
 *   text  : 单击 → 弹出输入框 → 创建文字标注
 *   arrow : mousedown 记录起点 → mousemove 实时预览 → mouseup 创建
 *   box   : 同 arrow，创建矩形框
 *   双击已有标注 → 编辑(text 内容) / 删除
 */
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'

const props = defineProps({
  dramaId: { type: [Number, String], default: null },
  /** VueFlow 视口 { x, y, zoom } */
  viewport: { type: Object, default: () => ({ x: 0, y: 0, zoom: 1 }) },
  /** 画布像素尺寸 { w, h } */
  canvasRect: { type: Object, default: () => ({ w: 0, h: 0 }) },
  /** 已有标注数组 */
  annotations: { type: Array, default: () => [] },
  /** 是否处于标注模式（由父组件顶栏按钮控制） */
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['create', 'delete', 'update', 'close'])

const canvasW = computed(() => props.canvasRect?.w || 0)
const canvasH = computed(() => props.canvasRect?.h || 0)
const zoom = computed(() => props.viewport?.zoom || 1)

const mode = ref(null) // 'text' | 'arrow' | 'box' | null
const color = ref('#3b82f6')
const arrowMarkerId = `annot-arrow-${Math.random().toString(36).slice(2, 8)}`

// 临时绘制状态（屏幕坐标）
const draft = ref(null)

function w2s(wx, wy) {
  const vp = props.viewport || {}
  return {
    x: wx * (vp.zoom || 1) + (vp.x || 0),
    y: wy * (vp.zoom || 1) + (vp.y || 0),
  }
}

function s2w(sx, sy) {
  const vp = props.viewport || {}
  const z = vp.zoom || 1
  return { x: (sx - (vp.x || 0)) / z, y: (sy - (vp.y || 0)) / z }
}

/** 从鼠标事件提取相对 SVG 的屏幕坐标 */
function eventToScreen(e) {
  const target = e.currentTarget
  if (!target) return { x: 0, y: 0 }
  const rect = target.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function rectBox(a) {
  const p1 = w2s(a.world_x, a.world_y)
  const p2 = w2s(a.world_x2, a.world_y2)
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  }
}

const draftRect = computed(() => {
  if (!draft.value || draft.value.type !== 'box') return { x: 0, y: 0, w: 0, h: 0 }
  return {
    x: Math.min(draft.value.sx, draft.value.ex),
    y: Math.min(draft.value.sy, draft.value.ey),
    w: Math.abs(draft.value.ex - draft.value.sx),
    h: Math.abs(draft.value.ey - draft.value.sy),
  }
})

function setMode(m) {
  mode.value = m
}

function onExit() {
  mode.value = null
  draft.value = null
  emit('close')
}

/* ---- 鼠标交互 ---- */
function onSvgClick(e) {
  if (!props.active || mode.value !== 'text') return
  const s = eventToScreen(e)
  const w = s2w(s.x, s.y)
  ElMessageBox.prompt('请输入标注文字', '文字标注', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputPattern: /.+/,
    inputErrorMessage: '内容不能为空',
  }).then(({ value }) => {
    emit('create', {
      annotationType: 'text',
      worldX: Math.round(w.x),
      worldY: Math.round(w.y),
      worldX2: null,
      worldY2: null,
      content: value,
      color: color.value,
      fontSize: 14,
    })
  }).catch(() => {})
}

function onSvgMouseDown(e) {
  if (!props.active) return
  if (mode.value !== 'arrow' && mode.value !== 'box') return
  // 仅左键
  if (e.button !== 0) return
  const s = eventToScreen(e)
  draft.value = {
    type: mode.value,
    sx: s.x, sy: s.y, ex: s.x, ey: s.y,
  }
  e.preventDefault()
}

function onSvgMouseMove(e) {
  if (!draft.value) return
  const s = eventToScreen(e)
  draft.value.ex = s.x
  draft.value.ey = s.y
}

function onSvgMouseUp(e) {
  if (!draft.value) return
  const s = eventToScreen(e)
  draft.value.ex = s.x
  draft.value.ey = s.y
  const d = draft.value
  draft.value = null
  // 过小则忽略（误触）
  const dist = Math.hypot(d.ex - d.sx, d.ey - d.sy)
  if (dist < 4) return
  const w1 = s2w(d.sx, d.sy)
  const w2 = s2w(d.ex, d.ey)
  emit('create', {
    annotationType: d.type,
    worldX: Math.round(w1.x),
    worldY: Math.round(w1.y),
    worldX2: Math.round(w2.x),
    worldY2: Math.round(w2.y),
    content: null,
    color: color.value,
    fontSize: 14,
  })
}

/* ---- 双击编辑/删除 ---- */
function onDblClickAnnotation(a) {
  if (!props.active) return
  if (a.annotation_type === 'text') {
    // 文字：先选择编辑/删除
    ElMessageBox.confirm('编辑或删除该文字标注？', '标注操作', {
      confirmButtonText: '编辑',
      cancelButtonText: '删除',
      distinguishCancelAndClose: true,
      type: 'info',
    }).then(() => {
      // 编辑内容
      ElMessageBox.prompt('请输入标注文字', '编辑文字标注', {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: a.content || '',
        inputPattern: /.+/,
        inputErrorMessage: '内容不能为空',
      }).then(({ value }) => {
        emit('update', a.id, { content: value })
      }).catch(() => {})
    }).catch((action) => {
      if (action === 'cancel') emit('delete', a.id)
    })
  } else {
    // 箭头/框选：仅支持删除
    ElMessageBox.confirm('删除该标注？', '标注操作', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    }).then(() => {
      emit('delete', a.id)
    }).catch(() => {})
  }
}

// 暴露给父组件：进入时默认工具
function activate(m) { mode.value = m || null }
defineExpose({ activate, setMode })
</script>

<style scoped>
.canvas-annotations-layer {
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
}
.canvas-annotations-layer.active {
  cursor: crosshair;
}
.annot-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 16;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}
.annot-svg {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  user-select: none;
}
.annot-el {
  pointer-events: none;
}
/* 仅在标注模式下，已有标注才可被双击编辑/删除，避免遮挡 VueFlow 交互 */
.canvas-annotations-layer.active .annot-el {
  pointer-events: auto;
  cursor: pointer;
}
.annot-text {
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(15, 23, 42, 0.85);
  stroke-width: 3px;
  stroke-linejoin: round;
}
</style>
