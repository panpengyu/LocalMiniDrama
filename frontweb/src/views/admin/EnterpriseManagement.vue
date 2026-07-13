<template>
  <div class="enterprise-management">
    <div class="page-header">
      <h2>企业管理</h2>
      <div class="header-actions">
        <el-input v-model="searchKeyword" placeholder="搜索企业名称" clearable style="width: 240px" @input="debouncedLoadEnterprises" />
        <el-button type="primary" @click="showAddDialog = true">
          <el-icon><Plus /></el-icon>新增企业
        </el-button>
      </div>
    </div>

    <el-table :data="enterprises" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="企业名称" min-width="200" />
      <el-table-column prop="contact_person" label="联系人" />
      <el-table-column prop="contact_phone" label="联系电话" />
      <el-table-column prop="address" label="地址" min-width="200" show-overflow-tooltip />
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
          <el-button size="small" @click="viewUsers(row)">查看用户</el-button>
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
      @current-change="loadEnterprises"
      @size-change="loadEnterprises"
    />

    <el-dialog v-model="showAddDialog" title="新增企业" width="500px" @closed="resetForm">
      <el-form :model="form" label-width="80px">
        <el-form-item label="企业名称" required>
          <el-input v-model="form.name" placeholder="请输入企业名称" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="form.contact_person" placeholder="请输入联系人" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.contact_phone" placeholder="请输入联系电话" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" placeholder="请输入地址" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="3" placeholder="请输入备注" />
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
const enterprises = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchKeyword = ref('')
const showAddDialog = ref(false)
const editRow = ref(null)

const form = reactive({
  name: '',
  contact_person: '',
  contact_phone: '',
  address: '',
  remark: ''
})

let searchTimer = null

async function loadEnterprises() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      page_size: pageSize.value
    })
    if (searchKeyword.value) {
      params.append('keyword', searchKeyword.value)
    }
    const response = await fetch(`/api/v1/enterprises?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await response.json()
    if (data.success) {
      enterprises.value = data.data.items
      total.value = data.data.pagination.total
    }
  } catch (error) {
    ElMessage.error('加载企业失败')
  } finally {
    loading.value = false
  }
}

function debouncedLoadEnterprises() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadEnterprises()
  }, 300)
}

function resetForm() {
  form.name = ''
  form.contact_person = ''
  form.contact_phone = ''
  form.address = ''
  form.remark = ''
  editRow.value = null
}

function openEditDialog(row) {
  editRow.value = row
  form.name = row.name
  form.contact_person = row.contact_person || ''
  form.contact_phone = row.contact_phone || ''
  form.address = row.address || ''
  form.remark = row.remark || ''
  showAddDialog.value = true
}

async function submitForm() {
  if (!form.name) {
    ElMessage.warning('请输入企业名称')
    return
  }
  saving.value = true
  try {
    if (editRow.value) {
      await fetch(`/api/v1/enterprises/${editRow.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      ElMessage.success('更新成功')
    } else {
      await fetch('/api/v1/enterprises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      ElMessage.success('创建成功')
    }
    showAddDialog.value = false
    loadEnterprises()
  } catch (error) {
    ElMessage.error('操作失败')
  } finally {
    saving.value = false
  }
}

function viewUsers(row) {
  ElMessage.info(`查看企业「${row.name}」的用户列表`)
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除企业「${row.name}」吗？`, '删除确认', { type: 'warning' })
    await fetch(`/api/v1/enterprises/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    ElMessage.success('删除成功')
    loadEnterprises()
  } catch {
  }
}

function formatDate(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('zh-CN')
}

loadEnterprises()
</script>

<style scoped>
.enterprise-management {
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