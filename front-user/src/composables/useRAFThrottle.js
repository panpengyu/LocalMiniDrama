/**
 * useRAFThrottle — requestAnimationFrame 节流
 *
 * 用途：
 *   节流画布拖拽、缩放、滚动等高频事件，保证同一帧内只执行一次回调，
 *   将渲染节奏交给浏览器调度，避免丢帧。
 *
 * API：
 *   rafThrottle(fn)        将 fn 包装为 RAF 节流函数，同一帧内多次调用只执行最后一次
 *   useRAFValue(initial)   创建一个 ref，其值更新经过 RAF 节流，返回 { value, set }
 *   cancelAll()            取消所有待执行的 RAF（组件卸载时自动调用）
 *
 * 注意：
 *   - 每个 rafThrottle 包装的函数拥有独立的 pending 状态，互不干扰。
 *   - cancelAll 会取消当前所有注册的 RAF id，用于统一清理。
 */

import { ref, getCurrentScope, onScopeDispose } from 'vue'

export function useRAFThrottle() {
  // 所有待执行的 RAF id 集合，供 cancelAll 统一清理
  const rafIds = new Set()

  /**
   * 将函数包装为 RAF 节流。
   * 同一帧内多次调用只保留最后一次参数，并在下一帧执行一次。
   * @param {Function} fn 目标函数
   * @returns {Function} 节流后的函数
   */
  function rafThrottle(fn) {
    let rafId = null
    let pendingArgs = null
    let hasPending = false

    function throttled(...args) {
      // 始终用最新参数覆盖
      pendingArgs = args
      hasPending = true
      if (rafId !== null) return // 当前帧已排队，等待执行
      rafId = requestAnimationFrame(() => {
        const id = rafId // 先捕获真实 id，再置空，确保从 Set 中正确移除
        rafId = null
        rafIds.delete(id)
        if (hasPending) {
          hasPending = false
          const finalArgs = pendingArgs
          pendingArgs = null
          fn(...finalArgs)
        }
      })
      rafIds.add(rafId)
    }

    return throttled
  }

  /**
   * 创建一个值更新经过 RAF 节流的 ref。
   * 连续调用 set 只会在下一帧应用最后一次的值。
   * @param {*} initialValue 初始值
   * @returns {{ value: import('vue').Ref, set: Function }}
   */
  function useRAFValue(initialValue) {
    const value = ref(initialValue)
    let rafId = null
    let pendingValue = initialValue
    let hasPending = false

    function set(newValue) {
      pendingValue = newValue
      hasPending = true
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        const id = rafId
        rafId = null
        rafIds.delete(id)
        if (hasPending) {
          hasPending = false
          value.value = pendingValue
        }
      })
      rafIds.add(rafId)
    }

    return { value, set }
  }

  /** 取消所有待执行的 RAF 回调 */
  function cancelAll() {
    for (const id of rafIds) {
      cancelAnimationFrame(id)
    }
    rafIds.clear()
  }

  // 组件/作用域销毁时自动清理，避免内存泄漏与卸载后回调
  if (getCurrentScope()) {
    onScopeDispose(cancelAll)
  }

  return {
    rafThrottle,
    useRAFValue,
    cancelAll,
  }
}

export default useRAFThrottle
