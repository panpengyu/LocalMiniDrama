<template>
  <div class="ops-center">
    <!-- 页头 -->
    <el-card shadow="never" class="header-card">
      <div class="header-row">
        <div>
          <div class="title">运维操作台</div>
          <div class="subtitle">S21 版权指纹检测 · 运维脚本自动化 · 扩缩容建议（真实指标，无 mock）</div>
        </div>
        <div>
          <el-button size="small" @click="refreshAll">刷新</el-button>
        </div>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" type="border-card">
      <!-- ================= 版权检测 ================= -->
      <el-tab-pane label="版权检测" name="copyright">
        <div class="toolbar">
          <el-select v-model="statusFilter" size="small" style="width: 160px" @change="loadCopyright(1)">
            <el-option label="全部状态" value="all" />
            <el-option label="正常" value="clean" />
            <el-option label="疑似侵权" value="suspect" />
            <el-option label="待检测" value="pending" />
            <el-option label="不支持" value="unsupported" />
          </el-select>
          <el-button size="small" :loading="detectingAll" type="danger" plain @click="handleDetectAll">
            检测全部未检素材
          </el-button>
          <div class="spacer" />
          <span class="hint">指纹比对仅基于本项目自有素材库，不引入第三方受版权保护资源</span>
        </div>

        <el-table v-loading="listLoading" :data="copyrightItems" stripe border size="small">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="name" label="素材名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="type" label="类型" width="100" />
          <el-table-column label="版权状态" width="120">
            <template #default="{ row }">
              <el-tag :type="statusMeta[row.copyright_status]?.type || 'info'" size="small">
                {{ statusMeta[row.copyright_status]?.label || row.copyright_status || '未检测' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="copyright_checked_at" label="检测时间" width="170" />
          <el-table-column label="感知指纹摘要" min-width="200">
            <template #default="{ row }">
              <span v-if="row.ahash" class="mono">
                aHash {{ row.ahash.slice(0, 12) }}…
              </span>
              <span v-else class="muted">暂无指纹</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" plain :loading="row._detecting" @click="handleDetect(row)">
                检测
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <el-pagination
            layout="total, prev, pager, next"
            :total="copyrightTotal"
            :page-size="pageSize"
            :current-page="page"
            small
            @current-change="loadCopyright"
          />
        </div>
      </el-tab-pane>

      <!-- ================= 运维脚本 ================= -->
      <el-tab-pane label="运维脚本" name="scripts">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-card shadow="never" class="op-card">
              <template #header><b>数据库 + 配置备份</b></template>
              <p class="op-desc">执行 backup.sh：MySQL 逻辑备份（mysqldump）、存储目录归档、config.yaml 副本。产物输出到指定目录。</p>
              <el-input v-model="backupDir" size="small" placeholder="备份输出目录（默认自动）" class="mb" />
              <el-button type="primary" size="small" :loading="runningAction === 'backup'" @click="runOp('backup')">
                执行备份
              </el-button>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="never" class="op-card">
              <template #header><b>恢复备份</b></template>
              <p class="op-desc">执行 restore.sh：从指定备份目录恢复 MySQL 数据与存储文件。需显式指定备份目录。</p>
              <el-input v-model="restoreDir" size="small" placeholder="备份目录（必填，如 /data/backup/2026-08-18_10-00-00）" class="mb" />
              <el-button type="warning" size="small" :loading="runningAction === 'restore'" @click="runOp('restore')">
                执行恢复
              </el-button>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="never" class="op-card">
              <template #header><b>版本回滚</b></template>
              <p class="op-desc">执行 rollback.sh：回退到上一部署版本（Git tag + 应用重启），用于发布异常快速止损。</p>
              <el-button type="danger" size="small" :loading="runningAction === 'rollback'" @click="runOp('rollback')">
                执行回滚
              </el-button>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="mt">
          <template #header><b>脚本输出</b></template>
          <pre class="script-output">{{ scriptOutput || '（尚未执行脚本，点击上方按钮触发）' }}</pre>
        </el-card>
      </el-tab-pane>

      <!-- ================= 扩缩容建议 ================= -->
      <el-tab-pane label="扩缩容建议" name="scaling">
        <el-row :gutter="16">
          <el-col :span="6"><el-statistic title="CPU 负载" :value="metrics.cpu_pct" suffix="%" /></el-col>
          <el-col :span="6"><el-statistic title="内存占用" :value="metrics.mem_pct" suffix="%" /></el-col>
          <el-col :span="6"><el-statistic title="队列待处理" :value="metrics.queue_waiting" /></el-col>
          <el-col :span="6"><el-statistic title="DB 连接数" :value="metrics.db_threads_connected" /></el-col>
        </el-row>

        <el-card shadow="never" class="mt">
          <template #header>
            <div class="header-row">
              <b>建议级别</b>
              <el-tag :type="levelMeta[scaling.level]?.type || 'info'" size="small">
                {{ levelMeta[scaling.level]?.label || scaling.level }}
              </el-tag>
            </div>
          </template>
          <p class="suggestion">{{ scaling.suggestion || '加载中…' }}</p>
          <ul class="reasons">
            <li v-for="(r, i) in scaling.reasons || []" :key="i">{{ r }}</li>
          </ul>
          <div class="mt">
            <el-button size="small" type="primary" plain :loading="scalingLoading" @click="loadScaling">重新采集</el-button>
            <span class="hint ml">采样时间：{{ scaling.sampled_at }}</span>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { opsAPI } from '@/api/ops'

const activeTab = ref('copyright')

const statusMeta = {
  clean: { label: '正常', type: 'success' },
  suspect: { label: '疑似侵权', type: 'danger' },
  pending: { label: '待检测', type: 'info' },
  unsupported: { label: '不支持', type: 'warning' }
}

// ---------- 版权检测 ----------
const copyrightItems = ref([])
const copyrightTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('all')
const listLoading = ref(false)
const detectingAll = ref(false)

async function loadCopyright(p = 1) {
  page.value = p
  listLoading.value = true
  try {
    const res = await opsAPI.copyrightList({ page: p, page_size: pageSize.value, status: statusFilter.value })
    copyrightItems.value = (res.items || []).map((it) => ({ ...it, _detecting: false }))
    copyrightTotal.value = res.total || 0
  } catch (e) {
    ElMessage.error('版权状态列表加载失败：' + (e.message || '网络错误'))
  } finally {
    listLoading.value = false
  }
}

async function handleDetect(row) {
  row._detecting = true
  try {
    const res = await opsAPI.detectCopyright({ asset_id: row.id })
    const r = res.results?.[0]
    if (r) ElMessage[statusMeta[r.status]?.type === 'danger' ? 'warning' : 'success'](`素材 ${row.name}：${r.reason || r.status}`)
    else ElMessage.success('检测完成')
    loadCopyright(page.value)
  } catch (e) {
    ElMessage.error('检测失败：' + (e.message || '网络错误'))
  } finally {
    row._detecting = false
  }
}

async function handleDetectAll() {
  try {
    await ElMessageBox.confirm('将对全部未检测/待重检素材（最多 200 条）执行版权指纹比对，确定继续？', '批量检测确认', { type: 'warning' })
  } catch (_) {
    return
  }
  detectingAll.value = true
  try {
    const res = await opsAPI.detectCopyright({ all: true })
    ElMessage.success(`批量检测完成，共处理 ${res.count || 0} 条`)
    loadCopyright(page.value)
  } catch (e) {
    ElMessage.error('批量检测失败：' + (e.message || '网络错误'))
  } finally {
    detectingAll.value = false
  }
}

// ---------- 运维脚本 ----------
const backupDir = ref('')
const restoreDir = ref('')
const runningAction = ref('')
const scriptOutput = ref('')

async function runOp(action) {
  const labels = { backup: '备份', restore: '恢复', rollback: '回滚' }
  if (action === 'restore' && !restoreDir.value.trim()) {
    ElMessage.warning('恢复操作必须指定备份目录（backup_dir）')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定执行「${labels[action]}」操作？该操作将调用真实脚本，请确认目标环境正确。`,
      '操作确认',
      { type: 'warning' }
    )
  } catch (_) {
    return
  }
  runningAction.value = action
  scriptOutput.value = ''
  try {
    const payload = action === 'restore' ? { backup_dir: restoreDir.value.trim() } : action === 'backup' && backupDir.value.trim() ? { backup_dir: backupDir.value.trim() } : {}
    const res = await opsAPI.runScript(action, payload)
    scriptOutput.value = res?.output || '（无输出）'
    ElMessage.success(`${labels[action]}脚本执行成功`)
  } catch (e) {
    scriptOutput.value = e.output || e.message || '脚本执行失败'
    ElMessage.error(`脚本执行失败：${e.message || '未知错误'}`)
  } finally {
    runningAction.value = ''
  }
}

// ---------- 扩缩容建议 ----------
const scaling = ref({})
const metrics = ref({})
const scalingLoading = ref(false)

const levelMeta = {
  normal: { label: '正常 · 无需扩容', type: 'success' },
  watch: { label: '观察 · 接近阈值', type: 'warning' },
  'scale-up': { label: '建议扩容', type: 'danger' }
}

async function loadScaling() {
  scalingLoading.value = true
  try {
    const res = await opsAPI.scalingAdvice()
    scaling.value = res || {}
    metrics.value = res.metrics || {}
  } catch (e) {
    ElMessage.error('扩缩容建议获取失败：' + (e.message || '网络错误'))
  } finally {
    scalingLoading.value = false
  }
}

function refreshAll() {
  loadCopyright(1)
  loadScaling()
}

onMounted(() => {
  loadCopyright(1)
  loadScaling()
})
</script>

<style scoped>
.ops-center {
  padding: 16px;
  background: #f5f7fa;
  min-height: calc(100vh - 120px);
}
.header-card {
  margin-bottom: 16px;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}
.subtitle {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.mono {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
  color: #606266;
}
.muted {
  color: #c0c4cc;
  font-size: 12px;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.op-card {
  height: 100%;
}
.op-desc {
  font-size: 13px;
  color: #606266;
  min-height: 60px;
  line-height: 1.6;
}
.mb {
  margin-bottom: 12px;
}
.mt {
  margin-top: 16px;
}
.ml {
  margin-left: 12px;
}
.script-output {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.suggestion {
  font-size: 14px;
  color: #303133;
  line-height: 1.8;
}
.reasons {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: #606266;
}
.reasons li {
  margin: 4px 0;
}
</style>
