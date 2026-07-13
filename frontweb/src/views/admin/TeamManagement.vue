<template>
  <div class="team-management">
    <div class="page-header">
      <h2>团队管理</h2>
      <div class="header-actions">
        <el-input v-model="searchKeyword" placeholder="搜索团队名称" clearable style="width: 240px" @input="debouncedLoadTeams" />
        <el-button type="primary" @click="showAddDialog = true">
          <el-icon><Plus /></el-icon>新增团队
        </el-button>
      </div>
    </div>

    <el-table :data="teams" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="团队名称" min-width="200" />
      <el-table-column prop="enterprise_name" label="所属企业" />
      <el-table-column prop="member_count" label="成员数" width="100" />
      <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '正常' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button size="small" @click="viewMembers(row)">查看成员</el-button>
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
      @current-change="loadTeams"
      @size-change="loadTeams"
    />

    <el-dialog v-model="showAddDialog" title="新增团队" width="500px" @closed="resetForm">
      <el-form :model="form" label-width="80px">
        <el-form-item label="团队名称" required>
          <el-input v-model="form.name" placeholder="请输入团队名称" />
        </el-form-item>
        <el-form-item label="所属企业">
          <el-select v-model="form.enterprise_id" placeholder="选择企业">
            <el-option v-for="e in enterpriseOptions" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入描述" />
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
const teams = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchKeyword = ref('')
const showAddDialog = ref(false)
const editRow = ref(null)
const enterpriseOptions = ref([])

const form = reactive({
  name: '',
  enterprise_id: '',
  description: ''
})

let searchTimer = null

async function loadTeams() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      page_size: pageSize.value
    })
    if (searchKeyword.value) {
      params.append('keyword', searchKeyword.value)
    }
    const response = await fetch(`/api/v1/teams?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      teams.value = data.data.items
      total.value = data.data.pagination.total
    }
  } catch (error) {
    ElMessage.error('加载团队失败')
  } finally {
    loading.value = false
  }
}

async function loadEnterprises() {
  try {
    const response = await fetch('/api/v1/enterprises?page=1&page_size=100', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      enterpriseOptions.value = data.data.items
    }
  } catch (error) {
    console.error('加载企业列表失败', error)
  }
}

function debouncedLoadTeams() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadTeams()
  }, 300)
}

function resetForm() {
  form.name = ''
  form.enterprise_id = ''
  form.description = ''
  editRow.value = null
}

function openEditDialog(row) {
  editRow.value = row
  form.name = row.name
  form.enterprise_id = row.enterprise_id || ''
  form.description = row.description || ''
  showAddDialog.value = true
}

async function submitForm() {
  if (!form.name) {
    ElMessage.warning('请输入团队名称')
    return
  }
  saving.value = true
  try {
    if (editRow.value) {
      await fetch(`/api/v1/teams/${editRow.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      ElMessage.success('更新成功')
    } else {
      await fetch('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      ElMessage.success('创建成功')
    }
    showAddDialog.value = false
    loadTeams()
  } catch (error) {
    ElMessage.error('操作失败')
  } finally {
    saving.value = false
  }
}

function viewMembers(row) {
  ElMessage.info(`查看团队「${row.name}」的成员列表`)
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除团队「${row.name}」吗？`, '删除确认', { type: 'warning' })
    await fetch(`/api/v1/teams/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    ElMessage.success('删除成功')
    loadTeams()
  } catch {
  }
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN')
}

loadTeams()
loadEnterprises()
</script>

<style scoped>
.team-management {
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