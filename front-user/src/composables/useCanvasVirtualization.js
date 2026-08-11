/**
 * useCanvasVirtualization — 画布节点虚拟化（视口剔除）
 *
 * 目标：
 *   只渲染视口内的节点，视口外节点不渲染 DOM，从而支撑千级节点流畅交互。
 *
 * 设计：
 *   - 输入（均为 ref，保证响应式）：
 *       nodes         节点数组，每个节点含 x/y 坐标（兼容 position.x/position.y）
 *       viewport      视口范围 { translateX, translateY, zoom }
 *       containerSize 容器尺寸 { width, height }
 *   - 输出：
 *       visibleNodes  视口内（含缓冲区）的节点子集
 *       hiddenCount   被剔除的节点数量
 *       isEnabled     是否已启用虚拟化（节点总数 > threshold 时为 true）
 *
 * 剔除算法（AABB 相交判定）：
 *   屏幕坐标 = 世界坐标 * zoom + translate
 *   视口矩形外扩 bufferSize 像素作为缓冲，避免滚动时频繁剔除/重建 DOM 造成闪烁。
 *   节点尺寸默认 200x150，可通过 options 配置。
 *
 * 自动启用策略：
 *   节点总数 <= threshold 时关闭虚拟化（全量渲染），避免小数据量下的无谓计算开销。
 */

import { computed, unref } from 'vue'

export function useCanvasVirtualization(nodes, viewport, containerSize, options = {}) {
  // ---- 可配置项 ----
  const threshold = options.threshold ?? 100      // 超过该节点数才启用虚拟化
  const bufferSize = options.bufferSize ?? 200    // 视口外扩缓冲像素
  const nodeWidth = options.nodeWidth ?? 200      // 节点默认宽度
  const nodeHeight = options.nodeHeight ?? 150    // 节点默认高度

  /**
   * 从节点对象中取世界坐标 x。
   * 兼容直接 x 与 VueFlow 的 position.x 两种结构。
   */
  function getNodeX(node) {
    if (node == null) return 0
    if (typeof node.x === 'number') return node.x
    if (node.position && typeof node.position.x === 'number') return node.position.x
    return 0
  }

  function getNodeY(node) {
    if (node == null) return 0
    if (typeof node.y === 'number') return node.y
    if (node.position && typeof node.position.y === 'number') return node.position.y
    return 0
  }

  /**
   * 取节点宽高：优先用节点自身声明的尺寸，否则回退到默认值。
   */
  function getNodeSize(node) {
    const w = node?.width ?? node?.data?.width ?? nodeWidth
    const h = node?.height ?? node?.data?.height ?? nodeHeight
    return { w, h }
  }

  /**
   * 判定单个节点是否落在"视口 + 缓冲区"矩形内。
   * 计算使用屏幕空间坐标：screenX = worldX * zoom + translateX
   */
  function isNodeVisible(node, vp, size) {
    const { translateX = 0, translateY = 0, zoom = 1 } = vp || {}
    const { width = 0, height = 0 } = size || {}

    const worldX = getNodeX(node)
    const worldY = getNodeY(node)
    const { w, h } = getNodeSize(node)

    // 节点在屏幕空间的包围盒
    const screenX1 = worldX * zoom + translateX
    const screenY1 = worldY * zoom + translateY
    const screenX2 = screenX1 + w * zoom
    const screenY2 = screenY1 + h * zoom

    // 视口包围盒（外扩缓冲区）
    const viewX1 = -bufferSize
    const viewY1 = -bufferSize
    const viewX2 = width + bufferSize
    const viewY2 = height + bufferSize

    // AABB 相交：任一轴上分离即不可见
    return !(screenX2 < viewX1 || screenX1 > viewX2 || screenY2 < viewY1 || screenY1 > viewY2)
  }

  /**
   * 是否启用虚拟化：节点总数超过阈值时启用。
   * 使用 unref 兼容 ref 与裸数组两种入参。
   */
  const isEnabled = computed(() => {
    const list = unref(nodes)
    return Array.isArray(list) && list.length > threshold
  })

  /**
   * 可见节点子集。
   * - 未启用虚拟化时直接返回全量节点（无计算开销）。
   * - 启用后按视口剔除；若剔除结果为空（异常情况）则回退全量，避免渲染空白。
   */
  const visibleNodes = computed(() => {
    const list = unref(nodes)
    if (!Array.isArray(list) || list.length === 0) return []

    // 未达阈值：全量渲染
    if (!isEnabled.value) return list

    const vp = unref(viewport) || {}
    const size = unref(containerSize) || {}

    const result = []
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      if (isNodeVisible(node, vp, size)) {
        result.push(node)
      }
    }

    // 兜底：若全部被判定为视口外（可能是视口/尺寸尚未初始化），回退全量渲染
    if (result.length === 0) return list
    return result
  })

  /** 被剔除（隐藏）的节点数量 */
  const hiddenCount = computed(() => {
    const list = unref(nodes)
    if (!Array.isArray(list)) return 0
    if (!isEnabled.value) return 0
    return list.length - visibleNodes.value.length
  })

  return {
    visibleNodes,
    hiddenCount,
    isEnabled,
  }
}

export default useCanvasVirtualization
