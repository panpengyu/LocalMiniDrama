<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-select v-model="dictType" size="small" style="width: 200px" clearable placeholder="字典类型" @change="load">
          <el-option v-for="t in types" :key="t" :label="t" :value="t" />
        </el-select>
        <el-button type="primary" size="small" @click="load">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新增字典项</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="dict_type" label="字典类型" min-width="160" />
        <el-table-column prop="label" label="标签" min-width="140" />
        <el-table-column prop="value" label="值" min-width="140" />
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openForm(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑字典项' : '新增字典项'" width="500px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="字典类型" required>
          <el-input v-model="form.dict_type" size="small" :disabled="!!form.id" placeholder="如 work_order_type" />
        </el-form-item>
        <el-form-item label="标签" required><el-input v-model="form.label" size="small" /></el-form-item>
        <el-form-item label="值" required><el-input v-model="form.value" size="small" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="0" size="small" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" size="small" /></el-form-item>
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

const dictType = ref('')
const types = ref([])
const items = ref([])
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

async function load() {
  loading.value = true
  try {
    const res = await sysManageAPI.dict.list({ dict_type: dictType.value || undefined })
    items.value = res.items || []
    types.value = res.types || []
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function openForm(row) {
  form.value = row
    ? { id: row.id, dict_type: row.dict_type, label: row.label, value: row.value, sort_order: row.sort_order || 0, remark: row.remark || '', status: row.status === 1 ? 1 : 0 }
    : { dict_type: dictType.value || '', label: '', value: '', sort_order: 0, remark: '', status: 1 }
  formVisible.value = true
}

async function save() {
  if (!form.value.dict_type || !form.value.label || !form.value.value) return ElMessage.warning('类型/标签/值必填')
  saving.value = true
  try {
    if (form.value.id) {
      await sysManageAPI.dict.update(form.value.id, { label: form.value.label, value: form.value.value, sort_order: form.value.sort_order, remark: form.value.remark, status: form.value.status })
    } else {
      await sysManageAPI.dict.create(form.value)
    }
    ElMessage.success('保存成功')
    formVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除字典项「${row.label}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await sysManageAPI.dict.remove(row.id)
    ElMessage.success('删除成功')
    load()
  } catch (e) {
    ElMessage.error('删除失败：' + (e.message || '网络错误'))
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 14px; align-items: center; }
.spacer { flex: 1; }
</style>
