<template>
  <el-drawer
    :model-value="modelValue"
    title="评论批注"
    direction="rtl"
    size="440px"
    class="comment-drawer"
    @update:model-value="$emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <template #header>
      <div class="cd-header">
        <span class="cd-title">
          <el-icon><ChatLineSquare /></el-icon>
          评论批注
          <el-badge v-if="unreadTotal > 0" :value="unreadTotal" class="cd-unread" />
        </span>
      </div>
    </template>

    <div class="cd-body">
      <!-- 过滤与操作栏 -->
      <div class="cd-toolbar">
        <el-segmented
          v-model="scope"
          :options="scopeOptions"
          size="small"
          @change="loadComments"
        />
        <div class="cd-toolbar-right">
          <el-select v-model="statusFilter" size="small" style="width: 92px" @change="loadComments">
            <el-option label="全部" value="" />
            <el-option label="待处理" value="open" />
            <el-option label="已解决" value="resolved" />
          </el-select>
          <el-tooltip content="全部标记已读" placement="top">
            <el-button size="small" :icon="Check" circle @click="markAll" />
          </el-tooltip>
        </div>
      </div>

      <div v-if="nodeKey" class="cd-node-hint">
        <el-icon><Aim /></el-icon>
        当前定位节点：<b>{{ nodeKey }}</b>
        <el-button text size="small" @click="clearNodeFilter">查看全部</el-button>
      </div>

      <!-- 内嵌视频预览：提供 videoSrc 时可在面板内直接播放并跳转到批注时间点 -->
      <div v-if="resolvedVideoSrc" class="cd-video-preview">
        <video
          ref="videoRef"
          :src="resolvedVideoSrc"
          controls
          preload="metadata"
          class="cd-video-el"
          @loadedmetadata="onVideoReady"
        ></video>
        <div class="cd-video-tip">
          <el-icon><VideoPlay /></el-icon>
          点击评论上的时间标签即可跳转到对应画面
        </div>
      </div>

      <!-- 批量回复条 -->
      <div v-if="selectedIds.length" class="cd-batch-bar">
        <span>已选 {{ selectedIds.length }} 条</span>
        <el-input
          v-model="batchContent"
          size="small"
          placeholder="批量回复内容"
          class="cd-batch-input"
        />
        <el-button size="small" type="primary" :loading="batchSubmitting" @click="submitBatchReply">回复</el-button>
        <el-button size="small" text @click="clearSelection">取消</el-button>
      </div>

      <!-- 评论线程列表 -->
      <div v-loading="loading" class="cd-list">
        <el-empty v-if="!loading && threads.length === 0" description="暂无评论，来发表第一条批注吧" />

        <div v-for="t in threads" :key="t.id" class="thread" :class="{ resolved: t.status === 'resolved' }">
          <div class="thread-main">
            <el-checkbox
              class="thread-check"
              :model-value="selectedIds.includes(t.id)"
              @change="(v) => toggleSelect(t.id, v)"
            />
            <el-avatar :size="30" class="thread-avatar">{{ initials(t.author_name) }}</el-avatar>
            <div class="thread-content">
              <div class="thread-meta">
                <span class="author">{{ t.author_name || ('用户' + t.author_id) }}</span>
                <span v-if="!t.unread" class="dot-read" title="已读"></span>
                <span v-else class="dot-unread" title="未读"></span>
                <span class="time">{{ fromNow(t.created_at) }}</span>
                <el-tag v-if="t.node_key" size="small" effect="plain" class="node-tag">{{ t.node_key }}</el-tag>
                <el-tag
                  v-if="t.timestamp_ms != null"
                  size="small"
                  type="warning"
                  effect="plain"
                  class="ts-tag ts-tag-clickable"
                  :title="`跳转到 ${fmtTs(t.timestamp_ms)}`"
                  @click.stop="seekTo(t)"
                >
                  <el-icon><VideoPlay /></el-icon>{{ fmtTs(t.timestamp_ms) }}
                </el-tag>
                <el-tag v-if="t.status === 'resolved'" size="small" type="success" effect="dark">已解决</el-tag>
              </div>
              <div class="thread-text" v-html="renderMentions(t.content)"></div>
              <div class="thread-actions">
                <el-button text size="small" @click="startReply(t)">回复</el-button>
                <el-button
                  text size="small"
                  :type="t.status === 'resolved' ? 'warning' : 'success'"
                  @click="toggleStatus(t)"
                >{{ t.status === 'resolved' ? '重开' : '标记解决' }}</el-button>
                <el-button
                  v-if="canDelete(t)"
                  text size="small" type="danger"
                  @click="removeComment(t)"
                >删除</el-button>
              </div>

              <!-- 回复列表 -->
              <div v-if="t.replies && t.replies.length" class="reply-list">
                <div v-for="r in t.replies" :key="r.id" class="reply">
                  <el-avatar :size="24" class="reply-avatar">{{ initials(r.author_name) }}</el-avatar>
                  <div class="reply-body">
                    <span class="author">{{ r.author_name || ('用户' + r.author_id) }}</span>
                    <span class="time">{{ fromNow(r.created_at) }}</span>
                    <div class="reply-text" v-html="renderMentions(r.content)"></div>
                  </div>
                </div>
              </div>

              <!-- 行内回复框 -->
              <div v-if="replyingTo === t.id" class="inline-reply">
                <el-input
                  v-model="replyContent"
                  type="textarea"
                  :rows="2"
                  size="small"
                  placeholder="回复内容，可用 @用户名 提及成员"
                />
                <div class="inline-reply-actions">
                  <el-button size="small" @click="cancelReply">取消</el-button>
                  <el-button size="small" type="primary" :loading="replySubmitting" @click="submitReply(t)">发送</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部：新建评论/批注 -->
    <template #footer>
      <div class="cd-composer">
        <el-input
          v-model="newContent"
          type="textarea"
          :rows="2"
          maxlength="1000"
          show-word-limit
          placeholder="发表评论，可用 @用户名 提及成员"
        />
        <div class="composer-row">
          <el-checkbox v-model="withTimestamp" size="small">时间戳批注</el-checkbox>
          <el-input
            v-if="withTimestamp"
            v-model="timestampInput"
            size="small"
            style="width: 110px"
            placeholder="mm:ss 或毫秒"
          />
          <span class="composer-node" v-if="nodeKey">定位：{{ nodeKey }}</span>
          <el-button
            type="primary"
            size="small"
            class="composer-send"
            :loading="submitting"
            @click="submitNew"
          >发表</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatLineSquare, Check, Aim, VideoPlay } from '@element-plus/icons-vue'
import commentAPI from '@/api/comments'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], required: true },
  // 当前定位的画布节点键，格式 type:id（可选）
  nodeKey: { type: String, default: null },
  // 当前用户的协作角色标签，用于删除权限判断（owner/manage 可删他人）
  myRoleTag: { type: String, default: '' },
  // 可选：当前节点关联的视频地址；提供后面板内嵌播放器，点击时间戳可直接跳转
  videoSrc: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'seek-timestamp'])

const userStore = useUserStore()
const myId = computed(() => Number(userStore.user?.id))

const loading = ref(false)
const threads = ref([])
const unreadTotal = ref(0)

// 内嵌视频预览 / 时间轴跳转
const videoRef = ref(null)
const videoReady = ref(false)
// 支持字符串或 { url }；解析为可播放地址（相对路径经 request 代理即可）
const resolvedVideoSrc = computed(() => {
  const v = props.videoSrc
  if (!v) return ''
  return typeof v === 'string' ? v : (v.url || '')
})

const scope = ref('node') // node | all
const statusFilter = ref('')
const scopeOptions = [
  { label: '当前节点', value: 'node' },
  { label: '全部评论', value: 'all' }
]

// 新建
const newContent = ref('')
const withTimestamp = ref(false)
const timestampInput = ref('')
const submitting = ref(false)

// 回复
const replyingTo = ref(null)
const replyContent = ref('')
const replySubmitting = ref(false)

// 批量
const selectedIds = ref([])
const batchContent = ref('')
const batchSubmitting = ref(false)

const effectiveNodeKey = computed(() => (scope.value === 'node' ? props.nodeKey : undefined))

async function onOpen() {
  scope.value = props.nodeKey ? 'node' : 'all'
  await Promise.all([loadComments(), loadUnread()])
}

async function loadComments() {
  loading.value = true
  try {
    const params = {}
    // scope=node 且有 nodeKey 时按节点过滤；否则查全部
    if (scope.value === 'node' && props.nodeKey) params.node_key = props.nodeKey
    if (statusFilter.value) params.status = statusFilter.value
    const res = await commentAPI.list(props.dramaId, params)
    threads.value = res?.items || []
  } finally {
    loading.value = false
  }
}

async function loadUnread() {
  try {
    const res = await commentAPI.unread(props.dramaId)
    unreadTotal.value = Number(res?.total) || 0
  } catch (e) { /* ignore */ }
}

function clearNodeFilter() {
  scope.value = 'all'
  loadComments()
}

/* ---------- 新建评论/批注 ---------- */
function parseTimestamp(input) {
  if (!input) return null
  const s = String(input).trim()
  if (/^\d+$/.test(s)) return Number(s) // 纯数字视为毫秒
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/) // mm:ss(.ms)
  if (m) {
    const min = Number(m[1]); const sec = Number(m[2]); const ms = Number(m[3] || 0)
    return (min * 60 + sec) * 1000 + ms
  }
  return null
}

async function submitNew() {
  const content = newContent.value.trim()
  if (!content) return ElMessage.warning('请输入评论内容')
  submitting.value = true
  try {
    const payload = { content }
    if (props.nodeKey) payload.node_key = props.nodeKey
    if (withTimestamp.value) {
      const ts = parseTimestamp(timestampInput.value)
      if (ts == null) { submitting.value = false; return ElMessage.warning('时间戳格式应为 mm:ss 或毫秒数') }
      payload.timestamp_ms = ts
    }
    await commentAPI.create(props.dramaId, payload)
    newContent.value = ''
    timestampInput.value = ''
    withTimestamp.value = false
    ElMessage.success('评论已发表')
    await Promise.all([loadComments(), loadUnread()])
  } finally {
    submitting.value = false
  }
}

/* ---------- 回复 ---------- */
function startReply(t) {
  replyingTo.value = t.id
  replyContent.value = ''
}
function cancelReply() {
  replyingTo.value = null
  replyContent.value = ''
}
async function submitReply(t) {
  const content = replyContent.value.trim()
  if (!content) return ElMessage.warning('请输入回复内容')
  replySubmitting.value = true
  try {
    await commentAPI.create(props.dramaId, { parent_id: t.id, content })
    cancelReply()
    ElMessage.success('回复已发送')
    await loadComments()
  } finally {
    replySubmitting.value = false
  }
}

/* ---------- 批量回复 ---------- */
function toggleSelect(id, v) {
  if (v) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  } else {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  }
}
function clearSelection() {
  selectedIds.value = []
  batchContent.value = ''
}
async function submitBatchReply() {
  const content = batchContent.value.trim()
  if (!content) return ElMessage.warning('请输入批量回复内容')
  batchSubmitting.value = true
  try {
    await commentAPI.batchReply(props.dramaId, selectedIds.value, content)
    ElMessage.success(`已批量回复 ${selectedIds.value.length} 条`)
    clearSelection()
    await loadComments()
  } finally {
    batchSubmitting.value = false
  }
}

/* ---------- 状态 / 删除 / 已读 ---------- */
async function toggleStatus(t) {
  const next = t.status === 'resolved' ? 'open' : 'resolved'
  await commentAPI.setStatus(props.dramaId, t.id, next)
  ElMessage.success(next === 'resolved' ? '已标记解决' : '已重开')
  await loadComments()
}

function canDelete(t) {
  if (Number(t.author_id) === myId.value) return true
  return props.myRoleTag === 'owner' || props.myRoleTag === 'manager'
}
async function removeComment(t) {
  try {
    await ElMessageBox.confirm('确认删除该评论？删除后不可恢复。', '删除评论', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
    await commentAPI.remove(props.dramaId, t.id)
    ElMessage.success('已删除')
    await loadComments()
  } catch (e) { /* 取消 */ }
}

async function markAll() {
  await commentAPI.markAllRead(props.dramaId, effectiveNodeKey.value)
  ElMessage.success('已全部标记已读')
  await Promise.all([loadComments(), loadUnread()])
}

/* ---------- 时间轴跳转 ---------- */
function onVideoReady() {
  videoReady.value = true
}

/**
 * 点击评论的时间戳标签：跳转到该批注对应的播放位置。
 *   1) 若面板内嵌了视频（videoSrc），直接 seek 内嵌播放器并自动播放；
 *   2) 无论是否内嵌，都向外 emit `seek-timestamp`，宿主（如主预览播放器/剪辑时间线）
 *      可监听并驱动自己的播放器跳转，保持组件解耦。
 */
function seekTo(comment) {
  const ms = Number(comment && comment.timestamp_ms)
  if (!Number.isFinite(ms) || ms < 0) return
  const seconds = ms / 1000

  // 内嵌播放器跳转
  const el = videoRef.value
  if (el) {
    try {
      const doSeek = () => {
        // 不超过视频总时长（元数据就绪时才有 duration）
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds
        el.currentTime = Math.min(seconds, dur)
        el.play && el.play().catch(() => { /* 自动播放被拦截时忽略 */ })
      }
      if (videoReady.value || (Number.isFinite(el.duration) && el.duration > 0)) {
        doSeek()
      } else {
        el.addEventListener('loadedmetadata', doSeek, { once: true })
        el.load && el.load()
      }
      ElMessage.success(`已跳转到 ${fmtTs(ms)}`)
    } catch (e) { /* 忽略播放器异常，仍向外派发事件 */ }
  }

  // 对外派发，供宿主主播放器响应
  emit('seek-timestamp', { ms, seconds, nodeKey: comment.node_key || null, commentId: comment.id })
}

/* ---------- 展示辅助 ---------- */
function initials(name) {
  if (!name) return 'U'
  return String(name).slice(0, 1).toUpperCase()
}
function fmtTs(ms) {
  const total = Math.floor(Number(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
function fromNow(v) {
  if (!v) return ''
  const d = new Date(v).getTime()
  const diff = Date.now() - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  const dt = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getMonth() + 1}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}
// 将 @用户名 高亮（纯文本转义后再替换，避免 XSS）
function renderMentions(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc.replace(/@([\u4e00-\u9fa5\w.-]+)/g, '<span class="mention">@$1</span>')
}
</script>

<style scoped>
.cd-header { display: flex; align-items: center; }
.cd-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1e1b4b;
}
.cd-unread { margin-left: 4px; }

.cd-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.cd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.cd-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cd-node-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6366f1;
  background: #f5f3ff;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 10px;
}
.cd-node-hint b { color: #4f46e5; }

.cd-batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #eef2ff;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #4338ca;
}
.cd-batch-input { flex: 1; }

.cd-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 2px;
}

.thread {
  border: 1px solid #eef0f5;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
  transition: box-shadow 0.2s;
}
.thread:hover { box-shadow: 0 4px 16px rgba(99, 102, 241, 0.1); }
.thread.resolved { background: #f8fafc; opacity: 0.86; }

.thread-main { display: flex; gap: 8px; align-items: flex-start; }
.thread-check { margin-top: 4px; }
.thread-avatar {
  background: linear-gradient(135deg, #a855f7, #6366f1);
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}
.thread-content { flex: 1; min-width: 0; }
.thread-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #94a3b8;
}
.thread-meta .author { font-weight: 600; color: #334155; font-size: 13px; }
.dot-read, .dot-unread {
  width: 7px; height: 7px; border-radius: 50%;
}
.dot-read { background: #cbd5e1; }
.dot-unread { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15); }
.node-tag, .ts-tag { font-size: 11px; }
.ts-tag .el-icon { margin-right: 2px; vertical-align: -1px; }
.ts-tag-clickable {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.ts-tag-clickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(230, 162, 60, 0.35);
}

/* 内嵌视频预览 */
.cd-video-preview {
  margin-bottom: 10px;
  border-radius: 10px;
  overflow: hidden;
  background: #0f172a;
}
.cd-video-el {
  width: 100%;
  max-height: 200px;
  display: block;
  background: #000;
}
.cd-video-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #cbd5e1;
  padding: 6px 10px;
  background: #1e293b;
}

.thread-text {
  margin: 6px 0;
  font-size: 14px;
  color: #1f2937;
  line-height: 1.6;
  word-break: break-word;
}
.thread-text :deep(.mention),
.reply-text :deep(.mention) {
  color: #6366f1;
  font-weight: 600;
}
.thread-actions { display: flex; gap: 2px; }

.reply-list {
  margin-top: 8px;
  padding-left: 8px;
  border-left: 2px solid #eef0f5;
}
.reply { display: flex; gap: 6px; padding: 6px 0; }
.reply-avatar { background: #cbd5e1; color: #475569; font-size: 11px; flex-shrink: 0; }
.reply-body { flex: 1; min-width: 0; }
.reply-body .author { font-weight: 600; color: #475569; font-size: 12px; margin-right: 6px; }
.reply-body .time { font-size: 11px; color: #94a3b8; }
.reply-text { font-size: 13px; color: #374151; margin-top: 2px; word-break: break-word; }

.inline-reply { margin-top: 8px; }
.inline-reply-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.cd-composer { width: 100%; }
.composer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.composer-node { font-size: 12px; color: #6366f1; }
.composer-send { margin-left: auto; }
</style>
