<template>
  <Teleport to="body">
    <div v-if="active" class="guide-tour">
      <!-- 居中步骤：全屏暗色遮罩 -->
      <div v-if="!hasTarget" class="guide-mask" />
      <!-- 目标步骤：高亮挖空层（box-shadow 形成遮罩，目标位置透明） -->
      <div v-else class="guide-highlight" :style="highlightStyle" />

      <!-- 引导气泡 -->
      <div
        ref="bubbleRef"
        class="guide-bubble"
        :class="[`is-${currentPlacement}`, { 'is-centered': !hasTarget }]"
        :style="bubbleStyle"
      >
        <!-- 指向箭头（居中步骤不显示） -->
        <span
          v-if="hasTarget && currentPlacement !== 'center'"
          class="guide-arrow"
          :class="`arrow-${currentPlacement}`"
        />

        <div class="guide-bubble-header">
          <span class="guide-badge">{{ currentIndex + 1 }}</span>
          <h3 class="guide-title">{{ currentStep.title }}</h3>
        </div>

        <div class="guide-content">{{ currentStep.content }}</div>

        <div class="guide-footer">
          <span class="guide-indicator">{{ currentIndex + 1 }} / {{ resolvedSteps.length }}</span>
          <div class="guide-actions">
            <el-button class="guide-btn-skip" size="small" text @click="skip">跳过</el-button>
            <el-button v-if="!isFirst" size="small" plain @click="prev">上一步</el-button>
            <el-button v-if="!isLast" size="small" type="primary" @click="next">下一步</el-button>
            <el-button v-else size="small" type="primary" @click="finish">完成</el-button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * GuideTour — 首次登录交互式引导
 *
 * 用法：
 *   <GuideTour v-if="tourActive" @complete="onDone" @skip="onSkip" />
 *
 * Props:
 *   steps — 可选，覆盖默认引导步骤。每项：{ target, title, content, placement }
 *           target 为空时居中展示；placement: top/bottom/left/right
 * Emits:
 *   complete — 完成全部步骤
 *   skip     — 用户跳过
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useOnboarding } from '@/composables/useOnboarding'

const props = defineProps({
  steps: { type: Array, default: null },
})
const emit = defineEmits(['complete', 'skip'])

const { markCompleted } = useOnboarding()

// 默认引导步骤（target 支持逗号分隔的回退选择器，querySelector 自动取首个匹配）
const DEFAULT_STEPS = [
  {
    title: '欢迎来到本地短剧助手',
    content: '这是一款 AI 驱动的本地短剧创作工具。接下来用一分钟带你了解核心功能。',
    placement: 'center',
  },
  {
    target: '.film-list-page, .drama-list, .film-list',
    title: '项目列表',
    content: '这里展示你的所有短剧项目，可随时打开继续创作或进行管理。',
    placement: 'right',
  },
  {
    target: '.create-drama-btn, .btn-new',
    title: '创建新项目',
    content: '点击「新建项目」即可开始一个全新的短剧创作旅程。',
    placement: 'bottom',
  },
  {
    target: '.workbench-canvas, .canvas-container, .wb-canvas',
    title: '创作画布',
    content: '画布是核心创作区，可组织剧本、分镜、素材等节点，自由编排故事结构。',
    placement: 'right',
  },
  {
    target: '.ai-panel, .workbench-ai-panel',
    title: 'AI助手面板',
    content: '在这里调用 AI 生成剧本、分镜、图片、视频等内容，大幅提升创作效率。',
    placement: 'left',
  },
  {
    title: '开始你的创作',
    content: '准备好了吗？现在就开始你的短剧创作之旅吧！如需重温可在设置中再次打开引导。',
    placement: 'center',
  },
]

const resolvedSteps = computed(() => (props.steps && props.steps.length ? props.steps : DEFAULT_STEPS))

const active = ref(true)
const currentIndex = ref(0)
const currentStep = computed(() => resolvedSteps.value[currentIndex.value] || {})
const isFirst = computed(() => currentIndex.value === 0)
const isLast = computed(() => currentIndex.value === resolvedSteps.value.length - 1)

// 定位相关状态
const hasTarget = ref(false)
const highlightStyle = ref({})
const bubbleStyle = ref({})
const currentPlacement = ref('center')
const bubbleRef = ref(null)

const GAP = 16 // 气泡与目标元素的间距

/** 根据 CSS 选择器查找目标元素（支持逗号分隔的回退选择器） */
function findTargetEl(selector) {
  if (!selector) return null
  try {
    return document.querySelector(selector)
  } catch (_) {
    return null
  }
}

/** 计算高亮层与气泡位置 */
async function updatePosition() {
  if (!active.value) return
  const step = currentStep.value
  const el = findTargetEl(step.target)

  // 无目标或找不到目标：居中展示
  if (!el) {
    hasTarget.value = false
    currentPlacement.value = step.placement || 'center'
    await nextTick()
    const b = bubbleRef.value
    const bw = b?.offsetWidth || 380
    const bh = b?.offsetHeight || 240
    bubbleStyle.value = {
      left: `${Math.max(8, (window.innerWidth - bw) / 2)}px`,
      top: `${Math.max(8, (window.innerHeight - bh) / 2)}px`,
    }
    return
  }

  // 滚动到可见区域，确保目标在视口内
  try {
    el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
  } catch (_) { /* 忽略 */ }
  await nextTick()

  const rect = el.getBoundingClientRect()
  hasTarget.value = true
  highlightStyle.value = {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }

  await nextTick()
  const b = bubbleRef.value
  const bw = b?.offsetWidth || 380
  const bh = b?.offsetHeight || 240
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 自动翻转：气泡超出视口时换到对侧
  let place = step.placement || 'bottom'
  if (place === 'top' && rect.top - bh - GAP < 8) place = 'bottom'
  else if (place === 'bottom' && rect.bottom + bh + GAP > vh - 8) place = 'top'
  else if (place === 'left' && rect.left - bw - GAP < 8) place = 'right'
  else if (place === 'right' && rect.right + bw + GAP > vw - 8) place = 'left'
  currentPlacement.value = place

  let left = 0
  let top = 0
  if (place === 'top') {
    left = rect.left + rect.width / 2 - bw / 2
    top = rect.top - bh - GAP
  } else if (place === 'bottom') {
    left = rect.left + rect.width / 2 - bw / 2
    top = rect.bottom + GAP
  } else if (place === 'left') {
    left = rect.left - bw - GAP
    top = rect.top + rect.height / 2 - bh / 2
  } else {
    // right
    left = rect.right + GAP
    top = rect.top + rect.height / 2 - bh / 2
  }
  // 视口边界裁剪
  left = Math.max(8, Math.min(left, vw - bw - 8))
  top = Math.max(8, Math.min(top, vh - bh - 8))
  bubbleStyle.value = { left: `${left}px`, top: `${top}px` }
}

function prev() {
  if (isFirst.value) return
  currentIndex.value -= 1
}

function next() {
  if (isLast.value) {
    finish()
    return
  }
  currentIndex.value += 1
}

function finish() {
  markCompleted()
  active.value = false
  emit('complete')
}

function skip() {
  active.value = false
  emit('skip')
}

// 步骤切换时重新定位
watch(currentIndex, () => {
  updatePosition()
})

// 键盘支持：Esc 跳过，左右方向键切换
function onKeydown(e) {
  if (!active.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    skip()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  }
}

// 滚动/缩放时重新定位（rAF 节流）
let rafId = null
function scheduleUpdate() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    updatePosition()
  })
}

onMounted(() => {
  window.addEventListener('resize', scheduleUpdate)
  window.addEventListener('scroll', scheduleUpdate, true)
  window.addEventListener('keydown', onKeydown)
  updatePosition()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleUpdate)
  window.removeEventListener('scroll', scheduleUpdate, true)
  window.removeEventListener('keydown', onKeydown)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<style scoped>
.guide-tour {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: auto;
}

/* 居中步骤的全屏遮罩 */
.guide-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
}

/* 高亮挖空层：box-shadow 形成全屏暗色遮罩，目标位置保持透明 */
.guide-highlight {
  position: fixed;
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  transition: all 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
}

/* 引导气泡：深色背景 + 蓝紫渐变边框 */
.guide-bubble {
  position: fixed;
  z-index: 2;
  width: 360px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: 18px 20px 14px;
  border-radius: 12px;
  color: #e6e6f0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
  /* 双层背景：内层实体深色 + 外层渐变边框 */
  border: 1px solid transparent;
  background-image: linear-gradient(#1a1a2e, #1a1a2e),
    linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
  animation: guide-pop 0.22s ease-out;
}

@keyframes guide-pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 指向箭头 */
.guide-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  transform: rotate(45deg);
}
.guide-arrow.arrow-bottom {
  /* 气泡在目标下方，箭头在气泡顶部居中、指向上方 */
  top: -6px;
  left: 50%;
  margin-left: -6px;
}
.guide-arrow.arrow-top {
  /* 气泡在目标上方，箭头在气泡底部居中、指向下方 */
  bottom: -6px;
  left: 50%;
  margin-left: -6px;
}
.guide-arrow.arrow-right {
  /* 气泡在目标右侧，箭头在气泡左侧居中、指向左方 */
  left: -6px;
  top: 50%;
  margin-top: -6px;
}
.guide-arrow.arrow-left {
  /* 气泡在目标左侧，箭头在气泡右侧居中、指向右方 */
  right: -6px;
  top: 50%;
  margin-top: -6px;
}

.guide-bubble-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.guide-badge {
  flex-shrink: 0;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
}
.guide-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}
.guide-content {
  font-size: 13px;
  line-height: 1.65;
  color: #b8b8cc;
  margin-bottom: 16px;
  white-space: pre-wrap;
}
.guide-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.guide-indicator {
  font-size: 12px;
  color: #7a7a92;
  font-variant-numeric: tabular-nums;
}
.guide-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 覆盖 Element Plus 按钮样式以匹配深色科技感主题 */
.guide-actions :deep(.el-button) {
  border-radius: 8px;
  font-weight: 500;
}
.guide-actions :deep(.el-button--primary) {
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  border: none;
  color: #fff;
}
.guide-actions :deep(.el-button--primary:hover) {
  background: linear-gradient(135deg, #4f90f7 0%, #9a6df8 100%);
}
.guide-actions :deep(.el-button.is-plain) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.22);
  color: #e6e6f0;
}
.guide-actions :deep(.el-button.is-plain:hover) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}
.guide-actions :deep(.el-button.is-text) {
  color: rgba(230, 230, 240, 0.65);
  padding: 5px 8px;
}
.guide-actions :deep(.el-button.is-text:hover) {
  color: #fff;
  background: transparent;
}
</style>
