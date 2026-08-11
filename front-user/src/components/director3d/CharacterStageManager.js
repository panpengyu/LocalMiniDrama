/**
 * CharacterStageManager — 3D 导演台角色站位编排管理器
 *
 * 核心职责：
 * 1. 将角色以 3D 卡片形式排列在场景空间中（line/arc/circle/facing 四种模式）
 * 2. 规划角色走位路径（waypoints），以虚线显示
 * 3. 绘制角色之间的互动关系连线（dialogue/conflict/ally 三种类型，不同颜色）
 * 4. 序列化当前编排数据，用于持久化
 *
 * 依赖：
 *   - three.js (THREE)
 *   - ViewSyncManager.nodeMap (Map<nodeId, { position3D, mesh, ... }>)
 */

import * as THREE from 'three'

// 站位排列模式
const STAGE_PATTERNS = {
  LINE: 'line',       // 一字排开
  ARC: 'arc',         // 弧形站位
  CIRCLE: 'circle',   // 环形站位
  FACING: 'facing',   // 对面对面
}

// 关系类型 → 连线颜色映射
const RELATION_COLORS = {
  dialogue: 0x4f9cf9,  // 对话 - 蓝色
  conflict: 0xef4444,  // 冲突 - 红色
  ally: 0x10b981,      // 结盟 - 绿色
}

// 走位路径虚线颜色
const WAYPOINT_COLOR = 0xffaa00  // 橙色

export class CharacterStageManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene - Three.js 场景对象
   * @param {Map} options.nodeMap - ViewSyncManager.nodeMap 的引用
   *   Map<nodeId, { nodeId, type, data, position2D, position3D, mesh, layer }>
   */
  constructor(options) {
    this.scene = options.scene
    this.nodeMap = options.nodeMap
    this.pattern = STAGE_PATTERNS.LINE
    this.spacing = 5          // 角色间距
    this.arcRadius = 10       // 弧形半径
    this.circleRadius = 8     // 环形半径

    // 互动关系连线组
    this.relationLines = new THREE.Group()
    this.relationLines.name = 'character_relations'
    this.scene.add(this.relationLines)

    // 走位路径线
    this.waypointLines = new THREE.Group()
    this.waypointLines.name = 'character_waypoints'
    this.scene.add(this.waypointLines)

    // 最近一次排列的位置映射（用于持久化 & 关系连线绘制）
    this.lastPositions = new Map()
    // 最近一次的关系列表（排列变更后需要重绘）
    this.lastRelations = []
  }

  // ===========================================================================
  // 站位排列
  // ===========================================================================

  /**
   * 按 pattern 排列角色
   * @param {Array} characters - 角色列表 [{ nodeId, data: { name, ... } }]
   * @param {String} pattern - STAGE_PATTERNS 的值
   * @param {Object} options - 排列选项
   *   { spacing, arcRadius, circleRadius, centerX, centerY, centerZ }
   * @returns {Array} 排列结果 [{ nodeId, position: { x, y, z } }]
   */
  arrange(characters, pattern, options = {}) {
    const list = characters || []
    const count = list.length

    console.log(`[CharacterStageManager] arrange START`, {
      pattern: pattern || this.pattern,
      characterCount: count,
      characterIds: list.map(c => c.nodeId),
      options: {
        spacing: options.spacing,
        arcRadius: options.arcRadius,
        circleRadius: options.circleRadius,
        centerX: options.centerX,
        centerY: options.centerY,
        centerZ: options.centerZ,
      },
    })

    // 角色数量不足时的友好提示
    if (count < 2) {
      const patternName = pattern || this.pattern
      if (count === 0) {
        console.warn(
          `[CharacterStageManager] arrange SKIP — 无法进行站位编排：当前没有可编排的角色节点（角色数量 = 0）。\n` +
          `  · 原因：画布中不存在 type='character' 的节点。\n` +
          `  · 说明：角色节点只有在被分镜（storyboard）引用后才会出现在 3D 舞台上。\n` +
          `  · 解决：请先在项目中创建角色，并让至少一个分镜引用这些角色，然后重试「${patternName}」站位编排。`
        )
        return []
      }

      // count === 1
      console.warn(
        `[CharacterStageManager] arrange SKIP — 无法进行站位编排：仅有 1 个角色节点（角色数量 = 1）。\n` +
        `  · 原因：站位编排需要在多个角色之间计算相对位置，「${patternName}」模式至少需要 2 个角色才能展现排列效果。\n` +
        `  · 当前角色：${list[0].nodeId}（已单独放置到舞台中心，但未执行排列）。\n` +
        `  · 解决：请再添加至少 1 个角色节点（并确保被分镜引用）后重试。`
      )
      // 单个角色仍然设置位置（放在中心点），但不执行排列逻辑
      const singlePos = { x: options.centerX ?? 0, y: options.centerY ?? 0, z: options.centerZ ?? 0 }
      const entry = this.nodeMap.get(list[0].nodeId)
      if (entry) {
        entry.position3D = { ...singlePos }
        if (entry.mesh) entry.mesh.position.set(singlePos.x, singlePos.y, singlePos.z)
      }
      this.lastPositions = new Map([[list[0].nodeId, { ...singlePos }]])
      return [{ nodeId: list[0].nodeId, position: singlePos }]
    }

    // 更新排列参数（若调用方提供则覆盖实例默认值）
    if (pattern) this.pattern = pattern
    if (typeof options.spacing === 'number') this.spacing = options.spacing
    if (typeof options.arcRadius === 'number') this.arcRadius = options.arcRadius
    if (typeof options.circleRadius === 'number') this.circleRadius = options.circleRadius

    const centerX = options.centerX ?? 0
    const centerY = options.centerY ?? 0
    const centerZ = options.centerZ ?? 0

    // 根据当前 pattern 计算位置
    let positions = []
    switch (this.pattern) {
      case STAGE_PATTERNS.LINE:
        positions = this._calcLinePositions(count, this.spacing, centerX)
        console.log(`[CharacterStageManager] _calcLinePositions RESULT`, {
          count,
          spacing: this.spacing,
          centerX,
          positions: positions.map((p, i) => ({ idx: i, x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2) })),
        })
        break
      case STAGE_PATTERNS.ARC:
        positions = this._calcArcPositions(count, this.arcRadius, centerX, centerZ)
        console.log(`[CharacterStageManager] _calcArcPositions RESULT`, {
          count,
          arcRadius: this.arcRadius,
          centerX,
          centerZ,
          positions: positions.map((p, i) => ({ idx: i, x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2) })),
        })
        break
      case STAGE_PATTERNS.CIRCLE:
        positions = this._calcCirclePositions(count, this.circleRadius, centerX, centerZ)
        console.log(`[CharacterStageManager] _calcCirclePositions RESULT`, {
          count,
          circleRadius: this.circleRadius,
          centerX,
          centerZ,
          positions: positions.map((p, i) => ({ idx: i, x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2) })),
        })
        break
      case STAGE_PATTERNS.FACING:
        positions = this._calcFacingPositions(count, this.spacing, centerX, centerZ)
        console.log(`[CharacterStageManager] _calcFacingPositions RESULT`, {
          count,
          spacing: this.spacing,
          centerX,
          centerZ,
          positions: positions.map((p, i) => ({ idx: i, x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2) })),
        })
        break
      default:
        positions = this._calcLinePositions(count, this.spacing, centerX)
    }

    // 应用 centerY（角色整体高度偏移）
    if (centerY !== 0) {
      for (const pos of positions) {
        pos.y = centerY
      }
      console.log(`[CharacterStageManager] apply centerY offset`, { centerY, positionsAfter: positions.map(p => ({ y: p.y.toFixed(2) })) })
    }

    // 更新 nodeMap 中角色的 3D 位置（position3D + mesh.position）
    const result = []
    this.lastPositions = new Map()
    const nodeMapUpdates = []
    for (let i = 0; i < count; i++) {
      const { nodeId } = list[i]
      const pos = positions[i]
      const entry = this.nodeMap.get(nodeId)
      const hadEntry = !!entry
      const hadMesh = !!(entry && entry.mesh)
      if (entry) {
        entry.position3D = { x: pos.x, y: pos.y, z: pos.z }
        if (entry.mesh) {
          entry.mesh.position.set(pos.x, pos.y, pos.z)
        }
      }
      this.lastPositions.set(nodeId, { x: pos.x, y: pos.y, z: pos.z })
      result.push({ nodeId, position: { x: pos.x, y: pos.y, z: pos.z } })
      nodeMapUpdates.push({ nodeId, hadEntry, hadMesh, pos: `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})` })
    }
    console.log(`[CharacterStageManager] nodeMap position updates`, { updates: nodeMapUpdates })

    // 排列变更后，清除并重绘互动关系连线（位置已更新）
    if (this.lastRelations.length > 0) {
      console.log(`[CharacterStageManager] arrangement changed, redrawing relations`, { relationCount: this.lastRelations.length })
      this.drawRelations(this.lastRelations)
    }

    console.log(`[CharacterStageManager] arrange END`, {
      finalPattern: this.pattern,
      resultCount: result.length,
      positions: result.map(r => ({ nodeId: r.nodeId, x: r.position.x.toFixed(2), y: r.position.y.toFixed(2), z: r.position.z.toFixed(2) })),
    })
    return result
  }

  /**
   * 计算线形排列位置
   * 角色以 spacing 间距沿 X 轴一字排开，以 centerX 为中心，Y=0、Z=0
   * @param {Number} count - 角色数量
   * @param {Number} spacing - 角色间距
   * @param {Number} centerX - X 方向中心
   * @returns {Array} 位置列表 [{ x, y, z }]
   */
  _calcLinePositions(count, spacing, centerX) {
    const positions = []
    if (count <= 0) return positions
    // 起始 X：使整排以 centerX 为中心
    const startX = centerX - ((count - 1) * spacing) / 2
    for (let i = 0; i < count; i++) {
      positions.push({
        x: startX + i * spacing,
        y: 0,
        z: 0,
      })
    }
    return positions
  }

  /**
   * 计算弧形排列位置
   * 角色在半径 radius 的弧线上均匀分布，弧度从 -60° 到 +60°（共 120°）
   * 弧线位于 XZ 平面：中间角色在 (centerX, 0, centerZ)，两端向 -Z 方向后撤
   * （即弧线凸向 +Z，面向摄像机）
   * @param {Number} count - 角色数量
   * @param {Number} radius - 弧形半径
   * @param {Number} centerX - 弧线中心 X
   * @param {Number} centerZ - 中间角色 Z（弧线凸向 +Z 一侧）
   * @returns {Array} 位置列表 [{ x, y, z }]
   */
  _calcArcPositions(count, radius, centerX, centerZ) {
    const positions = []
    if (count <= 0) return positions
    // 单个角色时角度为 0（位于弧线中点）
    if (count === 1) {
      positions.push({ x: centerX, y: 0, z: centerZ })
      return positions
    }
    // 角度范围：-60° ~ +60°（弧度 -π/3 ~ +π/3）
    const startAngle = -Math.PI / 3
    const endAngle = Math.PI / 3
    const span = endAngle - startAngle
    for (let i = 0; i < count; i++) {
      const angle = startAngle + (span * i) / (count - 1)
      positions.push({
        x: centerX + radius * Math.sin(angle),
        y: 0,
        // 中间角色 z=centerZ（最靠前），两端 z=centerZ - radius/2（向后撤）
        z: centerZ - radius * (1 - Math.cos(angle)),
      })
    }
    return positions
  }

  /**
   * 计算环形排列位置
   * 角色在半径 radius 的圆周上均匀分布
   * @param {Number} count - 角色数量
   * @param {Number} radius - 圆半径
   * @param {Number} centerX - 圆心 X
   * @param {Number} centerZ - 圆心 Z
   * @returns {Array} 位置列表 [{ x, y, z }]
   */
  _calcCirclePositions(count, radius, centerX, centerZ) {
    const positions = []
    if (count <= 0) return positions
    for (let i = 0; i < count; i++) {
      // 从 +X 方向起，逆时针均匀分布
      const angle = (2 * Math.PI * i) / count
      positions.push({
        x: centerX + radius * Math.cos(angle),
        y: 0,
        z: centerZ + radius * Math.sin(angle),
      })
    }
    return positions
  }

  /**
   * 计算对面对面排列位置
   * 角色分两排面对面：前排 Z = centerZ + 3，后排 Z = centerZ - 3
   * 前排数量为 ceil(count/2)，后排数量为 floor(count/2)，两排沿 X 轴对齐
   * @param {Number} count - 角色数量
   * @param {Number} spacing - 角色间距
   * @param {Number} centerX - X 方向中心
   * @param {Number} centerZ - Z 方向中心
   * @returns {Array} 位置列表 [{ x, y, z }]
   */
  _calcFacingPositions(count, spacing, centerX, centerZ) {
    const positions = []
    if (count <= 0) return positions
    const frontCount = Math.ceil(count / 2)
    const backCount = count - frontCount
    const frontZ = centerZ + 3
    const backZ = centerZ - 3
    // 前排（Z 较大，靠前）
    const frontStartX = centerX - ((frontCount - 1) * spacing) / 2
    for (let i = 0; i < frontCount; i++) {
      positions.push({
        x: frontStartX + i * spacing,
        y: 0,
        z: frontZ,
      })
    }
    // 后排（Z 较小，靠后；数量可能比前排少 1，仍以 centerX 为中心）
    const backStartX = centerX - ((backCount - 1) * spacing) / 2
    for (let i = 0; i < backCount; i++) {
      positions.push({
        x: backStartX + i * spacing,
        y: 0,
        z: backZ,
      })
    }
    return positions
  }

  // ===========================================================================
  // 关系连线
  // ===========================================================================

  /**
   * 绘制角色互动关系连线
   * @param {Array} relations - 关系列表
   *   [{ from: nodeId, to: nodeId, type: 'dialogue'|'conflict'|'ally' }]
   * 不同类型用不同颜色：dialogue=蓝，conflict=红，ally=绿
   * 使用 BufferGeometry + LineBasicMaterial + Line
   */
  drawRelations(relations) {
    console.log(`[CharacterStageManager] drawRelations START`, {
      inputCount: relations?.length ?? 0,
      relations: relations?.map(r => ({ from: r.from, to: r.to, type: r.type })),
    })
    // 先清除旧连线
    this._clearGroup(this.relationLines)
    this.lastRelations = relations ? relations.map(r => ({ ...r })) : []

    if (!relations || relations.length === 0) {
      console.log(`[CharacterStageManager] drawRelations END - no relations, cleared`)
      return
    }

    const drawnRelations = []
    const skippedRelations = []
    for (const rel of relations) {
      const fromEntry = this.nodeMap.get(rel.from)
      const toEntry = this.nodeMap.get(rel.to)
      if (!fromEntry || !toEntry) {
        skippedRelations.push({ ...rel, reason: `node not found: from=${!!fromEntry}, to=${!!toEntry}` })
        continue
      }
      const fromPos = fromEntry.position3D
      const toPos = toEntry.position3D
      if (!fromPos || !toPos) {
        skippedRelations.push({ ...rel, reason: `position3D missing: from=${!!fromPos}, to=${!!toPos}` })
        continue
      }

      const color = RELATION_COLORS[rel.type] ?? 0xffffff
      const points = [
        new THREE.Vector3(fromPos.x, fromPos.y, fromPos.z),
        new THREE.Vector3(toPos.x, toPos.y, toPos.z),
      ]
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
        transparent: true,
        opacity: 0.85,
      })
      const line = new THREE.Line(geometry, material)
      line.name = `relation_${rel.from}_${rel.to}_${rel.type}`
      line.userData = { from: rel.from, to: rel.to, type: rel.type }
      this.relationLines.add(line)
      drawnRelations.push({
        ...rel,
        colorHex: '#' + color.toString(16),
        from: `(${fromPos.x.toFixed(1)},${fromPos.y.toFixed(1)},${fromPos.z.toFixed(1)})`,
        to: `(${toPos.x.toFixed(1)},${toPos.y.toFixed(1)},${toPos.z.toFixed(1)})`,
      })
    }

    console.log(`[CharacterStageManager] drawRelations END`, {
      drawnCount: drawnRelations.length,
      skippedCount: skippedRelations.length,
      drawn: drawnRelations,
      skipped: skippedRelations,
    })
  }

  /**
   * 清除所有关系连线
   */
  clearRelations() {
    this._clearGroup(this.relationLines)
    this.lastRelations = []
  }

  // ===========================================================================
  // 走位路径
  // ===========================================================================

  /**
   * 设置角色走位路径
   * @param {String} nodeId - 角色 nodeId
   * @param {Array} waypoints - 路径点列表 [{ x, y, z }, ...]
   * 起点为角色当前位置（若 nodeMap 中存在），随后依次连接所有 waypoints
   * 使用 LineDashedMaterial 绘制虚线
   */
  setWaypoints(nodeId, waypoints) {
    console.log(`[CharacterStageManager] setWaypoints START`, {
      nodeId,
      waypointCount: waypoints?.length ?? 0,
      waypoints: waypoints?.map(w => `(${w.x?.toFixed(1)},${w.y?.toFixed(1)},${w.z?.toFixed(1)})`),
    })
    if (!nodeId || !waypoints || waypoints.length === 0) {
      console.log(`[CharacterStageManager] setWaypoints END - invalid input`)
      return
    }

    // 构建路径点：起点（角色当前位置） + 所有 waypoints
    const points = []
    const entry = this.nodeMap.get(nodeId)
    let startPos = null
    if (entry && entry.position3D) {
      startPos = { x: entry.position3D.x, y: entry.position3D.y, z: entry.position3D.z }
      points.push(new THREE.Vector3(
        entry.position3D.x,
        entry.position3D.y,
        entry.position3D.z,
      ))
    }
    for (const wp of waypoints) {
      points.push(new THREE.Vector3(wp.x, wp.y, wp.z))
    }
    console.log(`[CharacterStageManager] setWaypoints path points`, {
      hasStartPosition: !!startPos,
      startPos: startPos ? `(${startPos.x.toFixed(1)},${startPos.y.toFixed(1)},${startPos.z.toFixed(1)})` : null,
      totalPoints: points.length,
    })
    if (points.length < 2) {
      console.log(`[CharacterStageManager] setWaypoints END - need at least 2 points, got ${points.length}`)
      return // 至少需要 2 个点才能绘制路径
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineDashedMaterial({
      color: WAYPOINT_COLOR,
      dashSize: 0.5,
      gapSize: 0.3,
      transparent: true,
      opacity: 0.8,
    })
    const line = new THREE.Line(geometry, material)
    line.computeLineDistances() // 虚线必须调用此方法才能正确渲染
    line.name = `waypoint_${nodeId}`
    line.userData = { nodeId, waypoints: waypoints.map(p => ({ ...p })) }

    this.waypointLines.add(line)
    console.log(`[CharacterStageManager] setWaypoints END - waypoint line added for node ${nodeId}`)
  }

  /**
   * 清除所有走位路径
   */
  clearWaypoints() {
    this._clearGroup(this.waypointLines)
  }

  // ===========================================================================
  // 持久化 & 资源清理
  // ===========================================================================

  /**
   * 获取当前编排数据（用于持久化）
   * @returns {Object} 可 JSON 序列化的编排数据
   *   { pattern, spacing, arcRadius, circleRadius,
   *     positions: { [nodeId]: { x, y, z } },
   *     relations: [{ from, to, type }] }
   */
  serialize() {
    const positions = {}
    for (const [nodeId, pos] of this.lastPositions) {
      positions[nodeId] = { x: pos.x, y: pos.y, z: pos.z }
    }
    return {
      pattern: this.pattern,
      spacing: this.spacing,
      arcRadius: this.arcRadius,
      circleRadius: this.circleRadius,
      positions,
      relations: this.lastRelations.map(r => ({ ...r })),
    }
  }

  /**
   * 销毁管理器，清理 Three.js 资源
   */
  destroy() {
    this.clearRelations()
    this.clearWaypoints()
    if (this.scene) {
      this.scene.remove(this.relationLines)
      this.scene.remove(this.waypointLines)
    }
    if (this.lastPositions) {
      this.lastPositions.clear()
    }
    this.scene = null
    this.nodeMap = null
    this.lastPositions = null
    this.lastRelations = []
  }

  // ===========================================================================
  // 内部工具
  // ===========================================================================

  /**
   * 清除一个 THREE.Group 的所有子对象，并释放其几何/材质资源
   * @param {THREE.Group} group
   */
  _clearGroup(group) {
    if (!group) return
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i]
      group.remove(child)
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }
  }
}

export { STAGE_PATTERNS }
export default CharacterStageManager
