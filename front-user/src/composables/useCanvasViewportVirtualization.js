/**
 * Sprint 5 — S5-T03 视口外节点虚拟化
 *
 * 验收标准：视口外节点不渲染DOM，千级节点缩放平移 60fps。
 *
 * 核心思路：
 *   渲染节点 = 原始 nodes 过滤出"视口内 + padding 缓冲"的子集。
 *   用 VueFlow.getViewport() + project() 计算节点屏幕坐标，矩形相交判定。
 *   同时保持原选中/拖拽节点强制可见、连线不受影响（edges 全部保留）。
 *
 * 边界处理：
 *   - 选中节点（selected）即使视口外也保留（防止选区丢失）
 *   - 正在拖拽的节点强制保留
 *   - 初始或 null 视口全部渲染
 *   - padding 按屏幕像素给出 200px 缓冲，拖动画布时延迟 100ms 剔除（防抖）
 *
 * 注：
 *   数据源唯一：原始 nodes 数组不可变，虚拟化为"子集拷贝"作为 nodes 输入给 VueFlow，
 *   布局保存时仍使用原始全量 nodes（禁止用虚拟化结果回写布局）。
 */

import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const SCREEN_PADDING_PX = 200
const DEBOUNCE_MS = 100

export function useCanvasViewportVirtualization() {
  const { getViewport, project } = useVueFlow()

  const viewport = ref({ x: 0, y: 0, zoom: 1 })
  const canvasSize = ref({ w: 0, h: 0 })

  let debounceTimer = null
  const dirtyRerender = ref(0)  // 触发 computed 重算

  function touchRerender() { dirtyRerender.value = (dirtyRerender.value + 1) & 0xffff }

  /**
   * 更新视口（VueFlow onMoveEnd / viewport-change 调用）。
   * 使用节流避免每次滚动都重算。
   */
  function updateViewport(vp, immediate = false) {
    if (vp) viewport.value = { ...vp }
    if (debounceTimer) clearTimeout(debounceTimer)
    if (immediate) {
      touchRerender()
      return
    }
    debounceTimer = setTimeout(() => { touchRerender() }, DEBOUNCE_MS)
  }

  function updateCanvasSize(w, h) {
    canvasSize.value = { w, h }
  }

  /**
   * 判断节点是否在视口内（含 padding）
   * 使用 VueFlow 的 project() 将世界坐标 → 屏幕坐标，再做 AABB 相交。
   * 如无 project，则退化为近似计算。
   */
  function isInViewport(node) {
    const { x = 0, y = 0, zoom = 1 } = viewport.value || {}
    const w = Math.max(1, canvasSize.value.w || window.innerWidth)
    const h = Math.max(1, canvasSize.value.h || window.innerHeight)

    // 节点尺寸
    const nW = node.measured?.width ?? node.data?.width ?? 220
    const nH = node.measured?.height ?? node.data?.height ?? 160

    // 尝试 project（屏幕坐标）
    let screenX1, screenY1
    try {
      const p = project({ x: node.position.x, y: node.position.y })
      screenX1 = p.x
      screenY1 = p.y
    } catch {
      // 退化：屏幕坐标 = (x - vpX) * zoom
      screenX1 = (node.position.x - x) * zoom
      screenY1 = (node.position.y - y) * zoom
    }
    const screenX2 = screenX1 + nW * zoom
    const screenY2 = screenY1 + nH * zoom

    // 视口扩展 padding
    const pad = SCREEN_PADDING_PX
    const viewX1 = -pad
    const viewY1 = -pad
    const viewX2 = w + pad
    const viewY2 = h + pad

    return !(screenX2 < viewX1 || screenX1 > viewX2 || screenY2 < viewY1 || screenY1 > viewY2)
  }

  /**
   * 输入全量 nodes，返回视口内节点（虚拟化子集）。
   * selected 节点、dragging 节点强制保留。
   */
  function makeVisibleNodes(allNodes, opts = {}) {
    // 依赖 dirtyRerender 作为响应式依赖触发重算
    void dirtyRerender.value
    if (!Array.isArray(allNodes)) return []
    if (!allNodes.length) return []

    const vp = viewport.value
    const sz = canvasSize.value
    // 首次 / 无数据：全部渲染，避免空闪
    if ((!vp || !vp.x && !vp.y && !vp.zoom) && (!sz.w || !sz.h)) {
      return allNodes
    }
    const selectedIds = new Set(opts.selectedIds || [])

    let kept = 0
    const result = []
    for (const n of allNodes) {
      const forceKeep =
        n.selected === true ||
        n.dragging === true ||
        selectedIds.has(n.id) ||
        n.type === 'canvasAddButton' ||
        n.type === 'canvasLabel' ||
        n.type === 'canvasDramaHeader'
      if (forceKeep || isInViewport(n)) {
        result.push(n)
        kept++
      }
    }
    if (kept === 0) return allNodes  // 防止计算异常时渲染空白
    return result
  }

  const stats = computed(() => ({
    padding: SCREEN_PADDING_PX,
    debounce: DEBOUNCE_MS,
  }))

  return {
    stats,
    updateViewport,
    updateCanvasSize,
    makeVisibleNodes,
  }
}
