<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索标题/内容" clearable size="small" style="width: 200px" @keyup.enter="load(1)" />
        <el-select v-model="typeFilter" size="small" style="width: 130px" clearable placeholder="类型" @change="load(1)">
          <el-option label="通知" value="notice" />
          <el-option label="公告" value="announcement" />
          <el-option label="维护" value="maintenance" />
        </el-select>
        <el-select v-model="statusFilter" size="small" style="width: 110px" clearable placeholder="状态" @change="load(1)">
          <el-option label="已发布" :value="1" />
          <el-option label="已下架" :value="0" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">发布公告</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.is_top" class="top-tag">置顶</span>{{ row.title }}
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'maintenance' ? 'warning' : row.type === 'announcement' ? 'primary' : 'info'">{{ typeText(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.level === 'critical' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '已发布' : '已下架' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="publisher" label="发布人" width="120" />
        <el-table-column prop="publish_at" label="发布时间" width="170" />
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openForm(row)">编辑</el-button>
            <el-button size="small" type="warning" link @click="toggleStatus(row)">{{ row.status === 1 ? '下架' : '发布' }}</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize" :current-page="page" small @current-change="load" />
      </div>
    </el-card>

    <el-dialog v-model="formVisible" :title="form.id ? '编辑公告' : '发布公告'" width="620px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="标题" required><el-input v-model="form.title" size="small" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" size="small" style="width: 180px">
            <el-option label="通知" value="notice" />
            <el-option label="公告" value="announcement" />
            <el-option label="维护" value="maintenance" />
          </el-select>
        </el-form-item>
        <el-form-item label="级别">
          <el-select v-model="form.level" size="small" style="width: 180px">
            <el-option label="普通" value="info" />
            <el-option label="重要" value="warning" />
            <el-option label="紧急" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.is_top" />
        </el-form-item>
        <el-form-item label="发布状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item label="正文"><el-input v-model="form.content" type="textarea" :rows="6" size="small" /></el-form-item>
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
import { siteAPI } from '@/api/site'

const keyword = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

function typeText(t) {
  return { notice: '通知', announcement: '公告', maintenance: '维护' }[t] || t
}

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await siteAPI.notices.list({
      page: p, page_size: pageSize.value,
      keyword: keyword.value || undefined,
      type: typeFilter.value || undefined,
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
    ? { ...row, is_top: row.is_top === 1, status: row.status === 1 ? 1 : 0 }
    : { title: '', content: '', type: 'notice', level: 'info', is_top: false, status: 1 }
  formVisible.value = true
}

async function save() {
  if (!form.value.title || !form.value.title.trim()) return ElMessage.warning('标题必填')
  saving.value = true
  try {
    const payload = {
      title: form.value.title, content: form.value.content,
      type: form.value.type, level: form.value.level,
      is_top: form.value.is_top ? 1 : 0, status: form.value.status
    }
    if (form.value.id) await siteAPI.notices.update(form.value.id, payload)
    else await siteAPI.notices.create(payload)
    ElMessage.success('保存成功')
    formVisible.value = false
    load(page.value)
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row) {
  try {
    await siteAPI.notices.update(row.id, { status: row.status === 1 ? 0 : 1 })
    ElMessage.success(row.status === 1 ? '已下架' : '已发布')
    load(page.value)
  } catch (e) {
    ElMessage.error('操作失败：' + (e.message || '网络错误'))
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除公告「${row.title}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await siteAPI.notices.remove(row.id)
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
.top-tag { display: inline-block; background: #f56c6c; color: #fff; font-size: 11px; padding: 0 4px; border-radius: 3px; margin-right: 6px; }
</style>
