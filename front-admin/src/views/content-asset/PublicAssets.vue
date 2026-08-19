<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索素材名称" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-select v-model="typeFilter" size="small" style="width: 130px" clearable placeholder="素材类型" @change="load(1)">
          <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
        <div class="spacer" />
        <span class="hint">素材由用户上传/系统生成，此处提供元数据管理与版权状态查看</span>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="200" show-overflow-tooltip />
        <el-table-column prop="name" label="素材名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="90" />
        <el-table-column prop="category" label="分类" width="90" />
        <el-table-column label="版权状态" width="110">
          <template #default="{ row }">
            <el-tag :type="copyrightMeta[row.copyright_status]?.type || 'info'" size="small">
              {{ copyrightMeta[row.copyright_status]?.label || '未检测' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="tags" label="标签" min-width="140" show-overflow-tooltip />
        <el-table-column label="文件" width="150">
          <template #default="{ row }">
            <span class="muted">{{ row.mime_type || '未知' }} · {{ fmtSize(row.file_size) }}</span>
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

    <el-dialog v-model="formVisible" title="编辑素材" width="460px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" size="small" /></el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" size="small">
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
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
import { assetsAPI } from '@/api/assets'

const keyword = ref('')
const typeFilter = ref('')
const typeOptions = ['image', 'video', 'audio', 'voice', 'music', '3d', 'other']
const categoryOptions = ['素材', '场景', '角色', '道具', '特效', '音乐', '音效', '其他']
const copyrightMeta = {
  clean: { label: '正常', type: 'success' },
  suspect: { label: '疑似侵权', type: 'danger' },
  pending: { label: '待检测', type: 'info' },
  unsupported: { label: '不支持', type: 'warning' }
}
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

function fmtSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await assetsAPI.list({
      page: p,
      page_size: pageSize.value,
      keyword: keyword.value || undefined,
      type: typeFilter.value || undefined
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
  form.value = { id: row.id, name: row.name, category: row.category, tags: row.tags }
  formVisible.value = true
}

async function save() {
  saving.value = true
  try {
    await assetsAPI.update(form.value.id, { name: form.value.name, category: form.value.category, tags: form.value.tags })
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
    await ElMessageBox.confirm(`确定删除素材「${row.name}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await assetsAPI.remove(row.id)
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
.hint { font-size: 12px; color: #909399; }
.muted { color: #909399; font-size: 12px; }
.pager { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
