<template>
  <div class="user-management">
    <div class="page-header">
      <h2>用户管理</h2>
      <div class="header-actions">
        <el-input v-model="searchKeyword" placeholder="搜索用户名/手机号/昵称" clearable style="width: 240px" @input="debouncedLoadUsers" />
        <el-button type="primary" @click="showAddDialog = true">
          <el-icon><Plus /></el-icon>新增用户
        </el-button>
      </div>
    </div>

    <el-table :data="users" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="用户名/手机号" />
      <el-table-column prop="nickname" label="昵称" />
      <el-table-column prop="role" label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="getRoleType(row.role)">{{ formatRole(row.role) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="user_type" label="用户类型" width="100">
        <template #default="{ row }">
          <el-tag>{{ row.user_type === 'enterprise' ? '企业用户' : '个人用户' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-switch v-model="row.status" :active-value="1" :inactive-value="0" @change="handleStatusChange(row)" />
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      @current-change="loadUsers"
      @size-change="loadUsers"
    />

    <el-dialog v-model="showAddDialog" title="新增用户" width="480px" @closed="resetForm">
      <el-form :model="form" label-width="80px">
        <el-form-item label="用户名/手机号" required>
          <el-input v-model="form.username" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="form.password" type="password" placeholder="请输入密码（至少6位）" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.nickname" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option label="企业管理员" value="enterprise_admin" />
            <el-option label="团队管理员" value="team_admin" />
            <el-option label="团队成员" value="team_member" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户类型">
          <el-select v-model="form.user_type" style="width: 100%">
            <el-option label="个人用户" value="individual" />
            <el-option label="企业用户" value="enterprise" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const loading = ref(false)
const saving = ref(false)
const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchKeyword = ref('')
const showAddDialog = ref(false)
const editRow = ref(null)

const form = reactive({
  username: '',
  password: '',
  nickname: '',
  role: 'user',
  user_type: 'individual'
})

let searchTimer = null

async function loadUsers() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      page_size: pageSize.value
    })
    if (searchKeyword.value) {
      params.append('keyword', searchKeyword.value)
    }
    const response = await fetch(`/api/v1/admin/users?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      users.value = data.data.items
      total.value = data.data.pagination.total
    }
  } catch (error) {
    ElMessage.error('加载用户失败')
  } finally {
    loading.value = false
  }
}

function debouncedLoadUsers() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadUsers()
  }, 300)
}

function resetForm() {
  form.username = ''
  form.password = ''
  form.nickname = ''
  form.role = 'user'
  form.user_type = 'individual'
  editRow.value = null
}

function openEditDialog(row) {
  editRow.value = row
  form.username = row.username
  form.password = ''
  form.nickname = row.nickname || ''
  form.role = row.role
  form.user_type = row.user_type || 'individual'
  showAddDialog.value = true
}

async function submitForm() {
  if (!form.username) {
    ElMessage.warning('请输入用户名/手机号')
    return
  }
  if (!editRow.value && !form.password) {
    ElMessage.warning('请输入密码')
    return
  }
  saving.value = true
  try {
    if (editRow.value) {
      await fetch(`/api/v1/users/${editRow.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: form.nickname,
          role: form.role,
          user_type: form.user_type,
          ...(form.password ? { password: form.password } : {})
        })
      })
      ElMessage.success('更新成功')
    } else {
      await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(form)
      })
      ElMessage.success('创建成功')
    }
    showAddDialog.value = false
    loadUsers()
  } catch (error) {
    ElMessage.error('操作失败')
  } finally {
    saving.value = false
  }
}

async function handleStatusChange(row) {
  try {
    await fetch(`/api/v1/admin/users/${row.id}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ status: row.status })
    })
    ElMessage.success('状态更新成功')
  } catch {
    row.status = row.status === 1 ? 0 : 1
    ElMessage.error('状态更新失败')
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.nickname || row.username}」吗？`, '删除确认', { type: 'warning' })
    await fetch(`/api/v1/admin/users/${row.id}`, { 
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    ElMessage.success('删除成功')
    loadUsers()
  } catch {
  }
}

function formatRole(role) {
  const map = {
    super_admin: '超管',
    enterprise_admin: '企业管理员',
    team_admin: '团队管理员',
    team_member: '团队成员',
    user: '普通用户'
  }
  return map[role] || role
}

function getRoleType(role) {
  const map = {
    super_admin: 'danger',
    enterprise_admin: 'warning',
    team_admin: 'primary',
    team_member: 'info',
    user: 'default'
  }
  return map[role] || 'default'
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN')
}

loadUsers()
</script>

<style scoped>
.user-management {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #1e1b4b;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>