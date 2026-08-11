<template>
  <!-- Sprint 5 升级版工作台画布核心：
       S5-T01 节点三视图模式 / S5-T02 缩放联动 / S5-T03 虚拟化 / S5-T04 自定义小地图 / S5-T05 分区 / S5-T06 平滑缩放 -->
  <div class="wb-canvas" v-loading="loading" ref="canvasContainerRef">
    <!-- 顶栏：5档缩放按钮 + 分区操作 + 视图信息 -->
    <div class="wb-canvas-toolbar">
      <div class="wct-left">
        <template v-if="zoomModes">
        <el-tooltip v-for="(lv, i) in zoomModes.ZOOM_LEVELS" :key="lv.key"
                    :content="`${lv.desc} ${lv.label}`" placement="bottom">
          <el-button
            size="small"
            type="primary"
            :plain="zoomModes.zoomLevelIdx.value !== i"
            :style="zoomModes.zoomLevelIdx.value === i ? { opacity: 1 } : { opacity: 0.55 }"
            @click="zoomModes.setZoomLevel(i)"
          >
            {{ lv.desc }}
            <span class="wct-z">({{ lv.label }})</span>
          </el-button>
        </el-tooltip>
        </template>
      </div>
      <div class="wct-right">
        <!-- S6-T01 画布搜索 -->
        <el-input
          v-if="canvasSearch"
          v-model="canvasSearch.searchQuery.value"
          placeholder="搜索节点..."
          size="small"
          class="wct-search"
          clearable
          @input="onSearchInput"
          @clear="onSearchClear"
          @keyup.enter="onSearchEnter"
        >
          <template #prepend>
            <el-select
              v-model="canvasSearch.searchType.value"
              size="small"
              style="width: 90px"
              @change="onSearchTypeChange"
            >
              <el-option label="全部" value="all" />
              <el-option label="名称" value="name" />
              <el-option label="内容" value="content" />
              <el-option label="类型" value="type" />
              <el-option label="状态" value="status" />
            </el-select>
          </template>
          <template #suffix>
            <span v-if="canvasSearch.hasResults.value" class="wct-search-count">
              {{ canvasSearch.selectedIndex.value + 1 }}/{{ canvasSearch.searchResults.value.length }}
            </span>
          </template>
        </el-input>
        <el-button-group v-if="canvasSearch && canvasSearch.hasResults.value" size="small">
          <el-button @click="onSearchPrev" title="上一个">‹</el-button>
          <el-button @click="onSearchNext" title="下一个">›</el-button>
        </el-button-group>

        <el-divider direction="vertical" v-if="canvasSearch" />

        <!-- S6-T02 书签 -->
        <el-dropdown v-if="canvasBookmarks" trigger="click" @command="onBookmarkCommand">
          <el-button size="small">
            <el-icon><CollectionTag /></el-icon> 书签
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="save">📌 保存当前视口</el-dropdown-item>
              <el-dropdown-item
                divided
                class="bm-item"
                v-for="bm in canvasBookmarks.bookmarks.value"
                :key="bm.id"
                :command="bm.id"
              >
                <span class="bm-label">{{ bm.name }} ({{ Math.round((bm.viewport_zoom || bm.viewportZoom || 1) * 100) }}%)</span>
                <el-icon class="bm-del" @click.stop="onDeleteBookmark(bm.id)"><Delete /></el-icon>
              </el-dropdown-item>
              <el-dropdown-item v-if="canvasBookmarks.bookmarks.value.length === 0" disabled command="__empty__">暂无书签</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- S6-T03 标注 -->
        <el-button
          size="small"
          :type="annotationActive ? 'primary' : ''"
          @click="toggleAnnotation"
        >
          <el-icon><EditPen /></el-icon> 标注
        </el-button>

        <el-divider direction="vertical" />

        <!-- S5-T05 分区操作 -->
        <el-button size="small" @click="onToggleZonesAll(false)">展开分区</el-button>
        <el-button size="small" @click="onToggleZonesAll(true)">折叠分区</el-button>
        <el-button size="small" type="success" @click="onTidyLayout">
          <el-icon><Grid /></el-icon> 一键整理
        </el-button>
        <el-divider direction="vertical" />
        <!-- 视图模式指示器 -->
        <el-tag v-if="zoomModes" size="small" :type="viewModeTag(zoomModes.viewMode.value).type" effect="plain">
          视图: {{ viewModeTag(zoomModes.viewMode.value).label }}
        </el-tag>
        <span v-if="zoomModes" class="wct-zoom">{{ Math.round(zoomModes.zoomRatio.value * 100) }}%</span>

        <el-divider direction="vertical" />

        <!-- S9-T08: 2D/3D 视图切换 -->
        <el-tooltip :content="viewMode === '2d' ? '切换到3D导演台' : '切换到2D画布'" placement="bottom">
          <el-button
            size="small"
            :type="viewMode === '3d' ? 'primary' : ''"
            @click="toggleViewMode"
          >
            <el-icon><Box /></el-icon>
            {{ viewMode === '2d' ? '3D' : '2D' }}
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div ref="canvasMainRef" class="wb-canvas-main">
      <!-- S5-T05 分区背景层（在 VueFlow 外层，绝对定位 + 自己做 world->screen 变换） -->
      <CanvasZones
        v-if="rawNodes.length > 0 && canvasZones"
        v-show="viewMode === '2d'"
        :zones="canvasZones.zones.value"
        :viewport="viewportForZones"
        :canvas-rect="canvasRect"
        :node-zone-counts="nodeZoneCounts"
        @toggle="(k) => canvasZones.toggleZone(k)"
      />

      <VueFlow
        v-if="rawNodes.length"
        v-show="viewMode === '2d'"
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
        @move-end="onMoveEnd"
        @selection-change="onSelectionChange"
        @init="onVueFlowInit"
      >
        <Background pattern-color="#3f3f46" :gap="20" />
        <Controls>
          <template #icon-zoom-in><ZoomIn :size="16" /></template>
          <template #icon-zoom-out><ZoomOut :size="16" /></template>
          <template #icon-fit-view><FullScreen :size="16" /></template>
        </Controls>
      </VueFlow>

      <!-- S9-T08: 3D 导演台（2D/3D 视图切换，visible 由 viewMode 控制） -->
      <DirectorStage3D
        v-if="rawNodes.length > 0"
        ref="director3DRef"
        :nodes="rawNodes"
        :visible="viewMode === '3d'"
        :camera-state="camera3DState"
        :layout3d="savedLayout"
        :drama="drama"
        @view-change="on3DViewChange"
        @node-click="on3DNodeClick"
        @node-drag="on3DNodeDrag"
        @position-change="on3DPositionChange"
        @camera-change="on3DCameraChange"
        @arrange-characters="onArrangeCharacters"
        @toggle-scene-depth="onToggleSceneDepth"
        @toggle-timeline-3d="onToggleTimeline3D"
      />

      <!-- S6-T03 画布标注层（SVG overlay，标注模式下捕获鼠标） -->
      <CanvasAnnotations
        v-if="rawNodes.length > 0"
        v-show="viewMode === '2d'"
        :drama-id="dramaId"
        :viewport="currentViewport"
        :canvas-rect="canvasRect"
        :annotations="annotations"
        :active="annotationActive"
        @create="createAnnotation"
        @delete="deleteAnnotation"
        @update="updateAnnotation"
        @close="onAnnotationClose"
      />

      <!-- S5-T04 自定义小地图（Canvas2D + 视口框 + 点击跳转） -->
      <CanvasMinimap
        v-if="rawNodes.length > 0"
        v-show="viewMode === '2d'"
        :nodes="rawNodes"
        :viewport="currentViewport"
        :canvas-rect="canvasRect"
        :zones="minimapZones"
        @center="onMinimapCenter"
      />

      <!-- S6-T01 搜索结果浮动面板（可折叠） -->
      <div
        v-if="canvasSearch && canvasSearch.searchQuery.value"
        class="wct-search-panel"
      >
        <div class="wsp-header" @click="searchPanelCollapsed = !searchPanelCollapsed">
          <span class="wsp-title">搜索结果 ({{ canvasSearch.searchResults.value.length }})</span>
          <el-icon class="wsp-toggle">
            <component :is="searchPanelCollapsed ? 'ArrowDown' : 'ArrowUp'" />
          </el-icon>
        </div>
        <div v-show="!searchPanelCollapsed" class="wsp-body">
          <div
            v-for="(n, i) in canvasSearch.searchResults.value"
            :key="n.id"
            class="wsp-item"
            :class="{ active: i === canvasSearch.selectedIndex.value }"
            @click="onSearchResultClick(n)"
          >
            <span class="wsp-idx">{{ i + 1 }}</span>
            <span class="wsp-text">{{ describeNode(n) }}</span>
          </div>
          <div v-if="canvasSearch.searchResults.value.length === 0" class="wsp-empty">
            无匹配节点
          </div>
        </div>
      </div>

      <el-empty v-else-if="!loading" description="暂无画布数据，请在左侧导航树或AI面板创建内容" />
    </div>
  </div>
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { ZoomIn, ZoomOut, FullScreen, Grid, CollectionTag, EditPen, Delete, Box } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

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
  resolveZoneCollapsed,
  resolveViewMode,
  resolveCamera3D,
  resolveCameraPreset,
  merge3DFieldsIntoPayload,
  VIEW_MODE,
} from '@/utils/canvasLayout'
import { storyboardIdFromNodeId } from '@/utils/canvasWorkflow'
import { unwrapDramaResponse, estimateNodeCount } from '@/utils/dramaData'
import { useCanvasStoryboardMedia } from '@/composables/useCanvasStoryboardMedia'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

// S9-T08: 3D 导演台组件
import DirectorStage3D from '@/components/director3d/DirectorStage3D.vue'

import CanvasLabelNode from '@/components/dramaCanvas/CanvasLabelNode.vue'
import CanvasDramaHeaderNode from '@/components/dramaCanvas/CanvasDramaHeaderNode.vue'
import CanvasAssetNode from '@/components/dramaCanvas/CanvasAssetNode.vue'
import CanvasEpisodeNode from '@/components/dramaCanvas/CanvasEpisodeNode.vue'
import CanvasScriptNode from '@/components/dramaCanvas/CanvasScriptNode.vue'
import CanvasStoryboardNode from '@/components/dramaCanvas/CanvasStoryboardNode.vue'
import CanvasMediaNode from '@/components/dramaCanvas/CanvasMediaNode.vue'
import CanvasAddButtonNode from '@/components/dramaCanvas/CanvasAddButtonNode.vue'

// Sprint 5
import { useCanvasZoomModes } from '@/composables/useCanvasZoomModes'
import { useCanvasViewportVirtualization } from '@/composables/useCanvasViewportVirtualization'
import { useCanvasZones } from '@/composables/useCanvasZones'
import CanvasMinimap from '@/components/workbench/CanvasMinimap.vue'
import CanvasZones from '@/components/workbench/CanvasZones.vue'

// Sprint 6
import { useCanvasSearch, describeNode } from '@/composables/useCanvasSearch'
import { useCanvasBookmarks, apiJson } from '@/composables/useCanvasBookmarks'
import CanvasAnnotations from '@/components/workbench/CanvasAnnotations.vue'

const log = useWorkbenchLogger('WorkbenchCanvas')

const props = defineProps({
  dramaId: { type: [Number, String], required: true },
  highlightAssetId: { type: String, default: null },
  focusStoryboardId: { type: [Number, String], default: null },
  filterEpisodeId: { type: [Number, String], default: 'all' },
})
const emit = defineEmits([
  'drama-loaded', 'node-click', 'storyboard-click', 'script-click',
  'layout-saved', 'selection-change',
])

const loading = ref(false)
const drama = ref(null)
// rawNodes: 全量节点（布局保存、虚拟化、分区折叠判定都用它）
// nodes:    视口内可见节点（VueFlow 实际渲染的是它；VueFlow v-model:nodes="nodes"）
const rawNodes = ref([])
const nodes = ref([])
const edges = ref([])
const layoutCache = ref(null)
const currentViewport = ref({ x: 0, y: 0, zoom: 0.75 })
const canvasMainRef = ref(null)
const canvasContainerRef = ref(null)
const canvasRect = ref({ w: 0, h: 0 })
const selectedStoryboardIds = ref([])
const selectedIdsSet = computed(() => new Set(selectedStoryboardIds.value.map(String)))
const { imagesBySbId, videosBySbId, loadForDrama } = useCanvasStoryboardMedia()

// S9-T08: 2D/3D 视图模式切换
const viewMode = ref(VIEW_MODE.MODE_2D) // '2d' | '3d'
const director3DRef = ref(null) // DirectorStage3D 组件实例引用
const camera3DState = ref(null) // 保存的3D摄像机状态
const savedCameraPreset = ref('free') // 保存的预设机位

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
let resizeObserver = null
const resolvedEpisodeId = computed(() =>
  props.filterEpisodeId === 'all' ? null : props.filterEpisodeId
)
const savedLayout = computed(() => layoutCache.value || parseCanvasLayout(drama.value?.metadata))
const initialViewport = computed(() => {
  const v = resolveViewport(savedLayout.value)
  return { x: v.x, y: v.y, zoom: v.zoom }
})
const hasSavedViewport = computed(() => Boolean(savedLayout.value?.viewport))

// ---- Sprint 5 composables ----
// 注意：useVueFlow 必须在 <VueFlow> 作用域内可用，所以在 onVueFlowInit 之后再初始化
let zoomModes = null
let viewportVirt = null
let canvasZones = null

// ---- Sprint 6 composables ----
let canvasSearch = null
let canvasBookmarks = null
const annotations = ref([])
const annotationActive = ref(false)
const searchPanelCollapsed = ref(false)

function initSprint5() {
  zoomModes = useCanvasZoomModes()
  viewportVirt = useCanvasViewportVirtualization()
  canvasZones = useCanvasZones()
  // S6-T01/S6-T02：搜索与书签（不依赖 useVueFlow，可在此初始化）
  canvasSearch = useCanvasSearch()
  canvasBookmarks = useCanvasBookmarks()
  // S5-T05: 从 savedLayout 恢复分区折叠状态
  const restored = resolveZoneCollapsed(savedLayout.value)
  if (canvasZones && restored) {
    try { canvasZones.zoneCollapsed.value = { ...canvasZones.zoneCollapsed.value, ...restored } } catch (_) {}
  }
  // S6-T02：加载已存书签
  if (canvasBookmarks && props.dramaId) {
    canvasBookmarks.loadBookmarks(props.dramaId)
  }
  // S6-T03：加载画布标注
  loadAnnotations()

  // S9-T08: 从 savedLayout 恢复 3D 视图状态（不自动切换到3D，仅恢复摄像机状态供下次使用）
  const layout = savedLayout.value
  if (layout) {
    const cam3D = resolveCamera3D(layout)
    if (cam3D) {
      camera3DState.value = cam3D
      savedCameraPreset.value = resolveCameraPreset(layout, cam3D.preset || 'free')
    }
    // 恢复视图模式（默认2D，仅当明确保存为3D时恢复）
    const savedViewMode = resolveViewMode(layout, VIEW_MODE.MODE_2D)
    if (savedViewMode === VIEW_MODE.MODE_3D) {
      viewMode.value = VIEW_MODE.MODE_3D
      log.info('[ViewMode] 从已保存布局恢复3D视图模式', { dramaId: Number(props.dramaId) })
    }
  }
}

const viewportForZones = computed(() => currentViewport.value)
const minimapZones = computed(() =>
  (canvasZones?.zones?.value || []).map(z => ({
    key: z.key, label: z.label, color: z.color, worldBounds: z.worldBounds,
  }))
)

function viewModeTag(vm) {
  return vm === 'compact' ? { type: 'info', label: 'Compact 鸟瞰' }
    : vm === 'detailed' ? { type: 'warning', label: 'Detailed 精编' }
      : { type: 'success', label: 'Normal 编辑' }
}

// 分区节点数统计
const nodeZoneCounts = computed(() => {
  const counter = {}
  if (!canvasZones) return counter
  for (const n of rawNodes.value) {
    const zk = canvasZones.zoneKeyOfNode(n)
    counter[zk] = (counter[zk] || 0) + 1
  }
  return counter
})

/* ===================== 加载 & 构图 ===================== */
async function loadDrama(force = false) {
  await log.withPerfLog(
    'loadDrama',
    async () => {
      loading.value = true
      log.info('开始加载项目数据', { dramaId: Number(props.dramaId), force: !!force })
      const res = await dramaAPI.get(props.dramaId)
      drama.value = unwrapDramaResponse(res)
      const nodeCount = estimateNodeCount(drama.value)
      log.info('项目数据 HTTP 返回成功', {
        dramaId: Number(props.dramaId),
        title: drama.value?.title || '',
        episodes: (drama.value?.episodes || []).length,
        characters: (drama.value?.characters || []).length,
        scenes: (drama.value?.scenes || []).length,
        props: (drama.value?.props || []).length,
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

/**
 * 将视图模式/渲染密度注入每个节点的 data（S5-T01/S5-T02 节点组件内通过 this.$props.data 读取）
 * 保持单向：每次 rebuildGraph 都写入最新值
 */
function injectViewModeIntoNodes(arr) {
  const t0 = performance.now()
  const vm = zoomModes ? zoomModes.viewMode.value : 'normal'
  const den = zoomModes ? zoomModes.renderDensity.value : {
    showThumbnail: true, showMetadata: true, showActions: true, showDialogue: false, showHint: true,
  }
  const result = arr.map(n => {
    const hiddenByZone = canvasZones?.isNodeHiddenByZone(n) ?? false
    return {
      ...n,
      data: {
        ...(n.data || {}),
        _viewMode: vm,
        _renderDensity: den,
        _zoneKey: canvasZones?.zoneKeyOfNode(n) ?? null,
        _zoneCollapsed: hiddenByZone,
      },
    }
  })
  const ms = Math.round((performance.now() - t0) * 1000) / 1000
  if (arr.length > 20) {
    log.debug('[Inject] 视图模式注入完成', {
      viewMode: vm, nodeCount: arr.length, ms,
      density: den,
    })
  }
  return result
}

function rebuildGraph() {
  const end = log.startMeasure('rebuildGraph')
  if (!drama.value) { rawNodes.value = []; nodes.value = []; edges.value = []; end(true, { nodes: 0, edges: 0 }); return }
  const graph = buildDramaCanvasGraph(drama.value, {
    episodeId: resolvedEpisodeId.value,
    savedLayout: savedLayout.value,
    workflowGroups: [],
    imagesBySbId: imagesBySbId.value,
    videosBySbId: videosBySbId.value,
  })
  let nextRawNodes = injectViewModeIntoNodes(graph.nodes)
  let nextEdges = stampEdgeBaseStyles(graph.edges)
  if (props.highlightAssetId) {
    const h = applyCanvasHighlight(nextRawNodes, nextEdges, props.highlightAssetId, drama.value)
    nextRawNodes = h.nodes; nextEdges = h.edges
  }
  rawNodes.value = nextRawNodes
  edges.value = nextEdges
  // S5-T03 虚拟化：立即重新计算可见子集
  refreshVisibleNodes(true)
  end(true, {
    rawNodes: nextRawNodes.length,
    visibleNodes: nodes.value.length,
    edges: nextEdges.length,
    highlightAssetId: props.highlightAssetId || null,
    episodeFilter: props.filterEpisodeId,
  })
}

/* S5-T03 虚拟化：把 rawNodes 过滤成 nodes（视口内 + 选中 + 非折叠分区） */
function refreshVisibleNodes(immediate = false) {
  const t0 = performance.now()
  if (!viewportVirt) { nodes.value = rawNodes.value; return }
  viewportVirt.updateViewport(currentViewport.value, immediate)
  // 分区折叠强制剔除（在虚拟化之前）
  const candidates = canvasZones
    ? rawNodes.value.filter(n => !canvasZones.isNodeHiddenByZone(n))
    : rawNodes.value
  const filterMs = Math.round((performance.now() - t0) * 1000) / 1000
  const t1 = performance.now()
  const visible = viewportVirt.makeVisibleNodes(candidates, { selectedIds: selectedIdsSet.value })
  const virtMs = Math.round((performance.now() - t1) * 1000) / 1000
  const totalMs = Math.round((performance.now() - t0) * 1000) / 1000
  // 记录节点增减量，帮助排查渲染抖动
  const prevCount = nodes.value.length
  nodes.value = visible
  const delta = visible.length - prevCount
  log.debug('[Virtual] 节点可见性更新', {
    total: rawNodes.value.length,
    candidates: candidates.length,
    visible: visible.length,
    removed: rawNodes.value.length - visible.length,
    delta,
    filterMs, virtMs, totalMs,
    viewport: { z: Number(currentViewport.value.zoom?.toFixed(3)), x: Math.round(currentViewport.value.x), y: Math.round(currentViewport.value.y) },
    immediate,
  })
  // 可见节点数剧变（>30）时输出 WARN，帮助定位渲染抖动
  if (Math.abs(delta) > 30) {
    log.warn('[Virtual] 可见节点数剧变', { delta, from: prevCount, to: visible.length, totalMs, viewport: currentViewport.value })
  }
}

/* ===================== 素材高亮 ===================== */
function applyHighlight() {
  if (!rawNodes.value.length) return
  const cleared = rawNodes.value.map((n) => ({
    ...n, class: undefined, data: { ...n.data, highlighted: false, dimmed: false },
  }))
  let next = cleared
  if (props.highlightAssetId) {
    const h = applyCanvasHighlight(cleared, edges.value, props.highlightAssetId, drama.value)
    next = h.nodes; edges.value = h.edges
  }
  rawNodes.value = injectViewModeIntoNodes(next)
  refreshVisibleNodes(true)
}
watch(() => props.highlightAssetId, applyHighlight)

/* ===================== 集数过滤 ===================== */
watch(() => props.filterEpisodeId, () => {
  if (drama.value) {
    loadForDrama(drama.value, resolvedEpisodeId.value).then(() => rebuildGraph())
  }
})

/* S5-T01/S5-T02：视图模式/渲染密度变化 → 重新注入节点 data */
watch(
  () => [zoomModes?.viewMode?.value, JSON.stringify(zoomModes?.renderDensity?.value || {})],
  (n, o) => {
    if (!rawNodes.value.length) return
    const t0 = performance.now()
    rawNodes.value = injectViewModeIntoNodes(rawNodes.value)
    log.info('[Watch] 视图模式变化 → 重新注入', {
      newMode: n?.[0], oldMode: o?.[0],
      nodes: rawNodes.value.length,
      ms: Math.round((performance.now() - t0) * 1000) / 1000,
    })
  },
  { immediate: false }
)
/* S5-T05：分区折叠变化 → 重新计算可见节点 */
watch(
  () => JSON.stringify(canvasZones?.zoneCollapsed?.value || {}),
  (n, o) => {
    if (!canvasZones) return
    log.info('[Watch] 分区折叠状态变化', { from: o, to: n, rawNodes: rawNodes.value.length })
    refreshVisibleNodes(true)
  }
)

/* ===================== 分镜焦点同步（时间轴→画布） ===================== */
watch(() => props.focusStoryboardId, (sbId, old) => {
  if (!sbId) return
  log.info('[Sync] 时间轴→画布：聚焦分镜节点', { storyboardId: sbId, prev: old || null, nodesCount: nodes.value.length })
  if (!rawNodes.value.length) return
  const t0 = performance.now()
  const targetNode = rawNodes.value.find((n) => {
    const sid = storyboardIdFromNodeId(n.id)
    return sid && String(sid) === String(sbId)
  })
  const ms = Math.round(performance.now() - t0)
  if (targetNode && zoomModes) {
    selectedStoryboardIds.value = [sbId]
    // S5-T06: 平滑居中跳转
    zoomModes.smoothFitToNode(targetNode, {
      zoom: 0.6, duration: 420,
      canvasW: canvasRect.value.w || 1000,
      canvasH: canvasRect.value.h || 800,
    })
    log.info('[Sync] 找到并平滑跳转到分镜节点', {
      storyboardId: sbId, nodeId: targetNode.id,
      position: targetNode.position, lookupMs: ms,
    })
  } else {
    log.warn('[Sync] 未找到对应分镜节点或 zoomModes 未就绪', { storyboardId: sbId, lookupMs: ms })
  }
})

/* ===================== 事件回调 ===================== */
function onPaneClick() { }

function onVueFlowInit() {
  const t0 = performance.now()
  // 此时 @vue-flow/core 的 Provider 已就绪，可使用 useVueFlow
  initSprint5()
  log.info('[Init] VueFlow 已就绪，Sprint5 composables 初始化', {
    hasZoomModes: !!zoomModes,
    hasViewportVirt: !!viewportVirt,
    hasCanvasZones: !!canvasZones,
    initMs: Math.round((performance.now() - t0) * 1000) / 1000,
  })
  // 尺寸初始化
  if (canvasMainRef.value) {
    const rect = canvasMainRef.value.getBoundingClientRect()
    canvasRect.value = { w: rect.width, h: rect.height }
    viewportVirt?.updateCanvasSize(rect.width, rect.height)
    log.debug('[Init] 画布尺寸初始化', { w: Math.round(rect.width), h: Math.round(rect.height) })
  }
  // 监听尺寸变化
  if (canvasMainRef.value && typeof ResizeObserver !== 'undefined') {
    let roCount = 0
    resizeObserver = new ResizeObserver(entries => {
      for (const e of entries || []) {
        const w = e.contentRect.width
        const h = e.contentRect.height
        if (!w || !h) continue
        canvasRect.value = { w, h }
        viewportVirt?.updateCanvasSize(w, h)
        roCount++
        if (roCount <= 3 || roCount % 10 === 0) {
          log.debug('[ResizeObserver] 画布尺寸变化', { w: Math.round(w), h: Math.round(h), count: roCount })
        }
      }
    })
    resizeObserver.observe(canvasMainRef.value)
  }
  // 初次按档级重置为合理默认
  if (zoomModes) {
    const startVp = currentViewport.value
    // 不强制平滑，直接赋值起点
    zoomModes.syncViewport({ zoom: startVp.zoom })
    log.debug('[Init] 初始 zoom 同步', { zoom: startVp.zoom })
  }
}

/* onViewportChange 高频回调，用 _vpLogAcc 累计统计，每 500ms 聚合输出一次，避免日志刷屏 */
let _vpLogAcc = { count: 0, lastZoom: 0, lastT: performance.now(), maxGap: 0 }
function onViewportChange(ev) {
  if (!ev?.viewport) return
  const vp = ev.viewport
  currentViewport.value = vp
  zoomModes?.syncViewport(vp)
  // S5-T03 虚拟化：节流更新（debounce 100ms）
  viewportVirt?.updateViewport(vp)

  // 性能采样：统计 viewport 变更频率 & 单帧间隔
  const now = performance.now()
  const gap = now - _vpLogAcc.lastT
  _vpLogAcc.count++
  _vpLogAcc.lastT = now
  if (gap > _vpLogAcc.maxGap) _vpLogAcc.maxGap = gap
  if (_vpLogAcc.count % 10 === 0) {
    log.debug('[Viewport] viewport-change 聚合采样', {
      frames: _vpLogAcc.count,
      zoom: Number(vp.zoom?.toFixed(4)),
      x: Math.round(vp.x), y: Math.round(vp.y),
      avgGapMs: Math.round(gap * 10) / 10,
      maxGapMs: Math.round(_vpLogAcc.maxGap * 10) / 10,
      viewMode: zoomModes?.viewMode?.value || '?',
      visibleNodes: nodes.value.length,
      rawNodes: rawNodes.value.length,
    })
    _vpLogAcc.maxGap = 0
  }
  // 缩放档级跨越时立即输出一次（用于排查缩放卡顿拐点）
  const z = Number(vp.zoom?.toFixed(3))
  if (_vpLogAcc.lastZoom && Math.abs(z - _vpLogAcc.lastZoom) > 0.15) {
    log.info('[Viewport] 缩放幅度跨越阈值', {
      from: _vpLogAcc.lastZoom, to: z,
      viewMode: zoomModes?.viewMode?.value || '?',
      gapMs: Math.round(gap * 10) / 10,
      visibleNodes: nodes.value.length,
    })
  }
  _vpLogAcc.lastZoom = z
}

function onMoveEnd(ev) {
  const t0 = performance.now()
  if (ev?.viewport) currentViewport.value = ev.viewport
  log.debug('[MoveEnd] 平移/缩放结束', {
    zoom: Number(ev?.viewport?.zoom?.toFixed(4)),
    x: Math.round(ev?.viewport?.x || 0), y: Math.round(ev?.viewport?.y || 0),
    visibleNodes: nodes.value.length,
    ms: Math.round((performance.now() - t0) * 1000) / 1000,
  })
  scheduleLayoutSave()
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
        storyboardId: sb.id, number: sb.storyboard_number, image_status: sb.status || 'draft',
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

/* S5-T04 小地图跳转：平滑平移视口（不改变 zoom） */
function onMinimapCenter({ x, y }) {
  if (!zoomModes) return
  const vp = currentViewport.value
  log.info('[Minimap] 小地图跳转请求', {
    targetX: Math.round(x), targetY: Math.round(y),
    currentZoom: Number(vp.zoom?.toFixed(3)),
    currentX: Math.round(vp.x), currentY: Math.round(vp.y),
  })
  // 直接调用 smoothPanTo，内部用 RAF + easeOutCubic 动画，
  // 避免在回调中调用 useVueFlow()（组合式 API 不应在回调内调用）
  zoomModes.smoothPanTo(x, y, { duration: 280 })
  log.debug('[Minimap] smoothPanTo 已触发', {
    x: Math.round(x), y: Math.round(y), zoom: Number(vp.zoom?.toFixed(3)),
  })
}

/* S5-T05 分区折叠/展开全部 + 一键整理 */
function onToggleZonesAll(collapse) {
  if (!canvasZones) return
  if (collapse) canvasZones.collapseAll(); else canvasZones.expandAll()
}

async function onTidyLayout() {
  if (!canvasZones || !rawNodes.value.length) return
  try {
    await ElMessageBox.confirm(
      '一键整理会将所有节点按类型移入 5 个分区并重新网格排列（布局会被覆盖，可手动再调），确认继续？',
      '一键整理布局',
      { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  const tidied = canvasZones.tidyLayout(rawNodes.value, drama.value)
  rawNodes.value = injectViewModeIntoNodes(tidied)
  refreshVisibleNodes(true)
  log.info('[Tidy] 一键整理布局完成', { nodes: tidied.length, zones: 5 })
  ElMessage.success('布局已重新排列，稍后会自动保存到后端')
  // 立即触发布局保存
  scheduleLayoutSave(true)
}

/* ===================== S6-T01 画布搜索 ===================== */
let _searchDebounce = null
function runSearch(immediate = false) {
  if (!canvasSearch) return
  const doSearch = () => {
    canvasSearch.search(rawNodes.value)
    rawNodes.value = canvasSearch.applyHighlight(rawNodes.value)
    refreshVisibleNodes(true)
  }
  if (_searchDebounce) clearTimeout(_searchDebounce)
  if (immediate) { doSearch(); return }
  _searchDebounce = setTimeout(doSearch, 300)
}
function onSearchInput() { runSearch(false) }
function onSearchTypeChange() { runSearch(true) }
function onSearchClear() { runSearch(true) }
function onSearchEnter() {
  if (!canvasSearch) return
  runSearch(true)
  const results = canvasSearch.searchResults.value
  if (results.length) {
    canvasSearch.selectedIndex.value = 0
    canvasSearch.focusNode(results[0], zoomModes, canvasRect.value.w, canvasRect.value.h)
  } else {
    ElMessage.info('未找到匹配节点')
  }
}
function onSearchNext() {
  if (!canvasSearch) return
  canvasSearch.nextMatch()
  const node = canvasSearch.searchResults.value[canvasSearch.selectedIndex.value]
  if (node) canvasSearch.focusNode(node, zoomModes, canvasRect.value.w, canvasRect.value.h)
}
function onSearchPrev() {
  if (!canvasSearch) return
  canvasSearch.prevMatch()
  const node = canvasSearch.searchResults.value[canvasSearch.selectedIndex.value]
  if (node) canvasSearch.focusNode(node, zoomModes, canvasRect.value.w, canvasRect.value.h)
}
function onSearchResultClick(node) {
  if (!node || !canvasSearch) return
  const idx = canvasSearch.searchResults.value.findIndex(n => n.id === node.id)
  if (idx >= 0) canvasSearch.selectedIndex.value = idx
  canvasSearch.focusNode(node, zoomModes, canvasRect.value.w, canvasRect.value.h)
}

/* ===================== S6-T02 视图书签 ===================== */
async function onBookmarkCommand(cmd) {
  if (!canvasBookmarks) return
  if (cmd === 'save') {
    let name = ''
    try {
      const r = await ElMessageBox.prompt('请输入书签名称', '保存当前视口', {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: `视口 ${Math.round(currentViewport.value.zoom * 100)}%`,
        inputPattern: /.+/,
        inputErrorMessage: '名称不能为空',
      })
      name = r.value
    } catch { return }
    const saved = await canvasBookmarks.saveBookmark(props.dramaId, currentViewport.value, name)
    if (saved) ElMessage.success('书签已保存')
    return
  }
  if (cmd === '__empty__') return
  // 数字 id → 跳转
  const bm = canvasBookmarks.bookmarks.value.find(b => String(b.id) === String(cmd))
  if (bm) {
    canvasBookmarks.jumpToBookmark(bm, zoomModes, canvasRect.value.w, canvasRect.value.h)
    log.info('[Bookmark] 跳转到书签', { id: bm.id, name: bm.name })
  }
}
function onDeleteBookmark(id) {
  if (!canvasBookmarks || !id) return
  ElMessageBox.confirm('删除该书签？', '书签管理', {
    confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
  }).then(() => {
    canvasBookmarks.deleteBookmark(id)
  }).catch(() => {})
}

/* ===================== S6-T03 画布标注 ===================== */
async function loadAnnotations() {
  if (!props.dramaId) return
  try {
    const data = await apiJson(`/api/v1/dramas/${props.dramaId}/annotations`)
    const list = Array.isArray(data) ? data : (data?.items || data?.list || [])
    annotations.value = list
  } catch (e) {
    // 后端可能尚未提供该接口，静默处理
    annotations.value = []
  }
}
async function createAnnotation(payload) {
  try {
    const data = await apiJson(`/api/v1/dramas/${props.dramaId}/annotations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (data) annotations.value = [...annotations.value, data]
  } catch (e) {
    ElMessage.error('创建标注失败：' + e.message)
  }
}
async function deleteAnnotation(id) {
  if (!id) return
  try {
    await apiJson(`/api/v1/annotations/${id}`, { method: 'DELETE' })
    annotations.value = annotations.value.filter(a => a.id !== id)
  } catch (e) {
    ElMessage.error('删除标注失败：' + e.message)
  }
}
async function updateAnnotation(id, payload) {
  if (!id) return
  try {
    const data = await apiJson(`/api/v1/annotations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    annotations.value = annotations.value.map(a => a.id === id ? { ...a, ...payload, ...data } : a)
  } catch (e) {
    // 后端可能未实现 PUT，降级为本地更新
    annotations.value = annotations.value.map(a => a.id === id ? { ...a, ...payload } : a)
  }
}
function toggleAnnotation() {
  annotationActive.value = !annotationActive.value
  if (!annotationActive.value) log.debug('[Annotation] 退出标注模式')
}
function onAnnotationClose() {
  annotationActive.value = false
}

/* ===================== S9-T08: 2D/3D 视图切换 ===================== */

/**
 * 切换 2D / 3D 视图模式
 * 切换前保存当前视图状态，切换后恢复目标视图状态
 */
function toggleViewMode() {
  if (viewMode.value === VIEW_MODE.MODE_2D) {
    // 2D → 3D：切换前先保存2D布局
    scheduleLayoutSave(true)
    viewMode.value = VIEW_MODE.MODE_3D
    log.info('[ViewMode] 切换到3D导演台', { dramaId: Number(props.dramaId) })
  } else {
    // 3D → 2D：切换前先保存3D摄像机状态
    save3DStateBeforeSwitch()
    viewMode.value = VIEW_MODE.MODE_2D
    log.info('[ViewMode] 切换到2D画布', { dramaId: Number(props.dramaId) })
    // 切换回2D后触发一次布局保存（包含3D字段）
    nextTick(() => scheduleLayoutSave(true))
  }
}

/**
 * 在切换回2D前保存3D摄像机状态和节点位置
 */
function save3DStateBeforeSwitch() {
  if (director3DRef.value) {
    const layout3D = director3DRef.value.get3DLayout()
    if (layout3D) {
      camera3DState.value = layout3D.camera_3d || null
      savedCameraPreset.value = layout3D.camera_preset || 'free'
    }
  }
}

/**
 * 3D组件请求切换回2D视图（点击"切换到2D画布"按钮）
 */
function on3DViewChange(mode) {
  if (mode === '2d') {
    toggleViewMode()
  }
}

/**
 * 3D节点点击 — 复用2D节点点击逻辑
 */
function on3DNodeClick({ nodeId }) {
  log.debug('[3D] 节点点击', { nodeId })
  // 转换为2D节点点击事件
  const node = rawNodes.value.find(n => n.id === nodeId)
  if (node) {
    onNodeClick({ node })
  }
}

/**
 * 3D节点拖拽 — 位置变更需要同步回2D
 */
function on3DNodeDrag({ nodeId, position3D }) {
  log.debug('[3D] 节点拖拽', { nodeId, x: position3D.x, y: position3D.y })
}

/**
 * 3D节点位置变更（同步回2D画布）
 * ViewSyncManager 通过此回调将3D拖拽位置反推为2D坐标
 */
function on3DPositionChange({ nodeId, x, y }) {
  // 更新 rawNodes 中对应节点的2D位置
  const node = rawNodes.value.find(n => n.id === nodeId)
  if (node && node.position) {
    node.position.x = x
    node.position.y = y
  }
  // 标记布局为脏，触发防抖保存
  layoutDirty.value = true
}

/**
 * 3D摄像机状态变更（机位切换/运镜时触发）
 */
function on3DCameraChange(cameraState) {
  camera3DState.value = cameraState
  savedCameraPreset.value = cameraState?.preset || 'free'
  log.debug('[3D] 摄像机状态变更', { preset: cameraState?.preset })
}

/**
 * S10-T04: 角色站位编排 — 从 rawNodes 中提取角色节点并调用 3D 组件的站位方法
 */
function onArrangeCharacters(pattern) {
  if (!director3DRef.value) {
    log.warn('[3D] arrangeCharacters 失败: director3DRef 不存在')
    return
  }
  // 从 rawNodes 中筛选出类型为 character 的节点
  const characterNodes = rawNodes.value
    .filter(n => n.type === 'character')
    .map(n => ({ nodeId: n.id, data: n.data }))
  log.info('[3D] 角色站位编排', { pattern, characterCount: characterNodes.length, characters: characterNodes.map(c => c.nodeId) })
  if (characterNodes.length === 0) {
    log.warn('[3D] 角色站位编排: 没有找到角色节点')
    return
  }
  const positions = director3DRef.value.arrangeCharacters(characterNodes, pattern)
  log.info('[3D] 角色站位编排完成', { positionsCount: positions?.length ?? 0 })
  layoutDirty.value = true
  scheduleLayoutSave()
}

/**
 * S10-T05: 场景深度预览开关 — 收集场景节点信息并调用 3D 组件方法
 */
function onToggleSceneDepthPreview(enabled) {
  if (!director3DRef.value) {
    log.warn('[3D] toggleSceneDepthPreview 失败: director3DRef 不存在')
    return
  }
  log.info('[3D] 场景深度预览切换', { enabled })
  const state = director3DRef.value.toggleSceneDepthPreview(enabled)
  // 如果启用，添加当前所有场景节点到深度预览中
  if (state) {
    const sceneNodes = rawNodes.value.filter(n => n.type === 'scene')
    log.info('[3D] 加载场景到深度预览', { sceneCount: sceneNodes.length })
    // 注意: 实际上需要根据 drama 的场景数据构造 sceneData 列表传入
    // 这里先调用 toggle，后续的 addScenePlane 需要通过额外逻辑调用
  }
  layoutDirty.value = true
  scheduleLayoutSave()
}

/**
 * S10-T06: 时间轴3D化开关 — 收集分镜节点并调用 3D 组件方法
 */
function onToggleTimeline3D(enabled) {
  if (!director3DRef.value) {
    log.warn('[3D] toggleTimeline3D 失败: director3DRef 不存在')
    return
  }
  // 从 rawNodes 中筛选出类型为 storyboard 的节点
  const storyboardNodes = rawNodes.value
    .filter(n => n.type === 'storyboard')
    .map(n => ({
      nodeId: n.id,
      storyboard_number: n.data?.storyboard_number,
      layer: n.data?.layer || 'main',
    }))
  log.info('[3D] 时间轴3D化切换', { enabled, storyboardCount: storyboardNodes.length })
  director3DRef.value.toggleTimeline3D(enabled, storyboardNodes)
  layoutDirty.value = true
  scheduleLayoutSave()
}

/* ===================== 布局保存 ===================== */
let _lastScheduleAt = 0
const layoutDirty = ref(false)

async function flushLayoutSave() {
  if (!layoutDirty.value || !drama.value) return
  const t0 = Date.now()
  try {
    // 布局保存时，使用**全量 rawNodes**（不能用虚拟化后的 nodes）
    const zc = canvasZones?.zoneCollapsed?.value
    const payload = buildCanvasLayoutPayload(
      rawNodes.value, currentViewport.value,
      savedLayout.value || drama.value?.metadata?.canvas_layout || null,
      { zoneCollapsed: zc, meta: (savedLayout.value?.meta || {}) }
    )

    // S9-T07: 合并 3D 布局字段（view_mode / camera_3d / camera_preset / nodes_3d）
    const existingLayout = savedLayout.value || drama.value?.metadata?.canvas_layout || null
    const layout3D = {}
    // 写入当前视图模式
    layout3D.view_mode = viewMode.value
    // 写入3D摄像机状态
    if (camera3DState.value) {
      layout3D.camera_3d = camera3DState.value
      layout3D.camera_preset = camera3DState.value.preset || savedCameraPreset.value
    } else if (savedCameraPreset.value && savedCameraPreset.value !== 'free') {
      layout3D.camera_preset = savedCameraPreset.value
    }
    // 从 DirectorStage3D 获取3D节点位置
    if (director3DRef.value && viewMode.value === VIEW_MODE.MODE_3D) {
      const d3Layout = director3DRef.value.get3DLayout()
      if (d3Layout?.nodes) {
        layout3D.nodes_3d = d3Layout.nodes
      }
    } else if (existingLayout?.nodes_3d) {
      // 保留已保存的3D节点位置
      layout3D.nodes_3d = existingLayout.nodes_3d
    }
    const mergedPayload = merge3DFieldsIntoPayload(payload, layout3D)

    const nodeCount = mergedPayload?.nodes ? Object.keys(mergedPayload.nodes).length : 0
    const nodes3DCount = mergedPayload?.nodes_3d ? Object.keys(mergedPayload.nodes_3d).length : 0
    log.info('[LayoutSave] 开始保存画布布局到后端', {
      dramaId: drama.value.id, nodes: nodeCount, hasViewport: !!mergedPayload?.viewport,
      viewMode: mergedPayload?.view_mode, cameraPreset: mergedPayload?.camera_preset,
      nodes3D: nodes3DCount,
      debounceMs: Date.now() - _lastScheduleAt,
    })
    await dramaAPI.saveCanvasLayout(drama.value.id, mergedPayload, undefined)
    const ms = Date.now() - t0
    log.info('[LayoutSave] 画布布局保存成功', { dramaId: drama.value.id, nodes: nodeCount, totalMs: ms })
    layoutDirty.value = false
    emit('layout-saved', { ok: true, nodes: nodeCount, totalMs: ms })
  } catch (e) {
    const ms = Date.now() - t0
    log.error('[LayoutSave] 画布布局保存失败（下次拖动将重新触发）', e, {
      dramaId: drama.value?.id ?? null, nodes: rawNodes.value.length, totalMs: ms,
    })
  }
}

function scheduleLayoutSave(immediate) {
  layoutDirty.value = true
  _lastScheduleAt = Date.now()
  if (saveTimer) clearTimeout(saveTimer)
  if (immediate) {
    flushLayoutSave()
    return
  }
  saveTimer = setTimeout(() => {
    log.info('[LayoutSave] 防抖触发 flushLayoutSave', { dramaId: drama.value?.id ?? null, debounceMs: Date.now() - _lastScheduleAt })
    flushLayoutSave()
  }, 900)
}

/* ===================== 对外暴露方法 ===================== */
async function refresh(keepFocus = true) { await loadDrama(true) }
defineExpose({
  refresh,
  getDrama: () => drama.value,
  getSelectedStoryboardIds: () => selectedStoryboardIds.value,
  rebuild: rebuildGraph,
  // Sprint 5 扩展
  zoomModes: () => zoomModes,
  zones: () => canvasZones,
  setZoomLevel: (i) => zoomModes?.setZoomLevel(i),
  // Sprint 6 扩展
  canvasSearch: () => canvasSearch,
  canvasBookmarks: () => canvasBookmarks,
  annotations: () => annotations.value,
  toggleAnnotation,
  // S9 扩展：2D/3D 视图切换
  getViewMode: () => viewMode.value,
  setViewMode: (m) => { if (m === '2d' || m === '3d') { viewMode.value = m } },
  toggleViewMode,
  getDirector3D: () => director3DRef.value,
})

onMounted(() => { loadDrama() })
onBeforeUnmount(() => {
  if (saveTimer) { clearTimeout(saveTimer); flushLayoutSave() }
  if (resizeObserver) resizeObserver.disconnect()
})
</script>

<style scoped>
.wb-canvas {
  position: relative;
  width: 100%; height: 100%;
  background: #0f172a;
  overflow: hidden;
}
.wb-canvas-toolbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 25;
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}
.wct-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wct-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wct-z { opacity: 0.7; font-size: 11px; margin-left: 2px; }
.wct-zoom {
  font-variant-numeric: tabular-nums;
  color: #e2e8f0; font-weight: 600;
  background: rgba(255,255,255,0.04);
  padding: 2px 8px; border-radius: 4px; font-size: 12px;
}
.wb-canvas-main {
  width: 100%; height: 100%;
  padding-top: 52px; /* 为顶栏让出空间 */
  box-sizing: border-box;
  position: relative;
}
.vue-flow-canvas {
  width: 100%; height: 100%;
}

/* ---- S6-T01 搜索 ---- */
.wct-search { width: 220px; }
.wct-search-count {
  color: #22d3ee;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.wct-search-panel {
  position: absolute;
  top: 64px;
  right: 16px;
  z-index: 18;
  width: 260px;
  max-height: 60%;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  pointer-events: auto;
}
.wsp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  user-select: none;
}
.wsp-title { color: #e2e8f0; font-size: 12px; font-weight: 600; }
.wsp-toggle { color: #94a3b8; }
.wsp-body { overflow-y: auto; padding: 4px 0; }
.wsp-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 12px;
}
.wsp-item:hover { background: rgba(255, 255, 255, 0.06); }
.wsp-item.active { background: rgba(34, 211, 238, 0.16); color: #22d3ee; }
.wsp-idx {
  flex: 0 0 20px;
  text-align: center;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.wsp-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsp-empty { padding: 12px; color: #94a3b8; font-size: 12px; text-align: center; }

/* ---- S6-T02 书签 ---- */
.bm-item { display: flex; align-items: center; }
.bm-label { flex: 1; }
.bm-del { color: #94a3b8; margin-left: 8px; }
.bm-del:hover { color: #f87171; }
</style>
