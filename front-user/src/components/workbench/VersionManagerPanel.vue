<template>
  <!-- Sprint 11 - S11-T07 版本管理界面：版本列表 + 版本对比 + 一键回退 -->
  <el-dialog
    v-model="visible"
    title="版本管理"
    width="900px"
    append-to-body
    destroy-on-close
    class="version-manager-dialog"
    @open="onOpen"
    @close="onClose"
  >
    <div v-loading="loading" class="version-manager">
      <div class="vm-toolbar">
        <div class="vm-toolbar-left">
          <el-button size="small" type="primary" plain :icon="Camera" @click="handleSnapshot">
            创建快照
          </el-button>
          <el-button size="small" :icon="Refresh" @click="loadVersions">刷新</el-button>
        </div>
        <div class="vm-toolbar-right">
          <span class="vm-hint">勾选两个版本可进行对比</span>
        </div>
      </div>

      <el-empty v-if="!loading && versions.length === 0" description="暂无版本记录" :image-size="80" />

      <!-- 版本列表：时间 / 操作者 / 变更摘要 -->
      <div v-else class="vm-list">
        <div
          v-for="v in versions"
          :key="v.id"
          class="vm-item"
          :class="{ 'vm-item--latest': v.version_no === latestVersionNo }"
        >
          <el-checkbox
            :model-value="compareSelection.includes(v.version_no)"
            :disabled="!compareSelection.includes(v.version_no) && compareSelection.length >= 2"
            @change="(checked) => toggleCompare(v.version_no, checked)"
          />
          <div class="vm-item-badge">v{{ v.version_no }}</div>
          <div class="vm-item-main">
            <div class="vm-item-summary">
              {{ v.change_summary || '无摘要' }}
              <el-tag v-if="v.source === 'rollback'" size="small" type="warning" effect="plain">回退</el-tag>
              <el-tag v-else-if="v.source === 'manual'" size="small" type="info" effect="plain">手动</el-tag>
              <el-tag v-if="v.version_no === latestVersionNo" size="small" type="success" effect="plain">当前</el-tag>
            </div>
            <div class="vm-item-meta">
              <span class="vm-meta-op">{{ v.operator_name || '系统' }}</span>
              <span class="vm-meta-sep">·</span>
              <span class="vm-meta-time">{{ formatTime(v.created_at) }}</span>
              <span class="vm-meta-sep">·</span>
              <span class="vm-meta-nodes">{{ v.node_count }} 节点 / {{ v.edge_count }} 连线</span>
            </div>
          </div>
          <div class="vm-item-actions">
            <el-button
              size="small"
              text
              type="primary"
              :disabled="v.version_no === latestVersionNo || rollingBack"
              :loading="rollingBack"
              @click="handleRollback(v)"
            >
              回退到此版本
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="compareSelection.length === 2" class="vm-compare-bar">
        <span>已选 v{{ compareSelection[0] }} 与 v{{ compareSelection[1] }}</span>
        <el-button size="small" type="primary" @click="handleCompare">对比这两个版本</el-button>
        <el-button size="small" text @click="compareSelection = []">清空</el-button>
      </div>
    </div>

    <!-- 版本对比结果 -->
    <el-dialog
      v-model="diffVisible"
      title="版本对比"
      width="640px"
      append-to-body
      class="version-diff-dialog"
    >
      <div v-if="diffResult" class="vm-diff">
        <div class="vm-diff-head">
          <span>v{{ diffResult.from.version_no }}（{{ formatTime(diffResult.from.created_at) }}）</span>
          <el-icon><Right /></el-icon>
          <span>v{{ diffResult.to.version_no }}（{{ formatTime(diffResult.to.created_at) }}）</span>
        </div>
        <div class="vm-diff-summary">{{ diffResult.summary }}</div>
        <div class="vm-diff-groups">
          <div class="vm-diff-group">
            <div class="vm-diff-title">节点</div>
            <div class="vm-diff-line vm-added">新增 {{ diffResult.diff.nodes.added.length }}：{{ diffResult.diff.nodes.added.join(', ') || '—' }}</div>
            <div class="vm-diff-line vm-removed">删除 {{ diffResult.diff.nodes.removed.length }}：{{ diffResult.diff.nodes.removed.join(', ') || '—' }}</div>
            <div class="vm-diff-line vm-modified">修改 {{ diffResult.diff.nodes.modified.length }}：{{ diffResult.diff.nodes.modified.join(', ') || '—' }}</div>
          </div>
          <div class="vm-diff-group">
            <div class="vm-diff-title">连线</div>
            <div class="vm-diff-line vm-added">新增 {{ diffResult.diff.edges.added.length }}</div>
            <div class="vm-diff-line vm-removed">删除 {{ diffResult.diff.edges.removed.length }}</div>
            <div class="vm-diff-line vm-modified">修改 {{ diffResult.diff.edges.modified.length }}</div>
          </div>
        </div>
      </div>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Camera, Refresh, Right } from '@element-plus/icons-vue'
import collaborationAPI from '@/api/collaboration'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null }
})
const emit = defineEmits(['update:modelValue', 'rolled-back'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const loading = ref(false)
// 前端防重提交：回退进行中标记，避免 confirm 弹窗等待期间重复触发并发回退
const rollingBack = ref(false)
const versions = ref([])
const compareSelection = ref([])
const diffVisible = ref(false)
const diffResult = ref(null)

const latestVersionNo = computed(() =>
  versions.value.length ? Math.max(...versions.value.map((v) => v.version_no)) : 0
)

function formatTime(t) {
  if (!t) return ''
  const d = new Date(String(t).replace(' ', 'T'))
  if (isNaN(d.getTime())) return String(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function loadVersions() {
  if (!props.dramaId) return
  loading.value = true
  try {
    const res = await collaborationAPI.listVersions(props.dramaId)
    versions.value = res?.data || res || []
  } catch (err) {
    ElMessage.error('加载版本列表失败：' + (err?.message || err))
  } finally {
    loading.value = false
  }
}

function toggleCompare(versionNo, checked) {
  const idx = compareSelection.value.indexOf(versionNo)
  if (checked && idx === -1) {
    if (compareSelection.value.length >= 2) return
    compareSelection.value.push(versionNo)
  } else if (!checked && idx !== -1) {
    compareSelection.value.splice(idx, 1)
  }
}

async function handleCompare() {
  if (!props.dramaId) return ElMessage.warning('未指定项目，无法对比版本')
  if (compareSelection.value.length !== 2) return
  const [a, b] = [...compareSelection.value].sort((x, y) => x - y)
  loading.value = true
  try {
    const res = await collaborationAPI.diffVersions(props.dramaId, a, b)
    diffResult.value = res?.data || res
    diffVisible.value = true
  } catch (err) {
    ElMessage.error('版本对比失败：' + (err?.message || err))
  } finally {
    loading.value = false
  }
}

async function handleSnapshot() {
  if (!props.dramaId) return ElMessage.warning('未指定项目，无法创建快照')
  try {
    await collaborationAPI.createSnapshot(props.dramaId, '手动创建快照')
    ElMessage.success('已创建版本快照')
    await loadVersions()
  } catch (err) {
    ElMessage.error('创建快照失败：' + (err?.message || err))
  }
}

async function handleRollback(v) {
  // 边界守卫：缺少项目上下文
  if (!props.dramaId) return ElMessage.warning('未指定项目，无法回退版本')
  // 边界守卫：目标版本非法（防止空/无效版本号）
  if (!v || v.version_no == null) return ElMessage.warning('目标版本无效，无法回退')
  // 边界守卫：已是当前（最新）版本，无需回退（防止程序化调用绕过按钮禁用态）
  if (v.version_no === latestVersionNo.value) {
    return ElMessage.info(`v${v.version_no} 已是当前版本，无需回退`)
  }
  // 防重提交守卫：回退进行中（含 confirm 等待期）直接拒绝，避免多次触发并发回退
  if (rollingBack.value) {
    return ElMessage.warning('已有回退操作进行中，请稍候…')
  }
  rollingBack.value = true
  try {
    try {
      await ElMessageBox.confirm(
        `确定回退到版本 v${v.version_no} 吗？当前状态将作为新版本保留，可再次回退。`,
        '一键回退',
        { type: 'warning', confirmButtonText: '确认回退', cancelButtonText: '取消' }
      )
    } catch (_) {
      return
    }
    loading.value = true
    try {
      const res = await collaborationAPI.rollback(props.dramaId, v.version_no)
      ElMessage.success(`已回退到 v${v.version_no}`)
      emit('rolled-back', res?.data || res)
      await loadVersions()
    } catch (err) {
      // 后端并发乐观锁冲突（HTTP 409）：提示刷新后重试，并刷新版本列表
      const code = err?.response?.data?.error?.code || err?.code
      const msg = err?.response?.data?.error?.message || err?.message || err
      if (code === 'CONFLICT' || err?.response?.status === 409) {
        ElMessage.warning('画布在回退期间已被其他成员修改，已为你刷新版本列表，请确认后重试')
        await loadVersions()
      } else {
        ElMessage.error('回退失败：' + msg)
      }
    } finally {
      loading.value = false
    }
  } finally {
    rollingBack.value = false
  }
}

function onOpen() {
  compareSelection.value = []
  diffResult.value = null
  loadVersions()
}
function onClose() {
  compareSelection.value = []
}
</script>

<style scoped>
.version-manager { min-height: 200px; }
.vm-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 12px;
}
.vm-hint { font-size: 12px; color: #909399; }
.vm-list { max-height: 460px; overflow-y: auto; }
.vm-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border: 1px solid #ebeef5; border-radius: 8px;
  margin-bottom: 8px; background: #fff; transition: box-shadow .2s;
}
.vm-item:hover { box-shadow: 0 2px 12px rgba(0,0,0,.06); }
.vm-item--latest { border-color: #67c23a; background: #f0f9eb; }
.vm-item-badge {
  min-width: 44px; text-align: center; font-weight: 600;
  color: #409eff; background: #ecf5ff; border-radius: 6px; padding: 4px 6px;
}
.vm-item-main { flex: 1; min-width: 0; }
.vm-item-summary {
  font-size: 14px; color: #303133; display: flex; align-items: center; gap: 6px;
}
.vm-item-meta { margin-top: 4px; font-size: 12px; color: #909399; }
.vm-meta-sep { margin: 0 6px; }
.vm-compare-bar {
  display: flex; align-items: center; gap: 12px;
  margin-top: 12px; padding: 10px 12px; background: #f4f4f5; border-radius: 8px;
}
.vm-diff-head {
  display: flex; align-items: center; gap: 10px;
  font-weight: 600; color: #303133; margin-bottom: 8px;
}
.vm-diff-summary {
  padding: 8px 12px; background: #ecf5ff; border-radius: 6px;
  color: #409eff; margin-bottom: 12px;
}
.vm-diff-groups { display: flex; gap: 16px; }
.vm-diff-group { flex: 1; }
.vm-diff-title { font-weight: 600; margin-bottom: 6px; color: #606266; }
.vm-diff-line { font-size: 13px; margin-bottom: 4px; }
.vm-added { color: #67c23a; }
.vm-removed { color: #f56c6c; }
.vm-modified { color: #e6a23c; }
</style>
