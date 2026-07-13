<template>
  <div class="project-management">
    <div class="page-header">
      <h2>项目管理</h2>
      <div class="header-actions">
        <el-input v-model="searchKeyword" placeholder="搜索项目名称" clearable style="width: 240px" @input="debouncedLoadProjects" />
        <el-select v-model="filterRole" placeholder="按角色筛选" clearable style="width: 140px" @change="loadProjects">
          <el-option label="超管" value="super_admin" />
          <el-option label="企业管理员" value="enterprise_admin" />
          <el-option label="普通用户" value="user" />
        </el-select>
      </div>
    </div>

    <el-table :data="projects" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="title" label="项目名称" min-width="200" />
      <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">{{ formatStatus(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="creator" label="创建者" width="140">
        <template #default="{ row }">
          <span v-if="row.creator">{{ row.creator.nickname || row.creator.username }}</span>
          <span v-else style="color: #999">未知</span>
        </template>
      </el-table-column>
      <el-table-column prop="episodes" label="集数" width="80">
        <template #default="{ row }">{{ row.episodes?.length || 0 }}</template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="180">
        <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button size="small" @click="viewProject(row)">查看</el-button>
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
      @current-change="loadProjects"
      @size-change="loadProjects"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const loading = ref(false)
const projects = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchKeyword = ref('')
const filterRole = ref('')

let searchTimer = null

async function loadProjects() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      page_size: pageSize.value
    })
    if (searchKeyword.value) {
      params.append('keyword', searchKeyword.value)
    }
    const response = await fetch(`/api/v1/dramas?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      projects.value = data.data.items
      total.value = data.data.pagination.total
    }
  } catch (error) {
    ElMessage.error('加载项目失败')
  } finally {
    loading.value = false
  }
}

function debouncedLoadProjects() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadProjects()
  }, 300)
}

function viewProject(row) {
  router.push('/drama/' + row.id)
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除项目「${row.title}」吗？`, '删除确认', { type: 'warning' })
    await fetch(`/api/v1/dramas/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    ElMessage.success('删除成功')
    loadProjects()
  } catch {
  }
}

function formatStatus(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档', generating: '生成中' }
  return map[status] || status || '草稿'
}

function getStatusType(status) {
  const map = { draft: 'info', published: 'success', archived: 'warning', generating: 'primary' }
  return map[status] || 'info'
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN')
}

loadProjects()
</script>

<style scoped>
.project-management {
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