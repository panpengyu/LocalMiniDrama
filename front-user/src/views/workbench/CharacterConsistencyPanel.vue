<template>
  <!-- S3-T01: 角色详情-一致性展示 (Sprint 3 前端) -->
  <!-- 用于：workbench 项目导航树 → 角色 → 右侧详情 Drawer / 内嵌面板 -->
  <div v-loading="statsLoading || logsLoading" class="cc-panel">
    <div v-if="!character" class="cc-empty">
      <el-empty description="请选择角色" />
    </div>

    <template v-else>
      <!-- 头部：角色基本信息 -->
      <div class="cc-header">
        <el-avatar :size="64" :src="characterImageUrl" class="cc-avatar">
          {{ character?.name?.slice(0, 1) }}
        </el-avatar>
        <div class="cc-head-info">
          <div class="cc-name">
            {{ character?.name || '未命名角色' }}
            <el-tag v-if="character?.role" size="small" type="info" effect="plain" style="margin-left:8px">
              {{ ROLE_LABEL[character.role] || character.role }}
            </el-tag>
          </div>
          <div class="cc-meta">{{ character?.position || character?.personality || '暂无角色描述' }}</div>
        </div>
      </div>

      <!-- 核心区域：一致性分数卡 → 低于阈值标红警告 -->
      <div class="cc-score-card" :class="{ danger: !stats.recentPassed && stats.totalChecks > 0 }">
        <div class="cc-score-main">
          <div class="cc-score-num">
            {{ scorePct(stats.recentScore) }}<span class="cc-score-unit">%</span>
          </div>
          <div class="cc-score-label">最近一次一致性分数</div>
        </div>

        <div v-if="stats.totalChecks === 0" class="cc-no-checks">
          <el-alert type="info" :closable="false" show-icon>
            还未进行一致性校验。点击下方「重新提取指纹」先为角色生成 embedding。
          </el-alert>
        </div>

        <div v-else-if="!stats.recentPassed" class="cc-danger-warn">
          <el-alert type="error" :closable="false" show-icon>
            ⚠️ 最近一次生成图一致性 <b>低于阈值 {{ thresholdPct }}%</b>，
            系统已自动触发重试（最多 {{ MAX_RETRIES }} 次）。请在右侧历史记录查看重试链路。
            若多次仍不达标，建议在角色详情补充更清晰的面部参考图或调整 identity_anchors。
          </el-alert>
        </div>

        <div class="cc-stats-grid">
          <div class="cc-stat-item">
            <div class="cc-stat-value">{{ stats.totalChecks || 0 }}</div>
            <div class="cc-stat-label">总校验次数</div>
          </div>
          <div class="cc-stat-item">
            <div class="cc-stat-value">{{ scorePct(stats.avgScore) }}%</div>
            <div class="cc-stat-label">历史平均分</div>
          </div>
          <div class="cc-stat-item">
            <div class="cc-stat-value" :class="{ danger: (stats.passRate || 0) < 0.8 }">
              {{ pct(stats.passRate) }}%
            </div>
            <div class="cc-stat-label">通过率</div>
          </div>
          <div class="cc-stat-item">
            <div class="cc-stat-value">{{ thresholdPct }}%</div>
            <div class="cc-stat-label">合格阈值</div>
          </div>
        </div>

        <div class="cc-progress-row">
          <span class="cc-pr-label">最近分数</span>
          <el-progress
            :percentage="scorePct(stats.recentScore)"
            :color="progressColor(stats.recentScore, threshold)"
            :stroke-width="12"
            :show-text="false"
            style="flex: 1; margin: 0 12px"
          />
          <span class="cc-pr-threshold" :style="{ left: thresholdPosPx }">阈值{{ thresholdPct }}%</span>
        </div>
      </div>

      <!-- Embedding 元数据 & 操作 -->
      <div class="cc-emb-card">
        <div class="cc-section-title">角色指纹（Embedding）</div>
        <div v-if="embeddingMeta" class="cc-emb-meta">
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="维度">{{ embeddingMeta.embeddingDim }} 维</el-descriptions-item>
            <el-descriptions-item label="生成模型">{{ embeddingMeta.embeddingModel }}</el-descriptions-item>
            <el-descriptions-item label="生成时间">{{ formatTs(embeddingMeta.embeddingGeneratedAt) }}</el-descriptions-item>
            <el-descriptions-item label="阈值">{{ scorePct(embeddingMeta.threshold) }}%</el-descriptions-item>
          </el-descriptions>
        </div>
        <el-empty v-else description="角色尚未生成面部 embedding" :image-size="60" />

        <div class="cc-emb-actions">
          <el-button type="primary" size="small" :loading="embLoading" @click="onGenerateEmbedding">
            <el-icon><RefreshRight /></el-icon>
            重新提取指纹
          </el-button>
          <el-button size="small" :loading="batchEmbLoading" @click="onBatchGenerate">
            一键提取剧中全部角色
          </el-button>
        </div>
      </div>

      <!-- 历史记录 -->
      <div class="cc-logs-card">
        <div class="cc-section-title">
          一致性校验历史
          <el-tag size="small" style="margin-left:8px">{{ logs.length }} 条</el-tag>
        </div>
        <div v-if="logs.length === 0" class="cc-logs-empty">
          <el-empty description="暂无校验记录" :image-size="60" />
        </div>
        <el-scrollbar v-else max-height="320px">
          <div class="cc-log-list">
            <div v-for="log in logs" :key="log.checkId" class="cc-log-item" :class="{ pass: log.passed, fail: !log.passed }">
              <div class="cc-log-left">
                <el-tag size="small" :type="log.passed ? 'success' : 'danger'" effect="dark">
                  {{ log.passed ? '通过' : '未通过' }}
                </el-tag>
                <span class="cc-log-method" :title="log.method">{{ methodLabel(log.method) }}</span>
              </div>
              <div class="cc-log-right">
                <el-progress
                  :percentage="scorePct(log.similarityScore)"
                  :color="log.passed ? '#67c23a' : '#f56c6c'"
                  :stroke-width="8"
                  style="width: 180px"
                />
                <span class="cc-log-score">{{ scorePct(log.similarityScore) }}%</span>
                <span class="cc-log-time">{{ formatTs(log.createdAt) }}</span>
                <el-tag v-if="log.retryCount" size="small" type="warning">重试 #{{ log.retryCount }}</el-tag>
              </div>
            </div>
          </div>
        </el-scrollbar>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import consistencyAPI from '@/api/consistency'

const props = defineProps({
  character: { type: Object, default: null }, // { id, name, role, position, image_url, local_path, drama_id }
  dramaId: { type: [Number, String], default: null },
  defaultThreshold: { type: Number, default: 0.85 },
})
const emit = defineEmits(['updated', 'regenerate'])

const MAX_RETRIES = 3
const ROLE_LABEL = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  cameo: '客串',
  narrator: '旁白',
}

const stats = ref({ totalChecks: 0, avgScore: 0, passRate: 0, recentScore: null, recentPassed: null })
const statsLoading = ref(false)
const logs = ref([])
const logsLoading = ref(false)
const embeddingMeta = ref(null)
const embLoading = ref(false)
const batchEmbLoading = ref(false)
const threshold = ref(props.defaultThreshold)

const characterImageUrl = computed(() => {
  return props.character?.local_path || props.character?.image_url || props.character?.ref_image || ''
})
const thresholdPct = computed(() => Math.round(threshold.value * 100))
const thresholdPosPx = computed(() => `calc(${threshold.value * 100}% + 20px)`)

function scorePct(v) {
  if (v == null || Number.isNaN(Number(v))) return 0
  return Math.max(0, Math.min(100, Math.round(Number(v) * 100)))
}
function pct(v) {
  if (v == null) return 0
  return Math.round(Number(v) * 100)
}
function progressColor(score, thr) {
  const s = Number(score) || 0
  if (s >= thr) return '#67c23a'
  if (s >= thr - 0.1) return '#e6a23c'
  return '#f56c6c'
}
function methodLabel(m) {
  return { cosine_embedding: 'Embedding余弦', visual_llm: '视觉模型', structural: '结构化降级' }[m] || m
}
function formatTs(ts) {
  if (!ts) return '-'
  return String(ts).replace('T', ' ').slice(0, 16)
}

async function loadAll() {
  if (!props.character?.id) return
  const cid = Number(props.character.id)
  await Promise.all([loadStats(cid), loadLogs(cid), loadEmbeddingMeta(cid)])
}

async function loadStats(cid) {
  statsLoading.value = true
  try {
    const res = await consistencyAPI.getCharacterStats(cid)
    stats.value = res?.data || stats.value
    threshold.value = props.defaultThreshold
  } catch (e) {
    console.warn('[一致性面板] stats 加载失败', e)
  } finally {
    statsLoading.value = false
  }
}
async function loadLogs(cid) {
  logsLoading.value = true
  try {
    const res = await consistencyAPI.listLogs({ characterId: cid, limit: 50 })
    logs.value = res?.data?.items || []
  } catch (e) {
    console.warn('[一致性面板] logs 加载失败', e)
  } finally {
    logsLoading.value = false
  }
}
async function loadEmbeddingMeta(cid) {
  try {
    const res = await consistencyAPI.getEmbeddingMeta(cid)
    embeddingMeta.value = res?.data || null
  } catch (e) {
    embeddingMeta.value = null
  }
}

async function onGenerateEmbedding() {
  if (!props.character?.id) return
  embLoading.value = true
  try {
    const res = await consistencyAPI.generateEmbedding({
      characterId: Number(props.character.id),
      characterType: 'project',
    })
    if (res?.data?.success) {
      ElMessage.success(`指纹已生成：${res.data.embeddingDim} 维 / ${res.data.embeddingModel}`)
      emit('updated', { type: 'embedding', characterId: props.character.id })
      await loadEmbeddingMeta(Number(props.character.id))
    }
  } catch (e) {
    ElMessage.error(e?.message || '指纹生成失败')
  } finally {
    embLoading.value = false
  }
}

async function onBatchGenerate() {
  const did = props.dramaId || props.character?.drama_id
  if (!did) return ElMessage.warning('缺少项目上下文')
  try {
    await ElMessageBox.confirm(
      '将为剧中所有角色重新生成面部 embedding，可能调用 AI 模型，是否继续？',
      '批量提取角色指纹',
      { type: 'warning' }
    )
  } catch (_) { return }

  batchEmbLoading.value = true
  try {
    const res = await consistencyAPI.batchGenerateEmbeddings({ dramaId: Number(did) })
    const d = res?.data || {}
    const ok = (d.results || []).filter(r => r.success).length
    ElMessage.success(`完成：${ok}/${d.total} 个角色成功生成`)
    emit('updated', { type: 'batchEmbedding', dramaId: did })
    if (props.character?.id) await loadEmbeddingMeta(Number(props.character.id))
  } catch (e) {
    ElMessage.error(e?.message || '批量生成失败')
  } finally {
    batchEmbLoading.value = false
  }
}

watch(() => props.character?.id, () => loadAll(), { immediate: false })
onMounted(() => loadAll())
defineExpose({ loadAll, refresh: loadAll })
</script>

<style scoped>
.cc-panel { padding: 12px 16px 16px; }
.cc-empty { padding: 40px 0; }
.cc-header {
  display: flex; align-items: center; gap: 14px; padding: 10px 2px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 14px;
}
.cc-avatar { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff; font-weight: 600; }
.cc-head-info { flex: 1; min-width: 0; }
.cc-name { font-size: 18px; font-weight: 600; color: var(--el-text-color-primary); }
.cc-meta { margin-top: 4px; font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.5; }

.cc-score-card {
  background: linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%);
  border: 1px solid #bbf7d0;
  border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;
  transition: all .2s;
}
.cc-score-card.danger {
  background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%);
  border-color: #fecaca;
}
.cc-score-main { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.cc-score-num { font-size: 42px; font-weight: 800; color: #15803d; line-height: 1; }
.danger .cc-score-num { color: #dc2626; }
.cc-score-unit { font-size: 18px; color: inherit; margin-left: 2px; }
.cc-score-label { color: var(--el-text-color-secondary); font-size: 13px; }

.cc-no-checks { margin-bottom: 10px; }
.cc-danger-warn { margin-bottom: 14px; }

.cc-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 16px; }
.cc-stat-item { background: #fff; border-radius: 8px; padding: 10px; text-align: center; }
.cc-stat-value { font-size: 20px; font-weight: 700; color: var(--el-text-color-primary); }
.cc-stat-value.danger { color: #dc2626; }
.cc-stat-label { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 3px; }

.cc-progress-row { display: flex; align-items: center; position: relative; }
.cc-pr-label { font-size: 12px; color: var(--el-text-color-secondary); width: 64px; }
.cc-pr-threshold {
  position: absolute; top: -2px; transform: translateX(-50%);
  font-size: 11px; color: #dc2626; font-weight: 600;
  padding: 0 4px; background: #fff1f2; border-radius: 3px; border: 1px solid #fecaca;
}

.cc-emb-card, .cc-logs-card {
  background: #fff; border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 14px;
}
.cc-section-title { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); margin-bottom: 10px; }
.cc-emb-meta { margin-bottom: 10px; }
.cc-emb-actions { display: flex; gap: 8px; margin-top: 10px; }

.cc-logs-empty { padding: 20px 0; }
.cc-log-list { display: flex; flex-direction: column; gap: 6px; }
.cc-log-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-radius: 6px; background: var(--el-fill-color-lighter);
}
.cc-log-item.pass { border-left: 3px solid #67c23a; }
.cc-log-item.fail { border-left: 3px solid #f56c6c; background: #fef2f2; }
.cc-log-left { display: flex; align-items: center; gap: 10px; }
.cc-log-method { font-size: 12px; color: var(--el-text-color-secondary); }
.cc-log-right { display: flex; align-items: center; gap: 10px; }
.cc-log-score { font-weight: 600; width: 44px; text-align: right; }
.cc-log-time { font-size: 12px; color: var(--el-text-color-secondary); width: 130px; text-align: right; }
</style>
