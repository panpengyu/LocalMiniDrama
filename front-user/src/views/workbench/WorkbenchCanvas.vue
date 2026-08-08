<template>
  <!-- S3-T05: 一站式工作台画布核心（简化版 DramaCanvas，无顶栏/素材栏，嵌入工作台中间） -->
  <div class="wb-canvas" v-loading="loading">
    <div ref="canvasMainRef" class="wb-canvas-main">
      <VueFlow
        v-if="nodes.length"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :default-viewport="initialViewport"
        :min-zoom="0.08"
        :max-zoom="2"
        :nodes-connectable="false"
        :elements-selectable="true"
        :selection-key-code="true"
        :pan-on-drag="[1, 2]"
        :pan-on-scroll="true"
        :fit-view-on-init="!hasSavedViewport"
        class="vue-flow-canvas"
        @node-double-click="onNodeDoubleClick"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
        @node-drag-stop="scheduleLayoutSave"
        @viewport-change="onViewportChange"
        @move-end="scheduleLayoutSave"
        @selection-change="onSelectionChange"
      >
        <Background pattern-color="#3f3f46" :gap="20" />
        <Controls>
          <template #icon-zoom-in><ZoomIn :size="16" /></template>
          <template #icon-zoom-out><ZoomOut :size="16" /></template>
          <template #icon-fit-view><FullScreen :size="16" /></template>
        </Controls>
        <MiniMap pannable zoomable />
      </VueFlow>
      <el-empty v-else-if="!loading" description="暂无画布数据，请在左侧导航树或AI面板创建内容" />
    </div>
  </div>
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { ZoomIn, ZoomOut, FullScreen } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import { dramaAPI } from '@/api/drama'
import {
  applyCanvasHighlight,
  buildDramaCanvasGraph,
  getStoryboardRefFromNode,
  stampEdgeBaseStyles,
} from '@/utils/dramaCanvasAdapter'
import {
  buildCanvasLayoutPayload,
  parseCanvasLayout,
  resolveViewport,
} from '@/utils/canvasLayout'
import { storyboardIdFromNodeId } from '@/utils/canvasWorkflow'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

import CanvasLabelNode from '@/components/dramaCanvas/CanvasLabelNode.vue'
import CanvasDramaHeaderNode from '@/components/dramaCanvas/CanvasDramaHeaderNode.vue'
import CanvasAssetNode from '@/components/dramaCanvas/CanvasAssetNode.vue'
import CanvasEpisodeNode from '@/components/dramaCanvas/CanvasEpisodeNode.vue'
import CanvasScriptNode from '@/components/dramaCanvas/CanvasScriptNode.vue'
import CanvasStoryboardNode from '@/components/dramaCanvas/CanvasStoryboardNode.vue'
import CanvasMediaNode from '@/components/dramaCanvas/CanvasMediaNode.vue'
import CanvasAddButtonNode from '@/components/dramaCanvas/CanvasAddButtonNode.vue'

const log = useWorkbenchLogger('WorkbenchCanvas')

const props = defineProps({
  dramaId: { type: [Number, String], required: true },
  // 高亮的素材节点ID (格式：char:xxx / scene:xxx / prop:xxx)
  highlightAssetId: { type: String, default: null },
  // 选中的分镜ID（从时间轴同步过来）
  focusStoryboardId: { type: [Number, String], default: null },
  // 过滤集
  filterEpisodeId: { type: [Number, String], default: 'all' },
})
const emit = defineEmits([
  'drama-loaded',      // drama数据加载完成 payload: drama
  'node-click',        // 节点点击 payload: { nodeType, data, id }
  'storyboard-click',  // 分镜节点点击 payload: storyboard
  'script-click',      // 剧本节点点击 payload: script
  'layout-saved',      // 布局保存完成
  'selection-change',  // 选区变化 payload: selectedStoryboardIds
])

const loading = ref(false)
const drama = ref(null)
const nodes = ref([])
const edges = ref([])
const layoutCache = ref(null)
const currentViewport = ref({ x: 0, y: 0, zoom: 0.75 })
const canvasMainRef = ref(null)
const selectedStoryboardIds = ref([])
const { imagesBySbId, videosBySbId, loadForDrama } = useCanvasStoryboardMedia()

const nodeTypes = {
  canvasLabel: markRaw(CanvasLabelNode),
  canvasDramaHeader: markRaw(CanvasDramaHeaderNode),
  canvasAsset: markRaw(CanvasAssetNode),
  canvasEpisode: markRaw(CanvasEpisodeNode),
  canvasScript: markRaw(CanvasScriptNode),
  canvasStoryboard: markRaw(CanvasStoryboardNode),
  canvasMedia: markRaw(CanvasMediaNode),
  canvasAddButton: markRaw(CanvasAddButtonNode),
}

let saveTimer = null

const resolvedEpisodeId = computed(() =>
  props.filterEpisodeId === 'all' ? null : props.filterEpisodeId
)
const savedLayout = computed(() => layoutCache.value || parseCanvasLayout(drama.value?.metadata))
const initialViewport = computed(() => {
  const v = resolveViewport(savedLayout.value)
  return { x: v.x, y: v.y, zoom: v.zoom }
})
const hasSavedViewport = computed(() => Boolean(savedLayout.value?.viewport))

/* ===================== 加载 & 构图 ===================== */
async function loadDrama(force = false) {
  await log.withPerfLog(
    'loadDrama',
    async () => {
      loading.value = true
      log.info('开始加载项目数据', { dramaId: Number(props.dramaId), force: !!force })
      const res = await dramaAPI.get(props.dramaId)
      drama.value = res?.data || null
      const nodeCount = drama.value?.characters?.length + (drama.value?.scenes?.length || 0)
        + (drama.value?.props?.length || 0)
        + (drama.value?.episodes || []).reduce((s, e) => s + (e.storyboards || []).length, 0)
      log.info('项目数据 HTTP 返回成功', {
        dramaId: Number(props.dramaId),
        title: drama.value?.title || '',
        episodes: (drama.value?.episodes || []).length,
        characters: (drama.value?.characters || []).length,
        scenes: (drama.value?.scenes || []).length,
        estNodeCount: nodeCount,
      })
      layoutCache.value = parseCanvasLayout(drama.value?.metadata)
      emit('drama-loaded', drama.value)
      await loadForDrama(drama.value, resolvedEpisodeId.value)
      const start = performance.now()
      rebuildGraph()
      log.debug('rebuildGraph 内联耗时', { ms: Math.round(performance.now() - start) })
    },
    { dramaId: Number(props.dramaId), force: !!force }
  ).catch((e) => {
    log.error('loadDrama 失败', e, { dramaId: Number(props.dramaId) })
    ElMessage.error(e?.message || '项目加载失败')
  }).finally(() => {
    loading.value = false
  })
}

function rebuildGraph() {
  const end = log.startMeasure('rebuildGraph')
  if (!drama.value) { nodes.value = []; edges.value = []; end(true, { nodes: 0, edges: 0 }); return }
  const graph = buildDramaCanvasGraph(drama.value, {
    episodeId: resolvedEpisodeId.value,
    savedLayout: savedLayout.value,
    workflowGroups: [],
    imagesBySbId: imagesBySbId.value,
    videosBySbId: videosBySbId.value,
  })
  let nextNodes = graph.nodes
  let nextEdges = stampEdgeBaseStyles(graph.edges)
  const hlStart = performance.now()
  if (props.highlightAssetId) {
    const h = applyCanvasHighlight(nextNodes, nextEdges, props.highlightAssetId, drama.value)
    nextNodes = h.nodes; nextEdges = h.edges
  }
  const hlMs = Math.round(performance.now() - hlStart)
  nodes.value = nextNodes
  edges.value = nextEdges
  end(true, {
    nodes: nextNodes.length,
    edges: nextEdges.length,
    highlightAssetId: props.highlightAssetId || null,
    highlightMs: hlMs,
    episodeFilter: props.filterEpisodeId,
  })
}

/* ===================== 素材高亮 ===================== */
function applyHighlight() {
  if (!nodes.value.length) return
  const cleared = nodes.value.map((n) => ({
    ...n, class: undefined, data: { ...n.data, highlighted: false, dimmed: false },
  }))
  if (props.highlightAssetId) {
    const h = applyCanvasHighlight(cleared, edges.value, props.highlightAssetId, drama.value)
    nodes.value = h.nodes; edges.value = h.edges
  } else {
    nodes.value = cleared
  }
}
watch(() => props.highlightAssetId, applyHighlight)

/* ===================== 集数过滤 ===================== */
watch(() => props.filterEpisodeId, () => {
  if (drama.value) {
    loadForDrama(drama.value, resolvedEpisodeId.value).then(() => rebuildGraph())
  }
})

/* ===================== 分镜焦点同步（时间轴→画布） ===================== */
watch(() => props.focusStoryboardId, (sbId, old) => {
  if (!sbId) return
  log.info('[Sync] 时间轴→画布：聚焦分镜节点', { storyboardId: sbId, prev: old || null, nodesCount: nodes.value.length })
  if (!nodes.value.length) return
  const t0 = performance.now()
  const targetNode = nodes.value.find((n) => {
    const sid = storyboardIdFromNodeId(n.id)
    return sid && String(sid) === String(sbId)
  })
  const ms = Math.round(performance.now() - t0)
  if (targetNode) {
    selectedStoryboardIds.value = [sbId]
    log.info('[Sync] 找到并标记选中分镜节点', {
      storyboardId: sbId,
      nodeId: targetNode.id,
      position: targetNode.position,
      lookupMs: ms,
    })
  } else {
    log.warn('[Sync] 未找到对应分镜节点（可能集数过滤未包含）', { storyboardId: sbId, lookupMs: ms })
  }
})

/* ===================== 事件回调 ===================== */
function onPaneClick() { /* 留空 */ }
function onViewportChange(ev) {
  if (ev?.viewport) currentViewport.value = ev.viewport
}
function onNodeClick(_, node) {
  const type = node?.type || ''
  const id = node?.id
  log.info('画布节点被单击', { nodeId: id, nodeType: type, label: node?.data?.label || node?.label || '' })
  emit('node-click', { nodeType: type, data: node?.data || {}, id })
  if (type === 'canvasStoryboard') {
    const sb = getStoryboardRefFromNode(node, drama.value)
    if (sb) {
      log.info('分镜节点点击 → 向上发射 storyboard-click', {
        storyboardId: sb.id,
        number: sb.storyboard_number,
        image_status: sb.status || 'draft',
      })
      emit('storyboard-click', sb)
    }
  } else if (type === 'canvasScript') {
    log.info('剧本节点点击 → 向上发射 script-click')
    emit('script-click', { script: drama.value?.script })
  }
}
function onNodeDoubleClick(_e, node) {
  log.info('画布节点被双击（同步转单击处理）', { nodeId: node?.id, type: node?.type })
  onNodeClick(_e, node)
}

function onSelectionChange(sel) {
  const ids = []
  for (const n of (sel?.nodes || [])) {
    const sid = storyboardIdFromNodeId(n.id)
    if (sid) ids.push(sid)
  }
  const prev = selectedStoryboardIds.value.length
  selectedStoryboardIds.value = ids
  if (ids.length || prev) {
    log.info('画布选区变更', { selectedCount: ids.length, prevCount: prev, sampleIds: ids.slice(0, 5) })
  }
  emit('selection-change', ids)
}

/* ===================== 布局保存 ===================== */
let _lastScheduleAt = 0
const layoutDirty = ref(false)

async function flushLayoutSave() {
  if (!layoutDirty.value || !drama.value) {
    log.debug('[LayoutSave] 跳过：layout 非 dirty 或无 drama')
    return
  }
  const t0 = Date.now()
  try {
    const payload = buildCanvasLayoutPayload(
      nodes.value, currentViewport.value,
      drama.value?.metadata?.canvas_layout?.meta || {}
    )
    const nodeCount = Array.isArray(payload?.nodes) ? payload.nodes.length : 0
    log.info('[LayoutSave] 开始保存画布布局到后端', {
      dramaId: drama.value.id,
      nodes: nodeCount,
      hasViewport: !!payload?.viewport,
      debounceMs: Date.now() - _lastScheduleAt,
    })
    await dramaAPI.saveCanvasLayout(drama.value.id, payload, undefined)
    const ms = Date.now() - t0
    log.info('[LayoutSave] 画布布局保存成功', { dramaId: drama.value.id, nodes: nodeCount, totalMs: ms })
    layoutDirty.value = false
    emit('layout-saved', { ok: true, nodes: nodeCount, totalMs: ms })
  } catch (e) {
    const ms = Date.now() - t0
    log.error('[LayoutSave] 画布布局保存失败（下次拖动将重新触发）', e, {
      dramaId: Number(drama.value?.id),
      nodes: nodes.value.length,
      totalMs: ms,
    })
  }
}

function scheduleLayoutSave() {
  layoutDirty.value = true
  _lastScheduleAt = Date.now()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    log.info('[LayoutSave] 防抖触发 flushLayoutSave', { dramaId: Number(drama.value?.id), debounceMs: Date.now() - _lastScheduleAt })
    flushLayoutSave()
  }, 900)
}

/* ===================== 对外暴露方法 ===================== */
async function refresh(keepFocus = true) {
  await loadDrama(true)
}
defineExpose({
  refresh,
  getDrama: () => drama.value,
  getSelectedStoryboardIds: () => selectedStoryboardIds.value,
  rebuild: rebuildGraph,
})

onMounted(() => { loadDrama() })
onBeforeUnmount(() => {
  if (saveTimer) { clearTimeout(saveTimer); flushLayoutSave() }
})
</script>

<style scoped>
.wb-canvas {
  position: relative;
  width: 100%; height: 100%;
  background: #0f172a;
  overflow: hidden;
}
.wb-canvas-main {
  width: 100%; height: 100%;
}
.vue-flow-canvas {
  width: 100%; height: 100%;
}
</style>
