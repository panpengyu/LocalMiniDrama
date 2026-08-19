<template>
  <div class="page-wrap">
    <el-card shadow="never">
      <div class="toolbar">
        <span class="hint">输入用户 ID / 手机号 / 用户名，一键聚合账户、订单、作品、登录与会话信息</span>
      </div>
      <div class="search-row">
        <el-input v-model="keyword" placeholder="用户 ID / 手机号 / 用户名" clearable size="small" style="width: 280px" @keyup.enter="search" />
        <el-button type="primary" size="small" :loading="loading" @click="search">开始排查</el-button>
      </div>

      <template v-if="result">
        <el-descriptions title="账户信息" :column="3" border size="small" style="margin-top: 16px">
          <el-descriptions-item label="用户ID">{{ result.user.id }}</el-descriptions-item>
          <el-descriptions-item label="用户名">{{ result.user.username }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ result.user.nickname }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ result.user.phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="result.user.status === 1 ? 'success' : 'danger'">{{ result.user.status === 1 ? '正常' : '禁用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户类型">{{ result.user.user_type || 'user' }}</el-descriptions-item>
          <el-descriptions-item label="积分余额">{{ result.user.point_balance ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ result.user.last_login_at || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="block-row">
          <el-card shadow="never" class="block-card">
            <template #header>订单（{{ (result.orders || []).length }}）</template>
            <el-table :data="result.orders" size="small" max-height="260">
              <el-table-column prop="order_no" label="订单号" min-width="150" show-overflow-tooltip />
              <el-table-column prop="level_code" label="等级" width="90" />
              <el-table-column prop="amount" label="金额" width="90" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.pay_status === 'paid' ? 'success' : 'info'">{{ { pending: '待支付', paid: '已支付', failed: '失败', refunded: '已退款', closed: '已关闭' }[row.pay_status] || row.pay_status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="时间" width="150" />
            </el-table>
          </el-card>

          <el-card shadow="never" class="block-card">
            <template #header>作品（{{ (result.dramas || []).length }}）</template>
            <el-table :data="result.dramas" size="small" max-height="260">
              <el-table-column prop="title" label="标题" min-width="140" show-overflow-tooltip />
              <el-table-column prop="genre" label="类型" width="90" />
              <el-table-column prop="status" label="状态" width="80" />
              <el-table-column prop="total_episodes" label="集数" width="70" />
              <el-table-column prop="created_at" label="时间" width="150" />
            </el-table>
          </el-card>
        </div>

        <div class="block-row">
          <el-card shadow="never" class="block-card">
            <template #header>登录日志（{{ (result.login_logs || []).length }}）</template>
            <el-table :data="result.login_logs" size="small" max-height="260">
              <el-table-column prop="username" label="用户名" width="110" />
              <el-table-column label="结果" width="70">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.success === 1 ? 'success' : 'danger'">{{ row.success === 1 ? '成功' : '失败' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="ip" label="IP" min-width="110" />
              <el-table-column prop="reason" label="原因" min-width="120" show-overflow-tooltip />
              <el-table-column prop="created_at" label="时间" width="150" />
            </el-table>
          </el-card>

          <el-card shadow="never" class="block-card">
            <template #header>会话（{{ (result.sessions || []).length }}）</template>
            <el-table :data="result.sessions" size="small" max-height="260">
              <el-table-column prop="user_agent" label="设备/UA" min-width="140" show-overflow-tooltip />
              <el-table-column prop="ip" label="IP" width="110" />
              <el-table-column label="状态" width="80">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.revoked_at ? 'danger' : 'success'">{{ row.revoked_at ? '已下线' : '在线' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="时间" width="150" />
            </el-table>
          </el-card>
        </div>
      </template>
      <el-empty v-else-if="!loading" description="输入关键字开始排查" style="margin-top: 40px" />
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sysManageAPI } from '@/api/sysManage'

const keyword = ref('')
const loading = ref(false)
const result = ref(null)

async function search() {
  if (!keyword.value || !keyword.value.trim()) return ElMessage.warning('请输入用户ID/手机号/用户名')
  loading.value = true
  result.value = null
  try {
    const res = await sysManageAPI.troubleshoot.diagnose({ keyword: keyword.value.trim() })
    result.value = res
  } catch (e) {
    ElMessage.error('排查失败：' + (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page-wrap { padding: 16px; }
.toolbar { margin-bottom: 12px; }
.hint { color: #909399; font-size: 13px; }
.search-row { display: flex; gap: 12px; align-items: center; }
.block-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.block-card :deep(.el-card__header) { font-weight: 600; }
@media (max-width: 1100px) { .block-row { grid-template-columns: 1fr; } }
</style>
