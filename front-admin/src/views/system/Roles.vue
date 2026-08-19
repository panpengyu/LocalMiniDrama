<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索名称/编码" clearable size="small" style="width: 200px" @keyup.enter="load(1)" />
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新建角色</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="name" label="角色名称" min-width="140" />
        <el-table-column prop="code" label="角色编码" min-width="130" />
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="权限数" width="90">
          <template #default="{ row }">{{ (row.permissions || []).length }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑角色' : '新建角色'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="角色名称" required><el-input v-model="form.name" size="small" /></el-form-item>
        <el-form-item label="角色编码" required>
          <el-input v-model="form.code" size="small" :disabled="!!form.id" placeholder="如 operator、editor" />
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" size="small" /></el-form-item>
        <el-form-item label="权限">
          <el-checkbox-group v-model="form.permissions">
            <el-checkbox v-for="p in permOptions" :key="p.value" :label="p.value" size="small">{{ p.label }}</el-checkbox>
          </el-checkbox-group>
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

const permOptions = [
  { label: '用户管理', value: 'user:manage' },
  { label: '内容管理', value: 'content:manage' },
  { label: '财务查看', value: 'finance:view' },
  { label: '财务操作', value: 'finance:manage' },
  { label: '模型配置', value: 'model:manage' },
  { label: '运营分析', value: 'operation:view' },
  { label: '系统设置', value: 'system:manage' }
]

const keyword = ref('')
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
    const res = await sysManageAPI.roles.list({ page: p, page_size: pageSize.value, keyword: keyword.value || undefined })
    items.value = (res.items || []).map(it => ({ ...it, permissions: typeof it.permissions === 'string' ? JSON.parse(it.permissions || '[]') : (it.permissions || []) }))
    total.value = res.pagination?.total || 0
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function openForm(row) {
  form.value = row
    ? { id: row.id, name: row.name, code: row.code, description: row.description, permissions: [...(row.permissions || [])], status: row.status === 1 ? 1 : 0 }
    : { name: '', code: '', description: '', permissions: [], status: 1 }
  formVisible.value = true
}

async function save() {
  if (!form.value.name || !form.value.name.trim()) return ElMessage.warning('角色名称必填')
  if (!form.value.code || !form.value.code.trim()) return ElMessage.warning('角色编码必填')
  saving.value = true
  try {
    if (form.value.id) {
      await sysManageAPI.roles.update(form.value.id, { name: form.value.name, description: form.value.description, permissions: form.value.permissions, status: form.value.status })
    } else {
      await sysManageAPI.roles.create(form.value)
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
    await ElMessageBox.confirm(`确定删除角色「${row.name}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await sysManageAPI.roles.remove(row.id)
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
