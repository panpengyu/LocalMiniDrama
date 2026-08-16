<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Ticket /></el-icon>
          <span>优惠券管理</span>
          <span class="subtitle">创建优惠券 → 用户兑换 → 下单抵扣 → 核销，全链路数据落地 MySQL</span>
        </div>
        <div class="actions">
          <el-input v-model="filters.keyword" placeholder="券码 / 名称" clearable style="width: 200px" @clear="loadCoupons" @keyup.enter="loadCoupons" />
          <el-select v-model="filters.enabled" placeholder="状态" clearable style="width: 110px" @change="loadCoupons">
            <el-option label="启用中" :value="1" />
            <el-option label="已失效" :value="0" />
          </el-select>
          <el-button :loading="loading" @click="loadCoupons">刷新</el-button>
          <el-button type="primary" @click="openDialog()">发放优惠券</el-button>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" v-loading="loading">
      <el-table :data="coupons" stripe border style="width: 100%">
        <el-table-column label="券码" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="类型 / 面额" width="140" align="center">
          <template #default="{ row }">
            {{ row.type === 'percent' ? `${row.value}%（${(10 - row.value / 10).toFixed(row.value % 10 === 0 ? 0 : 1)}折）` : `减 ¥${Number(row.value).toFixed(2)}` }}
          </template>
        </el-table-column>
        <el-table-column label="使用门槛" width="100" align="right">
          <template #default="{ row }">{{ row.min_spend > 0 ? `满 ¥${Number(row.min_spend).toFixed(2)}` : '无门槛' }}</template>
        </el-table-column>
        <el-table-column label="库存(已领/总量)" width="120" align="center">
          <template #default="{ row }">{{ row.used_count }} / {{ row.total_stock === 0 ? '不限' : row.total_stock }}</template>
        </el-table-column>
        <el-table-column label="有效期" width="200">
          <template #default="{ row }">
            <div v-if="!row.start_at && !row.end_at">长期有效</div>
            <div v-else class="date-cell">
              <div>{{ row.start_at ? fmtDate(row.start_at) : '不限' }} ~ {{ row.end_at ? fmtDate(row.end_at) : '不限' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'success' : 'danger'">{{ row.enabled ? '启用' : '失效' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openRecords(row)">记录</el-button>
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-button v-if="row.enabled" size="small" type="danger" plain @click="disable(row)">失效</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑优惠券' : '发放优惠券'" width="620px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="兑换码" prop="code">
              <el-input v-model="form.code" :disabled="!!form.id" placeholder="唯一，自动转大写，如 NEWYEAR2026" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="如 新年礼包券" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="类型">
              <el-radio-group v-model="form.type">
                <el-radio-button value="amount">固定金额</el-radio-button>
                <el-radio-button value="percent">折扣</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="面额/折扣">
              <el-input-number v-model="form.value" :min="0" :max="form.type === 'percent' ? 100 : 99999" :precision="2" :step="form.type === 'percent' ? 5 : 1" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="使用门槛">
              <el-input-number v-model="form.min_spend" :min="0" :precision="2" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="总库存">
              <el-input-number v-model="form.total_stock" :min="0" controls-position="right" style="width: 100%" />
              <div class="form-tip">0 表示不限</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="生效时间">
              <el-date-picker v-model="form.start_at" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="失效时间">
              <el-date-picker v-model="form.end_at" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="不限" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="适用范围">
          <el-select v-model="form.scope" style="width: 100%">
            <el-option label="会员购买" value="membership" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="运营备注（可选）" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="form.enabled" active-text="启用" inactive-text="失效" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCoupon">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="recordsVisible" :title="`领取/核销记录 · ${recordsTitle}`" width="760px" destroy-on-close>
      <el-table :data="records" stripe border v-loading="recordsLoading" size="small">
        <el-table-column prop="user_id" label="用户ID" width="100" align="center" />
        <el-table-column prop="code" label="券码" width="120" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'used' ? 'success' : 'primary'">{{ row.status === 'used' ? '已核销' : '已领取' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="order_no" label="核销订单" width="180">
          <template #default="{ row }">{{ row.order_no || '—' }}</template>
        </el-table-column>
        <el-table-column label="抵扣金额" width="100" align="right">
          <template #default="{ row }">{{ row.amount != null ? `¥${Number(row.amount).toFixed(2)}` : '—' }}</template>
        </el-table-column>
        <el-table-column prop="claimed_at" label="领取时间" width="170" />
        <el-table-column prop="used_at" label="核销时间" width="170">
          <template #default="{ row }">{{ row.used_at || '—' }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Ticket } from '@element-plus/icons-vue'
import financeAPI from '@/api/finance'

const loading = ref(false)
const saving = ref(false)
const coupons = ref([])
const filters = reactive({ keyword: '', enabled: undefined })
const dialogVisible = ref(false)
const formRef = ref()

const recordsVisible = ref(false)
const recordsLoading = ref(false)
const records = ref([])
const recordsTitle = ref('')

const emptyForm = () => ({
  id: null,
  code: '',
  name: '',
  type: 'amount',
  value: 10,
  min_spend: 0,
  scope: 'membership',
  total_stock: 0,
  start_at: null,
  end_at: null,
  enabled: true,
  remark: '',
})
const form = reactive(emptyForm())

const rules = {
  code: [{ required: true, message: '请输入唯一兑换码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入优惠券名称', trigger: 'blur' }],
}

const fmtDate = v => String(v || '').replace('T', ' ').slice(0, 16)

async function loadCoupons() {
  loading.value = true
  try {
    const params = {}
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.enabled !== undefined && filters.enabled !== '') params.enabled = filters.enabled
    const res = await financeAPI.listCoupons(params)
    coupons.value = (res && res.items) || []
  } catch (e) {
    ElMessage.error(e?.message || '加载优惠券失败')
  } finally {
    loading.value = false
  }
}

function openDialog(row) {
  if (row) {
    Object.assign(form, emptyForm(), {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      value: Number(row.value),
      min_spend: Number(row.min_spend),
      scope: row.scope || 'membership',
      total_stock: Number(row.total_stock),
      start_at: row.start_at || null,
      end_at: row.end_at || null,
      enabled: !!row.enabled,
      remark: row.remark || '',
    })
  } else {
    Object.assign(form, emptyForm())
  }
  dialogVisible.value = true
}

async function saveCoupon() {
  try {
    await formRef.value.validate()
  } catch (_) {
    return
  }
  if (form.start_at && form.end_at && form.start_at >= form.end_at) {
    ElMessage.warning('生效时间必须早于失效时间')
    return
  }
  if (form.value === null || form.value < 0) {
    ElMessage.warning('请填写有效的面额/折扣')
    return
  }
  saving.value = true
  try {
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      value: form.value,
      min_spend: form.min_spend || 0,
      scope: form.scope,
      total_stock: form.total_stock || 0,
      start_at: form.start_at || null,
      end_at: form.end_at || null,
      enabled: form.enabled,
      remark: form.remark || null,
    }
    if (form.id) {
      await financeAPI.updateCoupon(form.id, payload)
      ElMessage.success('优惠券已更新')
    } else {
      await financeAPI.createCoupon(payload)
      ElMessage.success('优惠券已发放')
    }
    dialogVisible.value = false
    await loadCoupons()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function disable(row) {
  try {
    await ElMessageBox.confirm(`确认失效优惠券「${row.name}」（${row.code}）？失效后用户不可再兑换/使用。`, '失效确认', {
      type: 'warning', confirmButtonText: '失效', cancelButtonText: '取消',
    })
  } catch (_) {
    return
  }
  try {
    await financeAPI.disableCoupon(row.id)
    ElMessage.success('优惠券已失效')
    await loadCoupons()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

async function openRecords(row) {
  recordsVisible.value = true
  recordsTitle.value = `${row.name}（${row.code}）`
  recordsLoading.value = true
  try {
    const res = await financeAPI.couponRedemptions(row.id)
    records.value = (res && res.items) || []
  } catch (e) {
    ElMessage.error(e?.message || '加载记录失败')
    records.value = []
  } finally {
    recordsLoading.value = false
  }
}

onMounted(loadCoupons)
</script>

<style scoped>
.finance-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 16px;
}
.top-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
}
.date-cell {
  font-size: 12px;
  color: #606266;
}
.form-tip {
  font-size: 12px;
  color: #909399;
}
</style>
