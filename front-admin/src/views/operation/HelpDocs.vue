<template>
  <div class="help-docs-page">
    <!-- 顶部工具栏 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#8b5cf6"><Document /></el-icon>
          <span>帮助文档管理</span>
          <span class="subtitle">管理用户端帮助中心内容（分类 / 排序 / 发布状态），数据存储于 MySQL help_docs</span>
        </div>
        <div class="toolbar-actions">
          <el-button :icon="Refresh" :loading="loading" @click="loadList">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增文档</el-button>
        </div>
      </div>

      <!-- 筛选 -->
      <el-form :inline="true" :model="filter" size="default" style="margin-top: 12px">
        <el-form-item label="分类">
          <el-select v-model="filter.category" placeholder="全部" clearable style="width: 160px">
            <el-option label="使用手册（manual）" value="manual" />
            <el-option label="常见问题（faq）" value="faq" />
            <el-option label="视频教程（video）" value="video" />
            <el-option label="最佳实践（best_practice）" value="best_practice" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布状态">
          <el-select v-model="filter.is_published" placeholder="全部" clearable style="width: 130px">
            <el-option label="已发布" :value="1" />
            <el-option label="未发布" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filter.keyword" placeholder="标题 / doc_key" clearable style="width: 200px" @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 文档列表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <el-table v-loading="loading" :data="items" stripe border row-key="id" height="62vh">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="分类" width="130">
          <template #default="{ row }">
            <el-tag :type="categoryTag(row.category)" size="small">{{ categoryLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="doc_key" label="doc_key" width="160" show-overflow-tooltip />
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column label="摘要" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-muted">{{ row.summary || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sort_order" label="排序" width="70" align="center" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.is_published ? 'success' : 'info'" size="small">
              {{ row.is_published ? '已发布' : '未发布' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" link type="primary" @click="openPreview(row)">预览</el-button>
            <el-button size="small" link type="danger" @click="doDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top: 14px; justify-content: flex-end"
        background
        layout="total, prev, pager, next, sizes"
        :total="total"
        :page-size="filter.page_size"
        :page-sizes="[10, 20, 50, 100]"
        v-model:current-page="filter.page"
        @current-change="loadList"
        @size-change="loadList"
      />
    </el-card>

    <!-- 编辑抽屉 -->
    <el-drawer v-model="editVisible" :title="form.id ? '编辑帮助文档' : '新增帮助文档'" size="560px" destroy-on-close>
      <el-form label-width="90px" :model="form" :rules="formRules" ref="formRef">
        <el-form-item label="分类" prop="category">
          <el-select v-model="form.category" style="width: 100%">
            <el-option label="使用手册（manual）" value="manual" />
            <el-option label="常见问题（faq）" value="faq" />
            <el-option label="视频教程（video）" value="video" />
            <el-option label="最佳实践（best_practice）" value="best_practice" />
          </el-select>
        </el-form-item>
        <el-form-item label="doc_key" prop="docKey">
          <el-input v-model="form.docKey" placeholder="如 getting-started（唯一标识）" :disabled="!!form.id" />
        </el-form-item>
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="文档标题" />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="form.summary" type="textarea" :rows="2" placeholder="一句话摘要" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="12" placeholder="支持纯文本，空行分段渲染" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="发布">
          <el-switch v-model="form.isPublished" active-text="发布" inactive-text="草稿" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">保存</el-button>
      </template>
    </el-drawer>

    <!-- 预览抽屉 -->
    <el-drawer v-model="previewVisible" :title="previewDoc?.title || '预览'" size="52%" destroy-on-close>
      <div class="doc-preview" v-html="previewHtml"></div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus, Document } from '@element-plus/icons-vue'
import { helpAdminAPI } from '@/api/help'

const loading = ref(false)
const saving = ref(false)
const items = ref([])
const total = ref(0)
const filter = reactive({ page: 1, page_size: 20, category: '', is_published: undefined, keyword: '' })

const editVisible = ref(false)
const previewVisible = ref(false)
const previewDoc = ref(null)
const formRef = ref(null)
const form = reactive({
  id: null, category: 'manual', docKey: '', title: '', summary: '', content: '', sortOrder: 0, isPublished: true
})
const formRules = {
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  docKey: [{ required: true, message: 'doc_key 必填', trigger: 'blur' }],
  title: [{ required: true, message: '标题必填', trigger: 'blur' }]
}

const previewHtml = computed(() => {
  const c = previewDoc.value?.content || ''
  return c
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>')
})

function categoryLabel(c) {
  return { manual: '使用手册', faq: '常见问题', video: '视频教程', best_practice: '最佳实践' }[c] || c
}
function categoryTag(c) {
  return { manual: 'primary', faq: 'warning', video: 'danger', best_practice: 'success' }[c] || 'info'
}
function fmtTime(v) { return v ? String(v).replace('T', ' ').slice(0, 19) : '-' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: filter.page, page_size: filter.page_size }
    if (filter.category) params.category = filter.category
    if (filter.is_published !== undefined && filter.is_published !== '') params.is_published = filter.is_published
    if (filter.keyword) params.keyword = filter.keyword
    const res = await helpAdminAPI.list(params)
    items.value = res?.items || []
    total.value = res?.total || 0
  } catch (e) { /* 拦截器已提示 */ } finally { loading.value = false }
}

function resetForm() {
  Object.assign(form, {
    id: null, category: 'manual', docKey: '', title: '', summary: '', content: '', sortOrder: 0, isPublished: true
  })
}
function openCreate() {
  resetForm()
  editVisible.value = true
}
function openEdit(row) {
  Object.assign(form, {
    id: row.id, category: row.category, docKey: row.doc_key, title: row.title,
    summary: row.summary || '', content: row.content || '', sortOrder: row.sort_order, isPublished: !!row.is_published
  })
  editVisible.value = true
}
function openPreview(row) {
  previewDoc.value = row
  previewVisible.value = true
}
async function doSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = {
      category: form.category, title: form.title, summary: form.summary, content: form.content,
      sortOrder: form.sortOrder, isPublished: form.isPublished
    }
    if (form.id) {
      await helpAdminAPI.update(form.id, payload)
    } else {
      await helpAdminAPI.create({ ...payload, docKey: form.docKey })
    }
    ElMessage.success(form.id ? '更新成功' : '创建成功')
    editVisible.value = false
    loadList()
  } catch (e) { /* 拦截器已提示 */ } finally { saving.value = false }
}
async function doDelete(row) {
  const ok = await ElMessageBox.confirm(`确认删除帮助文档「${row.title}」？`, '删除确认', { type: 'warning' }).catch(() => null)
  if (!ok) return
  await helpAdminAPI.remove(row.id)
  ElMessage.success('已删除')
  loadList()
}

onMounted(loadList)
</script>

<style scoped>
.help-docs-page { padding: 4px; }
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 13px;
  font-weight: 400;
  color: #94a3b8;
}
.toolbar-actions { display: flex; gap: 10px; }
.text-muted { color: #94a3b8; }
.doc-preview {
  line-height: 1.8;
  color: #334155;
  font-size: 14px;
}
</style>
