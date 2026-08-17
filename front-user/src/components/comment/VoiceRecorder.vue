<template>
  <div class="voice-recorder">
    <!-- 已上传语音：播放器 + 移除 -->
    <div v-if="modelValue" class="vr-play">
      <el-icon class="vr-wave"><Microphone /></el-icon>
      <audio :src="modelValue" controls preload="metadata" class="vr-audio"></audio>
      <span v-if="voiceDuration" class="vr-duration">{{ fmtDur(voiceDuration) }}</span>
      <el-button text size="small" type="danger" :icon="Delete" @click="clear">移除</el-button>
    </div>

    <!-- 待上传的录音预览 -->
    <div v-else-if="previewUrl" class="vr-preview">
      <el-icon class="vr-wave"><Checked /></el-icon>
      <audio :src="previewUrl" controls preload="metadata" class="vr-audio"></audio>
      <span class="vr-duration">{{ fmtDur(recordedSeconds) }}</span>
      <el-button size="small" @click="discardPreview">重录</el-button>
      <el-button size="small" type="primary" :loading="uploading" @click="upload">使用此语音</el-button>
    </div>

    <!-- 录音状态 -->
    <div v-else class="vr-record">
      <template v-if="recording">
        <el-button size="small" type="danger" :icon="VideoPause" @click="stop">停止</el-button>
        <span class="vr-timer" :class="{ over: recordedSeconds >= maxSeconds }">
          {{ fmtDur(recordedSeconds) }} / {{ maxSeconds }}s
        </span>
        <span class="vr-tip">保持贴近麦克风，最长 {{ maxSeconds }} 秒，到点自动停止</span>
      </template>
      <template v-else>
        <el-button size="small" :icon="Microphone" @click="start">录语音</el-button>
        <span class="vr-tip">支持 1~{{ maxSeconds }} 秒语音评论（需浏览器麦克风权限）</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Microphone, Delete, Checked, VideoPause } from '@element-plus/icons-vue'
import { uploadAPI } from '@/api/upload'

const props = defineProps({
  // 已上传的语音地址（v-model）
  modelValue: { type: String, default: '' },
  // 语音时长（秒）
  voiceDuration: { type: [Number, String], default: 0 },
  // 最长录音时长（秒），超出自动停止
  maxSeconds: { type: Number, default: 60 },
  // 最短录音时长（秒），过短丢弃
  minSeconds: { type: Number, default: 1 },
})
const emit = defineEmits(['update:modelValue', 'change', 'error'])

const recording = ref(false)
const recordedSeconds = ref(0)
const timerRef = ref(null)
const previewUrl = ref('')
const previewBlob = ref(null)
const uploading = ref(false)

let mediaRecorder = null
let stream = null
let chunks = []
let startedAt = 0
let autoStopped = false

function fmtDur(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

async function start() {
  if (recording.value) return
  if (typeof window === 'undefined' || !window.MediaRecorder) {
    ElMessage.warning('当前浏览器不支持录音（MediaRecorder），请使用新版 Chrome / Edge / Safari')
    emit('error', new Error('MediaRecorder 不可用'))
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    ElMessage.warning('无法访问麦克风，请检查浏览器权限设置')
    emit('error', e)
    return
  }
  chunks = []
  autoStopped = false
  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  mediaRecorder.onstop = onStopped
  mediaRecorder.start()
  startedAt = Date.now()
  recording.value = true
  recordedSeconds.value = 0
  timerRef.value = setInterval(() => {
    recordedSeconds.value = Math.round((Date.now() - startedAt) / 1000)
    // 达到上限自动停止
    if (recordedSeconds.value >= props.maxSeconds && !autoStopped) {
      autoStopped = true
      stop()
    }
  }, 250)
}

function stop() {
  if (!recording.value || !mediaRecorder) return
  clearInterval(timerRef.value)
  timerRef.value = null
  try {
    mediaRecorder.state !== 'inactive' && mediaRecorder.stop()
  } catch (e) { /* 已停止 */ }
}

function onStopped() {
  recording.value = false
  recordedSeconds.value = Math.max(recordedSeconds.value, Math.round((Date.now() - startedAt) / 1000))
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  mediaRecorder = null
  if (recordedSeconds.value < props.minSeconds) {
    ElMessage.warning(`录音太短（${recordedSeconds.value}s），至少需要 ${props.minSeconds} 秒`)
    discardPreview()
    return
  }
  const type = (chunks[0]?.type) || 'audio/webm'
  previewBlob.value = new Blob(chunks, { type })
  previewUrl.value = URL.createObjectURL(previewBlob.value)
  chunks = []
}

function discardPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewBlob.value = null
  recordedSeconds.value = 0
}

async function upload() {
  if (!previewBlob.value) return
  uploading.value = true
  try {
    const name = `voice_${Date.now()}.webm`
    const file = new File([previewBlob.value], name, { type: previewBlob.value.type || 'audio/webm' })
    const res = await uploadAPI.uploadAudio(file)
    const url = res?.url || res?.local_path
    if (!url) throw new Error('上传响应缺少 url')
    const duration = recordedSeconds.value
    discardPreview()
    emit('update:modelValue', url)
    emit('change', { url, duration })
  } catch (e) {
    ElMessage.error('语音上传失败：' + (e?.message || '请重试'))
    emit('error', e)
  } finally {
    uploading.value = false
  }
}

function clear() {
  emit('update:modelValue', '')
  emit('change', { url: '', duration: 0 })
}

onBeforeUnmount(() => {
  clearInterval(timerRef.value)
  timerRef.value = null
  if (recording.value && mediaRecorder) {
    try { mediaRecorder.state !== 'inactive' && mediaRecorder.stop() } catch (e) { /* ignore */ }
  }
  if (stream) stream.getTracks().forEach((t) => t.stop())
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<style scoped>
.voice-recorder {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  margin-top: 6px;
}
.vr-play, .vr-preview, .vr-record {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}
.vr-wave { color: #6366f1; font-size: 16px; }
.vr-audio { height: 32px; max-width: 220px; flex: 1; min-width: 140px; }
.vr-duration {
  font-size: 12px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.vr-timer {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  font-variant-numeric: tabular-nums;
}
.vr-timer.over { color: #ef4444; }
.vr-tip { font-size: 12px; color: #94a3b8; }
</style>
