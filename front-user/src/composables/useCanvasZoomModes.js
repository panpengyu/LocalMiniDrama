/**
 * Sprint 5 — S5-T01/S5-T02/S5-T06
 * useCanvasZoomModes: 画布缩放档级、节点视图模式、平滑缩放过渡
 *
 * 设计原则：单向数据流、权威状态唯一
 *   - 权威状态：zoomLevel（当前档级索引）+ zoomRatio（实际比例）+ viewMode（compact/normal/detailed）
 *   - 派生状态：由 zoomRatio 直接派生（禁止独立维护多个 zoom 副本）
 *   - 触发：点击档位按钮 / 控件 zoomInOut / 滚轮 / 键盘 → 统一走 setZoomLevel / setZoomRatio
 *   - 平滑过渡：全部通过 requestAnimationFrame + easeOutCubic 到目标值，避免跳变
 *
 * 验收标准：
 *   - 5 档缩放：10%(鸟瞰) / 25%(概览) / 50%(编辑) / 100%(精编) / 200%(微调)
 *   - 3 种视图：zoom<=0.2→compact；0.2<zoom<=0.8→normal；zoom>0.8→detailed
 *   - 切换 zoom 级别时平滑过渡（RAF + easeOutCubic）
 */

import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

// ---- 常量 ----
const ZOOM_LEVELS = [
  { key: 'birdseye', ratio: 0.10, label: '10%', desc: '鸟瞰' },
  { key: 'overview', ratio: 0.25, label: '25%', desc: '概览' },
  { key: 'edit',     ratio: 0.50, label: '50%', desc: '编辑' },
  { key: 'refine',   ratio: 1.00, label: '100%', desc: '精编' },
  { key: 'tune',     ratio: 2.00, label: '200%', desc: '微调' },
]

// 视图模式切换阈值（与 zoomRatio 对应）
const VIEWMODE_COMPACT_MAX = 0.20
const VIEWMODE_NORMAL_MAX = 0.80

// 缓动函数
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

export function useCanvasZoomModes() {
  const { zoomIn, zoomOut, setViewport, getViewport, project } = useVueFlow()

  // ---- 响应式状态 ----
  const zoomRatio = ref(0.50)    // 实际比例（唯一权威值，来自 VueFlow viewport-change 同步）
  const animating = ref(false)
  let rafId = null
  let viewportRafId = null

  // ---- 派生 ----
  const zoomLevelIdx = computed(() => {
    // 找与当前 ratio 最接近的档级索引（作为当前"逻辑档"高亮按钮）
    let best = 2
    let bestDiff = Infinity
    ZOOM_LEVELS.forEach((lv, i) => {
      const diff = Math.abs(Math.log10(lv.ratio) - Math.log10(Math.max(0.0001, zoomRatio.value)))
      if (diff < bestDiff) { bestDiff = diff; best = i }
    })
    return best
  })

  const currentLevel = computed(() => ZOOM_LEVELS[zoomLevelIdx.value])

  /**
   * 当前节点视图模式：compact / normal / detailed
   * - zoom <= 0.2 (鸟瞰档)：只显名称+类型色条，无图无副信息
   * - 0.2 < zoom <= 0.8 (概览/编辑档)：标题+缩略图+基础tag（默认视图）
   * - zoom > 0.8 (精编/微调档)：完整大图+参数+操作按钮
   */
  const viewMode = computed(() => {
    const z = zoomRatio.value
    if (z <= VIEWMODE_COMPACT_MAX) return 'compact'
    if (z <= VIEWMODE_NORMAL_MAX) return 'normal'
    return 'detailed'
  })

  /**
   * 各档级细节开启标记（用于节点内精细控制渲染内容）
   *   showThumbnail: 缩略图
   *   showMetadata:  参数/标签文本
   *   showActions:   操作按钮
   *   showDialogue:  台词预览
   */
  const renderDensity = computed(() => {
    const z = zoomRatio.value
    return {
      showThumbnail: z >= 0.20,
      showMetadata: z >= 0.30,
      showActions: z >= 0.60,
      showDialogue: z >= 0.90,
      showHint: z >= 0.50,
    }
  })

  // ---- 方法：平滑 zoom 到目标 ratio（S5-T06 核心） ----
  function smoothZoomTo(targetRatio, opts = {}) {
    const duration = opts.duration ?? 280  // 平滑过渡 280ms
    const onDone = opts.onDone
    const startRatio = zoomRatio.value
    if (Math.abs(targetRatio - startRatio) < 0.001) {
      onDone?.()
      return
    }
    if (rafId) cancelAnimationFrame(rafId)
    animating.value = true
    const start = performance.now()
    const targetClamped = Math.max(0.08, Math.min(2, targetRatio))

    function step(now) {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      const current = startRatio + (targetClamped - startRatio) * eased
      const vp = getViewport()
      setViewport({ ...vp, zoom: current }, { duration: 0, force: opts.force ?? true })
      if (t < 1) {
        rafId = requestAnimationFrame(step)
      } else {
        animating.value = false
        rafId = null
        onDone?.()
      }
    }
    rafId = requestAnimationFrame(step)
  }

  /**
   * 设置档级：0=鸟瞰 1=概览 2=编辑 3=精编 4=微调
   */
  function setZoomLevel(idx, opts = {}) {
    const lv = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx))]
    smoothZoomTo(lv.ratio, opts)
  }

  /**
   * 适配连续 zoomIn / zoomOut 按钮（平滑步长）
   */
  function zoomInSmooth(step = 1.25) {
    const target = Math.min(2, zoomRatio.value * step)
    smoothZoomTo(target, { duration: 180 })
  }
  function zoomOutSmooth(step = 0.8) {
    const target = Math.max(0.08, zoomRatio.value * step)
    smoothZoomTo(target, { duration: 180 })
  }

  /**
   * 平滑平移 + 缩放 居中到指定节点（S5-T04 小地图点击跳转用）
   * @param {Object} node - VueFlow 节点（需要有 position）
   * @param {Object} opts - { zoom, duration, canvasW, canvasH }
   *   canvasW/canvasH 为主画布像素尺寸，用于精确居中计算
   */
  function smoothFitToNode(node, opts = {}) {
    if (!node || node.position == null) return
    const targetRatio = opts.zoom ?? 0.50
    const cw = opts.canvasW || 1000
    const ch = opts.canvasH || 800
    // VueFlow 变换：screenX = worldX * zoom + vp.x
    // 居中要求：cw/2 = node.x * targetZoom + vp.x → vp.x = cw/2 - node.x * targetZoom
    const targetX = (cw / 2) - node.position.x * targetRatio
    const targetY = (ch / 2) - node.position.y * targetRatio

    // === 排查日志：smoothFitToNode 居中计算全过程 ===
    const _startVp = getViewport()
    console.log('[smoothFitToNode] 居中计算链路:', {
      '1.节点世界坐标': { x: node.position.x, y: node.position.y },
      '2.目标zoom': targetRatio,
      '3.画布尺寸': { cw, ch },
      '4.目标vp(屏幕空间)': { targetX: Math.round(targetX), targetY: Math.round(targetY) },
      '5.当前vp': { x: Math.round(_startVp.x), y: Math.round(_startVp.y), zoom: Number(_startVp.zoom.toFixed(4)) },
      '6.验证': `节点应在屏幕中心: screenX=${Math.round(node.position.x * targetRatio + targetX)} 应等于 cw/2=${Math.round(cw / 2)}`,
    })

    const duration = opts.duration ?? 360
    const startVp = { ...getViewport() }
    if (viewportRafId) cancelAnimationFrame(viewportRafId)
    animating.value = true
    const start = performance.now()
    function step(now) {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      setViewport(
        {
          x: startVp.x + (targetX - startVp.x) * eased,
          y: startVp.y + (targetY - startVp.y) * eased,
          zoom: startVp.zoom + (targetRatio - startVp.zoom) * eased,
        },
        { duration: 0, force: true }
      )
      if (t < 1) viewportRafId = requestAnimationFrame(step)
      else { animating.value = false; viewportRafId = null }
    }
    viewportRafId = requestAnimationFrame(step)
  }

  /**
   * 平滑平移视口到指定屏幕空间坐标（不改变 zoom）
   * 供小地图点击/拖拽跳转使用，避免在回调中调用 useVueFlow()
   * @param {number} x - 目标 vp.x（屏幕空间平移量）
   * @param {number} y - 目标 vp.y
   * @param {Object} opts - { duration }
   */
  function smoothPanTo(x, y, opts = {}) {
    const duration = opts.duration ?? 280
    const startVp = { ...getViewport() }
    if (Math.abs(x - startVp.x) < 1 && Math.abs(y - startVp.y) < 1) return

    // === 排查日志：smoothPanTo 平移计算 ===
    console.log('[smoothPanTo] 平移视口:', {
      '1.目标vp(屏幕空间)': { targetX: Math.round(x), targetY: Math.round(y) },
      '2.当前vp': { x: Math.round(startVp.x), y: Math.round(startVp.y), zoom: Number(startVp.zoom.toFixed(4)) },
      '3.平移距离': { dx: Math.round(x - startVp.x), dy: Math.round(y - startVp.y) },
      '4.duration': duration,
      '5.验证': `worldMinX=${Math.round(-startVp.x / startVp.zoom)} → 目标worldMinX=${Math.round(-x / startVp.zoom)}`,
    })

    if (viewportRafId) cancelAnimationFrame(viewportRafId)
    animating.value = true
    const start = performance.now()
    function step(now) {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      setViewport(
        {
          x: startVp.x + (x - startVp.x) * eased,
          y: startVp.y + (y - startVp.y) * eased,
          zoom: startVp.zoom,
        },
        { duration: 0, force: true }
      )
      if (t < 1) viewportRafId = requestAnimationFrame(step)
      else { animating.value = false; viewportRafId = null }
    }
    viewportRafId = requestAnimationFrame(step)
  }

  /**
   * 接收 VueFlow viewport-change 事件同步 zoomRatio
   * （VueFlow 内部滚轮/控件缩放时我们也同步自己的状态）
   */
  function syncViewport(vp) {
    if (!vp) return
    if (!animating.value) {
      // 动画中：不再覆盖动画计算
      zoomRatio.value = Number(vp.zoom ?? zoomRatio.value)
    }
  }

  return {
    // 常量
    ZOOM_LEVELS,
    // 状态
    zoomRatio,
    zoomLevelIdx,
    currentLevel,
    viewMode,
    renderDensity,
    animating,
    // 方法
    setZoomLevel,
    smoothZoomTo,
    zoomInSmooth,
    zoomOutSmooth,
    smoothFitToNode,
    smoothPanTo,
    syncViewport,
  }
}
