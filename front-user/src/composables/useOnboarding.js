/**
 * ============================================================
 *  useOnboarding — 首次登录引导 & 功能气泡提示 composable
 * ============================================================
 *
 * 目标：
 *   1) 管理首次访问的交互式引导（GuideTour）的显示状态
 *   2) 管理功能提示气泡（FeatureBubble）的“已读”记忆
 *
 * localStorage 约定：
 *   - onboarding_completed=true            引导已完成
 *   - bubble_${key}_dismissed=true         某个功能气泡已被用户关闭
 *
 * 使用：
 *   const { isFirstVisit, markCompleted, shouldShowBubble,
 *           dismissBubble, startTour, stopTour, tourActive } = useOnboarding()
 *
 *   <GuideTour v-if="tourActive" @complete="..." @skip="..." />
 *   <FeatureBubble bubble-key="ai_panel" target=".ai-panel" ... />
 */

import { ref } from 'vue'

const ONBOARDING_KEY = 'onboarding_completed'

// 模块级共享状态：保证多个组件实例之间同步引导开关
const tourActive = ref(false)

/**
 * 读取 localStorage（容错：隐私模式或 SSR 环境下静默失败）
 */
function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch (_) {
    return null
  }
}

/**
 * 写入 localStorage（容错）
 */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (_) { /* 静默失败 */ }
}

/**
 * 是否为首次访问（尚未完成引导）
 */
function isFirstVisit() {
  return readStorage(ONBOARDING_KEY) !== 'true'
}

/**
 * 标记引导已完成
 */
function markCompleted() {
  writeStorage(ONBOARDING_KEY, 'true')
  tourActive.value = false
}

/**
 * 某个功能气泡是否应该展示（尚未被关闭）
 */
function shouldShowBubble(key) {
  if (!key) return false
  return readStorage(`bubble_${key}_dismissed`) !== 'true'
}

/**
 * 关闭某个功能气泡并记忆
 */
function dismissBubble(key) {
  if (!key) return
  writeStorage(`bubble_${key}_dismissed`, 'true')
}

/**
 * 触发引导（打开 GuideTour）
 */
function startTour() {
  tourActive.value = true
}

/**
 * 主动停止引导（不标记完成）
 */
function stopTour() {
  tourActive.value = false
}

export function useOnboarding() {
  return {
    isFirstVisit,
    markCompleted,
    shouldShowBubble,
    dismissBubble,
    startTour,
    stopTour,
    tourActive,
  }
}

export default useOnboarding
