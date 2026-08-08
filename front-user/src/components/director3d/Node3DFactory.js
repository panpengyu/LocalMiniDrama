/**
 * Node3DFactory — 3D节点工厂
 *
 * 核心职责：
 * 将 Vue Flow 的 2D 节点数据转换为 Three.js 的 3D 对象(Group)。
 * 不同节点类型生成不同尺寸/样式的3D平面，并加载对应的图片纹理。
 *
 * 节点类型到3D对象的映射：
 *   storyboard → 宽屏平面 (16:9) + 帧编号标签
 *   character  → 竖屏平面 (3:4) + 角色名标签
 *   scene      → 宽屏平面 (16:9) + 半透明 + 背景层标识
 *   prop       → 方形平面 (1:1) + 小尺寸
 *   script     → 方形平面 (1:1) + 文字纹理
 *   episode    → 宽条平面 (4:1) + 集数编号
 */

import * as THREE from 'three'

// 节点类型配置
const NODE_CONFIG = {
  storyboard: {
    width: 4,
    height: 2.25,     // 16:9
    color: 0x4f9cf9,
    label: '分镜',
  },
  character: {
    width: 2.25,
    height: 3,        // 3:4 竖屏
    color: 0xf97316,
    label: '角色',
  },
  scene: {
    width: 6,
    height: 3.375,    // 16:9 大尺寸背景
    color: 0x10b981,
    label: '场景',
  },
  prop: {
    width: 1.5,
    height: 1.5,      // 1:1 方形
    color: 0xa855f7,
    label: '道具',
  },
  script: {
    width: 2,
    height: 2,
    color: 0xeab308,
    label: '脚本',
  },
  episode: {
    width: 5,
    height: 1.25,     // 4:1 宽条
    color: 0xec4899,
    label: '集数',
  },
  canvasLabel: {
    width: 1.5,
    height: 0.6,
    color: 0x6b7280,
    label: '标签',
  },
}

// 默认配置
const DEFAULT_CONFIG = {
  width: 2,
  height: 2,
  color: 0x6b7280,
  label: '节点',
}

// 纹理缓存（避免重复加载同一图片）
const textureCache = new Map()

export class Node3DFactory {
  /**
   * @param {Object} options
   * @param {THREE.TextureLoader} options.textureLoader - 纹理加载器
   * @param {Boolean} options.showLabels - 是否显示文字标签
   */
  constructor(options = {}) {
    this.textureLoader = options.textureLoader || new THREE.TextureLoader()
    this.showLabels = options.showLabels ?? true
  }

  /**
   * 创建3D节点
   * @param {Object} nodeData - 节点数据
   * @param {String} nodeData.nodeId - 节点ID
   * @param {String} nodeData.type - 节点类型
   * @param {Object} nodeData.data - 节点业务数据
   * @param {Object} nodeData.position3D - 3D位置 { x, y, z }
   * @param {String} nodeData.layer - 所属层级
   * @returns {THREE.Group} 3D节点容器
   */
  create(nodeData) {
    const config = NODE_CONFIG[nodeData.type] || DEFAULT_CONFIG

    // 创建容器
    const group = new THREE.Group()
    group.name = `node3d_${nodeData.nodeId}`
    group.userData = {
      nodeId: nodeData.nodeId,
      nodeType: nodeData.type,
      layer: nodeData.layer,
    }

    // 设置位置
    const pos = nodeData.position3D
    group.position.set(pos.x, pos.y, pos.z)

    // 创建主平面（图片承载）
    const mainPlane = this._createMainPlane(config, nodeData)
    mainPlane.name = 'mainPlane'
    group.add(mainPlane)

    // 创建边框（HIGH LOD时显示）
    const border = this._createBorder(config)
    border.name = 'border'
    group.add(border)

    // 创建文字标签（HIGH LOD时显示）
    if (this.showLabels) {
      const label = this._createLabel(config, nodeData)
      label.name = 'label'
      group.add(label)
    }

    // 加载图片纹理（异步）
    this._loadTexture(nodeData, mainPlane)

    return group
  }

  /**
   * 创建主平面
   * @param {Object} config - 节点配置
   * @param {Object} nodeData - 节点数据
   * @returns {THREE.Mesh} 主平面网格
   */
  _createMainPlane(config, nodeData) {
    const geometry = new THREE.PlaneGeometry(config.width, config.height)

    // 初始材质使用纯色（纹理加载完成后替换）
    const material = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.config = config
    mesh.userData.nodeData = nodeData

    return mesh
  }

  /**
   * 创建边框线条
   * @param {Object} config - 节点配置
   * @returns {THREE.LineSegments} 边框
   */
  _createBorder(config) {
    const w = config.width / 2
    const h = config.height / 2

    const points = [
      new THREE.Vector3(-w, -h, 0), new THREE.Vector3(w, -h, 0),
      new THREE.Vector3(w, -h, 0),  new THREE.Vector3(w, h, 0),
      new THREE.Vector3(w, h, 0),   new THREE.Vector3(-w, h, 0),
      new THREE.Vector3(-w, h, 0),  new THREE.Vector3(-w, -h, 0),
    ]

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0.8,
    })

    return new THREE.LineSegments(geometry, material)
  }

  /**
   * 创建文字标签（使用Canvas纹理）
   * @param {Object} config - 节点配置
   * @param {Object} nodeData - 节点数据
   * @returns {THREE.Mesh} 标签网格
   */
  _createLabel(config, nodeData) {
    // 从节点数据中提取显示文本
    const text = this._getLabelText(nodeData)

    // 使用Canvas生成文字纹理
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 文字
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 24px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
    })

    const geometry = new THREE.PlaneGeometry(config.width, 0.4)
    const mesh = new THREE.Mesh(geometry, material)

    // 定位在主平面下方
    mesh.position.y = -config.height / 2 - 0.3

    return mesh
  }

  /**
   * 从节点数据中提取标签文字
   * @param {Object} nodeData - 节点数据
   * @returns {String} 标签文字
   */
  _getLabelText(nodeData) {
    const { type, data } = nodeData

    switch (type) {
      case 'storyboard':
        return data?.frame_label || data?.title || `分镜${data?.frame_index ?? ''}`
      case 'character':
        return data?.name || data?.character_name || '角色'
      case 'scene':
        return data?.name || data?.scene_name || '场景'
      case 'prop':
        return data?.name || data?.prop_name || '道具'
      case 'script':
        return data?.title || '脚本'
      case 'episode':
        return data?.title || `第${data?.episode_number ?? '?'}集`
      case 'canvasLabel':
        return data?.text || data?.label || '标签'
      default:
        return data?.name || data?.title || '节点'
    }
  }

  /**
   * 异步加载图片纹理
   * @param {Object} nodeData - 节点数据
   * @param {THREE.Mesh} mainPlane - 主平面网格
   */
  _loadTexture(nodeData, mainPlane) {
    const imageUrl = this._getImageUrl(nodeData)
    if (!imageUrl) return

    // 检查缓存
    if (textureCache.has(imageUrl)) {
      this._applyTexture(mainPlane, textureCache.get(imageUrl))
      return
    }

    // 异步加载
    this.textureLoader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        textureCache.set(imageUrl, texture)
        this._applyTexture(mainPlane, texture)
      },
      undefined,
      (error) => {
        console.warn(`[Node3DFactory] 纹理加载失败: ${imageUrl}`, error)
      }
    )
  }

  /**
   * 应用纹理到主平面
   * @param {THREE.Mesh} mainPlane - 主平面网格
   * @param {THREE.Texture} texture - 纹理
   */
  _applyTexture(mainPlane, texture) {
    const material = mainPlane.material
    material.map = texture
    material.color.set(0xffffff) // 纹理加载后清除纯色
    material.opacity = 1.0
    material.needsUpdate = true
  }

  /**
   * 从节点数据中提取图片URL
   * @param {Object} nodeData - 节点数据
   * @returns {String|null} 图片URL
   */
  _getImageUrl(nodeData) {
    const { type, data } = nodeData

    switch (type) {
      case 'storyboard':
        return data?.image_url || data?.generated_image || null
      case 'character':
        return data?.avatar_url || data?.image_url || data?.front_view_url || null
      case 'scene':
        return data?.image_url || data?.background_url || null
      case 'prop':
        return data?.image_url || data?.thumbnail_url || null
      default:
        return data?.image_url || data?.thumbnail_url || null
    }
  }

  /**
   * 更新节点数据（如图片生成完成后更新纹理）
   * @param {THREE.Group} group - 3D节点容器
   * @param {Object} newData - 新的节点数据
   */
  updateData(group, newData) {
    const mainPlane = group.getObjectByName('mainPlane')
    if (!mainPlane) return

    // 更新userData
    group.userData.nodeData = { ...group.userData.nodeData, data: newData }

    // 如果图片URL变更，重新加载纹理
    const newImageUrl = this._getImageUrl({
      type: group.userData.nodeType,
      data: newData,
    })

    if (newImageUrl) {
      const currentTexture = mainPlane.material.map
      const currentUrl = currentTexture?.userData?.url

      if (newImageUrl !== currentUrl) {
        this._loadTexture(
          { ...group.userData.nodeData, data: newData },
          mainPlane
        )
      }
    }

    // 更新标签
    const label = group.getObjectByName('label')
    if (label) {
      // 重新生成标签纹理
      const config = mainPlane.userData.config
      const newLabel = this._createLabel(config, {
        type: group.userData.nodeType,
        data: newData,
      })
      group.remove(label)
      label.geometry?.dispose()
      label.material?.map?.dispose()
      label.material?.dispose()
      newLabel.name = 'label'
      group.add(newLabel)
    }
  }

  /**
   * 更新节点3D位置
   * @param {THREE.Group} group - 3D节点容器
   * @param {Object} position3D - 新位置 { x, y, z }
   */
  updatePosition(group, position3D) {
    group.position.set(position3D.x, position3D.y, position3D.z)
  }

  /**
   * 销毁节点，释放资源
   * @param {THREE.Group} group - 3D节点容器
   */
  dispose(group) {
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (child.material.map && child.material.map.userData?.generated) {
          child.material.map.dispose()
        }
        child.material.dispose()
      }
    })
  }

  /**
   * 清空纹理缓存
   */
  static clearTextureCache() {
    for (const texture of textureCache.values()) {
      texture.dispose()
    }
    textureCache.clear()
  }
}

export default Node3DFactory
