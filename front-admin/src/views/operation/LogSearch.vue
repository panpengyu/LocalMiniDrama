<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <el-radio-group v-model="logType" size="small" @change="load(1)">
          <el-radio-button value="login">登录日志</el-radio-button>
          <el-radio-button value="audit">操作审计</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" :placeholder="logType === 'audit' ? '搜索操作者/操作/对象ID' : '搜索用户名/原因'" clearable size="small" style="width: 220px" @keyup.enter="load(1)" />
        <el-date-picker v-model="range" type="datetimerange" size="small" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" value-format="YYYY-MM-DD HH:mm:ss" style="width: 340px" />
        <el-select v-if="logType === 'login'" v-model="successFilter" size="small" style="width: 110px" clearable placeholder="结果" @change="load(1)">
          <el-option label="成功" :value="1" />
          <el-option label="失败" :value="0" />
        </el-select>
        <el-button type="primary" size="small" @click="load(1)">查询</el-button>
      </div>

      <el-table v-loading="loading" :data="items" border stripe size="small">
        <el-table-column prop="id" label="ID" width="90" />
        <template v-if="logType === 'login'">
          <el-table-column prop="username" label="用户名" min-width="120" />
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.success === 1 ? 'success' : 'danger'">{{ row.success === 1 ? '成功' : '失败' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="ip" label="IP" min-width="120" />
          <el-table-column prop="reason" label="原因" min-width="160" show-overflow-tooltip />
        </template>
        <template v-else>
          <el-table-column prop="actor_name" label="操作者" min-width="110" />
          <el-table-column prop="action" label="操作" min-width="150" />
          <el-table-column prop="method" label="方法" width="70" />
          <el-table-column prop="path" label="路径" min-width="180" show-overflow-tooltip />
          <el-table-column prop="target_type" label="对象类型" width="100" />
          <el-table-column prop="target_id" label="对象ID" width="110" />
          <el-table-column prop="status_code" label="状态码" width="80" />
          <el-table-column prop="ip" label="IP" min-width="120" />
        </template>
        <el-table-column prop="created_at" label="时间" width="170" />
      </el-table>

      <div class="pager">
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize" :current-page="page" small @current-change="load" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { sysManageAPI } from '@/api/sysManage'

const logType = ref('login')
const keyword = ref('')
const range = ref(null)
const successFilter = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)
const loading = ref(false)

async function load(p = 1) {
  page.value = p
  loading.value = true
  try {
    const res = await sysManageAPI.logs.search({
      type: logType.value,
      page: p,
      page_size: pageSize.value,
      keyword: keyword.value || undefined,
      start: range.value && range.value[0] ? range.value[0] : undefined,
      end: range.value && range.value[1] ? range.value[1] : undefined,
      success: successFilter.value === '' ? undefined : successFilter.value
    })
    items.value = res.items || []
    total.value = res.pagination?.total || 0
  } catch (e) {
    ElMessage.error('加载失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

onMounted(() => load(1))
</script>

<style scoped>
.page-wrap { padding: 16px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
.pager { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
