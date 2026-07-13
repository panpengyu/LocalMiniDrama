<template>
  <span class="canvas-flow-aligner" aria-hidden="true" />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'

const { fitView, getViewport, setViewport } = useVueFlow()
const ctx = useCanvasContext()

const PAN_STEP = 80

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

function onKeyDown(e) {
  const key = e.key.toLowerCase()
  if (!['w', 'a', 's', 'd'].includes(key)) return
  if (isTypingTarget(e.target)) return
  e.preventDefault()

  const vp = getViewport()
  if (!vp) return
  let { x, y, zoom } = vp

  if (key === 'w') y += PAN_STEP
  else if (key === 's') y -= PAN_STEP
  else if (key === 'a') x += PAN_STEP
  else if (key === 'd') x -= PAN_STEP

  setViewport({ x, y, zoom })
}

onMounted(() => {
  ctx?.registerCanvasFlowApi?.({ fitView, getViewport })
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  ctx?.registerCanvasFlowApi?.(null)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.canvas-flow-aligner {
  display: none;
}
</style>
