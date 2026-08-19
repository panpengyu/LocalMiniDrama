<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <span class="hint">管理端侧边菜单配置（树形展示，拖拽排序暂由 sort_order 控制）</span>
        <div class="spacer" />
        <el-button type="success" size="small" @click="openForm()">新增菜单</el-button>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="tree" border stripe size="small" row-key="id" :tree-props="{ children: 'children' }" default-expand-all>
        <el-table-column prop="name" label="菜单名称" min-width="200" />
        <el-table-column prop="path" label="路由路径" min-width="200" />
        <el-table-column prop="icon" label="图标" width="120" />
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column label="可见" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.visible === 1 ? 'success' : 'info'">{{ row.visible === 1 ? '是' : '否' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
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

    <el-dialog v-model="formVisible" :title="form.id ? '编辑菜单' : '新增菜单'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="父级菜单">
          <el-select v-model="form.parent_id" size="small" style="width: 100%">
            <el-option label="顶级菜单" :value="0" />
            <el-option v-for="it in flatMenus" :key="it.id" :label="it.name" :value="it.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="菜单名称" required><el-input v-model="form.name" size="small" /></el-form-item>
        <el-form-item label="路由路径"><el-input v-model="form.path" size="small" placeholder="如 /system/ops-center" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="form.icon" size="small" placeholder="Element Plus 图标名" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort_order" :min="0" size="small" /></el-form-item>
        <el-form-item label="可见">
          <el-switch v-model="form.visible" :active-value="1" :inactive-value="0" />
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
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sysManageAPI } from '@/api/sysManage'

const items = ref([])
const loading = ref(false)
const formVisible = ref(false)
const saving = ref(false)
const form = ref({})

const flatMenus = computed(() => items.value)
const tree = computed(() => {
  const map = {}
  items.value.forEach(it => { map[it.id] = { ...it, children: [] } })
  const roots = []
  items.value.forEach(it => {
    const node = map[it.id]
    if (it.parent_id && map[it.parent_id]) map[it.parent_id].children.push(node)
    else roots.push(node)
  })
  return roots
})

async function load() {
  loading.value = true
  try {
    const res = await sysManageAPI.menus.list()
    items.value = (res || []).map(it => ({ ...it, visible: it.visible === 1 ? 1 : 0, status: it.status === 1 ? 1 : 0 }))
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function openForm(row) {
  form.value = row
    ? { id: row.id, parent_id: row.parent_id || 0, name: row.name, path: row.path || '', icon: row.icon || '', sort_order: row.sort_order || 0, visible: row.visible, status: row.status }
    : { parent_id: 0, name: '', path: '', icon: '', sort_order: 0, visible: 1, status: 1 }
  formVisible.value = true
}

async function save() {
  if (!form.value.name || !form.value.name.trim()) return ElMessage.warning('菜单名称必填')
  saving.value = true
  try {
    if (form.value.id) {
      await sysManageAPI.menus.update(form.value.id, form.value)
    } else {
      await sysManageAPI.menus.create(form.value)
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
    await ElMessageBox.confirm(`确定删除菜单「${row.name}」？`, '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await sysManageAPI.menus.remove(row.id)
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
.hint { color: #909399; font-size: 13px; }
.spacer { flex: 1; }
</style>
