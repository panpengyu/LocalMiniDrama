<template>
  <div class="model-quota">
    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <div>
          <h3 class="page-title">模型用量配额</h3>
          <p class="page-desc">按主体/模型/全局设置周期调用上限，超限自动拦截（原子防超发）。</p>
        </div>
        <div class="toolbar-actions">
          <el-button @click="loadUsage">
            <el-icon style="margin-right: 4px"><Refresh /></el-icon>刷新
          </el-button>
          <el-button type="primary" @click="openDialog()">
            <el-icon style="margin-right: 4px"><Plus /></el-icon>新建规则
          </el-button>
        </div>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="配额规则" name="rules">
          <el-table :data="rules" v-loading="loading" border stripe>
            <el-table-column label="范围" width="150">
              <template #default="{ row }">
                <el-tag size="small" :type="scopeTag(row.scopeType)">
                  {{ scopeLabel(row.scopeType) }} {{ row.scopeType === 'global' ? '' : '· ' + row.scopeValue }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="周期" width="110">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ periodLabel(row.periodType) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="周期键" min-width="130" prop="periodKey" />
            <el-table-column label="上限" width="100" prop="quotaValue" />
            <el-table-column label="已用" width="100" prop="usedValue" />
            <el-table-column label="剩余" width="140">
              <template #default="{ row }">
                <el-progress
                  :percentage="quotaPct(row)"
                  :status="row.quotaValue - row.usedValue <= 0 ? 'exception' : row.quotaValue - row.usedValue <= row.quotaValue * 0.2 ? 'warning' : undefined"
                  :stroke-width="12"
                />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '生效' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="用量汇总" name="usage">
          <el-table :data="usage" v-loading="loadingUsage" border stripe>
            <el-table-column label="范围" width="180">
              <template #default="{ row }">
                {{ scopeLabel(row.scopeType) }}
                <span v-if="row.scopeType !== 'global'" class="usage-scope">· {{ row.scopeValue }}</span>
              </template>
            </el-table-column>
            <el-table-column label="周期" width="110" prop="periodType" />
            <el-table-column label="周期键" min-width="130" prop="periodKey" />
            <el-table-column label="配额" width="100" prop="quota" />
            <el-table-column label="已用" width="100" prop="used" />
            <el-table-column label="剩余" width="100" prop="remaining" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="dialog.visible" :title="dialog.form.id ? '编辑配额规则' : '新建配额规则'" width="520px" destroy-on-close>
      <el-form :model="dialog.form" label-width="90px">
        <el-form-item label="范围类型" required>
          <el-select v-model="dialog.form.scopeType" style="width: 100%">
            <el-option label="按用户（account）" value="account" />
            <el-option label="按模型（model）" value="model" />
            <el-option label="全局（global）" value="global" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dialog.form.scopeType !== 'global'" label="范围值" required>
          <el-input v-model="dialog.form.scopeValue" :placeholder="dialog.form.scopeType === 'account' ? '用户 ID' : '模型名'" />
        </el-form-item>
        <el-form-item label="周期" required>
          <el-radio-group v-model="dialog.form.periodType">
            <el-radio-button label="daily">每日</el-radio-button>
            <el-radio-button label="weekly">每周</el-radio-button>
            <el-radio-button label="monthly">每月</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="调用上限" required>
          <el-input-number v-model="dialog.form.quotaValue" :min="1" :max="1000000" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="dialog.form.remark" placeholder="如：新人日限额" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { modelsAPI } from '@/api/models'

const activeTab = ref('rules')
const rules = ref([])
const usage = ref([])
const loading = ref(false)
const loadingUsage = ref(false)
const saving = ref(false)

const dialog = reactive({ visible: false, form: {} })

const scopeLabel = (t) => ({ account: '用户', model: '模型', global: '全局' }[t] || t)
const scopeTag = (t) => ({ account: 'primary', model: 'success', global: 'warning' }[t] || 'info')
const periodLabel = (t) => ({ daily: '每日', weekly: '每周', monthly: '每月' }[t] || t)
const quotaPct = (row) => {
  if (!row.quotaValue) return 0
  return Math.min(100, Math.round((row.usedValue / row.quotaValue) * 100))
}

function emptyForm() {
  return { id: null, scopeType: 'account', scopeValue: '', periodType: 'daily', quotaValue: 100, remark: '' }
}

async function loadRules() {
  loading.value = true
  try {
    const res = await modelsAPI.listQuotas()
    rules.value = res.items
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadUsage() {
  loadingUsage.value = true
  try {
    const res = await modelsAPI.quotaUsage()
    usage.value = res.items
  } catch (e) {
    ElMessage.error(e?.message || '用量汇总加载失败')
  } finally {
    loadingUsage.value = false
  }
}

function openDialog(row) {
  dialog.form = row ? { ...row } : emptyForm()
  dialog.visible = true
}

async function save() {
  const f = dialog.form
  if (f.scopeType !== 'global' && !f.scopeValue) {
    ElMessage.warning('请填写范围值')
    return
  }
  saving.value = true
  try {
    if (f.id) await modelsAPI.updateQuota(f.id, { quotaValue: f.quotaValue, remark: f.remark })
    else await modelsAPI.createQuota(f)
    ElMessage.success('已保存')
    dialog.visible = false
    loadRules()
    loadUsage()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function del(row) {
  await ElMessageBox.confirm('确认删除该配额规则？', '删除确认', { type: 'warning' })
  await modelsAPI.deleteQuota(row.id)
  ElMessage.success('已删除')
  loadRules()
}

onMounted(() => {
  loadRules()
  loadUsage()
})

window.__modelQuotaPreview = { loadRules, loadUsage }
</script>

<style scoped>
.model-quota {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-card {
  border-radius: 10px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.page-desc {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.usage-scope {
  color: #909399;
}
</style>
