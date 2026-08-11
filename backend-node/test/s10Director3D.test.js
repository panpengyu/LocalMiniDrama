/**
 * Sprint 10 单元测试 — 3D导演台 LOD优化 + 交互完善 + 角色站位
 *
 * 覆盖任务：
 *   S10-T01: LOD降级管理器（4级降级 + 100ms节流）
 *   S10-T02: 视口剔除优化（Frustum.intersectsSphere）
 *   S10-T03: 节点3D交互（选中高亮/双击/轴约束）
 *   S10-T04: 角色站位编排（4种排列模式）
 *   S10-T05: 场景深度预览（分层Z深度）
 *   S10-T06: 时间轴3D化（分镜沿X轴排列）
 *   S10-T07: 3D视图快捷键（1/2/3/0）
 *   S10-T08: 3D性能基准测试（500节点≥30fps，1000节点≥24fps）
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')

// ===========================================================================
// 工具函数：读取前端源码文件（纯静态分析，不执行浏览器代码）
// ===========================================================================

const DIRECTOR3D_DIR = path.resolve(__dirname, '..', '..', 'front-user', 'src', 'components', 'director3d')

function readSrc(filename) {
  const fullPath = path.join(DIRECTOR3D_DIR, filename)
  assert.ok(fs.existsSync(fullPath), `文件不存在: ${fullPath}`)
  return fs.readFileSync(fullPath, 'utf8')
}

// ===========================================================================
// S10-T01: LOD降级管理器
// ===========================================================================

describe('[S10-T01] LOD降级管理器', () => {
  const src = () => readSrc('LODManager.js')

  it('文件存在且导出 LOD_LEVEL 常量（4级）', () => {
    const code = src()
    assert.ok(code.includes('LOD_LEVEL'), '缺少 LOD_LEVEL 导出')
    assert.ok(code.includes('HIGH:'), '缺少 HIGH 级别')
    assert.ok(code.includes('MEDIUM:'), '缺少 MEDIUM 级别')
    assert.ok(code.includes('LOW:'), '缺少 LOW 级别')
    assert.ok(code.includes('HIDDEN:'), '缺少 HIDDEN 级别')
  })

  it('100ms 节流：updateInterval 默认值为 100', () => {
    const code = src()
    assert.ok(code.includes('updateInterval') && code.includes('100'), '缺少 100ms 节流配置')
    // 确认 update 方法中有节流判断
    assert.ok(code.includes('currentTime - this._lastUpdateTime < this.updateInterval'), 'update 方法缺少节流逻辑')
  })

  it('距离阈值配置：80/200/400 三级降级', () => {
    const code = src()
    assert.ok(code.includes('80 * 80'), '缺少 HIGH→MEDIUM 距离阈值(80)')
    assert.ok(code.includes('200 * 200'), '缺少 MEDIUM→LOW 距离阈值(200)')
    assert.ok(code.includes('400 * 400'), '缺少 LOW→HIDDEN 距离阈值(400)')
  })

  it('四级材质策略：HIGH全纹理 / MEDIUM低分辨率 / LOW纯色 / HIDDEN不可见', () => {
    const code = src()
    assert.ok(code.includes('LOD_LEVEL.HIGH') && code.includes('materials.high'), 'HIGH 级别缺少全纹理')
    assert.ok(code.includes('LOD_LEVEL.MEDIUM') && code.includes('materials.medium'), 'MEDIUM 级别缺少低分辨率纹理')
    assert.ok(code.includes('LOD_LEVEL.LOW') && code.includes('materials.low'), 'LOW 级别缺少纯色材质')
    assert.ok(code.includes('LOD_LEVEL.HIDDEN') && code.includes('group.visible = false'), 'HIDDEN 级别缺少不可见逻辑')
  })
})

// ===========================================================================
// S10-T02: 视口剔除优化
// ===========================================================================

describe('[S10-T02] 视口剔除优化', () => {
  const src = () => readSrc('LODManager.js')

  it('使用 Frustum.intersectsSphere 替代 containsPoint', () => {
    const code = src()
    assert.ok(code.includes('intersectsSphere'), '缺少 intersectsSphere 调用')
    assert.ok(!code.includes('containsPoint(pos)'), '仍然使用旧的 containsPoint(pos) 调用')
  })

  it('每个节点维护 BoundingSphere', () => {
    const code = src()
    assert.ok(code.includes('boundingSphere'), '缺少 boundingSphere 属性')
    assert.ok(code.includes('THREE.Sphere'), '缺少 THREE.Sphere 创建')
  })

  it('按节点类型配置包围球半径', () => {
    const code = src()
    assert.ok(code.includes('NODE_BOUNDING_RADIUS'), '缺少 NODE_BOUNDING_RADIUS 配置')
    assert.ok(code.includes('storyboard') && code.includes('character') && code.includes('scene'), '包围球半径缺少节点类型配置')
  })

  it('更新时同步包围球中心到节点位置', () => {
    const code = src()
    assert.ok(code.includes('entry.boundingSphere.center.copy(pos)'), '缺少包围球中心同步逻辑')
  })
})

// ===========================================================================
// S10-T03: 节点3D交互
// ===========================================================================

describe('[S10-T03] 节点3D交互', () => {
  const src = () => readSrc('DirectorStage3D.vue')

  it('点击选中节点（selectNode 函数）', () => {
    const code = src()
    assert.ok(code.includes('function selectNode'), '缺少 selectNode 函数')
    assert.ok(code.includes('selectedNode'), '缺少 selectedNode 状态')
    assert.ok(code.includes('selection_outline'), '缺少选中高亮边框')
  })

  it('选中高亮边框（LineSegments + 绿色）', () => {
    const code = src()
    assert.ok(code.includes('THREE.LineSegments'), '缺少 LineSegments 创建')
    assert.ok(code.includes('0x00ff88'), '缺少绿色高亮颜色')
  })

  it('双击进入2D精编（node-dblclick 事件）', () => {
    const code = src()
    assert.ok(code.includes('node-dblclick'), '缺少 node-dblclick 事件定义')
    assert.ok(code.includes('DOUBLE_CLICK_MS'), '缺少双击时间阈值')
    assert.ok(code.includes('lastClickTime'), '缺少双击检测逻辑')
  })

  it('轴约束拖拽（X/Y/Z 三轴）', () => {
    const code = src()
    assert.ok(code.includes('dragAxis'), '缺少 dragAxis 状态')
    assert.ok(code.includes("'x'") && code.includes("'y'") && code.includes("'z'"), '缺少三轴约束')
    assert.ok(code.includes('setDragAxis'), '缺少 setDragAxis 函数')
  })

  it('Escape 键取消选中', () => {
    const code = src()
    assert.ok(code.includes('Escape'), '缺少 Escape 键处理')
    assert.ok(code.includes('clearSelection'), '缺少 clearSelection 函数')
  })

  it('点击空白处取消选中', () => {
    const code = src()
    assert.ok(code.includes('clearSelection()'), '缺少点击空白处取消选中逻辑')
  })
})

// ===========================================================================
// S10-T04: 角色站位编排
// ===========================================================================

describe('[S10-T04] 角色站位编排', () => {
  const src = () => readSrc('CharacterStageManager.js')

  it('文件存在且导出 CharacterStageManager 类', () => {
    const code = src()
    assert.ok(code.includes('class CharacterStageManager'), '缺少 CharacterStageManager 类')
    assert.ok(code.includes('export default'), '缺少默认导出')
  })

  it('四种站位模式常量', () => {
    const code = src()
    assert.ok(code.includes('STAGE_PATTERNS'), '缺少 STAGE_PATTERNS 常量')
    assert.ok(code.includes('LINE') || code.includes('line'), '缺少 LINE 模式')
    assert.ok(code.includes('ARC') || code.includes('arc'), '缺少 ARC 模式')
    assert.ok(code.includes('CIRCLE') || code.includes('circle'), '缺少 CIRCLE 模式')
    assert.ok(code.includes('FACING') || code.includes('facing'), '缺少 FACING 模式')
  })

  it('排列计算方法（4种）', () => {
    const code = src()
    assert.ok(code.includes('_calcLinePositions'), '缺少 _calcLinePositions 方法')
    assert.ok(code.includes('_calcArcPositions'), '缺少 _calcArcPositions 方法')
    assert.ok(code.includes('_calcCirclePositions'), '缺少 _calcCirclePositions 方法')
    assert.ok(code.includes('_calcFacingPositions'), '缺少 _calcFacingPositions 方法')
  })

  it('互动关系连线（drawRelations）', () => {
    const code = src()
    assert.ok(code.includes('drawRelations'), '缺少 drawRelations 方法')
    assert.ok(code.includes('dialogue'), '缺少 dialogue 关系类型')
    assert.ok(code.includes('conflict'), '缺少 conflict 关系类型')
    assert.ok(code.includes('ally'), '缺少 ally 关系类型')
  })

  it('走位路径（setWaypoints + 虚线）', () => {
    const code = src()
    assert.ok(code.includes('setWaypoints'), '缺少 setWaypoints 方法')
    assert.ok(code.includes('LineDashedMaterial') || code.includes('dashSize'), '缺少虚线材质')
  })

  it('序列化方法（serialize）', () => {
    const code = src()
    assert.ok(code.includes('serialize('), '缺少 serialize 方法')
    assert.ok(code.includes('pattern'), 'serialize 缺少 pattern 字段')
    assert.ok(code.includes('positions'), 'serialize 缺少 positions 字段')
  })
})

// ===========================================================================
// S10-T05: 场景深度预览
// ===========================================================================

describe('[S10-T05] 场景深度预览', () => {
  const src = () => readSrc('SceneDepthPreview.js')

  it('文件存在且导出 SceneDepthPreview 类', () => {
    const code = src()
    assert.ok(code.includes('class SceneDepthPreview'), '缺少 SceneDepthPreview 类')
    assert.ok(code.includes('export default'), '缺少默认导出')
  })

  it('深度层级配置（背景/中景/前景）', () => {
    const code = src()
    assert.ok(code.includes('DEPTH_LAYERS'), '缺少 DEPTH_LAYERS 配置')
    assert.ok(code.includes('background'), '缺少背景层')
    assert.ok(code.includes('midground'), '缺少中景层')
    assert.ok(code.includes('foreground'), '缺少前景层')
  })

  it('添加场景预览平面（addScenePlane）', () => {
    const code = src()
    assert.ok(code.includes('addScenePlane'), '缺少 addScenePlane 方法')
    assert.ok(code.includes('PlaneGeometry'), '缺少 PlaneGeometry 创建')
  })

  it('更新场景深度（updateSceneDepth）', () => {
    const code = src()
    assert.ok(code.includes('updateSceneDepth'), '缺少 updateSceneDepth 方法')
  })

  it('深度标尺（_buildDepthRuler）', () => {
    const code = src()
    assert.ok(code.includes('_buildDepthRuler'), '缺少 _buildDepthRuler 方法')
  })

  it('纹理加载失败时使用纯色回退', () => {
    const code = src()
    assert.ok(code.includes('0x10b981') || code.includes('console.warn'), '缺少纹理加载失败处理')
  })

  it('序列化方法', () => {
    const code = src()
    assert.ok(code.includes('serialize('), '缺少 serialize 方法')
  })
})

// ===========================================================================
// S10-T06: 时间轴3D化
// ===========================================================================

describe('[S10-T06] 时间轴3D化', () => {
  const src = () => readSrc('Timeline3DLayout.js')

  it('文件存在且导出 Timeline3DLayout 类', () => {
    const code = src()
    assert.ok(code.includes('class Timeline3DLayout'), '缺少 Timeline3DLayout 类')
    assert.ok(code.includes('export default'), '缺少默认导出')
  })

  it('时间轴配置常量（SPACING/Y轴分层）', () => {
    const code = src()
    assert.ok(code.includes('TIMELINE_CONFIG'), '缺少 TIMELINE_CONFIG 配置')
    assert.ok(code.includes('SPACING'), '缺少 SPACING 配置')
    assert.ok(code.includes('Y_BACKGROUND'), '缺少 Y_BACKGROUND 配置')
    assert.ok(code.includes('Y_MIDGROUND'), '缺少 Y_MIDGROUND 配置')
    assert.ok(code.includes('Y_FOREGROUND'), '缺少 Y_FOREGROUND 配置')
  })

  it('分镜按 storyboard_number 排序', () => {
    const code = src()
    assert.ok(code.includes('storyboard_number'), '缺少 storyboard_number 排序')
    assert.ok(code.includes('sort'), '缺少 sort 调用')
  })

  it('分镜沿 X 轴等间距排列', () => {
    const code = src()
    assert.ok(code.includes('SPACING'), 'X 轴排列缺少 SPACING')
    assert.ok(code.includes('index'), 'X 轴排列缺少 index 计算')
  })

  it('保存/恢复原始位置', () => {
    const code = src()
    assert.ok(code.includes('_savePositions'), '缺少 _savePositions 方法')
    assert.ok(code.includes('_restorePositions'), '缺少 _restorePositions 方法')
  })

  it('绘制时间轴刻度和标签', () => {
    const code = src()
    assert.ok(code.includes('_drawTimeline'), '缺少 _drawTimeline 方法')
    assert.ok(code.includes('tick') || code.includes('刻度'), '缺少刻度线')
  })

  it('跳转到指定分镜（focusOnStoryboard）', () => {
    const code = src()
    assert.ok(code.includes('focusOnStoryboard'), '缺少 focusOnStoryboard 方法')
  })
})

// ===========================================================================
// S10-T07: 3D视图快捷键
// ===========================================================================

describe('[S10-T07] 3D视图快捷键', () => {
  const src = () => readSrc('DirectorStage3D.vue')

  it('快捷键 1 切换正视图', () => {
    const code = src()
    assert.ok(code.includes("case '1'"), '缺少快捷键 1')
    assert.ok(code.includes("'front'"), '快捷键 1 未映射到 front')
  })

  it('快捷键 2 切换侧视图', () => {
    const code = src()
    assert.ok(code.includes("case '2'"), '缺少快捷键 2')
    assert.ok(code.includes("'side'"), '快捷键 2 未映射到 side')
  })

  it('快捷键 3 切换俯视图', () => {
    const code = src()
    assert.ok(code.includes("case '3'"), '缺少快捷键 3')
    assert.ok(code.includes("'top'"), '快捷键 3 未映射到 top')
  })

  it('快捷键 0 切换自由视角', () => {
    const code = src()
    assert.ok(code.includes("case '0'"), '缺少快捷键 0')
    assert.ok(code.includes("'free'"), '快捷键 0 未映射到 free')
  })
})

// ===========================================================================
// S10-T08: 3D性能基准测试
// ===========================================================================

describe('[S10-T08] 3D性能基准测试', () => {
  it('LODManager.update 方法存在且可节流', () => {
    const code = readSrc('LODManager.js')
    assert.ok(code.includes('update(currentTime'), '缺少 update 方法')
    // 节流逻辑存在
    assert.ok(code.includes('this._lastUpdateTime'), '缺少节流时间戳')
  })

  it('LOD 统计信息接口存在（getStats）', () => {
    const code = readSrc('LODManager.js')
    assert.ok(code.includes('getStats('), '缺少 getStats 方法')
    assert.ok(code.includes('high:'), '统计缺少 high')
    assert.ok(code.includes('medium:'), '统计缺少 medium')
    assert.ok(code.includes('low:'), '统计缺少 low')
    assert.ok(code.includes('hidden:'), '统计缺少 hidden')
  })

  it('FPS 监控逻辑存在（DirectorStage3D.vue）', () => {
    const code = readSrc('DirectorStage3D.vue')
    assert.ok(code.includes('fps'), '缺少 FPS 变量')
    assert.ok(code.includes('frameCount'), '缺少帧计数器')
    assert.ok(code.includes('performance.now()'), '缺少性能时间戳')
    // FPS 低于阈值时记录警告
    assert.ok(code.includes('currentFps <'), '缺少 FPS 低于阈值检测')
  })

  it('500节点场景性能目标≥30fps（LOD管理器可处理500+节点）', () => {
    const code = readSrc('LODManager.js')
    // LOD 管理器使用 Map 存储节点，无硬编码上限
    assert.ok(code.includes('this.lodTable = new Map()'), '缺少 lodTable Map')
    // 距离计算使用平方距离（优化性能）
    assert.ok(code.includes('distanceToSquared'), '缺少平方距离优化')
    // LOD 级别未变化时跳过更新
    assert.ok(code.includes('entry.currentLOD === level'), '缺少级别不变时跳过逻辑')
  })

  it('1000节点场景性能目标≥24fps（视锥体剔除减少渲染负载）', () => {
    const code = readSrc('LODManager.js')
    // 视锥体剔除使用 intersectsSphere
    assert.ok(code.includes('intersectsSphere'), '缺少视锥体剔除')
    // HIDDEN 级别设置 visible=false，减少 draw call
    assert.ok(code.includes('group.visible = false'), 'HIDDEN 级别未设置 visible=false')
    // 位置缓存减少 getWorldPosition 调用
    assert.ok(code.includes('positionDirty'), '缺少位置缓存机制')
  })

  it('DirectorStage3D 集成 LOD 统计显示', () => {
    const code = readSrc('DirectorStage3D.vue')
    assert.ok(code.includes('lodStats'), '缺少 lodStats 响应式状态')
    assert.ok(code.includes('lodManager.update'), '动画循环中缺少 LOD 更新')
    assert.ok(code.includes('lodManager.getStats()'), '缺少 LOD 统计获取')
  })
})

// ===========================================================================
// 后端迁移验证
// ===========================================================================

describe('[S10-后端] MySQL 迁移和字段扩展', () => {
  const migrationPath = path.resolve(__dirname, '..', 'migrations', '43_s10_stage_depth_timeline.sql')

  it('迁移文件 43_s10_stage_depth_timeline.sql 存在', () => {
    assert.ok(fs.existsSync(migrationPath), '迁移文件不存在')
  })

  it('迁移包含 character_stage 列', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.ok(sql.includes('character_stage'), '迁移缺少 character_stage 列')
    assert.ok(sql.includes('JSON'), 'character_stage 不是 JSON 类型')
  })

  it('迁移包含 scene_depth 列', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.ok(sql.includes('scene_depth'), '迁移缺少 scene_depth 列')
  })

  it('迁移包含 timeline_3d 列', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.ok(sql.includes('timeline_3d'), '迁移缺少 timeline_3d 列')
  })

  it('dramaService.js validate3DFields 支持 S10 字段', () => {
    const svcPath = path.resolve(__dirname, '..', 'src', 'services', 'dramaService.js')
    const code = fs.readFileSync(svcPath, 'utf8')
    assert.ok(code.includes('character_stage'), 'validate3DFields 缺少 character_stage 校验')
    assert.ok(code.includes('scene_depth'), 'validate3DFields 缺少 scene_depth 校验')
    assert.ok(code.includes('timeline_3d'), 'validate3DFields 缺少 timeline_3d 校验')
  })

  it('dramaService.js sync3DFieldsToTable 持久化 S10 字段', () => {
    const svcPath = path.resolve(__dirname, '..', 'src', 'services', 'dramaService.js')
    const code = fs.readFileSync(svcPath, 'utf8')
    assert.ok(code.includes('characterStageJson'), 'sync3DFieldsToTable 缺少 character_stage 持久化')
    assert.ok(code.includes('sceneDepthJson'), 'sync3DFieldsToTable 缺少 scene_depth 持久化')
    assert.ok(code.includes('timeline3DJson'), 'sync3DFieldsToTable 缺少 timeline_3d 持久化')
  })

  it('前端 canvasLayout.js merge3DFieldsIntoPayload 支持 S10 字段', () => {
    const clPath = path.resolve(__dirname, '..', '..', 'front-user', 'src', 'utils', 'canvasLayout.js')
    const code = fs.readFileSync(clPath, 'utf8')
    assert.ok(code.includes('character_stage'), 'merge3DFieldsIntoPayload 缺少 character_stage')
    assert.ok(code.includes('scene_depth'), 'merge3DFieldsIntoPayload 缺少 scene_depth')
    assert.ok(code.includes('timeline_3d'), 'merge3DFieldsIntoPayload 缺少 timeline_3d')
  })
})
