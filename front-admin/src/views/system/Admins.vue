<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索用户名/昵称/手机" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-select v-model="statusFilter" size="small" style="width: 110px" clearable placeholder="状态" @change="load(1)">
          <el-option label="启用" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新建管理员</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="nickname" label="昵称" min-width="120" />
        <el-table-column prop="email" label="邮箱" min-width="160" />
        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 'super_admin' ? 'danger' : 'primary'">{{ row.role === 'super_admin' ? '超级管理员' : '管理员' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="last_login_at" label="最近登录" width="170" />
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openForm(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize" :current-page="page" small @current-change="load" />
      </div>
    </el-card>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑管理员' : '新建管理员'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" size="small" :disabled="!!form.id" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="昵称"><el-input v-model="form.nickname" size="small" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" size="small" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" size="small" style="width: 180px" :disabled="form.id && form.role === 'super_admin'">
            <el-option label="管理员" value="admin" />
            <el-option label="超级管理员" value="super_admin" />
          </el-select>
        </el-form-item>
        <el-form-item :label="form.id ? '重置密码' : '初始密码'" required>
          <el-input v-model="form.password" type="password" show-password size="small" :placeholder="form.id ? '留空则不修改' : '至少 6 位'" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sysManageAPI } from '@/api/sysManage'

const keyword = ref('')
const statusFilter = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await sysManageAPI.admins.list({
      page: p, page_size: pageSize.value,
      keyword: keyword.value || undefined,
      status: statusFilter.value === '' ? undefined : statusFilter.value
    })
    items.value = res.items || []
    total.value = res.pagination?.total || 0
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function openForm(row) {
  form.value = row
    ? { id: row.id, username: row.username, nickname: row.nickname, email: row.email, role: row.role, status: row.status === 1 ? 1 : 0, password: '' }
    : { username: '', nickname: '', email: '', role: 'admin', status: 1, password: '' }
  formVisible.value = true
}

async function save() {
  if (!form.value.username || !form.value.username.trim()) return ElMessage.warning('用户名必填')
  if (!form.value.id && (!form.value.password || form.value.password.length < 6)) return ElMessage.warning('初始密码至少 6 位')
  saving.value = true
  try {
    if (form.value.id) {
      const payload = { nickname: form.value.nickname, email: form.value.email, role: form.value.role, status: form.value.status }
      if (form.value.password) payload.password = form.value.password
      await sysManageAPI.admins.update(form.value.id, payload)
    } else {
      await sysManageAPI.admins.create(form.value)
    }
    ElMessage.success('保存成功')
    formVisible.value = false
    load(page.value)
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除管理员「${row.username}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await sysManageAPI.admins.remove(row.id)
    ElMessage.success('删除成功')
    load(page.value)
  } catch (e) {
    ElMessage.error('删除失败：' + (e.message || '网络错误'))
  }
}

onMounted(() => load(1))
</script>

<style scoped>
.page-wrap { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 14px; align-items: center; }
.spacer { flex: 1; }
.pager { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
