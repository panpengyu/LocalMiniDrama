<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><CreditCard /></el-icon>
          <span>充值套餐管理</span>
          <span class="subtitle">管理用户端会员中心展示与下单的充值/会员套餐，数据落地 MySQL（membership_plans）</span>
        </div>
        <div class="actions">
          <el-button :loading="loading" @click="loadPlans">刷新</el-button>
          <el-button type="primary" @click="openDialog()">新增套餐</el-button>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" v-loading="loading">
      <el-table :data="plans" stripe border style="width: 100%">
        <el-table-column label="等级" width="110">
          <template #default="{ row }">
            <el-tag :color="row.badge_color || '#409eff'" effect="dark" size="small" style="border: none">{{ row.level_code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="套餐名称" min-width="170">
          <template #default="{ row }">
            <div class="plan-name">{{ row.name }}</div>
            <div class="plan-sub">{{ row.subtitle || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="level_rank" label="等级序号" width="90" align="center" />
        <el-table-column label="月付(元)" width="100" align="right">
          <template #default="{ row }">{{ fmtPrice(row.price_monthly) }}</template>
        </el-table-column>
        <el-table-column label="年付(元)" width="100" align="right">
          <template #default="{ row }">{{ fmtPrice(row.price_yearly) }}</template>
        </el-table-column>
        <el-table-column label="终身(元)" width="100" align="right">
          <template #default="{ row }">{{ fmtPrice(row.price_lifetime) }}</template>
        </el-table-column>
        <el-table-column label="权益/配额" width="110" align="center">
          <template #default="{ row }">{{ (row.benefits || []).length }} 项 / {{ (row.quota || {}).max_generations ?? '—' }} 次</template>
        </el-table-column>
        <el-table-column prop="sort_order" label="排序" width="70" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="!!row.enabled" @change="v => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="removePlan(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑套餐' : '新增套餐'" width="640px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="等级代码" prop="level_code">
              <el-input v-model="form.level_code" :disabled="!!form.id" placeholder="唯一，如 premium" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="套餐名称" prop="name">
              <el-input v-model="form.name" placeholder="如 专业版" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="副标题">
          <el-input v-model="form.subtitle" placeholder="一句话卖点，展示在套餐卡片上" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="等级序号">
              <el-input-number v-model="form.level_rank" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="展示排序">
              <el-input-number v-model="form.sort_order" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="徽章配色">
              <el-color-picker v-model="form.badge_color" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="月付价格">
              <el-input-number v-model="form.price_monthly" :min="0" :precision="2" :step="1" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年付价格">
              <el-input-number v-model="form.price_yearly" :min="0" :precision="2" :step="1" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="终身价格">
              <el-input-number v-model="form.price_lifetime" :min="0" :precision="2" :step="1" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="配额定义">
          <el-input v-model="quotaText" type="textarea" :rows="3" placeholder='JSON，如 {"max_generations": 300, "max_video_minutes": 60}' />
          <div class="form-tip">JSON 格式对象；字段含义见套餐配额约定（免费 30 / 基础 300 / 专业 2000 / 企业不限）</div>
        </el-form-item>
        <el-form-item label="权益点">
          <el-input v-model="benefitsText" type="textarea" :rows="3" placeholder='JSON 数组，如 ["高清无水印导出", "角色一致性增强（IP-Adapter）"]' />
          <div class="form-tip">JSON 数组，展示在用户端权益对比中，请勿包含未实现能力</div>
        </el-form-item>
        <el-form-item label="上架状态">
          <el-switch v-model="form.enabled" active-text="上架" inactive-text="下架" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePlan">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CreditCard } from '@element-plus/icons-vue'
import financeAPI from '@/api/finance'

const loading = ref(false)
const saving = ref(false)
const plans = ref([])
const dialogVisible = ref(false)
const formRef = ref()
const quotaText = ref('{}')
const benefitsText = ref('[]')

const emptyForm = () => ({
  id: null,
  level_code: '',
  name: '',
  subtitle: '',
  level_rank: 0,
  sort_order: 0,
  badge_color: null,
  price_monthly: null,
  price_yearly: null,
  price_lifetime: null,
  enabled: true,
})
const form = reactive(emptyForm())

const rules = {
  level_code: [{ required: true, message: '请输入唯一等级代码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
}

const fmtPrice = v => (v == null ? '—' : `¥${Number(v).toFixed(2)}`)

async function loadPlans() {
  loading.value = true
  try {
    const res = await financeAPI.listRechargePlans()
    plans.value = (res && res.items) || []
  } catch (e) {
    ElMessage.error(e?.message || '加载套餐失败')
  } finally {
    loading.value = false
  }
}

function parseJson(text, label, fallback) {
  if (!text || !text.trim()) return fallback
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`${label}不是合法的 JSON`)
  }
}

function openDialog(row) {
  if (row) {
    Object.assign(form, emptyForm(), {
      id: row.id,
      level_code: row.level_code,
      name: row.name,
      subtitle: row.subtitle || '',
      level_rank: row.level_rank,
      sort_order: row.sort_order,
      badge_color: row.badge_color || null,
      price_monthly: row.price_monthly == null ? null : Number(row.price_monthly),
      price_yearly: row.price_yearly == null ? null : Number(row.price_yearly),
      price_lifetime: row.price_lifetime == null ? null : Number(row.price_lifetime),
      enabled: !!row.enabled,
    })
    quotaText.value = JSON.stringify(row.quota || {}, null, 2)
    benefitsText.value = JSON.stringify(row.benefits || [], null, 2)
  } else {
    Object.assign(form, emptyForm())
    quotaText.value = '{\n  "max_generations": 100\n}'
    benefitsText.value = '[]'
  }
  dialogVisible.value = true
}

async function savePlan() {
  try {
    await formRef.value.validate()
  } catch (_) {
    return
  }
  let quotaConfig, benefits
  try {
    quotaConfig = parseJson(quotaText.value, '配额定义', {})
    benefits = parseJson(benefitsText.value, '权益点', [])
  } catch (e) {
    ElMessage.warning(e.message)
    return
  }
  saving.value = true
  try {
    const payload = {
      level_code: form.level_code.trim(),
      name: form.name.trim(),
      subtitle: form.subtitle || null,
      level_rank: form.level_rank,
      sort_order: form.sort_order,
      badge_color: form.badge_color || null,
      price_monthly: form.price_monthly,
      price_yearly: form.price_yearly,
      price_lifetime: form.price_lifetime,
      quota_config: quotaConfig,
      benefits,
      enabled: form.enabled,
    }
    if (form.id) {
      await financeAPI.updateRechargePlan(form.id, payload)
      ElMessage.success('套餐已更新')
    } else {
      await financeAPI.createRechargePlan(payload)
      ElMessage.success('套餐已创建')
    }
    dialogVisible.value = false
    await loadPlans()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(row, val) {
  try {
    await financeAPI.updateRechargePlan(row.id, { enabled: val })
    row.enabled = val ? 1 : 0
    ElMessage.success(val ? `套餐「${row.name}」已上架` : `套餐「${row.name}」已下架`)
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
    loadPlans()
  }
}

async function removePlan(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除套餐「${row.name}」？已被订单/会员引用的套餐会自动转为下架（软删除）。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (_) {
    return
  }
  try {
    const res = await financeAPI.deleteRechargePlan(row.id)
    ElMessage.success(res?.deleted ? '套餐已删除' : (res?.reason || '套餐已下架'))
    await loadPlans()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

onMounted(loadPlans)
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
.plan-name {
  font-weight: 600;
}
.plan-sub {
  font-size: 12px;
  color: #909399;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-top: 4px;
}
</style>
