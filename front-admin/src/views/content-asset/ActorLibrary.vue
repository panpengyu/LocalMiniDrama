<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索演员/角色名称" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-select v-model="categoryFilter" size="small" style="width: 140px" clearable placeholder="分类" @change="load(1)">
          <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新建角色</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="200" show-overflow-tooltip />
        <el-table-column label="形象" width="70">
          <template #default="{ row }">
            <el-avatar :size="40" :src="row.avatar_url || row.avatar || ''">{{ (row.name || '?')[0] }}</el-avatar>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="category" label="分类" width="100" />
        <el-table-column prop="source_type" label="来源" width="90" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="tags" label="标签" min-width="120" show-overflow-tooltip />
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑角色' : '新建角色'" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称" required><el-input v-model="form.name" size="small" /></el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" size="small">
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" size="small" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="form.tags" size="small" placeholder="逗号分隔" /></el-form-item>
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
import { actorLibraryAPI } from '@/api/actorLibrary'

const keyword = ref('')
const categoryFilter = ref('')
const categoryOptions = ['主角', '配角', '反派', '龙套', '虚拟形象']
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
    const res = await actorLibraryAPI.list({
      page: p,
      page_size: pageSize.value,
      keyword: keyword.value || undefined,
      category: categoryFilter.value || undefined
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
    ? { id: row.id, name: row.name, category: row.category, description: row.description, tags: row.tags }
    : { name: '', category: '主角', description: '', tags: '' }
  formVisible.value = true
}

async function save() {
  if (!form.value.name) return ElMessage.warning('名称必填')
  saving.value = true
  try {
    if (form.value.id) {
      await actorLibraryAPI.update(form.value.id, { name: form.value.name, category: form.value.category, description: form.value.description, tags: form.value.tags })
    } else {
      await actorLibraryAPI.create({ name: form.value.name, category: form.value.category, description: form.value.description, tags: form.value.tags })
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
    await actorLibraryAPI.remove(row.id)
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
