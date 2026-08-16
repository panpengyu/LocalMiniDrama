<template>
  <div class="ab-test">
    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <div>
          <h3 class="page-title">模型 A/B 测试</h3>
          <p class="page-desc">按任务类型配置两组模型并按流量比例分流，自动产出成功率/延迟/成本对比报告。</p>
        </div>
        <el-button type="primary" @click="openDialog()">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>新建测试
        </el-button>
      </div>

      <el-table :data="tests" v-loading="loading" border stripe>
        <el-table-column prop="name" label="测试名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="taskType" label="任务类型" min-width="140" show-overflow-tooltip />
        <el-table-column label="A 组" min-width="140">
          <template #default="{ row }">
            <div class="grp">
              <span class="grp-tag a">A</span>{{ row.groupA?.model || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="B 组" min-width="140">
          <template #default="{ row }">
            <div class="grp">
              <span class="grp-tag b">B</span>{{ row.groupB?.model || '—' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="B 组流量" width="140">
          <template #default="{ row }">
            <div class="ratio-bar">
              <span class="ratio-num">{{ row.trafficRatioB }}%</span>
              <div class="ratio-track">
                <div class="ratio-fill" :style="{ width: row.trafficRatioB + '%' }" />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isActive ? 'success' : 'info'">
              {{ row.isActive ? '运行中' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="toggle(row)">{{ row.isActive ? '停用' : '启用' }}</el-button>
            <el-button link type="primary" size="small" @click="openReport(row)">对比报告</el-button>
            <el-button link type="primary" size="small" @click="openDialog(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialog.visible" :title="dialog.form.id ? '编辑 A/B 测试' : '新建 A/B 测试'" width="640px" destroy-on-close>
      <el-form :model="dialog.form" label-width="100px">
        <el-form-item label="测试名称" required>
          <el-input v-model="dialog.form.name" placeholder="如：文案模型对比 v1" />
        </el-form-item>
        <el-form-item label="任务类型" required>
          <el-input v-model="dialog.form.taskType" placeholder="如：text_generation" />
        </el-form-item>
        <el-form-item label="A 组模型">
          <el-input v-model="dialog.form.groupA.model" placeholder="A 组模型名，如 gpt-4o-mini" />
        </el-form-item>
        <el-form-item label="B 组模型">
          <el-input v-model="dialog.form.groupB.model" placeholder="B 组模型名，如 gemini-1.5-flash" />
        </el-form-item>
        <el-form-item label="B 组流量占比">
          <el-slider v-model="dialog.form.trafficRatioB" :min="0" :max="100" show-input />
          <div class="ratio-hint">A 组自动分配 {{ 100 - (dialog.form.trafficRatioB || 0) }}% 流量</div>
        </el-form-item>
        <el-form-item label="立即启用">
          <el-switch v-model="dialog.form.activate" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 对比报告弹窗 -->
    <el-dialog v-model="report.visible" title="A/B 对比报告" width="720px">
      <template v-if="report.data">
        <div class="report-head">
          <el-tag size="small" :type="report.data.winner === 'A' ? 'primary' : report.data.winner === 'B' ? 'success' : 'warning'">
            {{ report.data.winner === 'tie' ? '打平' : `胜出：${report.data.winner} 组` }}
          </el-tag>
          <span class="report-meta">近 {{ report.data.days }} 天 · 生成于 {{ report.data.generatedAt }}</span>
        </div>
        <el-table :data="report.data.groups" border stripe>
          <el-table-column label="组" width="70">
            <template #default="{ row }">
              <span class="grp-tag" :class="row.group === 'A' ? 'a' : 'b'">{{ row.group }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="model" label="模型" min-width="140" />
          <el-table-column label="调用量" width="100" prop="totalCalls" />
          <el-table-column label="成功率" width="110">
            <template #default="{ row }">{{ row.successRate }}%</template>
          </el-table-column>
          <el-table-column label="平均延迟" width="110">
            <template #default="{ row }">{{ row.avgLatency }}ms</template>
          </el-table-column>
          <el-table-column label="平均成本" width="100">
            <template #default="{ row }">¥{{ row.avgCost }}</template>
          </el-table-column>
          <el-table-column label="质量分" width="90">
            <template #default="{ row }">{{ row.avgQuality ?? '—' }}</template>
          </el-table-column>
        </el-table>
        <div class="report-actions">
          <el-button type="primary" plain @click="setDefault('A')">A 组设为默认</el-button>
          <el-button type="primary" plain @click="setDefault('B')">B 组设为默认</el-button>
        </div>
      </template>
      <el-empty v-else description="暂无数据" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { modelsAPI } from '@/api/models'

const tests = ref([])
const loading = ref(false)
const saving = ref(false)

const dialog = reactive({ visible: false, form: {} })
const report = reactive({ visible: false, data: null })

function emptyForm() {
  return {
    id: null,
    name: '',
    taskType: '',
    groupA: { model: '' },
    groupB: { model: '' },
    trafficRatioB: 50,
    activate: false,
  }
}

async function load() {
  loading.value = true
  try {
    const res = await modelsAPI.listAbTests()
    tests.value = res.items
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openDialog(row) {
  dialog.form = row ? { ...emptyForm(), ...row, activate: !!row.isActive } : emptyForm()
  dialog.visible = true
}

async function save() {
  const f = dialog.form
  if (!f.name || !f.taskType || !f.groupA.model || !f.groupB.model) {
    ElMessage.warning('请填写完整测试名称、任务类型与 A/B 模型')
    return
  }
  saving.value = true
  try {
    if (f.id) {
      await modelsAPI.updateAbTest(f.id, {
        name: f.name,
        taskType: f.taskType,
        groupA: { model: f.groupA.model },
        groupB: { model: f.groupB.model },
        trafficRatioB: f.trafficRatioB,
        isActive: f.activate,
      })
    } else {
      await modelsAPI.createAbTest({
        name: f.name,
        taskType: f.taskType,
        serviceType: 'text',
        groupA: { configId: 1, model: f.groupA.model },
        groupB: { configId: 1, model: f.groupB.model },
        trafficRatioB: f.trafficRatioB,
        isActive: f.activate,
      })
    }
    ElMessage.success('已保存')
    dialog.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggle(row) {
  try {
    await modelsAPI.updateAbTest(row.id, { isActive: !row.isActive })
    ElMessage.success(row.isActive ? '已停用' : '已启用')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

async function del(row) {
  await ElMessageBox.confirm(`确认删除测试「${row.name}」？`, '删除确认', { type: 'warning' })
  await modelsAPI.deleteAbTest(row.id)
  ElMessage.success('已删除')
  load()
}

async function openReport(row) {
  report.visible = true
  report.data = null
  try {
    report.data = await modelsAPI.abReport(row.id, 30)
  } catch (e) {
    ElMessage.error(e?.message || '报告生成失败')
  }
}

async function setDefault(group) {
  const id = report.data.test.id
  await modelsAPI.setAbDefault(id, group)
  ElMessage.success(`已将 ${group} 组设为默认配置`)
  report.visible = false
}

onMounted(load)

window.__abTestPreview = { load, setDefault }
</script>

<style scoped>
.ab-test {
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

.grp {
  display: flex;
  align-items: center;
  gap: 8px;
}

.grp-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

.grp-tag.a {
  background: #409eff;
}

.grp-tag.b {
  background: #67c23a;
}

.ratio-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ratio-num {
  font-size: 13px;
  color: #606266;
  min-width: 36px;
}

.ratio-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #ebeef5;
  overflow: hidden;
}

.ratio-fill {
  height: 100%;
  background: linear-gradient(90deg, #67c23a, #409eff);
  border-radius: 3px;
  transition: width 0.3s;
}

.ratio-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.report-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.report-meta {
  font-size: 12px;
  color: #909399;
}

.report-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
</style>
