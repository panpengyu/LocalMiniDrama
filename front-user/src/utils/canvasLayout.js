/** 从 drama.metadata 解析画布布局（旧 JSON 无此字段时返回 null） */
export function parseCanvasLayout(metadata) {
  if (metadata == null) return null
  let meta = metadata
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      return null
    }
  }
  if (!meta || typeof meta !== 'object') return null
  return meta.canvas_layout || null
}

/** 合并 metadata 并写入 canvas_layout（阶段 B 使用） */
export function mergeCanvasLayoutIntoMetadata(metadata, canvasLayout) {
  let meta = metadata
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta)
    } catch {
      meta = {}
    }
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
  return {
    ...meta,
    canvas_layout: canvasLayout,
  }
}

/** 读取已保存节点坐标，无则返回 fallback */
export function resolveNodePosition(savedLayout, nodeId, fallback) {
  const saved = savedLayout?.nodes?.[nodeId]
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x, y: saved.y }
  }
  return fallback
}

export function resolveViewport(savedLayout, fallback = { x: 0, y: 0, zoom: 0.75 }) {
  const v = savedLayout?.viewport
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
    return v
  }
  return fallback
}

const NON_DRAGGABLE_TYPES = new Set(['canvasLabel', 'canvasAddButton'])

/** 从当前 Vue Flow 节点与视口构建可持久化的 canvas_layout
 *  @param {Array} flowNodes - 全量节点数组（rawNodes，非虚拟化子集）
 *  @param {{x,y,zoom}} viewport - 当前视口
 *  @param {object|null} existingLayout - 已保存布局，用于继承 nodes / zone_collapsed / meta
 *  @param {object} extras - 扩展字段：zoneCollapsed, meta 等（S5-T05 分区折叠持久化）
 */
export function buildCanvasLayoutPayload(flowNodes, viewport, existingLayout = null, extras = null) {
  const nodes = { ...(existingLayout?.nodes || {}) }
  for (const node of flowNodes || []) {
    if (!node?.id || NON_DRAGGABLE_TYPES.has(node.type)) continue
    if (!node.position) continue
    nodes[node.id] = {
      x: node.position.x,
      y: node.position.y,
    }
  }
  const payload = {
    version: 2,
    viewport: {
      x: Number(viewport?.x) || 0,
      y: Number(viewport?.y) || 0,
      zoom: Number(viewport?.zoom) || 0.75,
    },
    nodes,
    updated_at: new Date().toISOString(),
  }
  // S5-T05: 分区折叠状态写入（如有）
  if (extras?.zoneCollapsed && typeof extras.zoneCollapsed === 'object') {
    payload.zone_collapsed = extras.zoneCollapsed
  } else if (existingLayout?.zone_collapsed) {
    payload.zone_collapsed = existingLayout.zone_collapsed
  }
  // 自定义 meta 合并
  if (extras?.meta && typeof extras.meta === 'object') {
    payload.meta = { ...(existingLayout?.meta || {}), ...extras.meta }
  } else if (existingLayout?.meta) {
    payload.meta = existingLayout.meta
  }
  return payload
}

/** 读取 zone_collapsed（分区折叠状态），无则返回默认全展开 */
export function resolveZoneCollapsed(savedLayout) {
  const zc = savedLayout?.zone_collapsed
  if (zc && typeof zc === 'object') return zc
  return {
    characters: false, scenes: false, props: false, storyboard: false, reference: false,
  }
}

export function parseDramaMetadata(metadata) {
  if (metadata == null) return {}
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata)
    } catch {
      return {}
    }
  }
  return {}
}
