<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>协议文档管理</span>
          <div>
            <el-button size="small" @click="addRow">新增协议</el-button>
            <el-button type="primary" size="small" :loading="saving" @click="saveAll">保存全部</el-button>
          </div>
        </div>
      </template>

      <div v-for="(it, idx) in items" :key="it.key" class="agree-item">
        <div class="agree-head">
          <el-tag size="small" type="info">#{{ idx + 1 }}</el-tag>
          <el-input v-model="it.title" size="small" placeholder="协议标题（如 隐私政策）" class="w-200" />
          <el-input v-model="it.version" size="small" placeholder="版本号" class="w-90" />
          <el-date-picker v-model="it.effective_at" type="date" value-format="YYYY-MM-DD" size="small" placeholder="生效日期" />
          <el-switch v-model="it.enabled" active-text="启用" inactive-text="停用" />
          <div class="spacer" />
          <el-button size="small" type="danger" link @click="removeRow(idx)">删除</el-button>
        </div>
        <el-input v-model="it.content" type="textarea" :rows="6" size="small" placeholder="协议正文（支持 Markdown）" />
      </div>

      <el-empty v-if="!items.length" description="暂无协议，点击右上角「新增协议」创建" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { siteAPI } from '@/api/site'

const items = ref([])
const saving = ref(false)

function addRow() {
  items.value.push({ title: '', version: 'v1.0', content: '', enabled: true, effective_at: '' })
}

function removeRow(idx) {
  items.value.splice(idx, 1)
}

async function load() {
  try {
    const res = await siteAPI.getAgreements()
    items.value = (res || []).map(it => ({ ...it }))
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  }
}

async function saveAll() {
  const invalid = items.value.find(it => !it.title || !it.title.trim())
  if (invalid) return ElMessage.warning('存在未填写标题的协议')
  saving.value = true
  try {
    await siteAPI.saveAgreements(items.value)
    ElMessage.success('协议已保存')
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-wrap { padding: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.agree-item { border: 1px solid #ebeef5; border-radius: 6px; padding: 12px; margin-bottom: 14px; background: #fafafa; }
.agree-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
.w-200 { width: 220px; }
.w-90 { width: 100px; }
</style>
