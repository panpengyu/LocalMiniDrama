/**
 * SceneDepthPreview — 场景深度预览模块 (S10-T05)
 *
 * 核心职责：
 * 在3D空间中预览场景图片的透视和遮挡关系。
 * 场景图片按深度(Z轴)分层放置，展示前景遮挡背景的效果。
 * 支持深度调整（拖动场景节点改变Z值），并显示深度标尺和分层指示器。
 *
 * 设计说明：
 *   - 场景平面尺寸 6×3.375，与 Node3DFactory 的 scene 配置保持一致
 *   - 文字标签使用 CanvasTexture（参考 Node3DFactory._createLabel）
 *   - 纹理加载失败时回退为绿色半透明纯色材质
 */

import * as THREE from 'three'

// 深度层级配置
const DEPTH_LAYERS = {
  background: { z: 200, color: 0x10b981, label: '背景层' },
  midground: { z: 100, color: 0xf97316, label: '中景层' },
  foreground: { z: 30, color: 0xa855f7, label: '前景层' },
}

// 场景平面默认尺寸（与 Node3DFactory 的 scene 配置一致：16:9 大尺寸背景）
const DEFAULT_PLANE_WIDTH = 6
const DEFAULT_PLANE_HEIGHT = 3.375

// 纹理加载失败时的回退材质颜色（绿色半透明）
const FALLBACK_COLOR = 0x10b981
const FALLBACK_OPACITY = 0.5

// 深度标尺参数
const RULER_X = -30        // 标尺所在 X 坐标（场景左侧）
const RULER_Z_START = 0    // 标尺起点 Z
const RULER_Z_END = 250    // 标尺终点 Z
const RULER_TICK_LENGTH = 3 // 水平刻度线长度（沿 X 方向延伸）

export class SceneDepthPreview {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene - Three.js 场景
   * @param {THREE.Camera} options.camera - Three.js 相机
   * @param {THREE.TextureLoader} [options.textureLoader] - 纹理加载器
   */
  constructor(options) {
    this.scene = options.scene
    this.camera = options.camera
    this.textureLoader = options.textureLoader || new THREE.TextureLoader()
    this.enabled = false

    // 深度标尺组
    this.depthRuler = new THREE.Group()
    this.depthRuler.name = 'depth_ruler'
    this.depthRuler.visible = false
    this.scene.add(this.depthRuler)

    // 场景预览平面组
    this.previewPlanes = new THREE.Group()
    this.previewPlanes.name = 'scene_depth_preview'
    this.previewPlanes.visible = false
    this.scene.add(this.previewPlanes)

    // 纹理缓存（避免重复加载同一图片）
    this._textureCache = new Map()

    // 场景平面索引：sceneId -> { group, mesh, label, data }
    this._sceneMap = new Map()
  }

  /**
   * 启用/禁用深度预览
   * @param {Boolean} [enabled] - 是否启用，不传则切换当前状态
   * @returns {Boolean} 当前启用状态
   */
  toggle(enabled) {
    const prevEnabled = this.enabled
    this.enabled = enabled ?? !this.enabled
    this.depthRuler.visible = this.enabled
    this.previewPlanes.visible = this.enabled
    console.log(`[SceneDepthPreview] toggle`, {
      prevEnabled,
      newEnabled: this.enabled,
      param: enabled,
      depthRulerVisible: this.depthRuler.visible,
      previewPlanesVisible: this.previewPlanes.visible,
    })
    if (this.enabled) {
      this._buildDepthRuler()
    }
    return this.enabled
  }

  /**
   * 添加场景预览平面
   * @param {Object} sceneData - 场景数据
   * @param {String} sceneData.id - 场景ID
   * @param {String} [sceneData.imageUrl] - 场景图片URL
   * @param {String} [sceneData.name] - 场景名称
   * @param {Number} [sceneData.z] - 深度(Z值)，默认使用背景层
   * @param {Number} [sceneData.width] - 平面宽度，默认6
   * @param {Number} [sceneData.height] - 平面高度，默认3.375
   * @returns {THREE.Group} 场景平面容器
   */
  addScenePlane(sceneData) {
    const id = sceneData.id
    console.log(`[SceneDepthPreview] addScenePlane START`, {
      sceneId: id,
      sceneName: sceneData.name,
      imageUrl: sceneData.imageUrl ? sceneData.imageUrl.substring(0, 60) + (sceneData.imageUrl.length > 60 ? '...' : '') : null,
      z: sceneData.z,
      width: sceneData.width,
      height: sceneData.height,
      existedBefore: this._sceneMap.has(id),
    })
    // 已存在则先移除旧的
    if (this._sceneMap.has(id)) {
      console.log('[SceneDepthPreview] addScenePlane - removing existing plane for scene ' + id)
      this.removeScenePlane(id)
    }

    const width = sceneData.width ?? DEFAULT_PLANE_WIDTH
    const height = sceneData.height ?? DEFAULT_PLANE_HEIGHT
    // Z 值校验：非有限数字时回退到背景层默认值
    const rawZ = sceneData.z
    const z = Number.isFinite(rawZ) ? rawZ : DEPTH_LAYERS.background.z
    const usedFallbackZ = !Number.isFinite(rawZ)

    console.log(`[SceneDepthPreview] addScenePlane - resolved params`, {
      width,
      height,
      z,
      rawZ,
      usedFallback_z: usedFallbackZ,
      usedFallback_width: sceneData.width === undefined,
      usedFallback_height: sceneData.height === undefined,
    })
    if (usedFallbackZ && rawZ !== undefined) {
      console.warn(
        '[SceneDepthPreview] addScenePlane - 场景 ' + id + ' 的 z 值无效: ' + rawZ + ' (type: ' + typeof rawZ + ')，已回退到背景层默认值 ' + DEPTH_LAYERS.background.z
      )
    }

    // 容器
    const group = new THREE.Group()
    group.name = 'depth_plane_' + id
    group.userData = { sceneId: id, z }

    // 主平面：初始使用绿色半透明材质，纹理加载成功后替换
    const geometry = new THREE.PlaneGeometry(width, height)
    const material = new THREE.MeshBasicMaterial({
      color: FALLBACK_COLOR,
      transparent: true,
      opacity: FALLBACK_OPACITY,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'depthPlaneMesh'
    mesh.position.z = z
    mesh.userData = { sceneId: id, imageUrl: sceneData.imageUrl }
    group.add(mesh)

    // 深度标签（场景名 + Z值），宽度与主平面一致
    const labelText = `${sceneData.name || '场景'} | Z=${z}`
    const label = this._createTextLabel(labelText, undefined, width)
    label.name = 'depthLabel'
    // 标签位于主平面下方
    label.position.set(0, -height / 2 - 0.3, z)
    group.add(label)

    this.previewPlanes.add(group)

    // 记录索引
    this._sceneMap.set(id, {
      group,
      mesh,
      label,
      data: { ...sceneData, width, height, z },
    })

    console.log(`[SceneDepthPreview] addScenePlane END`, {
      sceneId: id,
      groupName: group.name,
      meshPosition: `(${mesh.position.x.toFixed(2)}, ${mesh.position.y.toFixed(2)}, ${mesh.position.z.toFixed(2)})`,
      labelPosition: `(${label.position.x.toFixed(2)}, ${label.position.y.toFixed(2)}, ${label.position.z.toFixed(2)})`,
      sceneMapSize: this._sceneMap.size,
      hasImageUrl: !!sceneData.imageUrl,
    })

    // 异步加载纹理（失败时保持回退材质）
    this._loadSceneTexture(sceneData.imageUrl, mesh)

    return group
  }

  /**
   * 更新场景平面深度（拖动调整Z值）
   * 直接更新 mesh.position.z，同时同步标签位置与文字。
   * @param {String} sceneId - 场景ID
   * @param {Number} newZ - 新的Z深度值
   */
  updateSceneDepth(sceneId, newZ) {
    const entry = this._sceneMap.get(sceneId)
    const oldZ = entry?.mesh?.position?.z
    const oldDataZ = entry?.data?.z

    console.log(`[SceneDepthPreview] updateSceneDepth START`, {
      sceneId,
      newZ,
      oldZ_mesh: oldZ,
      oldZ_data: oldDataZ,
      entryFound: !!entry,
      isZValid: Number.isFinite(newZ),
      zChanged: oldZ !== newZ,
    })

    if (!entry) {
      console.warn(`[SceneDepthPreview] updateSceneDepth END - scene ${sceneId} not found in _sceneMap`)
      return
    }
    if (!Number.isFinite(newZ)) {
      console.warn(
        `[SceneDepthPreview] updateSceneDepth END - invalid newZ: ${newZ} (type: ${typeof newZ})\n` +
        `  深度调整已跳过，当前场景保留原Z值: ${oldZ ?? 'unknown'}。请传入有效的数字值。`
      )
      return
    }

    // Z 值范围限制：限制在 0~300 之间，避免超出深度标尺范围导致渲染异常
    const DEPTH_MIN = 0
    const DEPTH_MAX = 300
    let clampedZ = newZ
    let wasClamped = false
    if (newZ < DEPTH_MIN) {
      clampedZ = DEPTH_MIN
      wasClamped = true
    } else if (newZ > DEPTH_MAX) {
      clampedZ = DEPTH_MAX
      wasClamped = true
    }
    if (wasClamped) {
      console.warn(
        `[SceneDepthPreview] updateSceneDepth - Z值已限制范围: ${newZ} → ${clampedZ}\n` +
        `  有效深度范围为 ${DEPTH_MIN}~${DEPTH_MAX}，超出范围的值将被自动限制到边界。`
      )
    }

    const { mesh, label, data } = entry

    // 检查当前是否仍在使用回退材质（图片加载失败/未加载时）
    // 注意：Z 值计算与纹理状态完全解耦——即使图片加载失败，深度调整仍正常执行，
    // 平面保持绿色半透明回退材质。此处 mesh/material 的存在性判断做了防御，
    // 避免材质被意外销毁时在深度更新路径抛出异常导致预览崩溃。
    const isUsingFallback = !mesh?.material || mesh.material.map == null
    if (isUsingFallback) {
      console.log(
        `[SceneDepthPreview] updateSceneDepth - 注意: 场景 ${sceneId} 当前使用回退材质（图片未加载或加载失败），` +
        `深度调整仍将正常执行，平面将以绿色半透明形式显示。`
      )
    }

    // 更新平面 Z 位置（mesh/label 存在性防御，避免结构异常时抛错）
    if (mesh?.position) mesh.position.z = clampedZ
    // 同步标签 Z 位置与文字
    if (label?.position) label.position.z = clampedZ
    const newLabelText = `${data?.name || '场景'} | Z=${clampedZ}`
    this._updateLabelText(label, newLabelText)

    // 同步缓存数据
    entry.data.z = clampedZ
    entry.group.userData.z = clampedZ

    console.log(`[SceneDepthPreview] updateSceneDepth END`, {
      sceneId,
      requestedZ: newZ,
      clampedZ,
      wasClamped,
      isUsingFallbackMaterial: isUsingFallback,
      deltaZ: (clampedZ - (oldZ ?? 0)).toFixed(3),
      finalMeshZ: mesh.position.z.toFixed(3),
      finalLabelZ: label.position.z.toFixed(3),
      finalDataZ: entry.data.z,
      finalGroupUserDataZ: entry.group.userData.z,
      newLabelText,
    })
  }

  /**
   * 移除单个场景平面
   * @param {String} sceneId - 场景ID
   */
  removeScenePlane(sceneId) {
    const entry = this._sceneMap.get(sceneId)
    if (!entry) return
    this._disposeObject(entry.group)
    this.previewPlanes.remove(entry.group)
    this._sceneMap.delete(sceneId)
  }

  /**
   * 构建深度标尺（在场景左侧显示 Z 轴刻度）
   * 在 X=-30 处绘制从 Z=0 到 Z=250 的线段，
   * 在 Z=30/100/200 处添加水平刻度线和文字标签，用不同颜色标识各层级。
   */
  _buildDepthRuler() {
    // 清除旧标尺
    this._clearGroup(this.depthRuler)

    // 主轴线（沿 Z 方向）
    const axisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(RULER_X, 0, RULER_Z_START),
      new THREE.Vector3(RULER_X, 0, RULER_Z_END),
    ])
    const axisMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
    })
    const axisLine = new THREE.Line(axisGeometry, axisMaterial)
    axisLine.name = 'ruler_axis'
    this.depthRuler.add(axisLine)

    // 三个层级刻度（按 Z 从小到大，即从前景到背景）
    const layers = [
      DEPTH_LAYERS.foreground,
      DEPTH_LAYERS.midground,
      DEPTH_LAYERS.background,
    ]
    layers.forEach((layer) => {
      // 水平刻度线（沿 X 方向延伸）
      const tickGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(RULER_X, 0, layer.z),
        new THREE.Vector3(RULER_X + RULER_TICK_LENGTH, 0, layer.z),
      ])
      const tickMaterial = new THREE.LineBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: 0.9,
      })
      const tickLine = new THREE.Line(tickGeometry, tickMaterial)
      tickLine.name = `ruler_tick_${layer.z}`
      this.depthRuler.add(tickLine)

      // 文字标签：层级名 + Z值
      const labelText = `${layer.label} Z=${layer.z}`
      const label = this._createTextLabel(labelText, layer.color, 3)
      label.name = `ruler_label_${layer.z}`
      // 标签放在刻度线右侧、略上方
      label.position.set(RULER_X + RULER_TICK_LENGTH + 0.3, 0.4, layer.z)
      this.depthRuler.add(label)
    })
  }

  /**
   * 创建文字标签（使用 Canvas 纹理，参考 Node3DFactory._createLabel）
   * @param {String} text - 标签文字
   * @param {Number} [accentColor] - 强调色（十六进制），默认白色文字
   * @param {Number} [width=3] - 标签平面宽度
   * @returns {THREE.Mesh} 标签网格
   */
  _createTextLabel(text, accentColor, width = 3) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 文字（如有强调色则使用，否则白色）
    const colorHex =
      accentColor !== undefined
        ? '#' + accentColor.toString(16).padStart(6, '0')
        : '#ffffff'
    ctx.fillStyle = colorHex
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.userData.generated = true // 标记为程序生成，便于销毁
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
    })
    const geometry = new THREE.PlaneGeometry(width, 0.4)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.labelText = text
    return mesh
  }

  /**
   * 更新标签文字（重新生成 Canvas 纹理）
   * @param {THREE.Mesh} label - 标签网格
   * @param {String} text - 新文字
   */
  _updateLabelText(label, text) {
    if (!label) return

    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    // 释放旧纹理
    const oldTexture = label.material.map
    if (oldTexture) oldTexture.dispose()

    const texture = new THREE.CanvasTexture(canvas)
    texture.userData.generated = true
    label.material.map = texture
    label.material.needsUpdate = true
    label.userData.labelText = text
  }

  /**
   * 异步加载场景图片纹理
   * @param {String} imageUrl - 图片URL
   * @param {THREE.Mesh} mesh - 主平面网格
   */
  _loadSceneTexture(imageUrl, mesh) {
    if (!imageUrl) {
      console.log(
        `[SceneDepthPreview] _loadSceneTexture - 图片URL为空，直接使用回退材质（绿色半透明）。\n` +
        `  深度预览功能不受影响，场景平面将以纯色形式显示。`
      )
      return
    }

    // 简单 URL 格式校验
    if (typeof imageUrl !== 'string' || (!imageUrl.startsWith('http') && !imageUrl.startsWith('/') && !imageUrl.startsWith('data:'))) {
      console.warn(
        `[SceneDepthPreview] _loadSceneTexture - 图片URL格式无效: "${imageUrl}"\n` +
        `  将使用回退材质（绿色半透明）。深度预览功能不受影响。`
      )
      return
    }

    // 命中缓存直接应用
    if (this._textureCache.has(imageUrl)) {
      console.log(`[SceneDepthPreview] _loadSceneTexture - 命中缓存: ${imageUrl.substring(0, 60)}`)
      this._applySceneTexture(mesh, this._textureCache.get(imageUrl))
      return
    }

    this.textureLoader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        this._textureCache.set(imageUrl, texture)
        // 网格可能已被销毁/移除，应用前检查父节点是否存在
        if (mesh.parent) {
          this._applySceneTexture(mesh, texture)
          console.log(`[SceneDepthPreview] _loadSceneTexture - 纹理加载成功并已应用`)
        } else {
          texture.dispose()
          console.log(`[SceneDepthPreview] _loadSceneTexture - 纹理加载成功但mesh已销毁，释放纹理`)
        }
      },
      undefined,
      (error) => {
        // 加载失败时保持绿色半透明材质（已在创建时设置）
        console.warn(
          `[SceneDepthPreview] _loadSceneTexture - 纹理加载失败，使用回退材质: ${imageUrl}\n` +
          `  错误信息: ${error?.message || error}\n` +
          `  深度预览功能不受影响，场景平面将以绿色半透明形式显示。`
        )
      }
    )
  }

  /**
   * 应用纹理到场景平面（替换回退材质）
   * @param {THREE.Mesh} mesh - 主平面网格
   * @param {THREE.Texture} texture - 纹理
   */
  _applySceneTexture(mesh, texture) {
    const material = mesh.material
    material.map = texture
    material.color.set(0xffffff) // 纹理加载后清除纯色
    material.opacity = 1.0
    material.needsUpdate = true
  }

  /**
   * 清除所有预览平面
   */
  clearPlanes() {
    for (const entry of this._sceneMap.values()) {
      this._disposeObject(entry.group)
      this.previewPlanes.remove(entry.group)
    }
    this._sceneMap.clear()
  }

  /**
   * 获取深度预览数据（用于持久化）
   * @returns {Object} { enabled, scenes: [{ id, imageUrl, name, z, width, height }] }
   */
  serialize() {
    const scenes = []
    for (const entry of this._sceneMap.values()) {
      scenes.push({
        id: entry.data.id,
        imageUrl: entry.data.imageUrl,
        name: entry.data.name,
        z: entry.data.z,
        width: entry.data.width,
        height: entry.data.height,
      })
    }
    return { enabled: this.enabled, scenes }
  }

  /**
   * 销毁，释放所有 geometry/material/texture 资源
   */
  destroy() {
    // 清除所有平面（释放程序生成的标签纹理等）
    this.clearPlanes()

    // 清除标尺
    this._clearGroup(this.depthRuler)

    // 从场景移除组
    this.scene.remove(this.depthRuler)
    this.scene.remove(this.previewPlanes)

    // 释放纹理缓存中的图片纹理
    for (const texture of this._textureCache.values()) {
      texture.dispose()
    }
    this._textureCache.clear()
    this._sceneMap.clear()

    this.enabled = false
  }

  /**
   * 释放单个3D对象及其子级的 geometry/material/texture
   * 仅释放程序生成的纹理（如 Canvas 标签）；图片纹理由缓存统一释放
   * @param {THREE.Object3D} object - 待释放对象
   */
  _disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        const material = child.material
        if (material.map && material.map.userData?.generated) {
          material.map.dispose()
        }
        material.dispose()
      }
    })
  }

  /**
   * 清空组内所有子对象并释放资源
   * @param {THREE.Group} group - 待清空的组
   */
  _clearGroup(group) {
    const children = [...group.children]
    for (const child of children) {
      this._disposeObject(child)
      group.remove(child)
    }
  }
}

export { DEPTH_LAYERS }
export default SceneDepthPreview
