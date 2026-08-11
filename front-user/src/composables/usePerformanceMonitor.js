/**
 * usePerformanceMonitor — 画布性能监控
 *
 * 用途：
 *   实时监控画布 FPS、渲染节点数、单次渲染耗时，并在帧率过低时标记降级模式，
 *   供上层据此关闭非必要特效（阴影、过渡、缩略图等）以保流畅。
 *
 * API：
 *   fps         ref<number>   当前帧率（每秒更新一次）
 *   nodeCount   ref<number>   当前渲染节点数（由调用方写入）
 *   renderTime  ref<number>   最近一次渲染耗时 ms（由调用方写入）
 *   shouldDegrade computed    FPS < 30 时为 true，触发降级逻辑
 *   isDegrading ref<boolean>  是否处于降级模式（与 shouldDegrade 同步，便于 watch）
 *   logMetrics()              打印当前性能指标到控制台
 *   start() / stop()          手动控制监控循环（默认自动启动）
 *
 * 实现：
 *   - 通过 requestAnimationFrame 累计帧数，每 1s 计算一次 FPS。
 *   - 作用域销毁时自动 cancelAnimationFrame。
 */

import { ref, computed, getCurrentScope, onScopeDispose } from 'vue'

// 降级阈值：FPS 低于该值视为性能不足
const DEGRADE_FPS_THRESHOLD = 30

export function usePerformanceMonitor(options = {}) {
  const autoStart = options.autoStart ?? true

  // ---- 响应式状态 ----
  const fps = ref(0)
  const nodeCount = ref(0)
  const renderTime = ref(0)
  const isDegrading = ref(false)

  /** FPS < 阈值时返回 true，可用于触发降级 */
  const shouldDegrade = computed(() => fps.value > 0 && fps.value < DEGRADE_FPS_THRESHOLD)

  // ---- RAF 计帧循环 ----
  let rafId = null
  let frames = 0
  let lastTime = 0

  function loop(now) {
    frames++
    const elapsed = now - lastTime
    // 每 1000ms 结算一次帧率
    if (elapsed >= 1000) {
      fps.value = Math.round((frames * 1000) / elapsed)
      frames = 0
      lastTime = now
      // 同步降级标记（避免每帧都写 isDegrading）
      const degrade = fps.value > 0 && fps.value < DEGRADE_FPS_THRESHOLD
      if (isDegrading.value !== degrade) {
        isDegrading.value = degrade
        if (degrade) {
          console.warn(`[PerformanceMonitor] 进入降级模式：FPS=${fps.value} < ${DEGRADE_FPS_THRESHOLD}`)
        }
      }
    }
    rafId = requestAnimationFrame(loop)
  }

  /** 启动监控循环 */
  function start() {
    if (rafId !== null) return
    frames = 0
    lastTime = performance.now()
    rafId = requestAnimationFrame(loop)
  }

  /** 停止监控循环 */
  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  /**
   * 打印当前性能指标。
   * @param {string} [tag] 可选日志标签
   */
  function logMetrics(tag = '') {
    const prefix = tag ? `[${tag}]` : '[PerformanceMonitor]'
    console.log(`${prefix} 性能指标:`, {
      fps: fps.value,
      nodeCount: nodeCount.value,
      renderTime: `${renderTime.value.toFixed(2)}ms`,
      shouldDegrade: shouldDegrade.value,
      isDegrading: isDegrading.value,
    })
  }

  if (autoStart) start()

  // 作用域销毁时自动停止循环
  if (getCurrentScope()) {
    onScopeDispose(stop)
  }

  return {
    fps,
    nodeCount,
    renderTime,
    shouldDegrade,
    isDegrading,
    logMetrics,
    start,
    stop,
  }
}

export default usePerformanceMonitor
