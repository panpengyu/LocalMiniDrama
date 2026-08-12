<template>
  <!-- ============================================================
       Sprint 11 - S11-T02 / S11-T04 / S11-T05 / S11-T08
       团队协作管理面板（抽屉）：
         · 在线成员（实时）  · 成员与角色分工管理
         · 当前节点锁         · 实时通知
         · 协作评论/沟通      · 操作审计历史（按成员/类型/时间筛选）
       ============================================================ -->
  <el-drawer
    v-model="visible"
    title="团队协作 · 实时协同与审计"
    direction="rtl"
    size="480px"
    :with-header="true"
    @open="onOpen"
  >
    <div class="collab-panel">
      <!-- 连接状态条 -->
      <div class="cp-status" :class="{ 'is-online': connected }">
        <span class="cp-dot"></span>
        <span class="cp-status-text">
          {{ connected ? '实时协作已连接' : '实时协作未连接' }}
        </span>
        <el-tag v-if="myRoleTag" size="small" effect="plain" type="primary">
          我的角色：{{ roleLabel(myRoleTag) }}
        </el-tag>
      </div>

      <el-tabs v-model="activeTab" class="cp-tabs">
        <!-- ============ 成员 ============ -->
        <el-tab-pane label="成员" name="members">
          <!-- 在线成员 -->
          <div class="cp-section-title">
            在线成员
            <el-tag size="small" round>{{ online.length }}</el-tag>
          </div>
          <div class="cp-online-list">
            <el-tag
              v-for="m in online"
              :key="m.userId"
              type="success"
              effect="light"
              size="small"
              class="cp-online-tag"
            >
              <span class="cp-online-dot"></span>{{ m.username }}
            </el-tag>
            <span v-if="!online.length" class="cp-empty-inline">当前仅您在线</span>
          </div>

          <!-- 成员与角色分工 -->
          <div class="cp-section-title">
            成员与角色分工
            <el-button
              v-if="canManage"
              size="small"
              type="primary"
              plain
              :icon="Plus"
              @click="addMemberVisible = true"
            >
              添加成员
            </el-button>
          </div>
          <el-table :data="members" size="small" v-loading="loadingMembers" empty-text="暂无协作成员">
            <el-table-column prop="username" label="成员" min-width="110">
              <template #default="{ row }">
                <span class="cp-member-name">{{ row.username || row.name || ('用户#' + row.user_id) }}</span>
                <el-tag v-if="row.role_tag === 'owner'" size="small" type="warning" effect="dark">负责人</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="分工" min-width="120">
              <template #default="{ row }">
                <el-select
                  v-if="canManage && row.role_tag !== 'owner'"
                  :model-value="row.role_tag"
                  size="small"
                  @change="(val) => onChangeRole(row, val)"
                >
                  <el-option
                    v-for="r in assignableRoles"
                    :key="r"
                    :label="roleLabel(r)"
                    :value="r"
                  />
                </el-select>
                <el-tag v-else size="small" effect="plain">{{ roleLabel(row.role_tag) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ row }">
                <el-button
                  v-if="canManage && row.role_tag !== 'owner'"
                  size="small"
                  text
                  type="danger"
                  @click="onRemoveMember(row)"
                >移除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- ============ 锁 ============ -->
        <el-tab-pane label="编辑锁" name="locks">
          <div class="cp-section-title">
            正在编辑的节点
            <el-button size="small" :icon="Refresh" text @click="loadLocks">刷新</el-button>
          </div>
          <el-table :data="lockRows" size="small" v-loading="loadingLocks" empty-text="当前无节点被锁定">
            <el-table-column prop="node_key" label="节点" min-width="140" show-overflow-tooltip />
            <el-table-column prop="locked_by_name" label="编辑者" min-width="90" />
            <el-table-column label="到期" min-width="90">
              <template #default="{ row }">{{ formatTime(row.expires_at) }}</template>
            </el-table-column>
          </el-table>
          <div class="cp-tip">
            锁在编辑者离线或超时（90 秒无续约）后自动释放；负责人可强制解锁。
          </div>
        </el-tab-pane>

        <!-- ============ 通知 ============ -->
        <el-tab-pane name="notifications">
          <template #label>
            通知
            <el-badge v-if="unreadCount > 0" :value="unreadCount" class="cp-badge" />
          </template>
          <div class="cp-section-title">
            我的通知
            <el-button size="small" text @click="markAllRead">全部已读</el-button>
          </div>
          <div class="cp-notif-list" v-loading="loadingNotif">
            <div
              v-for="n in notifications"
              :key="n.id"
              class="cp-notif-item"
              :class="{ 'is-unread': !n.is_read }"
              @click="markRead(n)"
            >
              <div class="cp-notif-head">
                <span class="cp-notif-title">{{ n.title }}</span>
                <span class="cp-notif-time">{{ formatTime(n.created_at) }}</span>
              </div>
              <div class="cp-notif-body">{{ n.content }}</div>
            </div>
            <el-empty v-if="!loadingNotif && !notifications.length" description="暂无通知" :image-size="60" />
          </div>
        </el-tab-pane>

        <!-- ============ 评论 ============ -->
        <el-tab-pane label="沟通" name="comments">
          <div class="cp-comment-stream" ref="commentStreamRef">
            <div v-for="(c, i) in comments" :key="i" class="cp-comment-item">
              <span class="cp-comment-author">{{ c.actorName }}</span>
              <span class="cp-comment-time">{{ formatTime(c.at) }}</span>
              <div class="cp-comment-text">{{ c.text }}</div>
            </div>
            <el-empty v-if="!comments.length" description="暂无协作沟通消息" :image-size="60" />
          </div>
          <div class="cp-comment-input">
            <el-input
              v-model="commentDraft"
              size="small"
              placeholder="输入协作沟通消息，回车发送"
              :disabled="!connected"
              @keyup.enter="onSendComment"
            />
            <el-button size="small" type="primary" :disabled="!connected || !commentDraft.trim()" @click="onSendComment">
              发送
            </el-button>
          </div>
        </el-tab-pane>

        <!-- ============ 审计 ============ -->
        <el-tab-pane label="审计" name="audit">
          <div class="cp-audit-filters">
            <el-select v-model="auditFilter.actionType" size="small" clearable placeholder="操作类型" style="width: 130px">
              <el-option v-for="(label, key) in ACTION_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
            <el-select v-model="auditFilter.userId" size="small" clearable placeholder="成员" style="width: 120px">
              <el-option
                v-for="m in members"
                :key="m.user_id"
                :label="m.username || m.name || ('用户#' + m.user_id)"
                :value="m.user_id"
              />
            </el-select>
            <el-button size="small" :icon="Search" @click="loadActivities">查询</el-button>
          </div>
          <el-table :data="activities" size="small" v-loading="loadingAudit" max-height="360" empty-text="暂无操作记录">
            <el-table-column label="时间" width="140">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column prop="user_name" label="成员" width="90" />
            <el-table-column label="操作" min-width="140">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="actionTagType(row.action_type)">
                  {{ actionLabel(row.action_type) }}
                </el-tag>
                <span v-if="row.target_key" class="cp-audit-target">{{ row.target_key }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 添加成员对话框 -->
    <el-dialog v-model="addMemberVisible" title="添加协作成员" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="用户ID">
          <el-input v-model="addForm.userId" placeholder="输入要邀请的用户 ID" />
        </el-form-item>
        <el-form-item label="分工角色">
          <el-select v-model="addForm.roleTag" style="width: 100%">
            <el-option v-for="r in assignableRoles" :key="r" :label="roleLabel(r)" :value="r" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addMemberVisible = false">取消</el-button>
        <el-button type="primary" @click="onAddMember">添加</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import collaborationAPI from '@/api/collaboration'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null },
  // 来自父级 useCollaboration 的实时状态（响应式传入）
  connected: { type: Boolean, default: false },
  myRoleTag: { type: String, default: null },
  online: { type: Array, default: () => [] },
  locks: { type: Object, default: () => ({}) },
  // 实时评论流（父级 onComment 收集）
  liveComments: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'send-comment'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const ROLE_LABELS = {
  owner: '负责人', screenwriter: '编剧', artist: '美术',
  editor: '剪辑', reviewer: '审核', viewer: '观察者'
}
// 可分配给成员的角色（不含 owner，owner 仅由创建者/super_admin 拥有）
const assignableRoles = ['screenwriter', 'artist', 'editor', 'reviewer', 'viewer']

const ACTION_LABELS = {
  member_join: '加入协作', member_remove: '移除成员',
  node_create: '新增节点', node_update: '修改节点', node_delete: '删除节点',
  node_move: '移动节点', edge_create: '新增连线', edge_delete: '删除连线',
  layout_save: '保存布局',
  lock: '锁定节点', unlock: '解锁节点',
  comment: '评论', version_rollback: '版本回退'
}

const activeTab = ref('members')

const members = ref([])
const loadingMembers = ref(false)
const notifications = ref([])
const loadingNotif = ref(false)
const activities = ref([])
const loadingAudit = ref(false)
const loadingLocks = ref(false)
const lockRowsLocal = ref([])
const comments = ref([])
const commentDraft = ref('')
const commentStreamRef = ref(null)

const addMemberVisible = ref(false)
const addForm = reactive({ userId: '', roleTag: 'viewer' })
const auditFilter = reactive({ actionType: '', userId: '' })

const canManage = computed(() => props.myRoleTag === 'owner')
const unreadCount = computed(() => notifications.value.filter((n) => !n.is_read).length)

// 锁：优先展示 REST 拉取的完整锁行；实时 locks 变化时也刷新
const lockRows = computed(() => lockRowsLocal.value)

function roleLabel(tag) { return ROLE_LABELS[tag] || tag || '—' }
function actionLabel(t) { return ACTION_LABELS[t] || t || '操作' }
function actionTagType(t) {
  if (['node_delete', 'edge_delete', 'member_remove', 'version_rollback'].includes(t)) return 'danger'
  if (['node_create', 'edge_create', 'member_join'].includes(t)) return 'success'
  if (['lock', 'unlock'].includes(t)) return 'warning'
  return 'info'
}

function formatTime(t) {
  if (!t) return ''
  const d = typeof t === 'number' ? new Date(t) : new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return String(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function unwrap(res) { return res?.data !== undefined ? res.data : res }

async function loadMembers() {
  if (!props.dramaId) return
  loadingMembers.value = true
  try {
    members.value = unwrap(await collaborationAPI.listCollaborators(props.dramaId)) || []
  } catch (err) {
    ElMessage.error('加载成员失败：' + (err?.message || err))
  } finally {
    loadingMembers.value = false
  }
}

async function loadLocks() {
  if (!props.dramaId) return
  loadingLocks.value = true
  try {
    lockRowsLocal.value = unwrap(await collaborationAPI.listLocks(props.dramaId)) || []
  } catch (_) {
    lockRowsLocal.value = []
  } finally {
    loadingLocks.value = false
  }
}

async function loadNotifications() {
  loadingNotif.value = true
  try {
    notifications.value = unwrap(await collaborationAPI.listNotifications({ limit: 50 })) || []
  } catch (_) {
    notifications.value = []
  } finally {
    loadingNotif.value = false
  }
}

async function loadActivities() {
  if (!props.dramaId) return
  loadingAudit.value = true
  try {
    const params = {}
    if (auditFilter.actionType) params.actionType = auditFilter.actionType
    if (auditFilter.userId) params.userId = auditFilter.userId
    activities.value = unwrap(await collaborationAPI.listActivities(props.dramaId, params)) || []
  } catch (err) {
    ElMessage.error('查询审计失败：' + (err?.message || err))
  } finally {
    loadingAudit.value = false
  }
}

async function onAddMember() {
  const uid = Number(addForm.userId)
  if (!uid) return ElMessage.warning('请输入有效的用户 ID')
  try {
    await collaborationAPI.addCollaborator(props.dramaId, uid, addForm.roleTag)
    ElMessage.success('已添加协作成员')
    addMemberVisible.value = false
    addForm.userId = ''
    await loadMembers()
  } catch (err) {
    ElMessage.error('添加失败：' + (err?.response?.data?.error || err?.message || err))
  }
}

async function onChangeRole(row, val) {
  try {
    await collaborationAPI.addCollaborator(props.dramaId, row.user_id, val)
    ElMessage.success(`已将 ${row.username || row.user_id} 的分工调整为「${roleLabel(val)}」`)
    await loadMembers()
  } catch (err) {
    ElMessage.error('调整分工失败：' + (err?.message || err))
  }
}

async function onRemoveMember(row) {
  try {
    await ElMessageBox.confirm(`确认移除协作成员「${row.username || row.user_id}」？`, '移除成员', {
      type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消'
    })
  } catch (_) { return }
  try {
    await collaborationAPI.removeCollaborator(props.dramaId, row.user_id)
    ElMessage.success('已移除成员')
    await loadMembers()
  } catch (err) {
    ElMessage.error('移除失败：' + (err?.message || err))
  }
}

async function markRead(n) {
  if (n.is_read) return
  try {
    await collaborationAPI.markNotificationRead(n.id)
    n.is_read = 1
  } catch (_) { /* ignore */ }
}

async function markAllRead() {
  try {
    await collaborationAPI.markNotificationRead()
    notifications.value.forEach((n) => (n.is_read = 1))
  } catch (_) { /* ignore */ }
}

function onSendComment() {
  const text = commentDraft.value.trim()
  if (!text) return
  emit('send-comment', text)
  // 本地即时回显
  comments.value.push({ actorName: '我', text, at: Date.now() })
  commentDraft.value = ''
  scrollCommentToBottom()
}

function scrollCommentToBottom() {
  nextTick(() => {
    const el = commentStreamRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 父级实时评论流 → 合并进本地展示
watch(() => props.liveComments, (list) => {
  if (Array.isArray(list) && list.length) {
    comments.value = [...list]
    scrollCommentToBottom()
  }
}, { deep: true })

// 实时锁变化 → 触发一次 REST 刷新（保持列表完整字段）
watch(() => props.locks, () => {
  if (visible.value && activeTab.value === 'locks') loadLocks()
}, { deep: true })

function onOpen() {
  loadMembers()
  loadNotifications()
  loadLocks()
  loadActivities()
}

// 供父级调用：新通知到达时刷新角标
defineExpose({
  refreshNotifications: loadNotifications,
  refreshLocks: loadLocks
})
</script>

<style scoped>
.collab-panel { display: flex; flex-direction: column; height: 100%; }
.cp-status {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px; background: #f4f4f5; margin-bottom: 12px;
}
.cp-status.is-online { background: #f0f9eb; }
.cp-dot { width: 8px; height: 8px; border-radius: 50%; background: #c0c4cc; }
.cp-status.is-online .cp-dot { background: #67c23a; box-shadow: 0 0 0 3px rgba(103,194,58,.2); }
.cp-status-text { font-size: 13px; color: #606266; flex: 1; }
.cp-tabs { flex: 1; }
.cp-section-title {
  display: flex; align-items: center; justify-content: space-between;
  font-weight: 600; font-size: 13px; color: #303133; margin: 12px 0 8px;
}
.cp-online-list { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-online-tag { display: inline-flex; align-items: center; }
.cp-online-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #67c23a;
  display: inline-block; margin-right: 4px;
}
.cp-empty-inline { font-size: 12px; color: #909399; }
.cp-member-name { margin-right: 6px; }
.cp-tip { margin-top: 10px; font-size: 12px; color: #909399; line-height: 1.6; }
.cp-notif-list { max-height: 420px; overflow-y: auto; }
.cp-notif-item {
  padding: 8px 10px; border-radius: 6px; border: 1px solid #ebeef5;
  margin-bottom: 6px; cursor: pointer; background: #fff;
}
.cp-notif-item.is-unread { background: #ecf5ff; border-color: #d9ecff; }
.cp-notif-head { display: flex; justify-content: space-between; align-items: center; }
.cp-notif-title { font-size: 13px; font-weight: 600; color: #303133; }
.cp-notif-time { font-size: 11px; color: #909399; }
.cp-notif-body { font-size: 12px; color: #606266; margin-top: 2px; }
.cp-badge { margin-left: 4px; }
.cp-comment-stream {
  height: 360px; overflow-y: auto; border: 1px solid #ebeef5;
  border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa;
}
.cp-comment-item { margin-bottom: 10px; }
.cp-comment-author { font-weight: 600; font-size: 13px; color: #409eff; margin-right: 6px; }
.cp-comment-time { font-size: 11px; color: #909399; }
.cp-comment-text { font-size: 13px; color: #303133; margin-top: 2px; }
.cp-comment-input { display: flex; gap: 8px; }
.cp-audit-filters { display: flex; gap: 8px; margin-bottom: 10px; }
.cp-audit-target { margin-left: 6px; font-size: 12px; color: #909399; }
</style>
