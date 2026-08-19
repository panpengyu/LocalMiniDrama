<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索编码/名称/备注" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-select v-model="typeFilter" size="small" style="width: 130px" clearable placeholder="渠道类型" @change="load(1)">
          <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新建渠道</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="code" label="渠道编码" min-width="120" />
        <el-table-column prop="name" label="渠道名称" min-width="160" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.type || 'organic' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑渠道' : '新建渠道'" width="460px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="渠道编码" required>
          <el-input v-model="form.code" size="small" :disabled="!!form.id" placeholder="如 wangzhe、douyin" />
        </el-form-item>
        <el-form-item label="渠道名称" required><el-input v-model="form.name" size="small" /></el-form-item>
        <el-form-item label="渠道类型">
          <el-select v-model="form.type" size="small">
            <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" size="small" /></el-form-item>
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
import { channelsAPI } from '@/api/channels'

const keyword = ref('')
const typeFilter = ref('')
const typeOptions = [
  { label: '自然流量', value: 'organic' },
  { label: '付费投放', value: 'paid' },
  { label: '社交媒体', value: 'social' },
  { label: '其他', value: 'other' }
]
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await channelsAPI.list({
      page: p,
      page_size: pageSize.value,
      keyword: keyword.value || undefined,
      type: typeFilter.value || undefined
    })
    items.value = res.items || []
    total.value = res.total || 0
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function openForm(row) {
  form.value = row
    ? { id: row.id, code: row.code, name: row.name, type: row.type || 'organic', status: row.status === 1 ? 1 : 0, remark: row.remark }
    : { code: '', name: '', type: 'organic', status: 1, remark: '' }
  formVisible.value = true
}

async function save() {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编码与名称必填')
  saving.value = true
  try {
    if (form.value.id) {
      await channelsAPI.update(form.value.id, { name: form.value.name, type: form.value.type, status: form.value.status, remark: form.value.remark })
    } else {
      await channelsAPI.create(form.value)
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
    await ElMessageBox.confirm(`确定删除渠道「${row.name}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await channelsAPI.remove(row.id)
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
