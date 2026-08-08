<!--
  DirectorStage3D.vue — 3D导演台主组件

  核心职责：
  1. 初始化和管理 Three.js 场景（Scene/Camera/Renderer/Light）
  2. 集成 ViewSyncManager 实现 2D/3D 数据双向同步
  3. 集成 LODManager 实现性能优化
  4. 集成 Node3DFactory 创建3D节点
  5. 集成 CameraController 管理虚拟摄像机
  6. 提供 2D/3D 视图切换、机位切换、镜头运动等交互UI

  使用方式：
  <DirectorStage3D
    :nodes="canvasNodes"
    :visible="show3DMode"
    :camera-state="savedCameraState"
    @node-click="on3DNodeClick"
    @node-drag="on3DNodeDrag"
    @view-change="onViewModeChange"
  />
-->
<template>
  <div class="director-stage-3d" :class="{ 'is-visible': visible }">
    <!-- Three.js Canvas 容器 -->
    <div ref="canvasContainer" class="canvas-container"></div>

    <!-- 顶部工具栏 -->
    <div class="toolbar-top" v-if="visible">
      <div class="toolbar-group">
        <span class="toolbar-title">3D导演台</span>
      </div>

      <!-- 机位切换 -->
      <div class="toolbar-group">
        <el-tooltip content="正视图 (1)" placement="bottom">
          <button class="preset-btn" :class="{ active: currentPreset === 'front' }" @click="switchPreset('front')">正</button>
        </el-tooltip>
        <el-tooltip content="侧视图 (2)" placement="bottom">
          <button class="preset-btn" :class="{ active: currentPreset === 'side' }" @click="switchPreset('side')">侧</button>
        </el-tooltip>
        <el-tooltip content="俯视图 (3)" placement="bottom">
          <button class="preset-btn" :class="{ active: currentPreset === 'top' }" @click="switchPreset('top')">俯</button>
        </el-tooltip>
        <el-tooltip content="自由视角 (0)" placement="bottom">
          <button class="preset-btn" :class="{ active: currentPreset === 'free' }" @click="switchPreset('free')">自由</button>
        </el-tooltip>
      </div>

      <!-- 镜头运动 -->
      <div class="toolbar-group">
        <el-dropdown trigger="click" @command="startCameraMovement">
          <button class="movement-btn">镜头运动</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="dolly_in">推镜头</el-dropdown-item>
              <el-dropdown-item command="dolly_out">拉镜头</el-dropdown-item>
              <el-dropdown-item command="pan_left">左摇</el-dropdown-item>
              <el-dropdown-item command="pan_right">右摇</el-dropdown-item>
              <el-dropdown-item command="tilt_up">上摇</el-dropdown-item>
              <el-dropdown-item command="tilt_down">下摇</el-dropdown-item>
              <el-dropdown-item command="track_left">左移</el-dropdown-item>
              <el-dropdown-item command="track_right">右移</el-dropdown-item>
              <el-dropdown-item command="crane_up">升镜头</el-dropdown-item>
              <el-dropdown-item command="crane_down">降镜头</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="stop-btn" @click="stopCameraMovement" v-if="movementActive">停止</button>
      </div>

      <!-- LOD统计 -->
      <div class="toolbar-group lod-stats">
        <span class="stat-item high">高:{{ lodStats.high }}</span>
        <span class="stat-item medium">中:{{ lodStats.medium }}</span>
        <span class="stat-item low">低:{{ lodStats.low }}</span>
        <span class="stat-item hidden">隐:{{ lodStats.hidden }}</span>
      </div>

      <!-- 切换回2D -->
      <div class="toolbar-group">
        <button class="switch-2d-btn" @click="$emit('view-change', '2d')">
          切换到2D画布
        </button>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="status-bar" v-if="visible">
      <span class="status-item">节点: {{ nodeCount }}</span>
      <span class="status-item">FPS: {{ fps }}</span>
      <span class="status-item">机位: {{ currentPreset }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as THREE from 'three'
import ViewSyncManager from './ViewSyncManager.js'
import LODManager from './LODManager.js'
import Node3DFactory from './Node3DFactory.js'
import CameraController, { CAMERA_PRESETS } from './CameraController.js'

// ===========================================================================
// Props & Emits
// ===========================================================================

const props = defineProps({
  // Vue Flow 节点列表
  nodes: { type: Array, default: () => [] },
  // 是否显示3D视图
  visible: { type: Boolean, default: false },
  // 保存的摄像机状态
  cameraState: { type: Object, default: null },
  // 保存的3D布局数据
  layout3D: { type: Object, default: null },
})

const emit = defineEmits([
  'node-click',      // 3D节点点击事件
  'node-drag',       // 3D节点拖拽事件 (nodeId, position3D)
  'view-change',     // 视图模式切换
  'position-change', // 节点位置变更 (需要同步回2D)
  'camera-change',   // 摄像机状态变更
])

// ===========================================================================
// 响应式状态
// ===========================================================================

const canvasContainer = ref(null)
const currentPreset = ref('free')
const movementActive = ref(false)
const nodeCount = ref(0)
const fps = ref(60)
const lodStats = ref({ high: 0, medium: 0, low: 0, hidden: 0 })

// ===========================================================================
// Three.js 核心对象（非响应式）
// ===========================================================================

let scene = null
let camera = null
let renderer = null
let animationId = null
let clock = null

// 管理器实例
let viewSyncManager = null
let lodManager = null
let nodeFactory = null
let cameraController = null

// 性能监控
let frameCount = 0
let lastFpsTime = 0

// 拖拽状态
let dragTarget = null
let dragPlane = new THREE.Plane()
let dragOffset = new THREE.Vector3()
let raycaster = new THREE.Raycaster()
let mouse = new THREE.Vector2()

// ===========================================================================
// 初始化
// ===========================================================================

onMounted(() => {
  nextTick(() => {
    initScene()
    initManagers()
    initEventListeners()
    if (props.visible) {
      startAnimationLoop()
    }
  })
})

onBeforeUnmount(() => {
  destroy()
})

// ===========================================================================
// 场景初始化
// ===========================================================================

function initScene() {
  const container = canvasContainer.value
  if (!container) return

  const width = container.clientWidth
  const height = container.clientHeight

  // 场景
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)
  scene.fog = new THREE.Fog(0x1a1a2e, 50, 200)

  // 摄像机
  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)
  camera.position.set(15, 10, 20)
  camera.lookAt(0, 0, 0)

  // 渲染器
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  // 灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5)
  directionalLight.position.set(10, 20, 15)
  scene.add(directionalLight)

  // 网格地面（辅助参考）
  const gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222)
  gridHelper.rotation.x = Math.PI / 2 // 旋转到X-Y平面
  scene.add(gridHelper)

  // 层级分隔线（背景/中景/前景）
  addLayerGuides()

  // 时钟
  clock = new THREE.Clock()
}

/**
 * 添加层级分隔辅助线
 */
function addLayerGuides() {
  const layers = [
    { z: 200, color: 0x10b981, name: '背景层' },
    { z: 100, color: 0x4f9cf9, name: '中景层' },
    { z: 50, color: 0xa855f7, name: '前景层' },
  ]

  for (const layer of layers) {
    const geometry = new THREE.BufferGeometry()
    const points = [
      new THREE.Vector3(-50, -30, layer.z),
      new THREE.Vector3(50, -30, layer.z),
    ]
    geometry.setFromPoints(points)
    const material = new THREE.LineDashedMaterial({
      color: layer.color,
      dashSize: 1,
      gapSize: 0.5,
      transparent: true,
      opacity: 0.3,
    })
    const line = new THREE.Line(geometry, material)
    line.computeLineDistances()
    line.name = `layer_guide_${layer.name}`
    scene.add(line)
  }
}

// ===========================================================================
// 管理器初始化
// ===========================================================================

function initManagers() {
  // 节点工厂
  nodeFactory = new Node3DFactory({
    textureLoader: new THREE.TextureLoader(),
    showLabels: true,
  })

  // LOD管理器
  lodManager = new LODManager({
    camera,
    scene,
    updateInterval: 100,
  })

  // 摄像机控制器
  cameraController = new CameraController({
    camera,
    renderer,
    domElement: renderer.domElement,
    transitionDuration: 800,
  })

  // 恢复摄像机状态
  if (props.cameraState) {
    cameraController.restoreState(props.cameraState)
    currentPreset.value = props.cameraState.preset || 'free'
  }

  // 视图同步管理器
  viewSyncManager = new ViewSyncManager({
    // 获取当前2D节点列表
    getNodes: () => props.nodes,
    // 更新2D节点位置（3D拖拽同步回2D）
    updateNodePosition: (nodeId, x, y) => {
      emit('position-change', { nodeId, x, y })
    },
    // 3D节点添加回调
    on3DNodeAdded: (nodeData) => {
      const group = nodeFactory.create(nodeData)
      scene.add(group)

      // 注册到LOD管理器
      lodManager.register(nodeData.nodeId, group, nodeData.type, {})

      nodeCount.value = viewSyncManager.nodeMap.size
      return group
    },
    // 3D节点移除回调
    on3DNodeRemoved: (nodeId) => {
      const entry = viewSyncManager.nodeMap.get(nodeId)
      if (entry?.mesh) {
        lodManager.unregister(nodeId)
        scene.remove(entry.mesh)
        nodeFactory.dispose(entry.mesh)
      }
      nodeCount.value = viewSyncManager.nodeMap.size
    },
    // 3D节点更新回调
    on3DNodeUpdated: (nodeId, updates) => {
      const entry = viewSyncManager.nodeMap.get(nodeId)
      if (!entry?.mesh) return

      if (updates.position3D) {
        nodeFactory.updatePosition(entry.mesh, updates.position3D)
        lodManager.markPositionDirty(nodeId)
      }
      if (updates.data) {
        nodeFactory.updateData(entry.mesh, updates.data)
      }
    },
  })

  // 从2D节点列表重建3D场景
  viewSyncManager.rebuildFrom2D(props.nodes)

  // 恢复3D布局
  if (props.layout3D) {
    viewSyncManager.restore3DLayout(props.layout3D, props.nodes)
  }
}

// ===========================================================================
// 事件监听
// ===========================================================================

function initEventListeners() {
  const dom = renderer.domElement

  // 鼠标点击/拖拽
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', onPointerUp)

  // 键盘快捷键
  window.addEventListener('keydown', onKeyDown)

  // 窗口resize
  window.addEventListener('resize', onResize)
}

// ===========================================================================
// 交互处理
// ===========================================================================

function onPointerDown(event) {
  if (!props.visible) return

  updateMousePosition(event)

  // 射线检测
  raycaster.setFromCamera(mouse, camera)
  const meshes = []

  // 收集所有可见节点的网格
  for (const entry of viewSyncManager.nodeMap.values()) {
    if (entry.mesh?.visible) {
      entry.mesh.traverse((child) => {
        if (child.isMesh) meshes.push(child)
      })
    }
  }

  const intersects = raycaster.intersectObjects(meshes, false)

  if (intersects.length > 0) {
    const hit = intersects[0].object
    // 向上查找包含 nodeId 的 Group
    let target = hit
    while (target && !target.userData?.nodeId) {
      target = target.parent
    }

    if (target?.userData?.nodeId) {
      dragTarget = target

      // 设置拖拽平面（垂直于摄像机方向，经过节点位置）
      const cameraDirection = new THREE.Vector3()
      camera.getWorldDirection(cameraDirection)
      dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, target.position)

      // 计算拖拽偏移
      const intersectPoint = new THREE.Vector3()
      raycaster.ray.intersectPlane(dragPlane, intersectPoint)
      dragOffset.copy(intersectPoint).sub(target.position)

      // 禁用 OrbitControls（拖拽节点时不旋转视角）
      cameraController.controls.enabled = false

      emit('node-click', { nodeId: target.userData.nodeId })
    }
  }
}

function onPointerMove(event) {
  if (!dragTarget) return

  updateMousePosition(event)
  raycaster.setFromCamera(mouse, camera)

  const intersectPoint = new THREE.Vector3()
  raycaster.ray.intersectPlane(dragPlane, intersectPoint)

  // 应用偏移
  intersectPoint.sub(dragOffset)

  // 更新3D位置
  const nodeId = dragTarget.userData.nodeId
  const newPosition = {
    x: intersectPoint.x,
    y: intersectPoint.y,
    z: intersectPoint.z,
  }

  // 通知 ViewSyncManager（3D→2D同步）
  viewSyncManager.on3DPositionChange(nodeId, newPosition)

  // 更新Mesh位置
  nodeFactory.updatePosition(dragTarget, newPosition)
  lodManager.markPositionDirty(nodeId)

  emit('node-drag', { nodeId, position3D: newPosition })
}

function onPointerUp() {
  if (dragTarget) {
    // 恢复 OrbitControls
    cameraController.controls.enabled = true
    dragTarget = null
  }
}

function onKeyDown(event) {
  if (!props.visible) return

  // 数字键切换机位
  switch (event.key) {
    case '1': switchPreset('front'); break
    case '2': switchPreset('side'); break
    case '3': switchPreset('top'); break
    case '0': switchPreset('free'); break
  }
}

function updateMousePosition(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

function onResize() {
  if (!canvasContainer.value || !renderer) return

  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// ===========================================================================
// 动画循环
// ===========================================================================

function startAnimationLoop() {
  if (animationId) return

  lastFpsTime = performance.now()
  frameCount = 0

  function animate() {
    animationId = requestAnimationFrame(animate)

    const currentTime = performance.now()
    const deltaTime = clock.getDelta()

    // 更新摄像机控制器（过渡动画 + OrbitControls）
    cameraController.update(currentTime)

    // LOD评估（内部节流，每100ms执行一次）
    lodManager.update(currentTime)

    // 更新LOD统计显示
    const stats = lodManager.getStats()
    lodStats.value = {
      high: stats.high,
      medium: stats.medium,
      low: stats.low,
      hidden: stats.hidden,
    }

    // 渲染
    renderer.render(scene, camera)

    // FPS计算
    frameCount++
    if (currentTime - lastFpsTime >= 1000) {
      fps.value = Math.round((frameCount * 1000) / (currentTime - lastFpsTime))
      frameCount = 0
      lastFpsTime = currentTime
    }
  }

  animate()
}

function stopAnimationLoop() {
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
}

// ===========================================================================
// 公共方法
// ===========================================================================

/**
 * 切换机位
 */
function switchPreset(presetName) {
  cameraController.switchToPreset(presetName, true)
  currentPreset.value = presetName
  emit('camera-change', cameraController.getState())
}

/**
 * 开始镜头运动
 */
function startCameraMovement(movementType) {
  cameraController.startMovement(movementType, 0, 0.3)
  movementActive.value = true
}

/**
 * 停止镜头运动
 */
function stopCameraMovement() {
  cameraController.stopMovement()
  movementActive.value = false
}

/**
 * 聚焦到指定节点
 */
function focusOnNode(nodeId) {
  const entry = viewSyncManager.nodeMap.get(nodeId)
  if (entry?.mesh) {
    cameraController.focusOn(entry.mesh.position, 8)
  }
}

/**
 * 获取3D布局数据（用于持久化）
 */
function get3DLayout() {
  return {
    ...viewSyncManager.serialize3DLayout(),
    camera_3d: cameraController.getState(),
    view_mode: '3d',
  }
}

/**
 * 销毁
 */
function destroy() {
  stopAnimationLoop()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', onResize)

  if (renderer?.domElement) {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
  }

  viewSyncManager?.destroy()
  lodManager?.destroy()
  cameraController?.destroy()

  if (renderer) {
    renderer.dispose()
    if (renderer.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }

  scene = null
  camera = null
  renderer = null
}

// ===========================================================================
// Watchers
// ===========================================================================

// 监听 visible 切换
watch(() => props.visible, (val) => {
  if (val) {
    nextTick(() => {
      onResize()
      startAnimationLoop()
    })
  } else {
    stopAnimationLoop()
  }
})

// 监听节点列表变更
watch(() => props.nodes, (newNodes, oldNodes) => {
  if (!viewSyncManager) return

  // 检测新增节点
  const oldIds = new Set((oldNodes || []).map((n) => n.id))
  const newIds = new Set(newNodes.map((n) => n.id))

  // 添加新节点
  for (const node of newNodes) {
    if (!oldIds.has(node.id)) {
      viewSyncManager.on2DNodeAdded(node)
    }
  }

  // 移除已删除节点
  for (const oldId of oldIds) {
    if (!newIds.has(oldId)) {
      viewSyncManager.on2DNodeRemoved(oldId)
    }
  }

  // 更新位置变更的节点
  for (const node of newNodes) {
    const entry = viewSyncManager.nodeMap.get(node.id)
    if (entry && (entry.position2D.x !== node.position.x || entry.position2D.y !== node.position.y)) {
      viewSyncManager.on2DPositionChange(node.id, node.position)
    }
  }
}, { deep: true })

// 暴露公共方法
defineExpose({
  switchPreset,
  focusOnNode,
  get3DLayout,
  startCameraMovement,
  stopCameraMovement,
})
</script>

<style scoped>
.director-stage-3d {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.director-stage-3d.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.canvas-container {
  width: 100%;
  height: 100%;
}

.canvas-container canvas {
  display: block;
  cursor: grab;
}

.canvas-container canvas:active {
  cursor: grabbing;
}

/* 顶部工具栏 */
.toolbar-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: linear-gradient(180deg, rgba(26, 26, 46, 0.95) 0%, rgba(26, 26, 46, 0) 100%);
  pointer-events: auto;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-title {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin-right: 8px;
}

/* 机位按钮 */
.preset-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.preset-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.preset-btn.active {
  background: #4f9cf9;
  border-color: #4f9cf9;
  color: #fff;
}

/* 镜头运动按钮 */
.movement-btn,
.stop-btn,
.switch-2d-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.movement-btn:hover,
.stop-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.stop-btn {
  border-color: #ef4444;
  color: #ef4444;
}

.switch-2d-btn {
  margin-left: auto;
  border-color: #4f9cf9;
  color: #4f9cf9;
}

.switch-2d-btn:hover {
  background: rgba(79, 156, 249, 0.15);
  color: #fff;
}

/* LOD统计 */
.lod-stats {
  margin-left: 16px;
  gap: 8px;
}

.stat-item {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}

.stat-item.high { color: #10b981; }
.stat-item.medium { color: #eab308; }
.stat-item.low { color: #f97316; }
.stat-item.hidden { color: #6b7280; }

/* 底部状态栏 */
.status-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 16px;
  padding: 4px 16px;
  background: linear-gradient(0deg, rgba(26, 26, 46, 0.95) 0%, rgba(26, 26, 46, 0) 100%);
  pointer-events: none;
}

.status-item {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
</style>
