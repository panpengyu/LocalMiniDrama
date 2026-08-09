/**
 * Sprint 6 — S6-T01 画布搜索功能
 *
 * 验收标准：
 *   - 按 searchQuery + searchType(all/name/content/type/status) 过滤节点
 *   - 匹配节点高亮（通过 node.data._searchMatch = true，节点组件自行渲染高亮态）
 *   - 回车跳转到第一个匹配；下一个/上一个循环切换并平滑居中
 *
 * 设计原则：
 *   - 纯前端搜索，不依赖后端
 *   - 不直接修改 rawNodes，由父组件调用 applyHighlight(nodes) 得到新数组后写回
 *   - 坐标变换沿用 VueFlow 约定：screenX = worldX * zoom + vp.x
 */
import { ref, computed } from 'vue'

// 节点类型 → 中文标签（用于"类型"搜索与结果展示）
const TYPE_LABELS = {
  canvasStoryboard: '分镜',
  canvasAsset: '素材',
  canvasEpisode: '集数',
  canvasScript: '剧本',
  canvasMedia: '媒体',
  canvasLabel: '标签',
  canvasDramaHeader: '项目',
  canvasAddButton: '新增',
}
const ASSET_TYPE_LABELS = { char: '角色', scene: '场景', prop: '道具' }

/** 节点主名称（"名称"搜索字段） */
function getNodeName(node) {
  const d = node?.data || {}
  switch (node?.type) {
    case 'canvasStoryboard': return d.title || ''
    case 'canvasAsset': return d.name || ''
    case 'canvasEpisode': return d.title || ''
    case 'canvasScript': return d.title || ''
    case 'canvasMedia': return d.name || ''
    case 'canvasLabel': return d.label || ''
    case 'canvasDramaHeader': return d.title || ''
    default: return d.name || d.title || d.label || ''
  }
}

/** 节点内容文本（"内容"搜索字段：描述/台词/镜号/媒体类型等） */
function getNodeContent(node) {
  const d = node?.data || {}
  const parts = []
  switch (node?.type) {
    case 'canvasStoryboard':
      if (d.description) parts.push(d.description)
      if (d.dialogue) parts.push(d.dialogue)
      if (d.shotType) parts.push(d.shotType)
      if (d.storyboardNumber != null) parts.push('#' + d.storyboardNumber)
      break
    case 'canvasAsset':
      if (d.description) parts.push(d.description)
      break
    case 'canvasEpisode':
      if (d.episodeNumber != null) parts.push('第' + d.episodeNumber + '集')
      if (d.storyboardCount != null) parts.push(d.storyboardCount + '分镜')
      break
    case 'canvasScript':
      if (d.episodeNumber != null) parts.push('第' + d.episodeNumber + '集剧本')
      break
    case 'canvasMedia':
      if (d.mediaType) parts.push(d.mediaType)
      break
    default: break
  }
  return parts.filter(Boolean).join(' ')
}

/** 节点类型文本（"类型"搜索字段） */
function getNodeTypeText(node) {
  const base = TYPE_LABELS[node?.type] || node?.type || ''
  const at = node?.data?.assetType
  if (node?.type === 'canvasAsset' && at) return base + ' ' + (ASSET_TYPE_LABELS[at] || at)
  return base
}

/** 节点状态（"状态"搜索字段） */
function getNodeStatus(node) {
  return node?.data?.status || ''
}

/** 结果展示用摘要（供浮动面板列表显示） */
export function describeNode(node) {
  const name = getNodeName(node) || '(未命名)'
  const t = getNodeTypeText(node)
  return `${t} · ${name}`
}

export function useCanvasSearch() {
  const searchQuery = ref('')
  const searchType = ref('all') // all / name / content / type / status
  const searchResults = ref([])
  const highlightedIds = ref(new Set())
  const selectedIndex = ref(-1)

  const hasResults = computed(() => searchResults.value.length > 0)
  const currentMatch = computed(() =>
    selectedIndex.value >= 0 ? searchResults.value[selectedIndex.value] : null
  )

  /**
   * 按 searchQuery + searchType 过滤节点。
   * 更新 searchResults / highlightedIds / selectedIndex。
   * @param {Array} allNodes - 全量节点数组（rawNodes）
   */
  function search(allNodes) {
    const q = (searchQuery.value || '').trim().toLowerCase()
    if (!q) {
      searchResults.value = []
      highlightedIds.value = new Set()
      selectedIndex.value = -1
      return
    }
    const t = searchType.value
    const results = (allNodes || []).filter((n) => {
      if (t === 'name') return getNodeName(n).toLowerCase().includes(q)
      if (t === 'content') return getNodeContent(n).toLowerCase().includes(q)
      if (t === 'type') {
        return getNodeTypeText(n).toLowerCase().includes(q)
          || (n.type || '').toLowerCase().includes(q)
          || (n.data?.assetType || '').toLowerCase().includes(q)
      }
      if (t === 'status') return getNodeStatus(n).toLowerCase().includes(q)
      // all：名称 / 内容 / 类型 / 状态 任一命中
      return getNodeName(n).toLowerCase().includes(q)
        || getNodeContent(n).toLowerCase().includes(q)
        || getNodeTypeText(n).toLowerCase().includes(q)
        || getNodeStatus(n).toLowerCase().includes(q)
    })
    searchResults.value = results
    highlightedIds.value = new Set(results.map((n) => n.id))
    selectedIndex.value = results.length ? 0 : -1
  }

  /**
   * 给匹配节点加 data._searchMatch = true（非匹配设为 false）。
   * 返回新数组（未变化的节点保持同一引用以减少渲染压力）。
   * @param {Array} nodes
   */
  function applyHighlight(nodes) {
    const ids = highlightedIds.value
    const hasQuery = !!(searchQuery.value || '').trim()
    return (nodes || []).map((n) => {
      const want = hasQuery && ids.has(n.id)
      const cur = !!(n.data && n.data._searchMatch)
      if (want === cur) return n
      return { ...n, data: { ...(n.data || {}), _searchMatch: want } }
    })
  }

  /** 清除搜索状态并剥离高亮标记 */
  function clearHighlight(nodes) {
    return (nodes || []).map((n) => {
      if (!n.data?._searchMatch) return n
      return { ...n, data: { ...n.data, _searchMatch: false } }
    })
  }

  /**
   * 平滑居中到指定节点（调用 zoomModes.smoothFitToNode）
   * @param {Object} node - 需含 position
   * @param {Object} zoomModes - useCanvasZoomModes 返回值
   * @param {number} canvasW
   * @param {number} canvasH
   */
  function focusNode(node, zoomModes, canvasW, canvasH) {
    if (!node || !zoomModes || node.position == null) return
    zoomModes.smoothFitToNode(node, {
      zoom: 0.6,
      duration: 420,
      canvasW: canvasW || 1000,
      canvasH: canvasH || 800,
    })
  }

  /** 下一个匹配（循环） */
  function nextMatch() {
    if (!searchResults.value.length) return
    selectedIndex.value = (selectedIndex.value + 1) % searchResults.value.length
  }

  /** 上一个匹配（循环） */
  function prevMatch() {
    if (!searchResults.value.length) return
    selectedIndex.value =
      (selectedIndex.value - 1 + searchResults.value.length) % searchResults.value.length
  }

  /** 重置搜索（清空 query 时调用） */
  function reset() {
    searchQuery.value = ''
    searchResults.value = []
    highlightedIds.value = new Set()
    selectedIndex.value = -1
  }

  return {
    searchQuery,
    searchType,
    searchResults,
    highlightedIds,
    selectedIndex,
    hasResults,
    currentMatch,
    search,
    applyHighlight,
    clearHighlight,
    focusNode,
    nextMatch,
    prevMatch,
    reset,
  }
}
