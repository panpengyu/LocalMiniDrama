/**
 * Timeline3DLayout — 时间轴3D化布局模块 (S10-T06)
 *
 * 核心职责：
 * 1. 将分镜节点沿 X 轴排列，形成3D故事时间线
 * 2. 按分镜序号(storyboard_number)等间距排列
 * 3. 绘制时间轴刻度线和序号标签
 * 4. 支持点击刻度跳转到对应分镜（摄像机聚焦）
 * 5. 分镜节点在 Y 轴按所属层级(背景/中景/前景)分层
 *
 * 布局规则：
 *   X 轴: 按分镜序号等间距排列（居中），间距 = SPACING
 *   Y 轴: 按层级分层 background→60, midground→30, foreground→10
 *   Z 轴: 保持节点原始深度不变
 *   时间轴主轴线 + 刻度 + 标签绘制在 Y=0 平面
 */

import * as THREE from 'three'

// 时间轴配置
const TIMELINE_CONFIG = {
  SPACING: 8,        // 分镜间距（X轴单位）
  Y_BACKGROUND: 60,  // 背景层 Y 坐标
  Y_MIDGROUND: 30,   // 中景层 Y 坐标
  Y_FOREGROUND: 10,  // 前景层 Y 坐标
  TICK_HEIGHT: 2,    // 刻度高度
}

// 层级到 Y 坐标的映射
const LAYER_Y_MAP = {
  background: TIMELINE_CONFIG.Y_BACKGROUND,
  midground: TIMELINE_CONFIG.Y_MIDGROUND,
  foreground: TIMELINE_CONFIG.Y_FOREGROUND,
}

export class Timeline3DLayout {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene - Three.js 场景
   * @param {Map} options.nodeMap - ViewSyncManager.nodeMap 引用（nodeId → entry）
   */
  constructor(options) {
    this.scene = options.scene
    this.nodeMap = options.nodeMap
    this.enabled = false

    // 时间轴组（刻度线 + 标签 + 主轴线）
    this.timelineGroup = new THREE.Group()
    this.timelineGroup.name = 'timeline_3d'
    this.timelineGroup.visible = false
    this.scene.add(this.timelineGroup)

    // 保存原始位置（禁用时恢复）
    this._savedPositions = new Map()

    // 当前分镜列表
    this._storyboards = []
  }

  /**
   * 启用/禁用时间轴3D化
   * @param {Boolean} enabled - 是否启用
   * @param {Array} storyboards - 分镜列表 [{ nodeId, storyboard_number, layer }]
   */
  toggle(enabled, storyboards) {
    if (enabled) {
      // 启用：先保存原始位置 → 按序号排列 → 绘制刻度
      this._savePositions()
      this._storyboards = storyboards || []
      this._arrangeStoryboards(this._storyboards)
      this._drawTimeline(this._storyboards)
      this.timelineGroup.visible = true
      this.enabled = true
    } else {
      // 禁用：恢复原始位置 → 清除时间轴
      this._restorePositions()
      this._clearTimeline()
      this.timelineGroup.visible = false
      this.enabled = false
      this._storyboards = []
    }
  }

  /**
   * 按分镜序号排列到时间轴
   * X = (index - (count-1)/2) * SPACING（居中排列）
   * Y 按层级映射: background→Y_BACKGROUND, midground→Y_MIDGROUND, foreground→Y_FOREGROUND
   * Z 保持原值
   * @param {Array} storyboards - 分镜列表 [{ nodeId, storyboard_number, layer }]
   */
  _arrangeStoryboards(storyboards) {
    if (!storyboards || storyboards.length === 0) return

    // 按 storyboard_number 升序排序
    const sorted = [...storyboards].sort((a, b) => {
      return (a.storyboard_number ?? 0) - (b.storyboard_number ?? 0)
    })

    const count = sorted.length

    sorted.forEach((sb, index) => {
      const entry = this.nodeMap.get(sb.nodeId)
      if (!entry || !entry.position3D) return

      // X 居中排列
      const x = (index - (count - 1) / 2) * TIMELINE_CONFIG.SPACING
      // Y 按层级映射
      const y = LAYER_Y_MAP[sb.layer] ?? TIMELINE_CONFIG.Y_MIDGROUND
      // Z 保持原值
      const z = entry.position3D.z

      // 更新 nodeMap 中 entry.position3D
      entry.position3D = { x, y, z }

      // 更新 entry.mesh.position
      if (entry.mesh) {
        entry.mesh.position.set(x, y, z)
      }
    })
  }

  /**
   * 绘制时间轴刻度和标签
   * 在 Y=0 平面绘制主轴线（白色半透明）+ 垂直刻度线 + 序号标签
   * @param {Array} storyboards - 分镜列表
   */
  _drawTimeline(storyboards) {
    // 先清除旧的时间轴内容
    this._clearTimeline()

    if (!storyboards || storyboards.length === 0) return

    // 按 storyboard_number 升序排序
    const sorted = [...storyboards].sort((a, b) => {
      return (a.storyboard_number ?? 0) - (b.storyboard_number ?? 0)
    })

    const count = sorted.length

    // 主轴线起点和终点 X 坐标
    const firstX = (0 - (count - 1) / 2) * TIMELINE_CONFIG.SPACING
    const lastX = ((count - 1) - (count - 1) / 2) * TIMELINE_CONFIG.SPACING

    // 绘制主轴线（白色半透明，沿 X 轴方向，Y=0）
    const axisPoints = [
      new THREE.Vector3(firstX, 0, 0),
      new THREE.Vector3(lastX, 0, 0),
    ]
    const axisGeometry = new THREE.BufferGeometry().setFromPoints(axisPoints)
    const axisMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    })
    const axisLine = new THREE.Line(axisGeometry, axisMaterial)
    axisLine.name = 'timeline_axis'
    this.timelineGroup.add(axisLine)

    // 为每个分镜绘制刻度线和序号标签
    sorted.forEach((sb, index) => {
      const x = (index - (count - 1) / 2) * TIMELINE_CONFIG.SPACING

      // 垂直刻度线（从 Y=0 向下延伸 TICK_HEIGHT）
      const tickPoints = [
        new THREE.Vector3(x, 0, 0),
        new THREE.Vector3(x, -TIMELINE_CONFIG.TICK_HEIGHT, 0),
      ]
      const tickGeometry = new THREE.BufferGeometry().setFromPoints(tickPoints)
      const tickMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
      })
      const tickLine = new THREE.Line(tickGeometry, tickMaterial)
      tickLine.name = `timeline_tick_${index}`
      // userData 保存索引和 nodeId，便于点击跳转
      tickLine.userData = { storyboardIndex: index, nodeId: sb.nodeId }
      this.timelineGroup.add(tickLine)

      // 序号标签（刻度下方）
      const label = this._createLabel(`镜${sb.storyboard_number ?? index + 1}`)
      label.position.set(x, -TIMELINE_CONFIG.TICK_HEIGHT - 0.6, 0)
      label.name = `timeline_label_${index}`
      label.userData = { storyboardIndex: index, nodeId: sb.nodeId }
      this.timelineGroup.add(label)
    })
  }

  /**
   * 清除时间轴内容（释放几何体/材质/纹理资源）
   */
  _clearTimeline() {
    for (let i = this.timelineGroup.children.length - 1; i >= 0; i--) {
      const child = this.timelineGroup.children[i]
      this._disposeObject(child)
      this.timelineGroup.remove(child)
    }
  }

  /**
   * 递归释放对象及其子级资源
   * @param {THREE.Object3D} obj - 要释放的对象
   */
  _disposeObject(obj) {
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (child.material.map) child.material.map.dispose()
        child.material.dispose()
      }
    })
  }

  /**
   * 跳转到指定分镜（摄像机聚焦）
   * @param {Number} index - 分镜索引（从0开始）
   * @param {Object} cameraController - CameraController 实例
   * @param {Number} distance - 摄像机与目标的距离，默认 15
   */
  focusOnStoryboard(index, cameraController, distance = 15) {
    if (!cameraController || typeof cameraController.focusOn !== 'function') return

    const count = this._storyboards.length
    if (count === 0) return

    // 计算目标 X 位置（与 _arrangeStoryboards 的公式一致）
    const targetX = (index - (count - 1) / 2) * TIMELINE_CONFIG.SPACING

    // 调用 cameraController.focusOn 聚焦
    // focusOn 期望 THREE.Vector3 参数（内部会调用 .clone()）
    const target = new THREE.Vector3(targetX, 0, 0)
    cameraController.focusOn(target, distance)
  }

  /**
   * 创建文字标签（CanvasTexture Sprite）
   * 256×64 Canvas，白色文字 + 黑色半透明背景，返回 Sprite
   * @param {String} text - 标签文字
   * @param {String} color - 文字颜色，默认 '#ffffff'
   * @returns {THREE.Sprite} 精灵标签
   */
  _createLabel(text, color = '#ffffff') {
    // 使用 Canvas 生成文字纹理
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    // 黑色半透明背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 白色文字
    ctx.fillStyle = color
    ctx.font = 'bold 32px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    })

    const sprite = new THREE.Sprite(material)
    // Sprite scale 保持与 Canvas 比例一致（256:64 = 4:1）
    sprite.scale.set(4, 1, 1)

    return sprite
  }

  /**
   * 保存 nodeMap 中所有节点的 position3D 副本
   */
  _savePositions() {
    this._savedPositions.clear()
    for (const [nodeId, entry] of this.nodeMap) {
      if (entry && entry.position3D) {
        this._savedPositions.set(nodeId, {
          x: entry.position3D.x,
          y: entry.position3D.y,
          z: entry.position3D.z,
        })
      }
    }
  }

  /**
   * 恢复 nodeMap 中所有节点到保存的位置
   */
  _restorePositions() {
    for (const [nodeId, pos] of this._savedPositions) {
      const entry = this.nodeMap.get(nodeId)
      if (!entry) continue

      entry.position3D = { x: pos.x, y: pos.y, z: pos.z }

      if (entry.mesh) {
        entry.mesh.position.set(pos.x, pos.y, pos.z)
      }
    }
    this._savedPositions.clear()
  }

  /**
   * 获取时间轴数据（用于持久化）
   * @returns {Object} { enabled, positions: { [nodeId]: {x,y,z} } }
   */
  serialize() {
    const positions = {}
    for (const [nodeId, entry] of this.nodeMap) {
      if (entry && entry.position3D) {
        positions[nodeId] = {
          x: entry.position3D.x,
          y: entry.position3D.y,
          z: entry.position3D.z,
        }
      }
    }
    return {
      enabled: this.enabled,
      positions,
    }
  }

  /**
   * 销毁，释放所有资源
   */
  destroy() {
    // 先恢复原始位置
    this._restorePositions()

    // 清除时间轴内容并释放资源
    this._clearTimeline()

    // 从场景中移除时间轴组
    this.scene.remove(this.timelineGroup)

    this.enabled = false
    this._storyboards = []
  }
}

export { TIMELINE_CONFIG }
export default Timeline3DLayout
