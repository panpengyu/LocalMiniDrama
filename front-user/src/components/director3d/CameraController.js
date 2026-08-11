/**
 * CameraController — 3D导演台虚拟摄像机控制器
 *
 * 核心职责：
 * 1. 管理摄像机位置、朝向、焦距
 * 2. 提供预设机位（正视图/侧视图/俯视图/自由视角）
 * 3. 支持镜头运动模拟（推/拉/摇/移/跟/升/降）
 * 4. 平滑过渡动画（机位切换时）
 * 5. 鼠标交互控制（旋转/缩放/平移）
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// 预设机位配置
const CAMERA_PRESETS = {
  // 正视图：从正面观察，Y轴朝上
  front: {
    position: { x: 0, y: 0, z: 25 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
  },
  // 侧视图：从右侧观察，展示时间轴深度
  side: {
    position: { x: 30, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
  },
  // 俯视图：从上方观察，展示X-Y平面布局
  top: {
    position: { x: 0, y: 30, z: 0.01 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
  },
  // 自由视角：斜45度，最常用的3D导演视角
  free: {
    position: { x: 15, y: 10, z: 20 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
  },
  // 特写机位：拉近到中心节点
  close_up: {
    position: { x: 0, y: 0, z: 8 },
    target: { x: 0, y: 0, z: 0 },
    fov: 35,
  },
  // 鸟瞰机位：超远距离全景
  bird_view: {
    position: { x: 0, y: 40, z: 30 },
    target: { x: 0, y: 0, z: 0 },
    fov: 60,
  },
}

// 镜头运动类型
const CAMERA_MOVEMENTS = {
  DOLLY_IN: 'dolly_in',       // 推镜头（向前移动）
  DOLLY_OUT: 'dolly_out',     // 拉镜头（向后移动）
  PAN_LEFT: 'pan_left',       // 左摇
  PAN_RIGHT: 'pan_right',     // 右摇
  TILT_UP: 'tilt_up',         // 上摇
  TILT_DOWN: 'tilt_down',     // 下摇
  TRACK_LEFT: 'track_left',   // 左移
  TRACK_RIGHT: 'track_right', // 右移
  CRANE_UP: 'crane_up',       // 升镜头
  CRANE_DOWN: 'crane_down',   // 降镜头
}

export class CameraController {
  /**
   * @param {Object} options
   * @param {THREE.PerspectiveCamera} options.camera - 摄像机对象
   * @param {THREE.WebGLRenderer} options.renderer - 渲染器
   * @param {HTMLElement} options.domElement - Canvas DOM元素
   * @param {Number} options.transitionDuration - 机位切换过渡时间(毫秒)，默认 800ms
   */
  constructor(options) {
    this.camera = options.camera
    this.renderer = options.renderer
    this.domElement = options.domElement
    this.transitionDuration = options.transitionDuration ?? 800

    // 当前机位
    this.currentPreset = 'free'

    // OrbitControls 实例（处理鼠标交互）
    this.controls = new OrbitControls(this.camera, this.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = 0.8
    this.controls.zoomSpeed = 0.8
    this.controls.panSpeed = 0.8
    this.controls.minDistance = 3
    this.controls.maxDistance = 100

    // 过渡动画状态
    this._transitioning = false
    this._transitionStart = null
    this._transitionFrom = null
    this._transitionTo = null

    // 镜头运动状态
    this._movementActive = false
    this._movementType = null
    this._movementSpeed = 0.5

    // 日志：累计统计
    this._logCounter = {
      switchPreset: 0,
      transitionComplete: 0,
      startMovement: 0,
      stopMovement: 0,
      frameUpdate: 0,
    }
    this._lastTransitionProgressLog = -1
    this._lastMovementLogTime = 0
  }

  // =========================================================================
  // 日志辅助方法
  // =========================================================================

  _logCamera(event, detail = {}) {
    const pos = this.camera.position
    const tgt = this.controls.target
    const entry = {
      ...detail,
      pos: `(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`,
      target: `(${tgt.x.toFixed(1)},${tgt.y.toFixed(1)},${tgt.z.toFixed(1)})`,
      fov: this.camera.fov,
      preset: this.currentPreset,
      transitioning: this._transitioning,
      movement: this._movementType || null,
    }
    console.log(`[CAM-3D] ${event}`, entry)
  }

  /**
   * 切换到预设机位（带平滑过渡动画）
   * @param {String} presetName - 预设名称 (front/side/top/free/close_up/bird_view)
   * @param {Boolean} animate - 是否使用过渡动画，默认 true
   */
  switchToPreset(presetName, animate = true) {
    const preset = CAMERA_PRESETS[presetName]
    if (!preset) {
      console.warn(`[CAM-3D] 未知机位: ${presetName}`)
      return
    }

    // 前置状态日志
    const beforePos = this.camera.position
    const beforePreset = this.currentPreset
    this._logCounter.switchPreset++
    console.log(`[CAM-3D] switchToPreset START #${this._logCounter.switchPreset}`, {
      target: presetName, animate, from: beforePreset,
      fromPos: `(${beforePos.x.toFixed(1)},${beforePos.y.toFixed(1)},${beforePos.z.toFixed(1)})`,
      fromFov: this.camera.fov,
    })

    this.currentPreset = presetName

    if (!animate) {
      // 直接设置，无动画
      this._applyPreset(preset)
      this._logCamera('switchToPreset INSTANT', { target: presetName, duration: 0 })
      return
    }

    // 启动过渡动画
    this._startTransition(preset)
  }

  /**
   * 启动机位过渡动画
   * @param {Object} targetPreset - 目标机位配置
   */
  _startTransition(targetPreset) {
    this._transitioning = true

    // 禁用 OrbitControls（过渡期间不允许手动控制）
    this.controls.enabled = false

    // 记录起始状态
    this._transitionFrom = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    }

    // 记录目标状态
    this._transitionTo = {
      position: new THREE.Vector3(
        targetPreset.position.x,
        targetPreset.position.y,
        targetPreset.position.z
      ),
      target: new THREE.Vector3(
        targetPreset.target.x,
        targetPreset.target.y,
        targetPreset.target.z
      ),
      fov: targetPreset.fov,
    }

    this._transitionStart = performance.now()
    this._lastTransitionProgressLog = -1

    console.log(`[CAM-3D] _startTransition`, {
      targetPreset: this.currentPreset,
      duration: this.transitionDuration,
      fromPos: `(${this._transitionFrom.position.x.toFixed(1)},${this._transitionFrom.position.y.toFixed(1)},${this._transitionFrom.position.z.toFixed(1)})`,
      toPos: `(${this._transitionTo.position.x.toFixed(1)},${this._transitionTo.position.y.toFixed(1)},${this._transitionTo.position.z.toFixed(1)})`,
      fromTarget: `(${this._transitionFrom.target.x.toFixed(1)},${this._transitionFrom.target.y.toFixed(1)},${this._transitionFrom.target.z.toFixed(1)})`,
      toTarget: `(${this._transitionTo.target.x.toFixed(1)},${this._transitionTo.target.y.toFixed(1)},${this._transitionTo.target.z.toFixed(1)})`,
      fromFov: this._transitionFrom.fov,
      toFov: this._transitionTo.fov,
    })
  }

  /**
   * 更新过渡动画（由DirectorStage3D在动画循环中调用）
   * @param {Number} currentTime - 当前时间戳
   */
  update(currentTime) {
    // 处理机位过渡动画
    if (this._transitioning) {
      this._updateTransition(currentTime)
    }

    // 处理镜头运动
    if (this._movementActive) {
      this._updateMovement()
    }

    // 更新 OrbitControls
    this.controls.update()
  }

  /**
   * 更新机位过渡动画
   * @param {Number} currentTime - 当前时间戳
   */
  _updateTransition(currentTime) {
    const elapsed = currentTime - this._transitionStart
    const progress = Math.min(elapsed / this.transitionDuration, 1)

    // 每25%进度打一次日志（避免刷屏）
    const progressPct = Math.floor(progress * 4) // 0-4
    if (progressPct !== this._lastTransitionProgressLog) {
      this._lastTransitionProgressLog = progressPct
      this._logCounter.frameUpdate++
      console.log(`[CAM-3D] _updateTransition progress=${(progress * 100).toFixed(0)}% elapsed=${elapsed.toFixed(0)}ms`, {
        easing: progress < 0.5 ? (4 * progress * progress * progress).toFixed(3) : (1 - Math.pow(-2 * progress + 2, 3) / 2).toFixed(3),
        pos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
      })
    }

    // 缓动函数：easeInOutCubic
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2

    // 插值位置
    this.camera.position.lerpVectors(
      this._transitionFrom.position,
      this._transitionTo.position,
      eased
    )

    // 插值焦点
    this.controls.target.lerpVectors(
      this._transitionFrom.target,
      this._transitionTo.target,
      eased
    )

    // 插值 FOV
    this.camera.fov = THREE.MathUtils.lerp(
      this._transitionFrom.fov,
      this._transitionTo.fov,
      eased
    )
    this.camera.updateProjectionMatrix()

    // 过渡完成
    if (progress >= 1) {
      this._transitioning = false
      this.controls.enabled = true // 恢复手动控制
      this._logCounter.transitionComplete++
      const totalMs = currentTime - this._transitionStart
      console.log(`[CAM-3D] _updateTransition COMPLETE #${this._logCounter.transitionComplete}`, {
        totalDurationMs: totalMs,
        targetPreset: this.currentPreset,
        finalPos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
        finalFov: this.camera.fov,
      })
    }
  }

  /**
   * 执行镜头运动
   * @param {String} movementType - 运动类型 (CAMERA_MOVEMENTS)
   * @param {Number} duration - 持续时间(毫秒)，0表示持续直到stopMovement
   * @param {Number} speed - 运动速度
   */
  startMovement(movementType, duration = 0, speed = 0.5) {
    this._logCounter.startMovement++
    console.log(`[CAM-3D] startMovement #${this._logCounter.startMovement}`, {
      type: movementType, duration, speed,
      pos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
    })
    this._movementActive = true
    this._movementType = movementType
    this._movementSpeed = speed
    this._lastMovementLogTime = 0

    if (duration > 0) {
      setTimeout(() => this.stopMovement(), duration)
    }
  }

  /**
   * 停止镜头运动
   */
  stopMovement() {
    if (!this._movementActive) return
    this._logCounter.stopMovement++
    console.log(`[CAM-3D] stopMovement #${this._logCounter.stopMovement}`, {
      lastType: this._movementType,
      pos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
    })
    this._movementActive = false
    this._movementType = null
  }

  /**
   * 更新镜头运动
   */
  _updateMovement() {
    const speed = this._movementSpeed
    const moveVector = new THREE.Vector3()
    const cameraDirection = new THREE.Vector3()
    this.camera.getWorldDirection(cameraDirection)

    switch (this._movementType) {
      case CAMERA_MOVEMENTS.DOLLY_IN:
        moveVector.copy(cameraDirection).multiplyScalar(speed)
        break
      case CAMERA_MOVEMENTS.DOLLY_OUT:
        moveVector.copy(cameraDirection).multiplyScalar(-speed)
        break
      case CAMERA_MOVEMENTS.TRACK_LEFT:
        moveVector.crossVectors(cameraDirection, this.camera.up).normalize().multiplyScalar(-speed)
        break
      case CAMERA_MOVEMENTS.TRACK_RIGHT:
        moveVector.crossVectors(cameraDirection, this.camera.up).normalize().multiplyScalar(speed)
        break
      case CAMERA_MOVEMENTS.CRANE_UP:
        moveVector.y = speed
        break
      case CAMERA_MOVEMENTS.CRANE_DOWN:
        moveVector.y = -speed
        break
      case CAMERA_MOVEMENTS.PAN_LEFT:
        this.controls.target.x -= speed
        return
      case CAMERA_MOVEMENTS.PAN_RIGHT:
        this.controls.target.x += speed
        return
      case CAMERA_MOVEMENTS.TILT_UP:
        this.controls.target.y += speed
        return
      case CAMERA_MOVEMENTS.TILT_DOWN:
        this.controls.target.y -= speed
        return
    }

    // 同时移动摄像机和焦点（保持相对位置）
    this.camera.position.add(moveVector)
    this.controls.target.add(moveVector)

    // 每500ms打一次运动日志
    const now = performance.now()
    if (now - this._lastMovementLogTime > 500) {
      this._lastMovementLogTime = now
      console.log(`[CAM-3D] _updateMovement type=${this._movementType}`, {
        delta: `(${moveVector.x.toFixed(3)},${moveVector.y.toFixed(3)},${moveVector.z.toFixed(3)})`,
        pos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
        target: `(${this.controls.target.x.toFixed(1)},${this.controls.target.y.toFixed(1)},${this.controls.target.z.toFixed(1)})`,
      })
    }
  }

  /**
   * 聚焦到指定节点
   * @param {THREE.Vector3} nodePosition - 节点3D位置
   * @param {Number} distance - 摄像机与节点的距离
   */
  focusOn(nodePosition, distance = 10) {
    console.log(`[CAM-3D] focusOn`, {
      nodePos: `(${nodePosition.x.toFixed(1)},${nodePosition.y.toFixed(1)},${nodePosition.z.toFixed(1)})`,
      distance,
      currentPos: `(${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)})`,
    })
    this._transitioning = true
    this.controls.enabled = false

    this._transitionFrom = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    }

    // 计算摄像机位置：从当前方向靠近节点
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize()

    this._transitionTo = {
      position: nodePosition.clone().add(direction.multiplyScalar(distance)),
      target: nodePosition.clone(),
      fov: this.camera.fov,
    }

    this._transitionStart = performance.now()
    this._lastTransitionProgressLog = -1
  }

  /**
   * 获取当前摄像机状态（用于持久化）
   * @returns {Object} { position, target, fov, preset }
   */
  getState() {
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      target: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      },
      fov: this.camera.fov,
      preset: this.currentPreset,
    }
  }

  /**
   * 恢复摄像机状态
   * @param {Object} state - 摄像机状态
   */
  restoreState(state) {
    if (!state) return
    console.log(`[CAM-3D] restoreState`, {
      preset: state.preset,
      pos: `(${state.position?.x ?? 0},${state.position?.y ?? 0},${state.position?.z ?? 0})`,
      target: `(${state.target?.x ?? 0},${state.target?.y ?? 0},${state.target?.z ?? 0})`,
      fov: state.fov,
    })

    this.camera.position.set(state.position.x, state.position.y, state.position.z)
    this.controls.target.set(state.target.x, state.target.y, state.target.z)
    this.camera.fov = state.fov
    this.camera.updateProjectionMatrix()
    this.controls.update()

    if (state.preset && CAMERA_PRESETS[state.preset]) {
      this.currentPreset = state.preset
    }

    this._logCamera('restoreState COMPLETE')
  }

  /**
   * 直接应用预设（无动画）
   * @param {Object} preset - 预设配置
   */
  _applyPreset(preset) {
    this.camera.position.set(
      preset.position.x,
      preset.position.y,
      preset.position.z
    )
    this.controls.target.set(
      preset.target.x,
      preset.target.y,
      preset.target.z
    )
    this.camera.fov = preset.fov
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this._logCamera('_applyPreset', { preset: this.currentPreset, duration: 0 })
  }

  /**
   * 销毁控制器
   */
  destroy() {
    this.controls.dispose()
    this._movementActive = false
    this._transitioning = false
  }
}

export { CAMERA_PRESETS, CAMERA_MOVEMENTS }
export default CameraController
