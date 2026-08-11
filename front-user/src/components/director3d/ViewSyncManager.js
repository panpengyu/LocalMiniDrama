/**
 * ViewSyncManager — 2D/3D 视图数据双向同步管理器
 *
 * 核心职责：
 * 1. 维护 2D 节点(Vue Flow) 与 3D 对象(Three.js Mesh) 之间的映射关系
 * 2. 当 2D 节点位置变更时，同步更新对应的 3D 对象位置
 * 3. 当 3D 对象被拖拽时，同步更新对应的 2D 节点位置
 * 4. 通过 "脏标记 + 防抖" 机制防止双向同步引发的反馈循环
 *
 * 同步策略：
 *   2D 变更 → 标记 dirty2D → 防抖 50ms → 批量更新 3D → 清除 dirty2D
 *   3D 变更 → 标记 dirty3D → 防抖 50ms → 批量更新 2D → 清除 dirty3D
 *   如果 dirty2D 为真时收到 3D 变更，忽略该 3D 变更（因为它是 2D 同步触发的）
 */

import { estimateNodeCount } from '../../utils/dramaData.js'

// 节点类型到 3D 深度(Z轴)的映射
const NODE_DEPTH_MAP = {
  scene: 200,          // 场景节点 → 背景层
  storyboard: 100,     // 分镜节点 → 中景层
  character: 80,       // 角色节点 → 中景偏前
  prop: 50,            // 道具节点 → 前景层
  script: 30,          // 脚本节点 → 前景层
  episode: 250,        // 集数节点 → 最远层
  canvasLabel: 20,     // 标签节点 → 最近层
}

// 节点类型到层级分组的映射
const NODE_LAYER_MAP = {
  scene: 'background',
  episode: 'background',
  storyboard: 'midground',
  character: 'midground',
  prop: 'foreground',
  script: 'foreground',
  canvasLabel: 'foreground',
}

export class ViewSyncManager {
  /**
   * @param {Object} options
   * @param {Function} options.getNodes - 获取当前2D节点列表的函数
   * @param {Function} options.updateNodePosition - 更新2D节点位置的函数 (id, x, y) => void
   * @param {Function} options.on3DNodeAdded - 3D节点添加回调 (nodeData) => Mesh
   * @param {Function} options.on3DNodeRemoved - 3D节点移除回调 (nodeId) => void
   * @param {Function} options.on3DNodeUpdated - 3D节点位置更新回调 (nodeId, position3D) => void
   * @param {Number} options.debounceMs - 防抖延迟(毫秒)，默认 50ms
   */
  constructor(options) {
    this.getNodes = options.getNodes
    this.updateNodePosition = options.updateNodePosition
    this.on3DNodeAdded = options.on3DNodeAdded
    this.on3DNodeRemoved = options.on3DNodeRemoved
    this.on3DNodeUpdated = options.on3DNodeUpdated
    this.debounceMs = options.debounceMs ?? 50

    // 核心映射表: nodeId → { mesh, position2D, position3D, type, data }
    this.nodeMap = new Map()

    // 脏标记 — 防止反馈循环的关键
    this.dirty2D = false    // 2D 有变更待同步到 3D
    this.dirty3D = false    // 3D 有变更待同步到 2D
    this.syncing = false    // 正在执行同步（同步期间忽略变更事件）

    // 防抖定时器
    this._debounce2DTimer = null
    this._debounce3DTimer = null

    // 待处理的变更队列（批量同步）
    this._pending2DChanges = new Set()
    this._pending3DChanges = new Set()
  }

  // ===========================================================================
  // 2D → 3D 同步（Vue Flow 节点变更触发）
  // ===========================================================================

  /**
   * 当 2D 画布节点位置变更时调用
   * @param {String} nodeId - 节点ID
   * @param {Object} position2D - 新的2D位置 { x, y }
   */
  on2DPositionChange(nodeId, position2D) {
    if (this.syncing) return // 同步过程中忽略，防止回环

    const entry = this.nodeMap.get(nodeId)
    if (!entry) return

    entry.position2D = { ...position2D }
    this._pending2DChanges.add(nodeId)
    this.dirty2D = true

    this._schedule2DSync()
  }

  /**
   * 当 2D 画布节点被添加时调用
   * @param {Object} node - Vue Flow 节点对象 { id, type, position, data }
   */
  on2DNodeAdded(node) {
    if (this.syncing) return
    if (this.nodeMap.has(node.id)) return

    const position3D = this._compute3DPosition(node.type, node.position)
    const entry = {
      nodeId: node.id,
      type: node.type,
      data: node.data,
      position2D: { ...node.position },
      position3D,
      mesh: null,
      layer: NODE_LAYER_MAP[node.type] || 'midground',
    }

    // 调用回调创建3D对象
    if (this.on3DNodeAdded) {
      entry.mesh = this.on3DNodeAdded({
        nodeId: node.id,
        type: node.type,
        data: node.data,
        position3D,
        layer: entry.layer,
      })
    }

    this.nodeMap.set(node.id, entry)
  }

  /**
   * 当 2D 画布节点被移除时调用
   * @param {String} nodeId - 节点ID
   */
  on2DNodeRemoved(nodeId) {
    if (this.syncing) return

    const entry = this.nodeMap.get(nodeId)
    if (!entry) return

    if (this.on3DNodeRemoved) {
      this.on3DNodeRemoved(nodeId)
    }

    this.nodeMap.delete(nodeId)
  }

  /**
   * 当 2D 画布节点数据变更时调用（如图片生成完成）
   * @param {String} nodeId - 节点ID
   * @param {Object} data - 新的节点数据
   */
  on2DDataChange(nodeId, data) {
    if (this.syncing) return

    const entry = this.nodeMap.get(nodeId)
    if (!entry) return

    entry.data = data

    // 数据变更可能需要更新3D对象的纹理
    if (this.on3DNodeUpdated) {
      this.on3DNodeUpdated(nodeId, { data })
    }
  }

  // ===========================================================================
  // 3D → 2D 同步（Three.js 对象拖拽触发）
  // ===========================================================================

  /**
   * 当 3D 对象位置变更时调用（用户在3D空间中拖拽节点）
   * @param {String} nodeId - 节点ID
   * @param {Object} position3D - 新的3D位置 { x, y, z }
   */
  on3DPositionChange(nodeId, position3D) {
    // 关键：如果当前正在从 2D 同步到 3D，忽略此 3D 变更
    // 因为这个 3D 变更是 2D 同步触发的，不能再同步回去（否则循环）
    if (this.syncing || this.dirty2D) return

    const entry = this.nodeMap.get(nodeId)
    if (!entry) return

    entry.position3D = { ...position3D }

    // 从 3D 位置反推 2D 位置（X/Y 轴直接映射，Z 轴忽略）
    const position2D = {
      x: position3D.x,
      y: position3D.y,
    }
    entry.position2D = position2D

    this._pending3DChanges.add(nodeId)
    this.dirty3D = true

    this._schedule3DSync()
  }

  /**
   * 当 3D 对象的 Z 轴深度变更时调用（用户调整节点层级）
   * @param {String} nodeId - 节点ID
   * @param {Number} z - 新的Z深度值
   */
  on3DDepthChange(nodeId, z) {
    if (this.syncing) return

    const entry = this.nodeMap.get(nodeId)
    if (!entry) return

    entry.position3D.z = z

    // Z 轴变更不需要同步到 2D（2D 没有 Z 维度）
    // 但需要持久化到 canvas_layout 的 nodes[nodeId].z 字段
    // 这个由调用方处理
  }

  // ===========================================================================
  // 批量同步逻辑（防抖触发）
  // ===========================================================================

  /**
   * 调度 2D→3D 同步（防抖）
   */
  _schedule2DSync() {
    if (this._debounce2DTimer) {
      clearTimeout(this._debounce2DTimer)
    }

    this._debounce2DTimer = setTimeout(() => {
      this._flush2DTo3D()
    }, this.debounceMs)
  }

  /**
   * 执行 2D→3D 批量同步
   */
  _flush2DTo3D() {
    if (this._pending2DChanges.size === 0) {
      this.dirty2D = false
      return
    }

    this.syncing = true // 标记同步中，阻止 3D 变更回环

    const nodeIds = Array.from(this._pending2DChanges)
    this._pending2DChanges.clear()

    for (const nodeId of nodeIds) {
      const entry = this.nodeMap.get(nodeId)
      if (!entry || !entry.mesh) continue

      // 将 2D 坐标转换为 3D 坐标
      const target3D = this._compute3DPosition(entry.type, entry.position2D)

      // 保持原有的 Z 深度不变（2D 变更不改变深度）
      target3D.z = entry.position3D.z

      entry.position3D = target3D

      // 更新 Three.js Mesh 位置
      if (this.on3DNodeUpdated) {
        this.on3DNodeUpdated(nodeId, { position3D: target3D })
      }
    }

    this.dirty2D = false
    this.syncing = false
  }

  /**
   * 调度 3D→2D 同步（防抖）
   */
  _schedule3DSync() {
    if (this._debounce3DTimer) {
      clearTimeout(this._debounce3DTimer)
    }

    this._debounce3DTimer = setTimeout(() => {
      this._flush3DTo2D()
    }, this.debounceMs)
  }

  /**
   * 执行 3D→2D 批量同步
   */
  _flush3DTo2D() {
    if (this._pending3DChanges.size === 0) {
      this.dirty3D = false
      return
    }

    this.syncing = true // 标记同步中，阻止 2D 变更回环

    const nodeIds = Array.from(this._pending3DChanges)
    this._pending3DChanges.clear()

    for (const nodeId of nodeIds) {
      const entry = this.nodeMap.get(nodeId)
      if (!entry) continue

      // 将 3D 坐标转换为 2D 坐标（仅 X/Y 轴）
      const position2D = {
        x: entry.position3D.x,
        y: entry.position3D.y,
      }

      entry.position2D = position2D

      // 更新 Vue Flow 节点位置
      if (this.updateNodePosition) {
        this.updateNodePosition(nodeId, position2D.x, position2D.y)
      }
    }

    this.dirty3D = false
    this.syncing = false
  }

  // ===========================================================================
  // 坐标转换工具
  // ===========================================================================

  /**
   * 根据 2D 坐标和节点类型计算 3D 坐标
   * X 轴: 水平位置（与 2D 一致）
   * Y 轴: 垂直位置（与 2D 一致）
   * Z 轴: 深度（根据节点类型决定）
   *
   * @param {String} nodeType - 节点类型
   * @param {Object} position2D - 2D 坐标 { x, y }
   * @returns {Object} 3D 坐标 { x, y, z }
   */
  _compute3DPosition(nodeType, position2D) {
    return {
      x: position2D.x,
      y: position2D.y,
      z: NODE_DEPTH_MAP[nodeType] ?? 100,
    }
  }

  /**
   * 全量重建映射表（切换到3D模式时调用）
   * @param {Array} nodes - 全部2D节点列表（可为 null/undefined，内部兜底为 []）
   */
  rebuildFrom2D(nodes, opts) {
    nodes = nodes || []
    const t0 = performance.now()
    const rawCount = nodes.length
    const prevSize = this.nodeMap.size
    const drama = opts?.drama ?? null

    // 按节点类型分组统计（输入侧）
    const typeIn = {}
    for (const n of nodes) { typeIn[n.type] = (typeIn[n.type] || 0) + 1 }

    const expected = estimateNodeCount(drama)
    console.log(`[DIR-3D] rebuildFrom2D START`, {
      rawNodeCount: rawCount,
      prevNodeMapSize: prevSize,
      expectedEstimate: expected,
      typesIn: typeIn,
      hasDrama: !!drama,
      dramaId: drama?.id ?? null,
      inputNodesNull: nodes === null,
      performanceMark: 'before-clear',
    })

    this.syncing = true

    // 清空现有映射
    this.nodeMap.clear()
    this._pending2DChanges.clear()
    this._pending3DChanges.clear()
    this.dirty2D = false
    this.dirty3D = false

    // 从2D节点列表重建
    let added = 0
    for (const node of nodes) {
      this.on2DNodeAdded(node)
      added++
    }

    // 按节点类型分组统计（输出侧）
    const typeOut = {}
    for (const entry of this.nodeMap.values()) {
      typeOut[entry.type] = (typeOut[entry.type] || 0) + 1
    }
    const actual = this.nodeMap.size
    const diff = expected - actual
    const match = expected === 0 || expected === actual

    console.log(`[DIR-3D] rebuildFrom2D DONE`, {
      added,
      actualSize: actual,
      expectedEstimate: expected,
      diff: diff,
      match,
      typesOut: typeOut,
      durationMs: Math.round((performance.now() - t0) * 1000) / 1000,
      pending2D: this._pending2DChanges.size,
      pending3D: this._pending3DChanges.size,
    })
    if (diff !== 0 && expected !== 0) {
      console.warn(`[DIR-3D] rebuildFrom2D 节点数不匹配: expected=${expected} actual=${actual} diff=${diff}`, {
        typesIn: typeIn,
        typesOut: typeOut,
      })
    }

    this.syncing = false
  }

  /**
   * 获取所有节点的3D布局数据（用于持久化到 canvas_layout）
   * @returns {Object} 布局数据 { nodes: { [id]: { x, y, z, layer } }, camera_3d: {...} }
   */
  serialize3DLayout() {
    const nodes = {}
    for (const [nodeId, entry] of this.nodeMap) {
      nodes[nodeId] = {
        x: entry.position3D.x,
        y: entry.position3D.y,
        z: entry.position3D.z,
        layer: entry.layer,
      }
    }
    return { nodes }
  }

  /**
   * 从持久化的3D布局数据恢复
   * @param {Object} layout3D - 3D布局数据
   * @param {Array} currentNodes - 当前2D节点列表
   */
  restore3DLayout(layout3D, currentNodes) {
    const t0 = performance.now()
    const hasLayoutNodes = !!(layout3D?.nodes)
    currentNodes = currentNodes || []
    const savedCount = hasLayoutNodes ? Object.keys(layout3D.nodes).length : 0
    const currentNodeCount = currentNodes.length

    console.log(`[DIR-3D] restore3DLayout START`, {
      hasLayoutNodes,
      savedNodeCount: savedCount,
      currentNodeCount,
      preNodeMapSize: this.nodeMap.size,
      hasViewport: !!layout3D?.viewport,
      hasCamera3d: !!layout3D?.camera_3d,
    })

    if (!hasLayoutNodes) {
      console.log(`[DIR-3D] restore3DLayout SKIP (no layout3D.nodes)`, { durationMs: performance.now() - t0 })
      return
    }

    this.syncing = true

    let restored = 0
    let skippedNotFound = 0
    const layers = { set: 0, inherit: 0 }
    for (const node of currentNodes) {
      const saved = layout3D.nodes[node.id]
      if (saved) {
        const entry = this.nodeMap.get(node.id)
        if (entry) {
          entry.position3D = { x: saved.x, y: saved.y, z: saved.z }
          if (saved.layer) { entry.layer = saved.layer; layers.set++ } else { layers.inherit++ }
          restored++
        } else {
          skippedNotFound++
        }
      }
    }

    console.log(`[DIR-3D] restore3DLayout DONE`, {
      restored,
      skippedNotFound,
      layers,
      postNodeMapSize: this.nodeMap.size,
      durationMs: Math.round((performance.now() - t0) * 1000) / 1000,
    })
    if (skippedNotFound > 0) {
      console.warn(`[DIR-3D] restore3DLayout 有 ${skippedNotFound} 条节点在 nodeMap 中未找到（可能 rebuildFrom2D 阶段未被正确加入）`)
    }

    this.syncing = false
  }

  /**
   * 校验 3D 场景节点数与 drama 估算节点数是否一致（用于 2D/3D 同步完整性检查）
   * @param {object|null} drama - drama 对象（可为 null）
   * @returns {{ expected: number, actual: number, match: boolean }}
   */
  validateAgainstDrama(drama) {
    const expected = estimateNodeCount(drama)
    const actual = this.nodeMap.size
    const match = expected === 0 || expected === actual
    if (!match) {
      console.warn(`[DIR-3D] validateAgainstDrama MISMATCH`, {
        expected, actual, diff: expected - actual,
        dramaId: drama?.id ?? null,
        hasDrama: !!drama,
      })
    } else {
      console.log(`[DIR-3D] validateAgainstDrama OK`, {
        expected, actual,
        dramaId: drama?.id ?? null,
        hasDrama: !!drama,
      })
    }
    return { expected, actual, match }
  }

  /**
   * 销毁管理器，清理资源
   */
  destroy() {
    if (this._debounce2DTimer) clearTimeout(this._debounce2DTimer)
    if (this._debounce3DTimer) clearTimeout(this._debounce3DTimer)
    this.nodeMap.clear()
    this._pending2DChanges.clear()
    this._pending3DChanges.clear()
  }
}

export default ViewSyncManager
