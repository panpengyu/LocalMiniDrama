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

      <!-- S10-T04/T05/T06: 站位/深度/时间轴 -->
      <div class="toolbar-group">
        <el-dropdown trigger="click" @command="(cmd) => $emit('arrange-characters', cmd)">
          <button class="movement-btn">角色站位</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="line">一字排开</el-dropdown-item>
              <el-dropdown-item command="arc">弧形站位</el-dropdown-item>
              <el-dropdown-item command="circle">环形站位</el-dropdown-item>
              <el-dropdown-item command="facing">面对面</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-tooltip content="场景深度预览" placement="bottom">
          <button class="preset-btn" :class="{ active: sceneDepthEnabled }" @click="$emit('toggle-scene-depth', !sceneDepthEnabled)">深度</button>
        </el-tooltip>
        <el-tooltip content="3D时间轴" placement="bottom">
          <button class="preset-btn" :class="{ active: timeline3DEnabled }" @click="$emit('toggle-timeline-3d', !timeline3DEnabled)">时间轴</button>
        </el-tooltip>
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
// S10-T04/T05/T06: 新增模块
import CharacterStageManager, { STAGE_PATTERNS } from './CharacterStageManager.js'
import SceneDepthPreview from './SceneDepthPreview.js'
import Timeline3DLayout from './Timeline3DLayout.js'

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
  // drama 项目数据对象（供 ViewSyncManager 节点数校验用，不会在此加载）
  drama: { type: Object, default: null },
})

const emit = defineEmits([
  'node-click',      // 3D节点点击事件
  'node-drag',       // 3D节点拖拽事件 (nodeId, position3D)
  'node-dblclick',   // S10-T03: 节点双击事件（进入2D精编）
  'view-change',     // 视图模式切换
  'position-change', // 节点位置变更 (需要同步回2D)
  'camera-change',   // 摄像机状态变更
  // S10-T04/T05/T06: 新增事件
  'arrange-characters',   // 角色站位编排请求
  'toggle-scene-depth',   // 场景深度预览开关
  'toggle-timeline-3d',   // 3D时间轴开关
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
// S10-T05/T06: 功能开关状态
const sceneDepthEnabled = ref(false)
const timeline3DEnabled = ref(false)

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
// S10-T04/T05/T06: 新增管理器
let characterStageManager = null
let sceneDepthPreview = null
let timeline3DLayout = null

// 性能监控
let frameCount = 0
let lastFpsTime = 0
let fpsDropLogTime = 0

// 拖拽状态
let dragTarget = null
let dragPlane = new THREE.Plane()
let dragOffset = new THREE.Vector3()
let raycaster = new THREE.Raycaster()
let mouse = new THREE.Vector2()

// S10-T03: 选中状态 + 轴约束拖拽
let selectedNode = null           // 当前选中的节点 Group
let selectedOutline = null         // 选中高亮边框 LineSegments
let dragAxis = null               // 拖拽轴约束: 'x' | 'y' | 'z' | null (null=自由拖拽)
let pointerDownTime = 0           // 按下时间戳（用于区分点击/双击）
let lastClickTime = 0             // 上次点击时间
const DOUBLE_CLICK_MS = 350       // 双击间隔阈值

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

  // 从2D节点列表重建3D场景（透传 drama 参数用于节点数校验日志）
  viewSyncManager.rebuildFrom2D(props.nodes, { drama: props.drama })

  // 恢复3D布局
  if (props.layout3D) {
    viewSyncManager.restore3DLayout(props.layout3D, props.nodes)
  }

  // 重建后做一次 2D/3D 节点完整性校验
  if (viewSyncManager) {
    viewSyncManager.validateAgainstDrama(props.drama)
  }

  // S10-T04: 角色站位编排管理器
  characterStageManager = new CharacterStageManager({
    scene,
    nodeMap: viewSyncManager.nodeMap,
  })

  // S10-T05: 场景深度预览管理器
  sceneDepthPreview = new SceneDepthPreview({
    scene,
    camera,
    textureLoader: new THREE.TextureLoader(),
  })

  // S10-T06: 时间轴3D化管理器
  timeline3DLayout = new Timeline3DLayout({
    scene,
    nodeMap: viewSyncManager.nodeMap,
  })
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
  pointerDownTime = performance.now()

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

      // S10-T03: 选中高亮
      selectNode(target)

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

      // S10-T03: 双击检测 — 进入2D精编模式
      const now = performance.now()
      if (now - lastClickTime < DOUBLE_CLICK_MS) {
        console.log(`[DIR-3D] 双击节点 → 请求进入2D精编`, { nodeId: target.userData.nodeId })
        emit('node-dblclick', { nodeId: target.userData.nodeId })
        lastClickTime = 0
      } else {
        lastClickTime = now
      }

      console.log(`[DIR-3D] onPointerDown node=${target.userData.nodeId}`, {
        hitPoint: `(${intersectPoint.x.toFixed(1)},${intersectPoint.y.toFixed(1)},${intersectPoint.z.toFixed(1)})`,
      })

      emit('node-click', { nodeId: target.userData.nodeId })
    }
  } else {
    // S10-T03: 点击空白处取消选中
    clearSelection()
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

  // S10-T03: 轴约束拖拽 — 只移动选定轴的分量
  const originalPos = dragTarget.position
  let newPosition
  if (dragAxis === 'x') {
    newPosition = { x: intersectPoint.x, y: originalPos.y, z: originalPos.z }
  } else if (dragAxis === 'y') {
    newPosition = { x: originalPos.x, y: intersectPoint.y, z: originalPos.z }
  } else if (dragAxis === 'z') {
    newPosition = { x: originalPos.x, y: originalPos.y, z: intersectPoint.z }
  } else {
    // 自由拖拽（无轴约束）
    newPosition = { x: intersectPoint.x, y: intersectPoint.y, z: intersectPoint.z }
  }

  // 从 dragTarget 获取 nodeId（修复：之前使用了未定义变量 nodeId）
  const nodeId = dragTarget.userData?.nodeId
  if (!nodeId) {
    console.warn(`[DIR-3D] onPointerMove - dragTarget has no nodeId in userData`, { userData: dragTarget.userData })
    return
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
    dragAxis = null
  }
}

// S10-T03: 选中节点高亮
function selectNode(target) {
  // 先清除之前选中
  clearSelection()

  selectedNode = target

  // 创建高亮边框（比节点稍大的线框）
  const config = target.userData
  const nodeType = config.nodeType
  const sizeMap = { storyboard: 4.5, character: 3, scene: 6.5, prop: 2, script: 2.5, episode: 5.5, canvasLabel: 1.8 }
  const w = (sizeMap[nodeType] || 2.5) / 2 + 0.3
  const h = w * 0.6 + 0.3

  const points = [
    new THREE.Vector3(-w, -h, 0.1), new THREE.Vector3(w, -h, 0.1),
    new THREE.Vector3(w, -h, 0.1),  new THREE.Vector3(w, h, 0.1),
    new THREE.Vector3(w, h, 0.1),   new THREE.Vector3(-w, h, 0.1),
    new THREE.Vector3(-w, h, 0.1),  new THREE.Vector3(-w, -h, 0.1),
  ]
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2, transparent: true, opacity: 0.9 })
  selectedOutline = new THREE.LineSegments(geo, mat)
  selectedOutline.name = 'selection_outline'
  target.add(selectedOutline)

  console.log(`[DIR-3D] selectNode`, { nodeId: target.userData.nodeId, nodeType })
}

// S10-T03: 取消选中
function clearSelection() {
  if (selectedOutline && selectedOutline.parent) {
    selectedOutline.parent.remove(selectedOutline)
    selectedOutline.geometry.dispose()
    selectedOutline.material.dispose()
  }
  selectedOutline = null
  selectedNode = null
}

// S10-T03: 设置拖拽轴约束
function setDragAxis(axis) {
  dragAxis = axis
  console.log(`[DIR-3D] setDragAxis`, { axis })
}

function onKeyDown(event) {
  if (!props.visible) return

  // S10-T03: 轴约束拖拽快捷键（仅在选中节点并拖拽时生效）
  if (event.key === 'x' || event.key === 'X') { setDragAxis('x'); return }
  if (event.key === 'y' || event.key === 'Y') { setDragAxis('y'); return }
  if (event.key === 'z' || event.key === 'Z') { setDragAxis('z'); return }
  if (event.key === 'Escape') { clearSelection(); setDragAxis(null); return }

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
  fpsDropLogTime = 0

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

    // FPS计算 + 卡顿监控
    frameCount++
    if (currentTime - lastFpsTime >= 1000) {
      const currentFps = Math.round((frameCount * 1000) / (currentTime - lastFpsTime))
      fps.value = currentFps

      if (currentFps < 20 && currentTime - fpsDropLogTime > 3000) {
        fpsDropLogTime = currentTime
        const pos = cameraController.camera.position
        console.warn(`[DIR-3D] FPS LOW=${currentFps}`, {
          pos: `(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`,
          preset: cameraController.currentPreset,
          transitioning: cameraController._transitioning,
          movement: cameraController._movementType || null,
          lodStats: { high: stats.high, medium: stats.medium, low: stats.low, hidden: stats.hidden },
        })
      }

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
  console.log(`[DIR-3D] switchPreset UI->3D`, {
    target: presetName,
    previous: currentPreset.value,
    fps: fps.value,
  })
  cameraController.switchToPreset(presetName, true)
  currentPreset.value = presetName
  emit('camera-change', cameraController.getState())
}

/**
 * 开始镜头运动
 */
function startCameraMovement(movementType) {
  console.log(`[DIR-3D] startCameraMovement UI->3D`, {
    type: movementType,
    fps: fps.value,
  })
  cameraController.startMovement(movementType, 0, 0.3)
  movementActive.value = true
}

/**
 * 停止镜头运动
 */
function stopCameraMovement() {
  console.log(`[DIR-3D] stopCameraMovement UI->3D`, {
    fps: fps.value,
  })
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
  const layout = {
    ...viewSyncManager.serialize3DLayout(),
    camera_3d: cameraController.getState(),
    view_mode: '3d',
  }
  // S10-T04: 合并角色站位编排数据
  if (characterStageManager) {
    layout.character_stage = characterStageManager.serialize()
  }
  // S10-T05: 合并场景深度预览数据
  if (sceneDepthPreview) {
    layout.scene_depth = sceneDepthPreview.serialize()
  }
  // S10-T06: 合并时间轴3D数据
  if (timeline3DLayout) {
    layout.timeline_3d = timeline3DLayout.serialize()
  }
  return layout
}

/**
 * S10-T04: 角色站位编排
 * @param {Array} characters - 角色节点列表 [{ nodeId, data }]
 * @param {String} pattern - 站位模式 (line/arc/circle/facing)
 * @param {Object} options - 排列参数
 */
function arrangeCharacters(characters, pattern = STAGE_PATTERNS.LINE, options = {}) {
  if (!characterStageManager) return
  console.log(`[DIR-3D] arrangeCharacters`, { count: characters.length, pattern })
  const positions = characterStageManager.arrange(characters, pattern, options)
  // 标记 LOD 位置脏
  for (const pos of positions) {
    lodManager.markPositionDirty(pos.nodeId)
  }
  return positions
}

/**
 * S10-T05: 场景深度预览开关
 */
function toggleSceneDepthPreview(enabled) {
  if (!sceneDepthPreview) return
  const state = sceneDepthPreview.toggle(enabled)
  console.log(`[DIR-3D] toggleSceneDepthPreview`, { enabled: state })
  return state
}

/**
 * S10-T06: 时间轴3D化开关
 * @param {Boolean} enabled
 * @param {Array} storyboards - 分镜节点列表 [{ nodeId, storyboard_number, layer }]
 */
function toggleTimeline3D(enabled, storyboards = []) {
  if (!timeline3DLayout) return
  console.log(`[DIR-3D] toggleTimeline3D`, { enabled, storyboardCount: storyboards.length })
  timeline3DLayout.toggle(enabled, storyboards)
  // 标记所有节点位置脏
  for (const entry of viewSyncManager.nodeMap.values()) {
    if (entry.mesh) {
      lodManager.markPositionDirty(entry.nodeId || entry.mesh.userData?.nodeId)
    }
  }
}

/**
 * 销毁
 */
function destroy() {
  stopAnimationLoop()
  clearSelection()
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
  // S10-T04/T05/T06: 销毁新模块
  characterStageManager?.destroy()
  sceneDepthPreview?.destroy()
  timeline3DLayout?.destroy()

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
  // S10-T03: 选中/轴约束
  clearSelection,
  setDragAxis,
  // S10-T04: 角色站位编排
  arrangeCharacters,
  // S10-T05: 场景深度预览
  toggleSceneDepthPreview,
  // S10-T06: 时间轴3D化
  toggleTimeline3D,
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
