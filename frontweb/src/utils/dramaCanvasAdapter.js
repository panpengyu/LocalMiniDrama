import { parseCanvasLayout, resolveNodePosition } from './canvasLayout'
import { Position } from '@vue-flow/core'
import { getStoryboardGroupMap, parseWorkflowGroups } from './canvasWorkflow'
import { assetImageUrl, storyboardImageUrl, storyboardVideoUrl, audioUrl } from './mediaUrl'
import { parseStoryboardCharacterIds, parseStoryboardPropIds, parseStoryboardSceneId } from './canvasEntityIds'
import {
  dramaUsesFirstLastFrame,
  imageRecordUrl,
  resolveSbFirstImageRecord,
  resolveSbLastImageRecord,
  resolveSbMainImageRecord,
  resolveSbVideoRecord,
  videoRecordUrl,
} from './storyboardMedia'

// ==================== 布局常量 ====================
// 资产区域（角色/道具/场景）相关
const ASSET_SECTION_GAP = 36    // 不同类型资产（角色/道具/场景）之间的间距
const ASSET_ROW_H = 188         // 资产节点高度
const ASSET_NODE_W = 176        // 资产节点宽度（来自CanvasAssetNode.vue）
const ASSET_GAP_X = 20          // 资产节点之间的间距
const MAX_ASSET_COLUMNS = 3     // 每行最多放置的资产数量

// 流水线区域（剧本/集/分镜/媒体）相关
const SCRIPT_OFFSET_X = 268     // 剧本节点相对于流水线的X偏移（剧本在集的左侧）
const PIPELINE_X = 360          // 流水线（分镜+媒体）的起始X坐标
const ASSET_RIGHT_BOUND = PIPELINE_X - 348  // 资产区域右边界（留出48px边距）
const ASSET_X = ASSET_RIGHT_BOUND - ASSET_NODE_W  // 第一个资产紧贴右边界
const EPISODE_ROW_GAP = 48      // 集之间的垂直间距
const SB_GAP_Y = 180            // 分镜之间的垂直间距

// 媒体节点相关
const MEDIA_OFFSET_X = 228      // 媒体节点（脚本摘要、分镜图等）相对于分镜的水平偏移
const MEDIA_GAP_X = 188         // 媒体节点之间的水平间距
/** 单行流水线（分镜 + 媒体）大致宽度，用于画布 bounds */
const SB_PIPELINE_WIDTH = MEDIA_OFFSET_X + 5 * MEDIA_GAP_X + 200

// ==================== 连线样式常量 ====================
const ASSET_EDGE_STYLE = { stroke: '#34d399', strokeWidth: 1.5, strokeDasharray: '6 4' }    // 资产→分镜连线（绿色虚线）
const SCRIPT_EDGE_STYLE = { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '8 4' }     // 剧本→集连线（黄色虚线）
const PIPELINE_EDGE_STYLE = { stroke: '#818cf8', strokeWidth: 2 }                           // 分镜→媒体连线（紫色实线）
const CHAIN_EDGE_STYLE = { stroke: '#a78bfa', strokeWidth: 1.5, strokeDasharray: '4 3' }    // 集→分镜/分镜间连线（紫色虚线）

/**
 * 创建 Vue Flow 连线对象
 * @param {object} props - 连线属性（id, source, target, style 等）
 * @returns {object} Vue Flow edge 对象
 */
function makeEdge(props) {
  return {
    type: 'default',           // 使用 Vue Flow 默认连线类型
    pathOptions: { curvature: 0.62 },  // 贝塞尔曲线曲率（越大弧线越明显）
    ...props,
  }
}

/**
 * 文本截断工具函数
 * @param {string} text - 待截断文本
 * @param {number} max - 最大长度（默认72）
 * @returns {string} 截断后的文本，超长时末尾添加省略号
 */
function truncate(text, max = 72) {
  if (!text) return ''
  const s = String(text).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * 生成分镜摘要文本
 * @param {object} sb - 分镜对象
 * @returns {string} 分镜摘要文本
 */
function storyboardSummary(sb) {
  // universal模式优先使用 universal_segment_text
  if (sb.creation_mode === 'universal' && sb.universal_segment_text) {
    return truncate(sb.universal_segment_text, 90)
  }
  // 普通模式组合动作、对白、结果字段
  const parts = [sb.action, sb.dialogue, sb.result].filter(Boolean)
  return truncate(parts.join(' · '), 90) || truncate(sb.description, 90) || '暂无脚本内容'
}

/**
 * 创建文本标签节点（不可选中、不可拖拽、不可连接）
 * @param {string} id - 节点ID
 * @param {string} label - 标签文本
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @returns {object} 标签节点对象
 */
function sectionLabel(id, label, x, y) {
  return {
    id,
    type: 'canvasLabel',
    position: { x, y },
    data: { label },
    selectable: false,
    draggable: false,
    connectable: false,
  }
}

function buildAssetRow(nodes, savedLayout, items, kind, prefix, startX, startY) {
  let colX = startX
  let rowY = startY
  let colIndex = 0
  for (const item of items) {
    const id = `${prefix}:${item.id}`
    if (colIndex >= MAX_ASSET_COLUMNS) {
      rowY += ASSET_ROW_H + 8
      colX = startX
      colIndex = 0
    }
    nodes.push(makeNode({
      id,
      type: 'canvasAsset',
      position: { x: colX, y: rowY },
      data: { kind, entity: item },
    }))
    colX -= ASSET_GAP_X + ASSET_NODE_W
    colIndex++
  }
  return { endX: startX + ASSET_NODE_W, endY: rowY + ASSET_ROW_H }
}

/**
 * 创建节点对象的通用工厂函数
 * @param {object} base - 基础节点配置（id, type, position, data 等）
 * @returns {object} Vue Flow node 对象
 */
function makeNode(base) {
  // 标签和添加按钮固定位置，不可拖拽
  const fixed = base.type === 'canvasLabel' || base.type === 'canvasAddButton'
  const draggable = base.draggable ?? !fixed
  return { ...base, draggable, style: { ...base.style, zIndex: 1 } }
}

/**
 * 构建资产节点（角色、场景、道具）—— 用于 vertical 模式的旧版布局
 * @param {object} drama - 项目数据对象
 * @param {object} savedLayout - 已保存的画布布局
 * @param {number} startY - 起始Y坐标
 * @returns {object} { nodes, edges, nextY }
 */
function buildAssetNodes(drama, savedLayout, startY) {
  const nodes = []
  const edges = []
  let y = startY

  // 资产分类配置：角色、场景、道具
  const sections = [
    { key: 'characters', label: '👤 角色', hint: '从剧本提取', items: drama.characters || [], kind: 'character', prefix: 'char' },
    { key: 'scenes', label: '🏞 场景', hint: '从剧本提取', items: drama.scenes || [], kind: 'scene', prefix: 'scene' },
    { key: 'props', label: '🎭 道具', hint: '从剧本提取', items: drama.props || [], kind: 'prop', prefix: 'prop' },
  ]

  // 遍历每个分类，纵向排列资产节点
  for (const sec of sections) {
    y += 36  // 分类间留白
    for (const item of sec.items) {
      const id = `${sec.prefix}:${item.id}`
      nodes.push(makeNode({
        id,
        type: 'canvasAsset',
        position: resolveNodePosition(savedLayout, id, { x: ASSET_X, y }),
        data: { kind: sec.kind, entity: item },
      }))
      y += ASSET_ROW_H  // 节点间间距
    }
    y += ASSET_SECTION_GAP  // 分类底部留白
  }

  return { nodes, edges, nextY: y }
}

/**
 * 获取分镜的通用段落文本（优先使用 universal_segment_text）
 * @param {object} sb - 分镜对象
 * @returns {string} 段落文本
 */
function universalSegmentText(sb) {
  return (sb?.universal_segment_text || sb?.video_prompt || sb?.description || '').trim()
}

/**
 * 添加通用模式媒体节点（universal模式下的脚本摘要）
 * @param {array} nodes - 节点数组
 * @param {array} edges - 连线数组
 * @param {object} ctx - 上下文参数（savedLayout, sb, sbId, fromId, mediaX, mediaY, uniId）
 * @returns {string} 新节点ID（若未创建则返回 fromId）
 */
function appendUniversalNode(nodes, edges, ctx) {
  const { savedLayout, sb, sbId, fromId, mediaX, mediaY, uniId } = ctx
  const text = universalSegmentText(sb)
  if (!text) return fromId  // 无文本时跳过

  nodes.push(makeNode({
    id: uniId,
    type: 'canvasMedia',
    position: resolveNodePosition(savedLayout, uniId, { x: mediaX, y: mediaY }),
    data: {
      kind: 'universal',
      storyboard: sb,
      summary: text,
    },
  }))

  edges.push(makeEdge({
    id: `e-${fromId}-${uniId}`,
    source: fromId,
    target: uniId,
    style: PIPELINE_EDGE_STYLE,
  }))

  return uniId
}

/**
 * 添加图片媒体节点（分镜图、首帧、尾帧）
 * @param {array} nodes - 节点数组
 * @param {array} edges - 连线数组
 * @param {object} ctx - 上下文参数（savedLayout, sb, sbId, fromId, mediaX, mediaY, imgId, url, frameKind, frameLabel）
 * @returns {string} 新节点ID（若未创建则返回 fromId）
 */
function appendMediaImageNode(nodes, edges, ctx) {
  const {
    savedLayout, sb, sbId, fromId, mediaX, mediaY, imgId, url, frameKind, frameLabel,
  } = ctx
  if (!url) return fromId  // 无图片URL时跳过

  nodes.push(makeNode({
    id: imgId,
    type: 'canvasMedia',
    position: resolveNodePosition(savedLayout, imgId, { x: mediaX, y: mediaY }),
    data: {
      kind: 'image',
      storyboard: sb,
      url,
      frameKind: frameKind || null,    // 'first' | 'last' | null
      frameLabel: frameLabel || null,   // '首帧' | '尾帧' | '分镜图'
    },
  }))

  edges.push(makeEdge({
    id: `e-${fromId}-${imgId}`,
    source: fromId,
    target: imgId,
    style: PIPELINE_EDGE_STYLE,
  }))

  return imgId
}

/**
 * 构建单集的完整流水线（剧本→集→分镜→媒体节点）
 * @param {object} episode - 集数据对象
 * @param {object} savedLayout - 已保存的画布布局
 * @param {number} startY - 起始Y坐标
 * @param {object} options - 配置选项
 * @param {Map} options.workflowGroupMap - 工作流分组映射
 * @param {object} options.imagesBySbId - 分镜图片映射
 * @param {object} options.videosBySbId - 分镜视频映射
 * @param {boolean} options.useFirstLastFrame - 是否使用首尾帧模式
 * @returns {object} { nodes, edges, nextY, rowWidth }
 */
function buildEpisodePipeline(episode, savedLayout, startY, options = {}) {
  const nodes = []
  const edges = []
  const storyboards = episode.storyboards || []
  const groupMap = options.workflowGroupMap || new Map()
  const imagesBySbId = options.imagesBySbId || {}
  const videosBySbId = options.videosBySbId || {}
  const useFirstLastFrame = options.useFirstLastFrame ?? false
  // ==================== 剧本和集节点 ====================
  const epId = `episode:${episode.id}`
  const scriptId = `script:${episode.id}`

  // 剧本节点（在集的左侧）
  nodes.push(makeNode({
    id: scriptId,
    type: 'canvasScript',
    position: resolveNodePosition(savedLayout, scriptId, { x: PIPELINE_X - SCRIPT_OFFSET_X, y: startY - 30 }),
    data: {
      episode,
      summary: truncate(episode.script_content, 96) || '',
    },
  }))

  // 集节点
  nodes.push(makeNode({
    id: epId,
    type: 'canvasEpisode',
    position: resolveNodePosition(savedLayout, epId, { x: PIPELINE_X, y: startY }),
    data: { episode },
  }))

  // 剧本 → 集 连线
  edges.push(makeEdge({
    id: `e-script-${episode.id}-ep`,
    source: scriptId,
    target: epId,
    style: SCRIPT_EDGE_STYLE,
  }))

  // ==================== 分镜流水线 ====================
  const rowYBase = startY + 56  // 分镜区域起始Y坐标（集下方56px）
  let prevSbId = null           // 上一个分镜ID，用于分镜间连线

  storyboards.forEach((sb, index) => {
    const sbId = `sb:${sb.id}`
    const sbX = PIPELINE_X
    const rowY = rowYBase + index * SB_GAP_Y  // 每个分镜垂直间距 SB_GAP_Y
    const wfGroup = groupMap.get(sb.id)

    // 分镜节点
    nodes.push(makeNode({
      id: sbId,
      type: 'canvasStoryboard',
      position: resolveNodePosition(savedLayout, sbId, { x: sbX, y: rowY }),
      data: {
        storyboard: sb,
        episodeId: episode.id,
        index: index + 1,
        workflowGroup: wfGroup ? { id: wfGroup.id, title: wfGroup.title } : null,
      },
    }))

    // 集 → 分镜 连线
    edges.push(makeEdge({
      id: `e-ep-${episode.id}-sb-${sb.id}`,
      source: epId,
      target: sbId,
      style: CHAIN_EDGE_STYLE,
    }))

    // ==================== 媒体节点（脚本摘要、图片、视频、音频） ====================
    let mediaX = sbX + MEDIA_OFFSET_X  // 媒体节点起始X坐标（分镜右侧）
    const mediaY = rowY + 8            // 媒体节点Y坐标（与分镜垂直居中偏移8px）
    const isUniversal = sb.creation_mode === 'universal'
    let pipelineTailId = sbId          // 流水线尾部节点ID，用于链式连接

    // 1. 通用模式 vs 普通模式
    if (isUniversal) {
      // universal模式：添加通用段落文本节点
      const uniId = `sbuni:${sb.id}`
      const nextId = appendUniversalNode(nodes, edges, {
        savedLayout, sb, sbId, fromId: sbId, mediaX, mediaY, uniId,
      })
      if (nextId !== sbId) {
        pipelineTailId = nextId
        mediaX += MEDIA_GAP_X
      }
    } else {
      // 普通模式：添加脚本摘要文本节点
      const txtId = `sbtxt:${sb.id}`
      nodes.push(makeNode({
        id: txtId,
        type: 'canvasMedia',
        position: resolveNodePosition(savedLayout, txtId, { x: mediaX, y: mediaY }),
        data: { kind: 'text', storyboard: sb, summary: storyboardSummary(sb) },
      }))
      edges.push(makeEdge({
        id: `e-${sbId}-${txtId}`,
        source: sbId,
        target: txtId,
        style: PIPELINE_EDGE_STYLE,
        animated: false,
      }))
      mediaX += MEDIA_GAP_X
      pipelineTailId = txtId

      // 2. 图片节点（首帧/尾帧 或 主图）
      const useFirstLast = useFirstLastFrame

      if (useFirstLast) {
        // 首尾帧模式：分别添加首帧和尾帧图片
        const firstUrl = imageRecordUrl(resolveSbFirstImageRecord(sb, imagesBySbId))
        if (firstUrl) {
          const imgId = `sbimg-first:${sb.id}`
          pipelineTailId = appendMediaImageNode(nodes, edges, {
            savedLayout, sb, sbId, fromId: pipelineTailId, mediaX, mediaY, imgId, url: firstUrl,
            frameKind: 'first', frameLabel: '首帧',
          })
          mediaX += MEDIA_GAP_X
        }
        const lastUrl = imageRecordUrl(resolveSbLastImageRecord(sb, imagesBySbId))
        if (lastUrl) {
          const imgId = `sbimg-last:${sb.id}`
          pipelineTailId = appendMediaImageNode(nodes, edges, {
            savedLayout, sb, sbId, fromId: pipelineTailId, mediaX, mediaY, imgId, url: lastUrl,
            frameKind: 'last', frameLabel: '尾帧',
          })
          mediaX += MEDIA_GAP_X
        }
      } else {
        // 主图模式：添加单张分镜图
        const mainUrl = imageRecordUrl(resolveSbMainImageRecord(sb, imagesBySbId)) || storyboardImageUrl(sb)
        if (mainUrl) {
          const imgId = `sbimg:${sb.id}`
          pipelineTailId = appendMediaImageNode(nodes, edges, {
            savedLayout, sb, sbId, fromId: pipelineTailId, mediaX, mediaY, imgId, url: mainUrl,
            frameKind: null, frameLabel: '分镜图',
          })
          mediaX += MEDIA_GAP_X
        }
      }
    }

    // 3. 视频节点
    const vidUrl = videoRecordUrl(resolveSbVideoRecord(sb, videosBySbId)) || storyboardVideoUrl(sb)
    if (vidUrl) {
      const vidId = `sbvid:${sb.id}`
      nodes.push(makeNode({
        id: vidId,
        type: 'canvasMedia',
        position: resolveNodePosition(savedLayout, vidId, { x: mediaX, y: mediaY }),
        data: { kind: 'video', storyboard: sb, url: vidUrl },
      }))
      edges.push(makeEdge({
        id: `e-${pipelineTailId}-${vidId}`,
        source: pipelineTailId,
        target: vidId,
        style: PIPELINE_EDGE_STYLE,
      }))
      mediaX += MEDIA_GAP_X
    }

    // 4. 音频节点（对白配音）
    if (sb.audio_local_path) {
      const audId = `sbaud:${sb.id}:dialogue`
      nodes.push(makeNode({
        id: audId,
        type: 'canvasMedia',
        position: resolveNodePosition(savedLayout, audId, { x: mediaX, y: mediaY }),
        data: { kind: 'audio', storyboard: sb, url: audioUrl(sb.audio_local_path), audioType: 'dialogue' },
      }))
      edges.push(makeEdge({
        id: `e-sb-aud-${sb.id}`,
        source: sbId,           // 音频直接从分镜连接（不经过流水线）
        target: audId,
        style: { stroke: '#fbbf24', strokeWidth: 1.5 },  // 黄色连线
      }))
    }

    // ==================== 资产→分镜连线（角色、场景、道具） ====================
    // 角色 → 分镜 连线
    const charIds = parseStoryboardCharacterIds(sb)
    for (const charId of charIds) {
      const source = `char:${charId}`
      edges.push(makeEdge({
        id: `e-char-${charId}-sb-${sb.id}`,
        source,
        sourcePosition: Position.Top,
        target: sbId,
        targetHandle: 'asset-in',
        style: ASSET_EDGE_STYLE,
      }))
    }

    // 场景 → 分镜 连线
    if (sb.scene_id) {
      edges.push(makeEdge({
        id: `e-scene-${sb.scene_id}-sb-${sb.id}`,
        source: `scene:${sb.scene_id}`,
        sourcePosition: Position.Top,
        target: sbId,
        targetHandle: 'asset-in',
        style: ASSET_EDGE_STYLE,
      }))
    }

    // 道具 → 分镜 连线
    const propIds = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    for (const propId of propIds) {
      edges.push(makeEdge({
        id: `e-prop-${propId}-sb-${sb.id}`,
        source: `prop:${propId}`,
        sourcePosition: Position.Top,
        target: sbId,
        targetHandle: 'asset-in',
        style: ASSET_EDGE_STYLE,
      }))
    }

    // 分镜间链式连线（前一个分镜 → 当前分镜）
    if (prevSbId) {
      edges.push(makeEdge({
        id: `e-chain-${prevSbId}-${sbId}`,
        source: prevSbId,
        target: sbId,
        sourceHandle: 'chain-out',  // 使用自定义连接点
        targetHandle: 'chain-in',
        style: CHAIN_EDGE_STYLE,
      }))
    }
    prevSbId = sbId
  })

  // 计算当前集流水线的宽度和下一集的起始Y坐标
  const rowWidth = SB_PIPELINE_WIDTH
  const nextY = rowYBase + storyboards.length * SB_GAP_Y + 120 + EPISODE_ROW_GAP
  return { nodes, edges, nextY, rowWidth }
}

/**
 * 将 drama API 数据转为 Vue Flow 图（兼容无 canvas_layout 的旧 JSON）
 * @param {object} drama - 项目数据对象
 * @param {object} options - 配置选项
 * @param {object} options.savedLayout - 已保存的画布布局
 * @param {Map} options.workflowGroupMap - 工作流分组映射
 * @param {array} options.workflowGroups - 工作流分组列表
 * @param {boolean} options.useFirstLastFrame - 是否使用首尾帧模式
 * @param {number|null} options.episodeId - 筛选特定集ID
 * @param {string} options.layoutMode - 布局模式：'horizontal'（左右）| 'vertical'（上下）
 * @returns {object} { nodes, edges, savedLayout, bounds }
 */
export function buildDramaCanvasGraph(drama, options = {}) {
  if (!drama) return { nodes: [], edges: [] }

  // 解析配置和布局
  const savedLayout = options.savedLayout ?? parseCanvasLayout(drama.metadata)
  const workflowGroupMap = options.workflowGroupMap ?? getStoryboardGroupMap(
    options.workflowGroups ?? parseWorkflowGroups(drama.metadata)
  )
  const useFirstLastFrame = options.useFirstLastFrame ?? dramaUsesFirstLastFrame(drama)
  const episodeId = options.episodeId ?? null
  const layoutMode = options.layoutMode ?? 'horizontal'
  const episodes = episodeId
    ? (drama.episodes || []).filter((ep) => ep.id === episodeId)
    : (drama.episodes || [])

  const nodes = []
  const edges = []

  // 添加项目头部节点（显示项目名称和基本信息）
  const headerId = 'drama:header'
  nodes.push(makeNode({
    id: headerId,
    type: 'canvasDramaHeader',
    position: resolveNodePosition(savedLayout, headerId, { x: PIPELINE_X, y: -60 }),
    data: { drama },
  }))

  // ==================== horizontal 模式（左右布局） ====================
  // 流水线（剧本/集/分镜/媒体）在左侧，资产（角色/道具/场景）在右侧，按行排列
  if (layoutMode === 'horizontal') {
    let pipelineY = 88        // 流水线起始Y坐标
    let maxPipelineX = PIPELINE_X  // 流水线最右侧X坐标

    // 1. 构建每个集的流水线
    for (const ep of episodes) {
      const block = buildEpisodePipeline(ep, savedLayout, pipelineY, {
        ...options,
        workflowGroupMap,
        useFirstLastFrame,
      })
      nodes.push(...block.nodes)
      edges.push(...block.edges)
      maxPipelineX = Math.max(maxPipelineX, PIPELINE_X + (block.rowWidth || 0))
      pipelineY = block.nextY + 40  // 下一集的起始Y坐标
    }

    // 2. 收集所有被分镜引用的资产ID（使用数组保持首次出现顺序）
    const charIds = []
    const charIdSet = new Set()
    const sceneIds = []
    const sceneIdSet = new Set()
    const propIds = []
    const propIdSet = new Set()
    for (const ep of episodes) {
      for (const sb of ep.storyboards || []) {
        for (const cid of parseStoryboardCharacterIds(sb)) {
          if (!charIdSet.has(cid)) {
            charIdSet.add(cid)
            charIds.push(cid)
            console.log('[Canvas] 添加角色ID:', cid, '当前顺序:', charIds)
          }
        }
        const sceneId = parseStoryboardSceneId(sb)
        if (sceneId && !sceneIdSet.has(sceneId)) {
          sceneIdSet.add(sceneId)
          sceneIds.push(sceneId)
        }
        for (const pid of parseStoryboardPropIds(sb)) {
          if (!propIdSet.has(pid)) {
            propIdSet.add(pid)
            propIds.push(pid)
          }
        }
      }
    }

    // 3. 构建资产节点（按行排列：角色一行、道具一行、场景一行，支持自动换行）
    // 资产移动到左侧，位于集节点下方（集节点在 y=88，高度约100px，所以从 y=220 开始）
    // 当一行资产超过 MAX_ASSET_ROW_WIDTH 时自动换行，避免画布宽度无限增长
    let assetY = 280

    const charItems = charIds.map(id => (drama.characters || []).find(c => c.id === id)).filter(Boolean)
    const charResult = buildAssetRow(nodes, savedLayout, charItems, 'character', 'char', ASSET_X, assetY)
    assetY = charResult.endY + ASSET_SECTION_GAP

    const propItems = propIds.map(id => (drama.props || []).find(p => p.id === id)).filter(Boolean)
    const propResult = buildAssetRow(nodes, savedLayout, propItems, 'prop', 'prop', ASSET_X, assetY)
    assetY = propResult.endY + ASSET_SECTION_GAP

    const sceneItems = sceneIds.map(id => (drama.scenes || []).find(s => s.id === id)).filter(Boolean)
    const sceneResult = buildAssetRow(nodes, savedLayout, sceneItems, 'scene', 'scene', ASSET_X, assetY)
    assetY = sceneResult.endY

    // 空状态提示（无剧集时）
    if (!episodes.length) {
      nodes.push(sectionLabel('label:empty', '暂无剧集，可点顶栏「+ 集」或右键空白处新建', PIPELINE_X, pipelineY))
    }

    return {
      nodes,
      edges,
      savedLayout,
      bounds: { width: Math.max(maxPipelineX + 520, 1200), height: Math.max(pipelineY + 80, assetY, 600) },
    }
  } else {
    // ==================== vertical 模式（上下布局） ====================
    // 资产（角色/道具/场景）在左侧按行排列，流水线（剧本/集/分镜/媒体）在右侧
    let pipelineY = 88        // 流水线起始Y坐标
    let maxPipelineX = PIPELINE_X  // 流水线最右侧X坐标

    // 1. 构建每个集的流水线（与horizontal模式相同）
    for (const ep of episodes) {
      const block = buildEpisodePipeline(ep, savedLayout, pipelineY, {
        ...options,
        workflowGroupMap,
        useFirstLastFrame,
      })
      nodes.push(...block.nodes)
      edges.push(...block.edges)
      maxPipelineX = Math.max(maxPipelineX, PIPELINE_X + (block.rowWidth || 0))
      pipelineY = block.nextY + 40
    }

    // 2. 收集所有被分镜引用的资产ID（与horizontal模式相同，使用数组保持首次出现顺序）
    const charIds = []
    const charIdSet = new Set()
    const sceneIds = []
    const sceneIdSet = new Set()
    const propIds = []
    const propIdSet = new Set()
    for (const ep of episodes) {
      for (const sb of ep.storyboards || []) {
        for (const cid of parseStoryboardCharacterIds(sb)) {
          if (!charIdSet.has(cid)) {
            charIdSet.add(cid)
            charIds.push(cid)
            console.log('[Canvas] 添加角色ID:', cid, '当前顺序:', charIds)
          }
        }
        const sceneId = parseStoryboardSceneId(sb)
        if (sceneId && !sceneIdSet.has(sceneId)) {
          sceneIdSet.add(sceneId)
          sceneIds.push(sceneId)
        }
        for (const pid of parseStoryboardPropIds(sb)) {
          if (!propIdSet.has(pid)) {
            propIdSet.add(pid)
            propIds.push(pid)
          }
        }
      }
    }

    // 3. 构建资产节点（按行排列：角色一行、道具一行、场景一行，支持自动换行）
    // 资产移动到左侧，位于剧本节点下方（剧本节点在 y=58，高度约100px，所以从 y=180 开始）
    // 当一行资产超过 MAX_ASSET_ROW_WIDTH 时自动换行，避免画布宽度无限增长
    let assetY = 280

    const charItems = charIds.map(id => (drama.characters || []).find(c => c.id === id)).filter(Boolean)
    const charResult = buildAssetRow(nodes, savedLayout, charItems, 'character', 'char', ASSET_X, assetY)
    assetY = charResult.endY + ASSET_SECTION_GAP

    const propItems = propIds.map(id => (drama.props || []).find(p => p.id === id)).filter(Boolean)
    const propResult = buildAssetRow(nodes, savedLayout, propItems, 'prop', 'prop', ASSET_X, assetY)
    assetY = propResult.endY + ASSET_SECTION_GAP

    const sceneItems = sceneIds.map(id => (drama.scenes || []).find(s => s.id === id)).filter(Boolean)
    const sceneResult = buildAssetRow(nodes, savedLayout, sceneItems, 'scene', 'scene', ASSET_X, assetY)
    assetY = sceneResult.endY

    // 空状态提示（无剧集时）
    if (!episodes.length) {
      nodes.push(sectionLabel('label:empty', '暂无剧集，可点顶栏「+ 集」或右键空白处新建', PIPELINE_X, pipelineY))
    }

    return {
      nodes,
      edges,
      savedLayout,
      bounds: { width: Math.max(maxPipelineX + 200, 1200), height: Math.max(pipelineY + 80, assetY, 600) },
    }
  }
}

/**
 * 从节点中提取分镜引用信息
 * @param {object} node - Vue Flow 节点对象
 * @returns {object|null} { storyboardId, episodeId } 或 null
 */
export function getStoryboardRefFromNode(node) {
  if (!node?.data?.storyboard) return null
  return {
    storyboardId: node.data.storyboard.id,
    episodeId: node.data.episodeId || node.data.storyboard.episode_id,
  }
}

/**
 * 点击素材时，计算应高亮的节点与连线
 * @param {object} drama - 项目数据对象
 * @param {string} assetNodeId - 资产节点ID（格式：char:id | scene:id | prop:id）
 * @returns {object} { nodeIds: Set, edgeIds: Set } - 应高亮的节点和连线ID集合
 */
export function getAssetRelationHighlight(drama, assetNodeId) {
  const nodeIds = new Set([assetNodeId])  // 默认高亮点击的资产节点
  const edgeIds = new Set()
  if (!drama || !assetNodeId) return { nodeIds, edgeIds }

  // 解析节点ID（格式：char:123）
  const [prefix, rawId] = assetNodeId.split(':')
  const entityId = Number(rawId)
  if (!entityId) return { nodeIds, edgeIds }

  // 遍历所有分镜，找到与该资产关联的分镜及其媒体节点
  for (const ep of drama.episodes || []) {
    for (const sb of ep.storyboards || []) {
      let linked = false
      // 判断分镜是否引用了该资产
      if (prefix === 'char' && parseStoryboardCharacterIds(sb).includes(entityId)) linked = true
      if (prefix === 'scene' && parseStoryboardSceneId(sb) === entityId) linked = true
      if (prefix === 'prop' && parseStoryboardPropIds(sb).includes(entityId)) linked = true
      if (!linked) continue

      // 收集该分镜相关的所有节点ID
      const sbId = `sb:${sb.id}`
      nodeIds.add(sbId)                    // 分镜节点
      nodeIds.add(`sbtxt:${sb.id}`)        // 脚本摘要节点
      nodeIds.add(`sbuni:${sb.id}`)        // 通用段落节点
      nodeIds.add(`sbimg:${sb.id}`)        // 分镜图节点
      nodeIds.add(`sbimg-first:${sb.id}`)  // 首帧节点
      nodeIds.add(`sbimg-last:${sb.id}`)   // 尾帧节点
      if (storyboardVideoUrl(sb)) nodeIds.add(`sbvid:${sb.id}`)      // 视频节点（有视频时）
      if (sb.audio_local_path) nodeIds.add(`sbaud:${sb.id}:dialogue`) // 音频节点（有音频时）

      // 收集资产→分镜的连线ID
      if (prefix === 'char') edgeIds.add(`e-char-${entityId}-sb-${sb.id}`)
      if (prefix === 'scene') edgeIds.add(`e-scene-${entityId}-sb-${sb.id}`)
      if (prefix === 'prop') edgeIds.add(`e-prop-${entityId}-sb-${sb.id}`)
    }
  }
  return { nodeIds, edgeIds }
}

/**
 * 应用画布高亮效果（高亮选中的资产及其关联的分镜和媒体）
 * @param {array} nodes - 节点数组
 * @param {array} edges - 连线数组
 * @param {string} highlightNodeId - 需要高亮的节点ID
 * @param {object} drama - 项目数据对象
 * @returns {object} { nodes, edges } - 带高亮效果的节点和连线
 */
export function applyCanvasHighlight(nodes, edges, highlightNodeId, drama) {
  // 无高亮节点时，恢复所有节点和连线的默认样式
  if (!highlightNodeId) {
    return {
      nodes: nodes.map((n) => ({ ...n, class: undefined, data: { ...n.data, dimmed: false, highlighted: false } })),
      edges: edges.map((e) => ({
        ...e,
        animated: false,
        style: e._baseStyle || e.style,  // 恢复基础样式
      })),
    }
  }

  // 获取应高亮的节点和连线ID集合
  const { nodeIds, edgeIds } = getAssetRelationHighlight(drama, highlightNodeId)
  return {
    // 节点：高亮的节点添加高亮样式，非高亮节点添加暗淡样式
    nodes: nodes.map((n) => {
      const highlighted = nodeIds.has(n.id)
      const dimmed = !highlighted
      return {
        ...n,
        class: highlighted ? 'canvas-node-highlight' : 'canvas-node-dim',
        data: { ...n.data, highlighted, dimmed },
      }
    }),
    // 连线：高亮的连线加粗并动画，非高亮连线变暗
    edges: edges.map((e) => {
      const baseStyle = e._baseStyle || e.style
      const highlighted = edgeIds.has(e.id)
      return {
        ...e,
        _baseStyle: baseStyle,
        animated: highlighted,
        style: highlighted
          ? { ...baseStyle, stroke: '#34d399', strokeWidth: 2.5, opacity: 1 }
          : { ...baseStyle, opacity: 0.15 },
      }
    }),
  }
}

/**
 * 为连线附加 _baseStyle 属性，便于高亮后恢复原始样式
 * @param {array} edges - 连线数组
 * @returns {array} 附加了 _baseStyle 的连线数组
 */
export function stampEdgeBaseStyles(edges) {
  return edges.map((e) => ({ ...e, _baseStyle: e.style ? { ...e.style } : undefined }))
}

/**
 * 按默认网格规则计算全部节点坐标（忽略已保存的手动位置）
 * 用于重置画布布局或自动对齐节点
 * @param {object} drama - 项目数据对象
 * @param {object} options - 配置选项（同 buildDramaCanvasGraph）
 * @returns {object} { positions: Record<string, {x:number,y:number}>, bounds: object }
 */
export function computeAutoLayoutPositions(drama, options = {}) {
  // 使用空布局（无手动保存位置）重新计算所有节点坐标
  const emptyLayout = { version: 1, nodes: {} }
  const graph = buildDramaCanvasGraph(drama, {
    ...options,
    savedLayout: emptyLayout,
  })
  // 提取节点位置映射
  const positions = {}
  for (const node of graph.nodes) {
    if (node?.id && node.position) {
      positions[node.id] = { x: node.position.x, y: node.position.y }
    }
  }
  return { positions, bounds: graph.bounds }
}
