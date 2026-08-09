<template>
  <!-- S3-T07: 底部时间轴预览区 — 一站式工作台组成部分 -->
  <!-- 分镜时间轴：缩略图预览 + 原生 HTML5 drag & drop 排序 -->
  <div class="sb-timeline" :class="{ dragging: dragState.active }">
    <div class="sbt-head">
      <div class="sbt-title">
        <el-icon><Grid /></el-icon>
        <span>分镜时间轴</span>
        <el-tag size="small" effect="plain" style="margin-left:8px">{{ frames.length }} 镜</el-tag>
      </div>

      <div class="sbt-tools">
        <el-select
          v-model="episodeFilter"
          size="small"
          placeholder="选择集数"
          clearable
          style="width: 160px"
        >
          <el-option
            v-for="ep in episodes"
            :key="ep.id"
            :label="ep.title || `第 ${ep.episode_number || 0} 集`"
            :value="ep.id"
          />
        </el-select>
        <el-button size="small" @click="onScrollToFocused">
          <el-icon><Aim /></el-icon>
          定位当前
        </el-button>
        <el-button size="small" type="primary" :disabled="!frames.length" @click="onPlayReel">
          <el-icon><VideoPlay /></el-icon>
          预览
        </el-button>
        <el-divider direction="vertical" />
        <!-- S4-T04: 音画对齐 -->
        <div class="sbt-dub-stat" v-if="dubbingStats.count > 0">
          <el-icon><Headset /></el-icon>
          <span>配音 {{ dubbingStats.count }}/{{ frames.length }} · {{ dubbingStats.totalSec }}s</span>
        </div>
        <el-button
          size="small"
          type="warning"
          :disabled="!dubbingStats.count"
          @click="onAlignDuration"
          title="按配音时长自动调整分镜时长，实现音画同步"
        >
          <el-icon><Sort /></el-icon>
          音画对齐
        </el-button>
        <el-divider direction="vertical" />
        <span class="sbt-hint">💡 拖拽调整顺序；音画对齐按配音时长调整分镜</span>
      </div>
    </div>

    <div class="sbt-scroll-shell" ref="scrollRef">
      <div class="sbt-track">
        <div
          v-for="(f, idx) in frames"
          :key="f.id || `f-${idx}`"
          class="sbt-card"
          :class="{
            'is-focus': focusId === f.id,
            'is-dragging': dragState.idx === idx,
            'is-before': dragState.active && dragState.toIdx === idx && idx < dragState.idx,
            'is-after': dragState.active && dragState.toIdx === idx && idx > dragState.idx,
            'no-img': !f.image_url && !f.local_path && !f.thumbnail,
          }"
          draggable="true"
          @dragstart="onDragStart($event, idx)"
          @dragover.prevent="onDragOver($event, idx)"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop($event, idx)"
          @dragend="onDragEnd"
          @click="$emit('select', f, idx)"
        >
          <div class="sbt-order">{{ idx + 1 }}</div>

          <div class="sbt-thumb">
            <img
              v-if="f.local_path || f.image_url || f.thumbnail"
              :src="resolveImg(f)"
              :alt="f.action || f.title || `frame-${idx + 1}`"
              loading="lazy"
              draggable="false"
              @error="onImgError($event, f, idx)"
            />
            <div v-else class="sbt-noimg">
              <el-icon :size="24"><Picture /></el-icon>
              <span>{{ f.shot_type || (f.action || '').slice(0, 6) || '未生成' }}</span>
            </div>
            <div v-if="f.consistency_passed === 0" class="sbt-badge sbt-badge-danger" title="一致性未达标">
              <el-icon><WarningFilled /></el-icon>
              一致性 {{ pct(f.consistency_score) }}%
            </div>
            <div v-else-if="f.consistency_passed === 1" class="sbt-badge sbt-badge-ok" title="一致性达标">
              {{ pct(f.consistency_score) }}%
            </div>
            <div v-if="f.retry_count > 0" class="sbt-retry">R{{ f.retry_count }}</div>
            <!-- S4-T04: 配音音频指示层 -->
            <div v-if="getDub(f)" class="sbt-audio-ind" :title="`${getDub(f).characterName}: ${(getDub(f).durationMs/1000).toFixed(1)}s`">
              <div class="sbt-wave">
                <span
                  v-for="(h, wi) in waveBars(getDub(f).durationMs)"
                  :key="wi"
                  class="sbt-wave-bar"
                  :style="{ height: h + '%' }"
                ></span>
              </div>
              <div class="sbt-audio-dur">{{ (getDub(f).durationMs / 1000).toFixed(1) }}s</div>
            </div>
          </div>

          <div class="sbt-meta">
            <div class="sbt-action" :title="f.action || f.title">
              {{ f.action || f.title || `第 ${idx + 1} 镜` }}
            </div>
            <div class="sbt-foot">
              <el-tag size="small" effect="plain" v-if="f.shot_type">{{ f.shot_type }}</el-tag>
              <el-tag size="small" effect="plain" type="warning" v-if="f.angle_s">{{ f.angle_s }}</el-tag>
              <span class="sbt-duration" v-if="f.duration_sec">{{ f.duration_sec }}s</span>
              <span
                class="sbt-dub-dur"
                v-if="getDub(f)"
                :class="[
                  isDurationSuspicious(getDub(f)) ? 'is-error' : '',
                  Math.abs((f.duration_sec||0) - getDub(f).durationMs/1000) > 0.5 ? 'is-mismatch' : '',
                  Math.abs((f.duration_sec||0) - getDub(f).durationMs/1000) > MISMATCH_ALERT_SEC ? 'is-alert' : '',
                ]"
                :title="isDurationSuspicious(getDub(f))
                  ? '配音时长异常：' + (getDub(f).durationMs < 0 ? '负数' : getDub(f).durationMs < 400 ? '过短' : '过长')
                  : '配音 ' + (getDub(f).durationMs/1000).toFixed(1) + 's / 分镜 ' + (f.duration_sec||0) + 's / 偏差 ' + Math.abs((f.duration_sec||0) - getDub(f).durationMs/1000).toFixed(1) + 's'"
              >
                {{ isDurationSuspicious(getDub(f)) ? '⚠️' : '🎙' }}
                {{ (getDub(f).durationMs / 1000).toFixed(1) }}s
              </span>
            </div>
          </div>
        </div>
        <div v-if="!frames.length" class="sbt-empty">
          <el-empty description="暂无分镜，到 AI 分镜 Tab 启动创作" :image-size="80" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import { Grid, Aim, VideoPlay, Picture, WarningFilled, Sort, Headset } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const log = useWorkbenchLogger('StoryboardTimeline')

const props = defineProps({
  frames: { type: Array, default: () => [] },
  episodes: { type: Array, default: () => [] },
  focusId: { type: [Number, String], default: null },
  episodeFilterValue: { type: [Number, String], default: null },
  // S4-T04: 配音数据映射 { [storyboardId]: { durationMs, audioPath, characterName, text } }
  dubbingMap: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:frames', 'select', 'reorder', 'playReel', 'update:episodeFilter', 'alignDuration'])

// ---- S4-T04: 配音时长统计与音画同步 ----
const dubbingStats = computed(() => {
  const map = props.dubbingMap || {}
  let count = 0
  let totalMs = 0
  for (const f of props.frames) {
    const d = map[f.id]
    if (d && d.durationMs) { count++; totalMs += d.durationMs }
  }
  return { count, totalMs, totalSec: (totalMs / 1000).toFixed(1) }
})

// 分镜原时长总和（秒）
const frameDurationTotal = computed(() => {
  let sec = 0
  for (const f of props.frames) {
    const d = Number(f.duration_sec || f.duration || 0)
    if (d) sec += d
  }
  return sec
})

/**
 * 取分镜的配音信息
 */
function getDub(f) {
  if (!f || !f.id) return null
  return (props.dubbingMap || {})[f.id] || null
}

// ---- 时长偏差判定常量 ----
const MISMATCH_WARN_SEC = 1       // 偏差 > 1s → 卡片橙色警告
const MISMATCH_ALERT_SEC = 5      // 偏差 > 5s → 对齐前拦截询问
const DURATION_SUSPICIOUS_MIN_MS = 400  // < 0.4s 可疑（过短）
const DURATION_SUSPICIOUS_MAX_MS = 40000 // > 40s 可疑（过长）

/**
 * 计算单个分镜的配音时长与原时长偏差（秒）
 */
function getDurationDiffSec(f) {
  const d = getDub(f)
  if (!d || !d.durationMs) return 0
  const dubSec = d.durationMs / 1000
  const origSec = Number(f.duration_sec || f.duration || 0)
  if (!origSec) return 0
  return Math.abs(dubSec - origSec)
}

/**
 * 检测配音时长是否异常（非数字/负数/极短/极长）
 */
function isDurationSuspicious(d) {
  if (!d || typeof d.durationMs !== 'number') return true
  if (isNaN(d.durationMs) || !isFinite(d.durationMs)) return true
  if (d.durationMs <= 0) return true
  return d.durationMs < DURATION_SUSPICIOUS_MIN_MS || d.durationMs > DURATION_SUSPICIOUS_MAX_MS
}

/**
 * 对齐前偏差分析，返回分析报告
 */
function analyzeDurationMismatch() {
  const map = props.dubbingMap || {}
  const report = {
    total: props.frames.length,
    hasDub: 0,
    suspicious: [],       // [{ frameId, storyboardNum, reason, durationMs, origSec }]
    mismatchAlert: [],    // 偏差 > 5s
    mismatchWarn: [],     // 偏差 1~5s
    matched: [],          // 偏差 ≤ 1s
  }
  for (const f of props.frames) {
    const d = map[f.id]
    if (!d || !d.durationMs) continue
    report.hasDub++
    if (isDurationSuspicious(d)) {
      const reason = !isFinite(d.durationMs) || isNaN(d.durationMs)
        ? '时长值无效（NaN/Infinity）'
        : d.durationMs <= 0
          ? '时长为 0 或负数'
          : d.durationMs < DURATION_SUSPICIOUS_MIN_MS
            ? `时长过短（${d.durationMs}ms < ${DURATION_SUSPICIOUS_MIN_MS}ms）`
            : `时长过长（${d.durationMs}ms > ${DURATION_SUSPICIOUS_MAX_MS}ms）`
      report.suspicious.push({
        frameId: f.id,
        storyboardNum: f.storyboard_number || f.storyboardNumber || f.id,
        reason, durationMs: d.durationMs,
        origSec: Number(f.duration_sec || f.duration || 0),
      })
      continue
    }
    const diffSec = getDurationDiffSec(f)
    const entry = {
      frameId: f.id,
      storyboardNum: f.storyboard_number || f.storyboardNumber || f.id,
      dubSec: (d.durationMs / 1000).toFixed(1),
      origSec: Number(f.duration_sec || f.duration || 0) || '未设',
      diffSec: diffSec.toFixed(1),
    }
    if (diffSec > MISMATCH_ALERT_SEC) report.mismatchAlert.push(entry)
    else if (diffSec > MISMATCH_WARN_SEC) report.mismatchWarn.push(entry)
    else report.matched.push(entry)
  }
  return report
}

/**
 * 格式化偏差分析报告为对话框文本
 */
function formatAlignReport(report) {
  if (report.suspicious.length === 0 && report.mismatchAlert.length === 0 && report.mismatchWarn.length === 0) {
    return `✅ 全部 ${report.hasDub} 条配音时长与分镜原时长匹配良好（偏差 ≤ ${MISMATCH_WARN_SEC}s），可直接对齐。`
  }
  const lines = []
  lines.push(`检测到 ${report.hasDub} 条配音，偏差分析如下：`)
  lines.push(`• 匹配良好（≤${MISMATCH_WARN_SEC}s）：${report.matched.length} 条`)
  if (report.mismatchWarn.length) lines.push(`• 轻度偏差（${MISMATCH_WARN_SEC+1}~${MISMATCH_ALERT_SEC}s）：${report.mismatchWarn.length} 条`)
  if (report.mismatchAlert.length) {
    lines.push(`• ⚠️ 偏差过大（>${MISMATCH_ALERT_SEC}s）：${report.mismatchAlert.length} 条`)
    const samples = report.mismatchAlert.slice(0, 3)
    for (const s of samples) {
      lines.push(`  - 分镜 #${s.storyboardNum}：原 ${s.origSec}s → 配音 ${s.dubSec}s，偏差 ${s.diffSec}s`)
    }
    if (report.mismatchAlert.length > 3) lines.push(`  ...另有 ${report.mismatchAlert.length - 3} 条`)
  }
  if (report.suspicious.length) {
    lines.push(`• ❌ 配音时长异常（将被跳过）：${report.suspicious.length} 条`)
    const samples = report.suspicious.slice(0, 2)
    for (const s of samples) lines.push(`  - 分镜 #${s.storyboardNum}：${s.reason}`)
    if (report.suspicious.length > 2) lines.push(`  ...另有 ${report.suspicious.length - 2} 条`)
  }
  lines.push('')
  lines.push('是否继续执行对齐？（继续将按配音时长重写分镜 duration，异常值跳过）')
  return lines.join('\n')
}

/**
 * 音画对齐：根据配音时长自动更新分镜 duration_sec
 *
 * 错误捕获与提示流程：
 * 1. 对齐前偏差分析 → 有偏差时弹窗确认用户意图
 * 2. 异常时长（NaN/∞/0/过短/过长）直接跳过，不写入
 * 3. 对齐完成后输出详细结果报告（成功/跳过/异常），失败率高时给出警告
 * 4. emit alignDuration 时携带对齐详情，便于父组件展示
 */
async function onAlignDuration() {
  const map = props.dubbingMap || {}
  if (Object.keys(map).length === 0) {
    ElMessage.warning('暂无配音数据，无法执行音画对齐。请先为分镜生成配音。')
    return
  }
  if (!props.frames.length) {
    ElMessage.warning('当前时间轴无分镜。')
    return
  }

  // 阶段 1：偏差分析 + 用户确认
  const report = analyzeDurationMismatch()
  log.info('[Align] 对齐前偏差分析', report)

  const shouldConfirm = report.suspicious.length > 0 || report.mismatchAlert.length > 0
  if (shouldConfirm) {
    try {
      await ElMessageBox.confirm(formatAlignReport(report), '音画对齐偏差预警', {
        type: report.suspicious.length ? 'error' : 'warning',
        confirmButtonText: '继续对齐（跳异常）',
        cancelButtonText: '取消',
        customClass: 'align-warning-dialog',
      })
    } catch {
      log.info('[Align] 用户取消对齐', { mismatches: report.mismatchAlert.length, suspicious: report.suspicious.length })
      return
    }
  }

  // 阶段 2：执行对齐
  let aligned = 0
  let skippedSuspicious = 0
  let skippedNoDub = 0
  const skippedItems = []
  const updated = props.frames.map(f => {
    const d = map[f.id]
    if (!d || !d.durationMs) { skippedNoDub++; return f }
    if (isDurationSuspicious(d)) {
      skippedSuspicious++
      skippedItems.push({
        frameId: f.id,
        storyboardNum: f.storyboard_number || f.storyboardNumber || f.id,
        reason: isNaN(d.durationMs) ? 'NaN' : d.durationMs < 0 ? '负数' : d.durationMs < 400 ? '过短' : '过长',
        rawMs: d.durationMs,
      })
      return f
    }
    const sec = Math.max(1, Math.round(d.durationMs / 1000))
    aligned++
    return { ...f, duration_sec: sec }
  })

  const result = {
    updated, aligned, skippedSuspicious, skippedNoDub,
    skippedItems,
    analysisReport: report,
    dubbingStats: dubbingStats.value,
  }

  log.info('[Align] 音画对齐执行结果', {
    aligned, skippedSuspicious, skippedNoDub,
    skippedCount: skippedItems.length,
    mismatches: report.mismatchAlert.length,
  })

  emit('update:frames', updated)
  emit('alignDuration', result)

  // 阶段 3：结果提示
  const mismatchRemain = report.mismatchAlert.length // 对齐后偏差（配音仍可能 >5s，用户需要二次确认）
  const critical = skippedSuspicious > 0 || (aligned === 0 && skippedNoDub === 0)
  if (critical) {
    const msg = skippedSuspicious > 0
      ? `音画对齐：${aligned} 条成功，${skippedSuspicious} 条因时长异常被跳过（请检查配音质量）`
      : `音画对齐：无有效分镜可对齐（${report.suspicious.length} 条配音时长异常）`
    ElMessage({ type: 'error', message: msg, duration: 6000 })
    log.warn('[Align] 对齐存在严重问题', { skippedSuspicious, skippedItems })
  } else if (mismatchRemain > 0) {
    ElMessage.warning(
      `音画对齐：${aligned} 条已调整；仍有 ${mismatchRemain} 条原时长与配音偏差超过 ${MISMATCH_ALERT_SEC}s，建议检查分镜时长设置`
    )
  } else if (skippedNoDub > 0 && aligned === 0) {
    ElMessage.warning('当前分镜无配音数据，未执行对齐。请先生成配音。')
  } else {
    ElMessage.success(
      skippedSuspicious > 0
        ? `音画对齐完成：${aligned} 条成功，${skippedSuspicious} 条异常值被跳过`
        : `音画对齐完成：${aligned} 个分镜已按配音时长调整`
    )
  }
}

/**
 * 生成简化波形条（基于时长生成伪随机高度）
 */
function waveBars(durationMs) {
  const n = Math.min(12, Math.max(4, Math.round(durationMs / 600)))
  const bars = []
  let seed = (durationMs % 100) + 1
  for (let i = 0; i < n; i++) {
    seed = (seed * 9301 + 49297) % 233280
    bars.push(30 + Math.round((seed / 233280) * 70))
  }
  return bars
}

const scrollRef = ref(null)
const episodeFilter = ref(props.episodeFilterValue)
watch(episodeFilter, (v) => {
  log.info('[Filter] 集数过滤器变更', { value: v })
  emit('update:episodeFilter', v)
})

// —— 焦点同步（画布→时间轴）：自动滚动到对应卡片 ——
let _lastFocusScrollId = null
watch(() => props.focusId, (fid, old) => {
  if (!fid || fid === _lastFocusScrollId) return
  log.info('[Sync] 画布→时间轴：聚焦分镜卡片', { storyboardId: fid, prev: old || null })
  const t0 = Date.now()
  const idx = [...(props.frames || [])].findIndex(f => f.id === fid)
  if (idx < 0) {
    log.warn('[Sync] 时间轴中未找到焦点分镜（可能被集数过滤）', { storyboardId: fid })
    return
  }
  // 延迟到下一个 tick 等 DOM 更新
  requestAnimationFrame(() => {
    try {
      const el = scrollRef.value?.querySelector(`.sbt-card:nth-child(${idx + 1})`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
        const ms = Date.now() - t0
        log.info('[Sync] 已滚动时间轴卡片到视图中心', { storyboardId: fid, idx, scrollMs: ms })
        _lastFocusScrollId = fid
      }
    } catch (e) { log.warn('[Sync] 滚动失败（DOM未就绪）', { storyboardId: fid, msg: e?.message }) }
  })
})

const dragState = reactive({ active: false, idx: -1, toIdx: -1, startAt: 0 })
const brokenIdxSet = ref(new Set())

function resolveImg(f) {
  return f.local_path ? (String(f.local_path).startsWith('/') ? '/static' + f.local_path : f.local_path)
    : f.thumbnail || f.image_url || ''
}
function onImgError(_e, f, idx) {
  log.warn('[Render] 分镜缩略图加载失败', { storyboardId: f?.id, idx, src: resolveImg(f) })
  brokenIdxSet.value.add(idx)
}
function pct(v) {
  if (v == null) return '-'
  return Math.max(0, Math.min(100, Math.round(Number(v) * 100)))
}

// ---- Drag & Drop（原生 HTML5 DnD，对齐 Sprint 2 风格） ----
function onDragStart(e, idx) {
  // 若正在处理（防抖：已有拖拽进行中则拦截）
  if (dragState.active) { log.warn('[DnD] 拖拽重复触发被拦截'); e.preventDefault(); return }
  dragState.active = true
  dragState.idx = idx
  dragState.toIdx = idx
  dragState.startAt = Date.now()
  try {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  } catch (_) {}
  document.body.classList.add('sbt-drag-active')
  log.info('[DnD] 分镜拖拽开始', {
    fromIdx: idx,
    storyboardId: props.frames?.[idx]?.id,
    title: props.frames?.[idx]?.title || props.frames?.[idx]?.action?.slice?.(0, 10),
  })
}
function onDragOver(_e, idx) {
  if (!dragState.active) return
  dragState.toIdx = idx
}
function onDragLeave() {}
function onDrop(e, idx) {
  if (!dragState.active) return
  const fromIdx = dragState.idx
  const toIdx = idx
  const dur = Date.now() - (dragState.startAt || 0)
  onDragEnd()
  if (fromIdx === toIdx) { log.debug('[DnD] 原位drop，跳过'); return }
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= props.frames.length || toIdx >= props.frames.length) {
    log.error('[DnD] drop索引越界', { fromIdx, toIdx, len: props.frames.length })
    return
  }

  try {
    const list = props.frames.slice()
    const [moved] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, moved)
    log.info('[DnD] 分镜拖拽结束 → 向上 emit 排序', {
      fromIdx, toIdx, durMs: dur,
      movedId: moved?.id,
      movedNumber: moved?.storyboard_number,
      consistency: moved?.consistency_score != null ? pct(moved.consistency_score) + '%' : null,
      retries: moved?.retry_count || 0,
    })
    emit('update:frames', list)
    emit('reorder', { fromIdx, toIdx, storyboardId: moved?.id, durMs: dur })
    ElMessage.success(`已调整分镜：${fromIdx + 1} → ${toIdx + 1}`)
  } catch (e) {
    log.error('[DnD] 拖拽排序处理异常', e, { fromIdx, toIdx })
  }
}
function onDragEnd() {
  dragState.active = false
  dragState.idx = -1
  dragState.toIdx = -1
  dragState.startAt = 0
  document.body.classList.remove('sbt-drag-active')
}

function onScrollToFocused() {
  const t0 = Date.now()
  if (scrollRef.value && props.focusId != null) {
    const idx = [...(props.frames || [])].findIndex(f => f.id === props.focusId)
    const el = scrollRef.value.querySelector(`.sbt-card:nth-child(${idx + 1})`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
      log.info('[UI] 定位当前焦点卡片成功', { storyboardId: props.focusId, idx, ms: Date.now() - t0 })
    } else {
      log.warn('[UI] 定位焦点卡片失败：DOM未找到', { storyboardId: props.focusId, idx })
    }
  } else {
    log.warn('[UI] 定位焦点卡片失败：无焦点或DOM未ready', { focusId: props.focusId })
  }
}
function onPlayReel() {
  log.info('[UI] 点击预览连播', { count: props.frames?.length || 0 })
  emit('playReel', props.frames.slice())
}
</script>

<style scoped>
.sbt-timeline {
  display: flex; flex-direction: column;
  background: #fff;
  border-top: 1px solid var(--el-border-color-lighter);
  height: 100%;
}
.sbt-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 14px; background: linear-gradient(90deg, #fff7ed, #fef3c7);
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
.sbt-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #92400e; }
.sbt-tools { display: flex; align-items: center; gap: 6px; }
.sbt-hint { font-size: 12px; color: var(--el-text-color-secondary); }

.sbt-scroll-shell {
  overflow-x: auto; overflow-y: hidden;
  padding: 10px 14px 14px;
  flex: 1;
  min-height: 0;
}
.sbt-track {
  display: flex; gap: 10px; align-items: stretch;
  min-width: max-content;
}

.sbt-empty { min-width: 100%; padding: 20px; }
.sbt-card {
  width: 168px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s;
  user-select: none;
  display: flex; flex-direction: column;
}
.sbt-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.08); border-color: #6366f1; transform: translateY(-2px); }
.sbt-card.is-focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(99, 102, 241, .18); }
.sbt-card.no-img .sbt-thumb { background: #f3f4f6; }
.sbt-card.is-dragging { opacity: 0.4; }
.sbt-card.is-before { transform: translateX(-6px); }
.sbt-card.is-after { transform: translateX(6px); }

.sbt-order {
  position: absolute; top: 6px; left: 6px; z-index: 2;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0,0,0,0.65); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.sbt-retry {
  position: absolute; top: 6px; right: 6px; z-index: 2;
  background: #f59e0b; color: #fff;
  font-size: 10px; padding: 2px 5px; border-radius: 4px; font-weight: 700;
}

.sbt-thumb {
  width: 168px; height: 96px;
  background: #0f172a;
  position: relative;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.sbt-thumb img {
  width: 100%; height: 100%; object-fit: cover;
}
.sbt-noimg { color: #9ca3af; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; }
.sbt-badge {
  position: absolute; bottom: 4px; left: 4px; z-index: 2;
  padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
  display: flex; align-items: center; gap: 2px;
}
.sbt-badge-ok { background: #16a34a; color: #fff; }
.sbt-badge-danger { background: #dc2626; color: #fff; }

.sbt-meta { padding: 6px 8px 8px; flex: 1; display: flex; flex-direction: column; }
.sbt-action {
  font-size: 12px; line-height: 1.4;
  color: var(--el-text-color-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}
.sbt-foot {
  margin-top: 4px;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.sbt-duration { font-size: 11px; color: var(--el-text-color-secondary); margin-left: auto; }

/* S4-T04: 配音音频指示样式 */
.sbt-dub-stat {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #7c3aed; font-weight: 600;
  padding: 2px 8px; background: #f5f3ff; border-radius: 4px;
}
.sbt-dub-dur {
  font-size: 11px; color: #7c3aed; font-weight: 600;
}
/* 三档偏差色：正常紫 → 偏差异常橙 → 大红差红 */
.sbt-dub-dur.is-mismatch { color: #f59e0b; }
.sbt-dub-dur.is-alert {
  color: #ef4444;
  background: #fef2f2;
  padding: 1px 4px; border-radius: 3px;
  animation: sbt-pulse 1.5s infinite;
}
.sbt-dub-dur.is-error {
  color: #dc2626;
  background: #fee2e2;
  padding: 1px 4px; border-radius: 3px;
  font-weight: 700;
}
@keyframes sbt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* 缩略图上的音频指示层 */
.sbt-audio-ind {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  padding: 14px 4px 3px;
  display: flex; flex-direction: column; gap: 2px;
  pointer-events: none;
}
.sbt-wave {
  display: flex; align-items: flex-end; gap: 1px; height: 16px; padding: 0 2px;
}
.sbt-wave-bar {
  flex: 1; min-width: 2px;
  background: linear-gradient(to top, #a78bfa, #60a5fa);
  border-radius: 1px; opacity: 0.85;
}
.sbt-audio-dur {
  font-size: 10px; color: #fff; font-weight: 600; text-align: center;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
</style>

<!-- S3-T07 全局：拖拽时防止意外文本选中（参考 Sprint 2 经验） -->
<style>
body.sbt-drag-active * { user-select: none !important; }
</style>
