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

// ===========================================================================
// S9-T07: 3D 导演台布局字段扩展
// ===========================================================================

/** 视图模式枚举 */
export const VIEW_MODE = Object.freeze({ MODE_2D: '2d', MODE_3D: '3d' })

/** 合法视图模式集合 */
const VALID_VIEW_MODES = new Set(['2d', '3d'])

/** 合法预设机位集合（与 CameraController.js CAMERA_PRESETS 保持一致） */
const VALID_CAMERA_PRESETS = new Set([
  'front', 'side', 'top', 'free', 'close_up', 'bird_view',
])

/**
 * 节点类型 → 3D Z 轴深度默认值（与 ViewSyncManager.js NODE_DEPTH_MAP 保持一致）
 * 用于旧数据无 z 字段时回退
 */
export const NODE_DEPTH_DEFAULTS = Object.freeze({
  scene: 200,        // 背景层
  episode: 250,      // 最远层
  storyboard: 100,   // 中景层
  character: 80,     // 中景偏前
  prop: 50,          // 前景层
  script: 30,        // 前景层
  canvasLabel: 20,   // 最近层
})

/** 节点类型 → 层级分组（与 ViewSyncManager.js NODE_LAYER_MAP 保持一致） */
export const NODE_LAYER_DEFAULTS = Object.freeze({
  scene: 'background',
  episode: 'background',
  storyboard: 'midground',
  character: 'midground',
  prop: 'foreground',
  script: 'foreground',
  canvasLabel: 'foreground',
})

/**
 * 读取视图模式
 * @param {Object|null} savedLayout - 已保存布局
 * @param {String} fallback - 默认值，'2d'
 * @returns {String} '2d' | '3d'
 */
export function resolveViewMode(savedLayout, fallback = '2d') {
  const vm = savedLayout?.view_mode
  return VALID_VIEW_MODES.has(vm) ? vm : fallback
}

/**
 * 读取 3D 摄像机状态
 * @param {Object|null} savedLayout - 已保存布局
 * @param {Object|null} fallback - 默认摄像机状态
 * @returns {Object|null} { position:{x,y,z}, target:{x,y,z}, fov, preset }
 */
export function resolveCamera3D(savedLayout, fallback = null) {
  const cam = savedLayout?.camera_3d
  if (!cam || typeof cam !== 'object') return fallback
  // 基本结构校验
  const pos = cam.position
  const tgt = cam.target
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)
    && tgt && Number.isFinite(tgt.x) && Number.isFinite(tgt.y) && Number.isFinite(tgt.z)) {
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      target: { x: tgt.x, y: tgt.y, z: tgt.z },
      fov: Number.isFinite(cam.fov) ? cam.fov : 50,
      preset: VALID_CAMERA_PRESETS.has(cam.preset) ? cam.preset : 'free',
    }
  }
  return fallback
}

/**
 * 读取预设机位名称
 * @param {Object|null} savedLayout - 已保存布局
 * @param {String} fallback - 默认机位 'free'
 * @returns {String} 机位名称
 */
export function resolveCameraPreset(savedLayout, fallback = 'free') {
  const cp = savedLayout?.camera_preset
  return VALID_CAMERA_PRESETS.has(cp) ? cp : fallback
}

/**
 * 读取节点 3D 位置（含 Z 深度），无则根据节点类型推断默认深度
 * @param {Object|null} savedLayout - 已保存布局
 * @param {String} nodeId - 节点ID
 * @param {String} nodeType - 节点类型（用于推断默认 Z 深度）
 * @param {Object} fallback2D - 2D 回退坐标 { x, y }
 * @returns {Object} 3D 坐标 { x, y, z, layer }
 */
export function resolveNode3DPosition(savedLayout, nodeId, nodeType, fallback2D) {
  const saved = savedLayout?.nodes?.[nodeId]
  const x = (saved && Number.isFinite(saved.x)) ? saved.x : (fallback2D?.x ?? 0)
  const y = (saved && Number.isFinite(saved.y)) ? saved.y : (fallback2D?.y ?? 0)
  // Z 深度：优先使用已保存值，否则按节点类型取默认值
  const z = (saved && Number.isFinite(saved.z))
    ? saved.z
    : (NODE_DEPTH_DEFAULTS[nodeType] ?? 100)
  // 层级：优先使用已保存值，否则按节点类型取默认值
  const layer = (saved && saved.layer)
    ? saved.layer
    : (NODE_LAYER_DEFAULTS[nodeType] ?? 'midground')
  return { x, y, z, layer }
}

/**
 * 构建可持久化的 3D 布局数据（由 DirectorStage3D 调用）
 * @param {Object} params
 * @param {Object} params.camera3D - 3D摄像机状态 { position, target, fov, preset }
 * @param {Object} params.nodes3D - 3D节点位置表 { [nodeId]: { x, y, z, layer } }
 * @param {String} params.viewMode - 视图模式 '3d'
 * @param {Object|null} existingLayout - 已保存布局（用于继承 2D 字段）
 * @returns {Object} 3D 布局数据片段（可合并到 canvas_layout）
 */
export function build3DLayoutPayload({ camera3D, nodes3D, viewMode = '3d' }, existingLayout = null) {
  const payload = {
    view_mode: VALID_VIEW_MODES.has(viewMode) ? viewMode : '3d',
    camera_3d: null,
    camera_preset: null,
    nodes_3d: {},
  }

  // 摄像机状态
  if (camera3D && typeof camera3D === 'object') {
    const pos = camera3D.position
    const tgt = camera3D.target
    if (pos && tgt) {
      payload.camera_3d = {
        position: {
          x: Number(pos.x) || 0,
          y: Number(pos.y) || 0,
          z: Number(pos.z) || 0,
        },
        target: {
          x: Number(tgt.x) || 0,
          y: Number(tgt.y) || 0,
          z: Number(tgt.z) || 0,
        },
        fov: Number.isFinite(camera3D.fov) ? camera3D.fov : 50,
        preset: VALID_CAMERA_PRESETS.has(camera3D.preset) ? camera3D.preset : 'free',
      }
      payload.camera_preset = payload.camera_3d.preset
    }
  }

  // 节点 3D 位置
  if (nodes3D && typeof nodes3D === 'object') {
    for (const [nodeId, pos] of Object.entries(nodes3D)) {
      if (!pos || typeof pos !== 'object') continue
      payload.nodes_3d[nodeId] = {
        x: Number(pos.x) || 0,
        y: Number(pos.y) || 0,
        z: Number.isFinite(pos.z) ? pos.z : 100,
        layer: pos.layer || 'midground',
      }
    }
  }

  // 继承已有 2D 字段（viewport / nodes / zone_collapsed），保证切换回 2D 时不丢失
  if (existingLayout) {
    if (existingLayout.viewport) payload.viewport = existingLayout.viewport
    if (existingLayout.nodes) payload.nodes = existingLayout.nodes
    if (existingLayout.zone_collapsed) payload.zone_collapsed = existingLayout.zone_collapsed
    if (existingLayout.meta) payload.meta = existingLayout.meta
  }

  return payload
}

/**
 * 将 3D 布局字段合并到现有 canvas_layout payload
 * 用于 2D/3D 切换时保存完整布局（2D + 3D 字段共存）
 * @param {Object} payload - 原 canvas_layout payload
 * @param {Object} layout3D - 3D 布局数据
 * @returns {Object} 合并后的 payload
 */
export function merge3DFieldsIntoPayload(payload, layout3D) {
  if (!payload || typeof payload !== 'object') return payload
  if (!layout3D || typeof layout3D !== 'object') return payload

  const merged = { ...payload }

  if (VALID_VIEW_MODES.has(layout3D.view_mode)) {
    merged.view_mode = layout3D.view_mode
  }
  if (layout3D.camera_3d) {
    merged.camera_3d = layout3D.camera_3d
  }
  if (layout3D.camera_preset && VALID_CAMERA_PRESETS.has(layout3D.camera_preset)) {
    merged.camera_preset = layout3D.camera_preset
  }
  // 合并 nodes_3d（3D 专属节点位置，与 2D nodes 并存）
  if (layout3D.nodes_3d && typeof layout3D.nodes_3d === 'object') {
    merged.nodes_3d = { ...(merged.nodes_3d || {}), ...layout3D.nodes_3d }
  }

  return merged
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
