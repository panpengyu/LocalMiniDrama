<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索参数键/说明" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新增参数</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="param_key" label="参数键" min-width="200" />
        <el-table-column prop="param_value" label="参数值" min-width="220" show-overflow-tooltip />
        <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑参数' : '新增参数'" width="500px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="参数键" required>
          <el-input v-model="form.param_key" size="small" :disabled="!!form.id" placeholder="如 site.maintenance_mode" />
        </el-form-item>
        <el-form-item label="参数值" required><el-input v-model="form.param_value" size="small" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" size="small" /></el-form-item>
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
    const res = await sysManageAPI.params.list({ page: p, page_size: pageSize.value, keyword: keyword.value || undefined })
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
    ? { id: row.id, param_key: row.param_key, param_value: row.param_value, description: row.description, status: row.status === 1 ? 1 : 0 }
    : { param_key: '', param_value: '', description: '', status: 1 }
  formVisible.value = true
}

async function save() {
  if (!form.value.param_key || !form.value.param_key.trim()) return ElMessage.warning('参数键必填')
  saving.value = true
  try {
    if (form.value.id) {
      await sysManageAPI.params.update(form.value.id, { param_key: form.value.param_key, param_value: form.value.param_value, description: form.value.description, status: form.value.status })
    } else {
      await sysManageAPI.params.create(form.value)
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
    await ElMessageBox.confirm(`确定删除参数「${row.param_key}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await sysManageAPI.params.remove(row.id)
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
