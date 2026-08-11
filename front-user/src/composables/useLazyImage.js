/**
 * useLazyImage — 图片懒加载（IntersectionObserver）
 *
 * 用途：
 *   仅在图片元素进入视口时才加载真实图片，减少首屏网络请求与渲染压力。
 *
 * API：
 *   const { createLazyImageRef } = useLazyImage()
 *   const img = createLazyImageRef('/real.jpg', '/placeholder.jpg')
 *   // 模板：<img :ref="img.setRef" :src="img.currentSrc" />
 *
 *   img.isVisible   ref<boolean>  是否已进入视口
 *   img.currentSrc  ref<string>   当前显示的图片地址（占位符 / 真实图 / 错误占位符）
 *   img.error       ref<boolean>  真实图片是否加载失败
 *   img.setRef      (el) => void  绑定到模板 :ref
 *
 * 设计：
 *   - 共用一个 IntersectionObserver 实例观察所有懒加载元素。
 *   - rootMargin 提前 200px 触发加载，滚动更顺滑。
 *   - 进入视口后立即加载真实图，加载完成替换 currentSrc；失败则显示错误占位符。
 *   - 作用域销毁时自动 disconnect observer。
 */

import { ref, getCurrentScope, onScopeDispose } from 'vue'

// 默认占位符：灰色背景（运行时生成 data URI，兼容中文）
function makePlaceholder(bgColor, text) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'>` +
    `<rect width='100%' height='100%' fill='${bgColor}'/>` +
    (text
      ? `<text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' ` +
        `fill='#ef4444' font-family='sans-serif' font-size='14'>${text}</text>`
      : '') +
    `</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

const DEFAULT_PLACEHOLDER = makePlaceholder('#e5e7eb', '')
const ERROR_PLACEHOLDER = makePlaceholder('#fef2f2', '加载失败')

export function useLazyImage() {
  // 元素 -> 状态 的映射，供 observer 回调查找
  const registry = new Map()
  let observer = null

  /** 懒加载提前量（与虚拟化缓冲区保持一致） */
  const ROOT_MARGIN = '200px'

  /** 按需创建 IntersectionObserver（单例） */
  function ensureObserver() {
    if (observer) return observer
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const state = registry.get(entry.target)
            if (state && !state.isVisible.value) {
              state.isVisible.value = true
              loadImage(state)
              // 进入视口并触发加载后不再观察该元素
              observer.unobserve(entry.target)
            }
          }
        }
      },
      { rootMargin: ROOT_MARGIN }
    )
    return observer
  }

  /**
   * 使用 Image 预加载真实图片，成功后替换 currentSrc，失败则置错误占位符。
   */
  function loadImage(state) {
    const img = new Image()
    img.onload = () => {
      state.currentSrc.value = state.src
      state.error.value = false
    }
    img.onerror = () => {
      state.error.value = true
      state.currentSrc.value = ERROR_PLACEHOLDER
    }
    img.src = state.src
  }

  /**
   * 创建一个懒加载图片的响应式状态。
   * @param {string} src 真实图片地址
   * @param {string} [placeholder] 自定义占位符地址（默认灰色背景）
   * @returns {{ isVisible, currentSrc, error, setRef }}
   */
  function createLazyImageRef(src, placeholder) {
    const isVisible = ref(false)
    const currentSrc = ref(placeholder || DEFAULT_PLACEHOLDER)
    const error = ref(false)

    const state = {
      src,
      isVisible,
      currentSrc,
      error,
      _el: null,
    }

    /**
     * 模板 ref 绑定函数：元素挂载时开始观察，卸载时清理。
     * Vue 3 支持函数式 ref：:ref="img.setRef"
     */
    function setRef(el) {
      // 清理上一次绑定的旧元素
      if (state._el && state._el !== el) {
        observer?.unobserve(state._el)
        registry.delete(state._el)
      }
      state._el = el
      if (el) {
        registry.set(el, state)
        ensureObserver().observe(el)
      }
    }

    return {
      isVisible,
      currentSrc,
      error,
      setRef,
    }
  }

  // 作用域销毁时断开 observer，释放资源
  if (getCurrentScope()) {
    onScopeDispose(() => {
      observer?.disconnect()
      observer = null
      registry.clear()
    })
  }

  return {
    createLazyImageRef,
  }
}

export default useLazyImage
