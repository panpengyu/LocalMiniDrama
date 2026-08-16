<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><List /></el-icon>
          <span>支付订单管理</span>
          <span class="subtitle">S17-T04：订单查询 / 单笔关单 / 退款（支付宝走官方 SDK），数据落地 MySQL membership_orders</span>
        </div>
        <div class="actions">
          <el-input v-model="filters.keyword" placeholder="订单号 / 交易号 / 用户名" clearable style="width: 200px" @clear="loadOrders" @keyup.enter="loadOrders" />
          <el-select v-model="filters.payStatus" placeholder="状态" clearable style="width: 110px" @change="loadOrders">
            <el-option label="待支付" value="pending" />
            <el-option label="已支付" value="paid" />
            <el-option label="已关闭" value="closed" />
            <el-option label="已退款" value="refunded" />
          </el-select>
          <el-select v-model="filters.payMethod" placeholder="渠道" clearable style="width: 110px" @change="loadOrders">
            <el-option label="微信支付" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="积分支付" value="points" />
          </el-select>
          <el-date-picker v-model="filters.dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 230px" @change="loadOrders" />
          <el-button :loading="loading" @click="loadOrders">刷新</el-button>
        </div>
      </div>
    </el-card>

    <el-row :gutter="12" class="stat-row">
      <el-col :span="6" v-for="s in statCards" :key="s.key">
        <el-card shadow="never">
          <div class="stat-card">
            <div class="stat-label">{{ s.label }}</div>
            <div class="stat-value" :style="{ color: s.color }">{{ s.count }}<span class="stat-unit">单</span></div>
            <div class="stat-sub">¥{{ s.total.toFixed(2) }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" v-loading="loading">
      <el-table :data="orders" stripe border style="width: 100%">
        <el-table-column prop="order_no" label="订单号" width="185" show-overflow-tooltip />
        <el-table-column label="用户" min-width="110">
          <template #default="{ row }">
            <div>{{ row.nickname || row.username || `#${row.user_id}` }}</div>
            <div class="cell-sub">ID: {{ row.user_id }}</div>
          </template>
        </el-table-column>
        <el-table-column label="套餐" min-width="110">
          <template #default="{ row }">
            <div>{{ row.plan_name || `${row.level_code || ''}${row.billing_cycle ? '/' + row.billing_cycle : ''}` }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">
            <span :class="['amount', row.coupon_amount ? 'discount' : '']">¥{{ Number(row.amount).toFixed(2) }}</span>
            <div v-if="row.coupon_amount" class="cell-sub">券-¥{{ Number(row.coupon_amount).toFixed(2) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="渠道" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.pay_method === 'wechat' ? 'success' : row.pay_method === 'alipay' ? 'primary' : 'warning'">
              {{ row.pay_method === 'wechat' ? '微信' : row.pay_method === 'alipay' ? '支付宝' : '积分' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.pay_status)">{{ statusText(row.pay_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="trade_no" label="交易号" width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.trade_no || '—' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ row.created_at }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.pay_status === 'pending'" size="small" type="warning" plain @click="closeOrder(row)">关单</el-button>
            <el-button v-if="row.pay_status === 'paid'" size="small" type="danger" plain @click="openRefund(row)">退款</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadOrders"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="订单详情" width="640px" destroy-on-close>
      <el-descriptions :column="2" border v-if="current">
        <el-descriptions-item label="订单号" :span="2">{{ current.order_no }}</el-descriptions-item>
        <el-descriptions-item label="用户">{{ current.nickname || current.username || `#${current.user_id}` }}（ID: {{ current.user_id }}）</el-descriptions-item>
        <el-descriptions-item label="套餐">{{ current.plan_name || current.level_code }} / {{ current.billing_cycle || '—' }}</el-descriptions-item>
        <el-descriptions-item label="应付金额">¥{{ Number(current.amount).toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="优惠券抵扣">
          <span v-if="current.coupon_amount">¥{{ Number(current.coupon_amount).toFixed(2) }}（{{ current.coupon_code || '' }}）</span>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="支付渠道">{{ current.pay_method }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusText(current.pay_status) }}</el-descriptions-item>
        <el-descriptions-item label="交易号">{{ current.trade_no || '—' }}</el-descriptions-item>
        <el-descriptions-item label="预支付标识">{{ current.prepay_id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ current.created_at }}</el-descriptions-item>
        <el-descriptions-item label="支付时间">{{ current.paid_at || '—' }}</el-descriptions-item>
        <el-descriptions-item label="退款时间">{{ current.refunded_at || '—' }}</el-descriptions-item>
        <el-descriptions-item label="退款原因" :span="2">{{ current.refund_reason || '—' }}</el-descriptions-item>
        <el-descriptions-item label="自动续费" :span="2">{{ current.auto_renew ? '开启' : '关闭' }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="refundVisible" title="订单退款" width="520px" destroy-on-close>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="退款说明"
        description="退款将真实调用支付渠道退款（支付宝走官方 SDK），并将订单置为已退款、回滚收入流水与会员自动续费。退款后会员权益保留至当前周期到期。"
      />
      <el-form label-width="90px" style="margin-top: 16px">
        <el-form-item label="订单">
          <span>{{ current?.order_no }}</span>
        </el-form-item>
        <el-form-item label="退款金额">
          <span class="amount">¥{{ current ? Number(current.amount).toFixed(2) : '0.00' }}</span>
        </el-form-item>
        <el-form-item label="退款原因">
          <el-input v-model="refundReason" type="textarea" :rows="2" placeholder="如：用户申请退款 / 渠道风控 / 运营取消" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundVisible = false">取消</el-button>
        <el-button type="danger" :loading="refunding" @click="confirmRefund">确认退款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { List } from '@element-plus/icons-vue'
import financeAPI from '@/api/finance'

const loading = ref(false)
const orders = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const filters = reactive({ keyword: '', payStatus: '', payMethod: '', dateRange: null })

const stats = ref({ by_status: [], by_method: [] })
const detailVisible = ref(false)
const current = ref(null)
const refundVisible = ref(false)
const refunding = ref(false)
const refundReason = ref('')

const statusText = (s) => ({ pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' })[s] || s
const statusType = (s) => ({ pending: 'warning', paid: 'success', closed: 'info', refunded: 'danger' })[s] || 'info'

const statCards = computed(() => {
  const m = {}
  for (const s of (stats.value.by_status || [])) m[s.pay_status] = s
  const totalAmount = (s) => Number(s && s.total) || 0
  const totalCount = (s) => Number(s && s.c) || 0
  return [
    { key: 'paid', label: '已支付订单', count: totalCount(m.paid), total: totalAmount(m.paid), color: '#67c23a' },
    { key: 'pending', label: '待支付订单', count: totalCount(m.pending), total: totalAmount(m.pending), color: '#e6a23c' },
    { key: 'refunded', label: '已退款订单', count: totalCount(m.refunded), total: totalAmount(m.refunded), color: '#f56c6c' },
    { key: 'closed', label: '已关闭订单', count: totalCount(m.closed), total: totalAmount(m.closed), color: '#909399' },
  ]
})

async function loadOrders() {
  loading.value = true
  try {
    const params = {
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
    }
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.payStatus) params.payStatus = filters.payStatus
    if (filters.payMethod) params.payMethod = filters.payMethod
    if (filters.dateRange && filters.dateRange.length === 2) {
      params.dateFrom = `${filters.dateRange[0]} 00:00:00`
      params.dateTo = `${filters.dateRange[1]} 23:59:59`
    }
    const res = await financeAPI.listOrders(params)
    orders.value = (res && res.items) || []
    total.value = (res && res.total) || 0
    await loadStats()
  } catch (e) {
    ElMessage.error(e?.message || '加载订单失败')
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const params = {}
    if (filters.dateRange && filters.dateRange.length === 2) {
      params.dateFrom = `${filters.dateRange[0]} 00:00:00`
      params.dateTo = `${filters.dateRange[1]} 23:59:59`
    }
    const res = await financeAPI.orderStats(params)
    stats.value = res || {}
  } catch (_) { /* 统计失败不影响主列表 */ }
}

function openDetail(row) {
  current.value = row
  detailVisible.value = true
}

async function closeOrder(row) {
  try {
    await ElMessageBox.confirm(
      `确认关单？订单 ${row.order_no} 将标记为已关闭${row.coupon_amount ? '，并使用户优惠券回退可用' : ''}。`,
      '关单确认', { type: 'warning', confirmButtonText: '确认关单', cancelButtonText: '取消' },
    )
  } catch (_) {
    return
  }
  try {
    const res = await financeAPI.closeOrder(row.order_no, { reason: '管理端手动关单' })
    ElMessage.success(res?.alreadyClosed ? '订单已处于关闭状态' : '订单已关闭')
    await loadOrders()
  } catch (e) {
    ElMessage.error(e?.message || '关单失败')
  }
}

function openRefund(row) {
  current.value = row
  refundReason.value = ''
  refundVisible.value = true
}

async function confirmRefund() {
  if (!current.value) return
  refunding.value = true
  try {
    await financeAPI.refundOrder(current.value.order_no, { reason: refundReason.value || '管理端退款' })
    ElMessage.success('退款成功，订单已标记为已退款')
    refundVisible.value = false
    await loadOrders()
  } catch (e) {
    ElMessage.error(e?.message || '退款失败')
  } finally {
    refunding.value = false
  }
}

onMounted(loadOrders)
</script>

<style scoped>
.finance-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 12px;
}
.top-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-card {
  text-align: center;
  padding: 4px 0;
}
.stat-label {
  font-size: 13px;
  color: #909399;
}
.stat-value {
  font-size: 22px;
  font-weight: 600;
  margin: 4px 0;
}
.stat-unit {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
  margin-left: 2px;
}
.stat-sub {
  font-size: 12px;
  color: #606266;
}
.cell-sub {
  font-size: 12px;
  color: #909399;
}
.amount {
  color: #f56c6c;
  font-weight: 600;
}
.amount.discount {
  color: #303133;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
