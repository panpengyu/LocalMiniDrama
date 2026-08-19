<template>
  <div class="online-sessions-page">
    <!-- 操作栏 -->
    <el-card shadow="never">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-input
            v-model="query.keyword"
            placeholder="用户名 / 手机号 / IP / UA 关键字"
            clearable
            class="kw-input"
            @keyup.enter="load(1)"
            @clear="load(1)"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-checkbox v-model="query.online" @change="load(1)">仅看在线</el-checkbox>
          <el-button type="primary" @click="load(1)">查询</el-button>
        </div>
        <div>
          <el-button plain @click="handlePrune">清理过期会话</el-button>
          <el-button type="danger" plain @click="handleRevokeAll">强制下线指定用户</el-button>
        </div>
      </div>
    </el-card>

    <!-- 会话列表 -->
    <el-card shadow="never" class="mt16">
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column label="会话ID" prop="id" width="120" show-overflow-tooltip />
        <el-table-column label="用户" width="140">
          <template #default="{ row }">
            <div>{{ row.username }}</div>
            <div class="sub">{{ row.nickname }}</div>
          </template>
        </el-table-column>
        <el-table-column label="IP" prop="ip" width="130" show-overflow-tooltip />
        <el-table-column label="设备 / UA" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.user_agent || '-' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="过期时间" width="170">
          <template #default="{ row }">{{ formatTime(row.expires_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.online" type="success" size="small">在线</el-tag>
            <el-tag v-else type="info" size="small">离线</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.online" size="small" type="danger" link @click="handleRevoke(row)">下线</el-button>
            <span v-else class="sub">-</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="mt16 pagination"
        layout="total, prev, pager, next, sizes"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @current-change="load()"
        @size-change="load(1)"
      />
    </el-card>

    <!-- 强制下线用户弹窗 -->
    <el-dialog v-model="revokeAllVisible" title="强制下线用户全部会话" width="420px">
      <el-alert type="warning" :closable="false" show-icon title="下线后该用户所有已签发令牌立即失效（无缓存窗口），需重新登录。" class="mb16" />
      <el-form label-width="80px">
        <el-form-item label="用户名">
          <el-input v-model="revokeTarget" placeholder="输入用户名或手机号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="revokeAllVisible = false">取消</el-button>
        <el-button type="danger" :loading="revoking" @click="confirmRevokeAll">确认下线</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { securityAPI } from '@/api/security'

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const query = reactive({ keyword: '', online: false, page: 1, pageSize: 20 })

const revokeAllVisible = ref(false)
const revokeTarget = ref('')
const revoking = ref(false)

function formatTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function load(page) {
  if (page) query.page = page
  loading.value = true
  try {
    const params = {
      keyword: query.keyword || undefined,
      online: query.online ? 'true' : undefined,
      page: query.page,
      pageSize: query.pageSize
    }
    const res = await securityAPI.sessions(params)
    rows.value = res.items || []
    total.value = res.pagination?.total || 0
  } catch (e) {
    ElMessage.error('加载会话失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

async function handleRevoke(row) {
  try {
    await ElMessageBox.confirm(`确定下线用户「${row.username}」的会话 ${row.id}？`, '下线确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await securityAPI.revokeSession(row.id, row.user_id)
    ElMessage.success('已强制下线该会话')
    load()
  } catch (e) {
    ElMessage.error('操作失败：' + (e.message || '网络错误'))
  }
}

function handleRevokeAll() {
  revokeTarget.value = ''
  revokeAllVisible.value = true
}

async function confirmRevokeAll() {
  if (!revokeTarget.value.trim()) {
    ElMessage.warning('请输入用户名或手机号')
    return
  }
  revoking.value = true
  try {
    await securityAPI.revokeAllForUser({ username: revokeTarget.value.trim() })
    ElMessage.success('已强制下线该用户全部会话')
    revokeAllVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('操作失败：' + (e.message || '网络错误'))
  } finally {
    revoking.value = false
  }
}

async function handlePrune() {
  try {
    const res = await securityAPI.pruneSessions()
    ElMessage.success(`已清理 ${res?.removed || 0} 条过期/已下线会话`)
    load()
  } catch (e) {
    ElMessage.error('清理失败：' + (e.message || '网络错误'))
  }
}

onMounted(() => load())
</script>

<style scoped>
.online-sessions-page { padding: 4px; }
.mt16 { margin-top: 16px; }
.mb16 { margin-bottom: 16px; }
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toolbar-left { display: flex; align-items: center; gap: 12px; }
.kw-input { width: 280px; }
.sub { color: #909399; font-size: 12px; }
.pagination { justify-content: flex-end; }
</style>
