/**
 * Sprint 5 — S5-T05 画布分区功能
 *
 * 验收标准：角色区/分镜主流程区/场景区/道具区/参考素材区 5 区域，可折叠，支持一键整理布局。
 *
 * 分区与节点类型映射：
 *   - characterZone  : canvasAsset 类型中 assetType=char 的节点
 *   - storyboardZone : canvasStoryboard / canvasEpisode / canvasScript
 *   - sceneZone      : canvasAsset 类型中 assetType=scene 的节点
 *   - propZone       : canvasAsset 类型中 assetType=prop 的节点
 *   - referenceZone  : canvasLabel / canvasMedia (参考图、视频、文本标注)
 *
 * 折叠（collapse）行为：
 *   - 折叠后，区域内节点在"视口虚拟化"阶段被归类为"forceCollapsed" → 不再命中 isInViewport 判定
 *     ，同时节点 data.hiddenInZoneCollapsed = true
 *   - 展开 → 恢复可见
 *
 * 一键整理：按类型将节点批量移动到对应分区矩形内，使用简单的网格排序（横向 N 列，纵向流动）。
 *   整理结果通过 emit 更新 nodes 到父组件 → WorkbenchCanvas 保存 → 写入 drama metadata → 持久化
 *
 * 权威数据源：
 *   zones（ref） 是唯一状态，折叠修改仅走 toggleZone / collapseAll / expandAll。
 *   worldBounds 为分区世界坐标矩形，作为"一键整理"的目标位置。
 */

import { computed, ref } from 'vue'

export const ZONE_DEFS = [
  { key: 'characters', label: '角色区',  assetType: 'char',  color: '#10b981', pos: { x: -2800, y: -1600 }, cols: 3 },
  { key: 'scenes',     label: '场景区',  assetType: 'scene', color: '#3b82f6', pos: { x: -2800, y: -400 },  cols: 3 },
  { key: 'props',      label: '道具区',  assetType: 'prop',  color: '#8b5cf6', pos: { x: -2800, y: 800 },   cols: 3 },
  { key: 'storyboard', label: '分镜主流程区', assetType: '*', color: '#f59e0b', pos: { x: -200,  y: -1600 }, cols: 8 },
  { key: 'reference',  label: '参考素材区', assetType: 'ref', color: '#ec4899', pos: { x: 6800, y: -1600 }, cols: 3 },
]

export function useCanvasZones() {
  // 每个 zone 的可见性（折叠=true→隐藏节点）
  const zoneCollapsed = ref(
    Object.fromEntries(ZONE_DEFS.map(z => [z.key, false]))
  )

  // 分区尺寸（单位：世界坐标 px），整理布局时统一写入节点 pos
  const ZONE_W = {
    characters: 2400, scenes: 2400, props: 2400,
    storyboard: 9800, reference: 2400,
  }
  const ZONE_H = {
    characters: 1000, scenes: 1000, props: 1000,
    storyboard: 2800, reference: 2800,
  }

  const zones = computed(() =>
    ZONE_DEFS.map(def => ({
      key: def.key,
      label: def.label,
      color: def.color,
      collapsed: !!zoneCollapsed.value[def.key],
      cols: def.cols,
      assetType: def.assetType,
      worldBounds: {
        x: def.pos.x, y: def.pos.y,
        w: ZONE_W[def.key], h: ZONE_H[def.key],
      },
    }))
  )

  /**
   * 分区命中规则（用于 UI 标记节点所属分区、一键整理时的归类）
   */
  function zoneKeyOfNode(node) {
    const type = node?.type || ''
    const assetType = node?.data?.assetType || ''
    if (type === 'canvasAsset') {
      if (assetType === 'char') return 'characters'
      if (assetType === 'scene') return 'scenes'
      if (assetType === 'prop') return 'props'
    }
    if (['canvasStoryboard', 'canvasEpisode', 'canvasScript', 'canvasDramaHeader'].includes(type)) {
      return 'storyboard'
    }
    if (['canvasMedia', 'canvasLabel', 'canvasAddButton'].includes(type)) {
      return 'reference'
    }
    return 'storyboard' // 兜底
  }

  function nodeInZone(node, zoneKey) {
    return zoneKeyOfNode(node) === zoneKey
  }

  function toggleZone(key) {
    zoneCollapsed.value = {
      ...zoneCollapsed.value,
      [key]: !zoneCollapsed.value[key],
    }
  }

  function collapseAll() {
    const next = { ...zoneCollapsed.value }
    for (const k of Object.keys(next)) next[k] = true
    zoneCollapsed.value = next
  }

  function expandAll() {
    const next = { ...zoneCollapsed.value }
    for (const k of Object.keys(next)) next[k] = false
    zoneCollapsed.value = next
  }

  /**
   * 分区折叠后节点是否被隐藏。用于虚拟化阶段"强制剔除"。
   */
  function isNodeHiddenByZone(node) {
    const zk = zoneKeyOfNode(node)
    return !!zoneCollapsed.value[zk]
  }

  /**
   * S5-T05 一键整理：按分区重新布局 nodes。
   * 规则：
   *   - 保持 node.id/type/data/edges 不变，只写 position.x/.y
   *   - 每个分区 cols 列，网格步长：(nodeSize + gap)
   *   - 分镜主流程区按集数排序，集内按 storyboard_number 排序
   *
   * 返回 newNodes 数组（仅位置变），不直接改 ref，交由父组件写入。
   */
  function tidyLayout(allNodes, drama) {
    if (!Array.isArray(allNodes)) return []
    const result = allNodes.map(n => ({ ...n, position: { ...n.position } }))
    const NODE_W = 260
    const NODE_H = 200
    const GAP = 40

    function placeInZone(items, zoneKey, sortFn) {
      const zone = ZONE_DEFS.find(z => z.key === zoneKey)
      const def = zones.value.find(z => z.key === zoneKey)
      if (!zone || !def) return
      const sorted = [...items]
      if (sortFn) sorted.sort(sortFn)
      const cols = zone.cols
      sorted.forEach((item, idx) => {
        const row = Math.floor(idx / cols)
        const col = idx % cols
        result.find(n => n.id === item.id).position = {
          x: def.worldBounds.x + 40 + col * (NODE_W + GAP),
          y: def.worldBounds.y + 40 + row * (NODE_H + GAP),
        }
      })
    }

    // 分组
    const byZone = { characters: [], scenes: [], props: [], storyboard: [], reference: [] }
    for (const n of result) byZone[zoneKeyOfNode(n)]?.push(n)

    placeInZone(byZone.characters, 'characters', (a, b) => (a.data?.name || '').localeCompare(b.data?.name || ''))
    placeInZone(byZone.scenes, 'scenes', (a, b) => (a.data?.name || '').localeCompare(b.data?.name || ''))
    placeInZone(byZone.props, 'props', (a, b) => (a.data?.name || '').localeCompare(b.data?.name || ''))
    placeInZone(byZone.reference, 'reference', (a, b) => (a.id || '').localeCompare(b.id || ''))
    placeInZone(byZone.storyboard, 'storyboard', (a, b) => {
      // 先按集数(canvasEpisode 优先)，再分镜号
      const ea = a.data?.episodeId ?? -1
      const eb = b.data?.episodeId ?? -1
      if (ea !== eb) return ea - eb
      const sa = a.data?.storyboardNumber ?? a.data?.number ?? 0
      const sb = b.data?.storyboardNumber ?? b.data?.number ?? 0
      return sa - sb
    })

    return result
  }

  return {
    ZONE_DEFS,
    zones,
    zoneCollapsed,
    zoneKeyOfNode,
    nodeInZone,
    toggleZone,
    collapseAll,
    expandAll,
    isNodeHiddenByZone,
    tidyLayout,
  }
}
