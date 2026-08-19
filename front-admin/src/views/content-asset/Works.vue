<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索作品标题/题材" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-select v-model="statusFilter" size="small" style="width: 140px" clearable placeholder="作品状态" @change="load(1)">
          <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button size="small" @click="load(1)">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="200" show-overflow-tooltip />
        <el-table-column prop="title" label="作品标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="genre" label="题材" width="100" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMeta[row.status]?.type || 'info'" size="small">{{ statusMeta[row.status]?.label || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="episode_count" label="剧集数" width="80" />
        <el-table-column prop="tags" label="标签" min-width="140" show-overflow-tooltip />
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

    <el-dialog v-model="formVisible" title="编辑作品" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="标题"><el-input v-model="form.title" size="small" /></el-form-item>
        <el-form-item label="题材"><el-input v-model="form.genre" size="small" placeholder="如 都市/古装/悬疑" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" size="small">
            <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签"><el-input v-model="form.tags" size="small" placeholder="逗号分隔，如 爱情,逆袭" /></el-form-item>
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
import { worksAPI } from '@/api/works'

const keyword = ref('')
const statusFilter = ref('')
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '制作中', value: 'producing' },
  { label: '已发布', value: 'published' },
  { label: '已归档', value: 'archived' },
  { label: '失败', value: 'failed' }
]
const statusMeta = {
  draft: { label: '草稿', type: 'info' },
  producing: { label: '制作中', type: 'warning' },
  published: { label: '已发布', type: 'success' },
  archived: { label: '已归档', type: 'info' },
  failed: { label: '失败', type: 'danger' }
}
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
    const res = await worksAPI.list({
      page: p,
      page_size: pageSize.value,
      keyword: keyword.value || undefined,
      status: statusFilter.value || undefined
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
  form.value = { id: row.id, title: row.title, genre: row.genre, status: row.status, tags: row.tags }
  formVisible.value = true
}

async function save() {
  saving.value = true
  try {
    await worksAPI.update(form.value.id, { title: form.value.title, genre: form.value.genre, status: form.value.status, tags: form.value.tags })
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
    await ElMessageBox.confirm(`确定删除作品「${row.title}」？相关剧集将一并下线。`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await worksAPI.remove(row.id)
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
