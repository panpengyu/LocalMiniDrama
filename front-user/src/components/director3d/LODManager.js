/**
 * LODManager — 3D导演台 LOD（Level of Detail）降级管理器
 *
 * 核心职责：
 * 根据摄像机与节点的距离和节点是否在视锥体内，动态切换节点的渲染细节级别，
 * 在保证视觉体验的前提下最大化3D场景的渲染性能。
 *
 * 四级 LOD 策略：
 *
 *   Level 0 (HIGH)    距离 < 80      全纹理 + 文字 + 边框 + 悬浮效果
 *   Level 1 (MEDIUM)  距离 80-200     低分辨率纹理 + 无文字 + 简化边框
 *   Level 2 (LOW)     距离 200-400    纯色平面 + 类型标识色
 *   Level 3 (HIDDEN)  距离 > 400      不渲染（从场景中移除）
 *
 * 此外，无论距离如何，不在摄像机视锥体内的节点直接降级为 HIDDEN。
 *
 * S10-T02 增强：视口剔除使用 Frustum.intersectsSphere（包围球检测），
 * 替代 Sprint 9 的 containsPoint（点检测），避免节点在屏幕边缘闪现/消失。
 * 每个节点维护一个 BoundingSphere，半径按节点类型配置，覆盖平面最大边长。
 *
 * 性能优化：
 * - LOD 评估每 100ms 执行一次（而非每帧），通过 requestAnimationFrame 节流
 * - 距离计算使用平方距离（避免开方运算）
 * - 视锥体剔除使用 Three.js Frustum.intersectsSphere（S10-T02 增强）
 * - 同一 LOD 级别的节点不重复更新（避免不必要的材质切换）
 */

import * as THREE from 'three'

// LOD 级别常量
export const LOD_LEVEL = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  HIDDEN: 3,
}

// LOD 距离阈值（平方距离，避免开方）
const LOD_DIST_SQ = {
  HIGH_TO_MEDIUM: 80 * 80,      // 80 单位
  MEDIUM_TO_LOW: 200 * 200,     // 200 单位
  LOW_TO_HIDDEN: 400 * 400,     // 400 单位
}

// 节点类型对应的纯色（LOW 级别使用）
const TYPE_COLORS = {
  storyboard: 0x4f9cf9,   // 蓝色 — 分镜
  character: 0xf97316,    // 橙色 — 角色
  scene: 0x10b981,        // 绿色 — 场景
  prop: 0xa855f7,         // 紫色 — 道具
  script: 0xeab308,       // 黄色 — 脚本
  episode: 0xec4899,      // 粉色 — 集数
  canvasLabel: 0x6b7280,  // 灰色 — 标签
}

// 默认颜色
const DEFAULT_COLOR = 0x6b7280

// S10-T02: 节点类型对应的包围球半径（覆盖平面最大边长的一半 + 余量）
const NODE_BOUNDING_RADIUS = {
  storyboard: 2.5,   // 4×2.25 → max=4, radius≈2.5
  character: 2.0,    // 2.25×3 → max=3, radius≈2.0
  scene: 3.5,        // 6×3.375 → max=6, radius≈3.5
  prop: 1.2,         // 1.5×1.5 → max=1.5, radius≈1.2
  script: 1.5,       // 2×2 → max=2, radius≈1.5
  episode: 2.8,      // 5×1.25 → max=5, radius≈2.8
  canvasLabel: 1.0,  // 1.5×0.6 → max=1.5, radius≈1.0
}
const DEFAULT_BOUNDING_RADIUS = 2.0

export class LODManager {
  /**
   * @param {Object} options
   * @param {THREE.PerspectiveCamera} options.camera - 摄像机对象
   * @param {THREE.Scene} options.scene - 场景对象
   * @param {Number} options.updateInterval - LOD更新间隔(毫秒)，默认 100ms
   * @param {Number} options.textureDownscale - 中等LOD纹理降采样倍数，默认 0.5
   */
  constructor(options) {
    this.camera = options.camera
    this.scene = options.scene
    this.updateInterval = options.updateInterval ?? 100
    this.textureDownscale = options.textureDownscale ?? 0.5

    // 节点LOD状态表: nodeId → { currentLOD, mesh, group, type, materials }
    this.lodTable = new Map()

    // 视锥体和射线复用对象（避免每帧创建）
    this._frustum = new THREE.Frustum()
    this._projScreenMatrix = new THREE.Matrix4()

    // 更新节流
    this._lastUpdateTime = 0
    this._updateScheduled = false

    // 统计信息
    this.stats = {
      high: 0,
      medium: 0,
      low: 0,
      hidden: 0,
      lastUpdateTime: 0,
    }
  }

  /**
   * 注册一个3D节点到LOD管理器
   * @param {String} nodeId - 节点ID
   * @param {THREE.Group} group - 节点的3D容器（包含所有LOD级别的子对象）
   * @param {String} nodeType - 节点类型
   * @param {Object} textures - 纹理资源 { high, medium }
   */
  register(nodeId, group, nodeType, textures = {}) {
    // 为每个节点创建多级材质
    const materials = this._createMaterials(nodeType, textures)

    const entry = {
      nodeId,
      group,
      type: nodeType,
      currentLOD: LOD_LEVEL.HIGH,
      materials,
      // 缓存世界坐标位置（避免每帧调用 getWorldPosition）
      cachedPosition: new THREE.Vector3(),
      // 标记位置是否需要更新缓存
      positionDirty: true,
      // S10-T02: 包围球（用于精确视锥体剔除）
      boundingSphere: new THREE.Sphere(
        new THREE.Vector3(),
        NODE_BOUNDING_RADIUS[nodeType] ?? DEFAULT_BOUNDING_RADIUS
      ),
    }

    // 初始应用 HIGH 级别
    this._applyLOD(entry, LOD_LEVEL.HIGH)

    this.lodTable.set(nodeId, entry)
  }

  /**
   * 注销一个3D节点
   * @param {String} nodeId - 节点ID
   */
  unregister(nodeId) {
    const entry = this.lodTable.get(nodeId)
    if (!entry) return

    // 释放纹理资源
    if (entry.materials.high?.map) entry.materials.high.map.dispose()
    if (entry.materials.medium?.map) entry.materials.medium.map.dispose()
    entry.materials.high?.dispose()
    entry.materials.medium?.dispose()
    entry.materials.low?.dispose()

    this.lodTable.delete(nodeId)
  }

  /**
   * 标记节点位置已变更（需要更新缓存）
   * @param {String} nodeId - 节点ID
   */
  markPositionDirty(nodeId) {
    const entry = this.lodTable.get(nodeId)
    if (entry) {
      entry.positionDirty = true
    }
  }

  /**
   * 执行LOD评估和更新（由DirectorStage3D在动画循环中调用）
   * @param {Number} currentTime - 当前时间戳
   * @param {Boolean} force - 是否强制更新（忽略节流）
   */
  update(currentTime, force = false) {
    // 节流：间隔不足则跳过（除非强制）
    if (!force && currentTime - this._lastUpdateTime < this.updateInterval) {
      return
    }

    this._lastUpdateTime = currentTime

    // 更新视锥体
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    )
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix)

    // 重置统计
    this.stats = { high: 0, medium: 0, low: 0, hidden: 0, lastUpdateTime: currentTime }

    // 摄像机位置（用于距离计算）
    const cameraPos = this.camera.position

    // 遍历所有节点评估LOD
    for (const [nodeId, entry] of this.lodTable) {
      // 更新缓存的位置
      if (entry.positionDirty) {
        entry.group.getWorldPosition(entry.cachedPosition)
        entry.positionDirty = false
      }

      const pos = entry.cachedPosition

      // S10-T02: 同步包围球中心到节点位置
      entry.boundingSphere.center.copy(pos)

      // Step 1: 视锥体剔除 — 使用包围球检测（比 containsPoint 更精确）
      // 包围球与视锥体相交 → 至少部分在屏幕内 → 保持渲染
      // 包围球完全在视锥体外 → 降级处理
      if (!this._frustum.intersectsSphere(entry.boundingSphere)) {
        // 视锥体外，距离很远则直接隐藏
        const distToCamera = pos.distanceToSquared(cameraPos)
        if (distToCamera > LOD_DIST_SQ.LOW_TO_HIDDEN) {
          this._setLOD(entry, LOD_LEVEL.HIDDEN)
          this.stats.hidden++
          continue
        }
        // 在视锥体外但距离较近，降级到 LOW
        this._setLOD(entry, LOD_LEVEL.LOW)
        this.stats.low++
        continue
      }

      // Step 2: 基于距离的LOD降级
      const distSq = pos.distanceToSquared(cameraPos)

      let targetLOD
      if (distSq < LOD_DIST_SQ.HIGH_TO_MEDIUM) {
        targetLOD = LOD_LEVEL.HIGH
        this.stats.high++
      } else if (distSq < LOD_DIST_SQ.MEDIUM_TO_LOW) {
        targetLOD = LOD_LEVEL.MEDIUM
        this.stats.medium++
      } else if (distSq < LOD_DIST_SQ.LOW_TO_HIDDEN) {
        targetLOD = LOD_LEVEL.LOW
        this.stats.low++
      } else {
        targetLOD = LOD_LEVEL.HIDDEN
        this.stats.hidden++
      }

      this._setLOD(entry, targetLOD)
    }
  }

  /**
   * 设置节点的LOD级别（仅在级别变化时执行切换操作）
   * @param {Object} entry - 节点LOD条目
   * @param {Number} level - 目标LOD级别
   */
  _setLOD(entry, level) {
    // 级别未变化，跳过（避免不必要的材质切换）
    if (entry.currentLOD === level) return

    this._applyLOD(entry, level)
    entry.currentLOD = level
  }

  /**
   * 应用LOD级别到节点（执行实际的材质/可见性切换）
   * @param {Object} entry - 节点LOD条目
   * @param {Number} level - 目标LOD级别
   */
  _applyLOD(entry, level) {
    const { group, materials } = entry

    switch (level) {
      case LOD_LEVEL.HIGH:
        // 全纹理 + 文字 + 边框
        group.visible = true
        this._swapMaterial(group, materials.high)
        // 显示文字子对象
        this._setChildrenVisible(group, true)
        break

      case LOD_LEVEL.MEDIUM:
        // 低分辨率纹理 + 无文字
        group.visible = true
        this._swapMaterial(group, materials.medium)
        // 隐藏文字子对象（保留图片）
        this._setChildrenVisible(group, false, ['text', 'label'])
        break

      case LOD_LEVEL.LOW:
        // 纯色平面 + 类型标识色
        group.visible = true
        this._swapMaterial(group, materials.low)
        // 隐藏所有子对象，只保留主平面
        this._setChildrenVisible(group, false)
        break

      case LOD_LEVEL.HIDDEN:
        // 完全不渲染
        group.visible = false
        break
    }
  }

  /**
   * 切换主平面的材质
   * @param {THREE.Group} group - 节点容器
   * @param {THREE.Material} material - 目标材质
   */
  _swapMaterial(group, material) {
    // 查找主平面（名称为 'mainPlane' 的子对象）
    const mainPlane = group.getObjectByName('mainPlane')
    if (mainPlane) {
      mainPlane.material = material
    }
  }

  /**
   * 设置子对象的可见性
   * @param {THREE.Group} group - 节点容器
   * @param {Boolean} visible - 是否可见
   * @param {Array<String>} excludeNames - 排除的子对象名称列表
   */
  _setChildrenVisible(group, visible, excludeNames = []) {
    group.children.forEach((child) => {
      if (child.name === 'mainPlane') return // 主平面由材质控制
      if (excludeNames.includes(child.name)) {
        child.visible = !visible
        return
      }
      child.visible = visible
    })
  }

  /**
   * 为节点创建多级材质
   * @param {String} nodeType - 节点类型
   * @param {Object} textures - 纹理资源 { high, medium }
   * @returns {Object} { high, medium, low }
   */
  _createMaterials(nodeType, textures) {
    const color = TYPE_COLORS[nodeType] ?? DEFAULT_COLOR

    // HIGH: 高分辨率纹理 + 透明度
    const highMaterial = new THREE.MeshBasicMaterial({
      map: textures.high || null,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 1.0,
    })

    // MEDIUM: 低分辨率纹理（降采样）
    let mediumTexture = textures.medium
    if (!mediumTexture && textures.high) {
      mediumTexture = this._downscaleTexture(textures.high)
    }

    const mediumMaterial = new THREE.MeshBasicMaterial({
      map: mediumTexture || null,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.85,
    })

    // LOW: 纯色（无纹理，最低GPU开销）
    const lowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.6,
    })

    return { high: highMaterial, medium: mediumMaterial, low: lowMaterial }
  }

  /**
   * 纹理降采样（生成低分辨率版本）
   * @param {THREE.Texture} texture - 原始纹理
   * @returns {THREE.Texture} 降采样后的纹理
   */
  _downscaleTexture(texture) {
    // 利用 Three.js 的 minFilter 和 generateMipmaps 实现降采样
    // 而非真正创建低分辨率纹理（GPU会自动选择合适的mipmap级别）
    const downscaled = texture.clone()
    downscaled.minFilter = THREE.LinearMipmapLinearFilter
    downscaled.generateMipmaps = true
    downscaled.needsUpdate = true
    return downscaled
  }

  /**
   * 获取当前LOD统计信息
   * @returns {Object} { high, medium, low, hidden, total, lastUpdateTime }
   */
  getStats() {
    return {
      ...this.stats,
      total: this.lodTable.size,
    }
  }

  /**
   * 调整LOD距离阈值（根据场景规模动态调整）
   * @param {Object} thresholds - { highToMedium, mediumToLow, lowToHidden }
   */
  setDistanceThresholds(thresholds) {
    if (thresholds.highToMedium) {
      LOD_DIST_SQ.HIGH_TO_MEDIUM = thresholds.highToMedium * thresholds.highToMedium
    }
    if (thresholds.mediumToLow) {
      LOD_DIST_SQ.MEDIUM_TO_LOW = thresholds.mediumToLow * thresholds.mediumToLow
    }
    if (thresholds.lowToHidden) {
      LOD_DIST_SQ.LOW_TO_HIDDEN = thresholds.lowToHidden * thresholds.lowToHidden
    }

    // 强制所有节点重新评估
    for (const entry of this.lodTable.values()) {
      entry.currentLOD = -1 // 重置为无效值，触发下次更新时强制切换
    }
  }

  /**
   * 销毁LOD管理器，释放所有资源
   */
  destroy() {
    for (const nodeId of this.lodTable.keys()) {
      this.unregister(nodeId)
    }
    this.lodTable.clear()
  }
}

export default LODManager
