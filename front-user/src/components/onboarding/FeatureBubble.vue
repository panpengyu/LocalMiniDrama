<template>
  <Teleport to="body">
    <div
      v-if="show"
      ref="bubbleRef"
      class="feature-bubble"
      :class="`is-${actualPlacement}`"
      :style="bubbleStyle"
    >
      <!-- 指向目标的箭头 -->
      <span class="fb-arrow" :class="`arrow-${actualPlacement}`" />

      <div class="fb-header">
        <h4 class="fb-title">{{ title }}</h4>
      </div>
      <div class="fb-content">{{ content }}</div>
      <div class="fb-footer">
        <el-button size="small" type="primary" @click="dismiss">知道了</el-button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * FeatureBubble — 功能提示气泡
 *
 * 在指定元素旁边显示一个气泡提示，用户点击“知道了”后关闭并记忆。
 *
 * Props:
 *   target    — 目标元素的 CSS 选择器（支持逗号分隔的回退选择器）
 *   title     — 气泡标题
 *   content   — 气泡内容
 *   placement — 位置：top/bottom/left/right，默认 top
 *   bubbleKey — 唯一标识，用于 localStorage 记忆是否已关闭
 *
 * Emits:
 *   dismiss — 用户点击“知道了”关闭气泡时触发
 */
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useOnboarding } from '@/composables/useOnboarding'

const props = defineProps({
  target: { type: String, required: true },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  placement: { type: String, default: 'top' },
  bubbleKey: { type: String, required: true },
})

const emit = defineEmits(['dismiss'])

const { shouldShowBubble, dismissBubble } = useOnboarding()

const show = ref(false)
const bubbleRef = ref(null)
const bubbleStyle = ref({})
const actualPlacement = ref(props.placement)

const GAP = 12 // 气泡与目标元素的间距

/** 查找目标元素 */
function findTarget() {
  try {
    return document.querySelector(props.target)
  } catch (_) {
    return null
  }
}

/** 计算气泡位置 */
async function updatePosition() {
  if (!show.value) return
  const el = findTarget()
  if (!el) {
    show.value = false
    return
  }
  try {
    el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
  } catch (_) { /* 忽略 */ }
  await nextTick()

  const rect = el.getBoundingClientRect()
  await nextTick()
  const b = bubbleRef.value
  const bw = b?.offsetWidth || 280
  const bh = b?.offsetHeight || 120
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 自动翻转：超出视口时换到对侧
  let place = props.placement
  if (place === 'top' && rect.top - bh - GAP < 8) place = 'bottom'
  else if (place === 'bottom' && rect.bottom + bh + GAP > vh - 8) place = 'top'
  else if (place === 'left' && rect.left - bw - GAP < 8) place = 'right'
  else if (place === 'right' && rect.right + bw + GAP > vw - 8) place = 'left'
  actualPlacement.value = place

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
  left = Math.max(8, Math.min(left, vw - bw - 8))
  top = Math.max(8, Math.min(top, vh - bh - 8))
  bubbleStyle.value = { left: `${left}px`, top: `${top}px` }
}

/** 关闭气泡并记忆 */
function dismiss() {
  dismissBubble(props.bubbleKey)
  show.value = false
  emit('dismiss')
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
  // 已被关闭则不展示
  if (!shouldShowBubble(props.bubbleKey)) return
  // 延迟一帧，确保目标元素已渲染到 DOM
  setTimeout(async () => {
    const el = findTarget()
    if (!el) return
    show.value = true
    await nextTick()
    await updatePosition()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
  }, 300)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleUpdate)
  window.removeEventListener('scroll', scheduleUpdate, true)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<style scoped>
.feature-bubble {
  position: fixed;
  z-index: 9998;
  width: 280px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: 14px 16px 12px;
  border-radius: 12px;
  color: #e6e6f0;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  /* 深色背景 + 蓝紫渐变边框 */
  border: 1px solid transparent;
  background-image: linear-gradient(#1a1a2e, #1a1a2e),
    linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
  animation: fb-pop 0.2s ease-out;
}

@keyframes fb-pop {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 指向箭头 */
.fb-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  transform: rotate(45deg);
}
.fb-arrow.arrow-top {
  /* 气泡在目标上方，箭头在底部 */
  bottom: -5px;
  left: 50%;
  margin-left: -5px;
}
.fb-arrow.arrow-bottom {
  /* 气泡在目标下方，箭头在顶部 */
  top: -5px;
  left: 50%;
  margin-left: -5px;
}
.fb-arrow.arrow-left {
  /* 气泡在目标左侧，箭头在右侧 */
  right: -5px;
  top: 50%;
  margin-top: -5px;
}
.fb-arrow.arrow-right {
  /* 气泡在目标右侧，箭头在左侧 */
  left: -5px;
  top: 50%;
  margin-top: -5px;
}

.fb-header {
  margin-bottom: 6px;
}
.fb-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}
.fb-content {
  font-size: 12px;
  line-height: 1.6;
  color: #b8b8cc;
  margin-bottom: 12px;
  white-space: pre-wrap;
}
.fb-footer {
  display: flex;
  justify-content: flex-end;
}

/* 蓝色渐变按钮 */
.fb-footer :deep(.el-button--primary) {
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  border: none;
  color: #fff;
  border-radius: 8px;
}
.fb-footer :deep(.el-button--primary:hover) {
  background: linear-gradient(135deg, #4f90f7 0%, #9a6df8 100%);
}
</style>
