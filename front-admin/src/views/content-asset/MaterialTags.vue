<template>
  <div class="material-tags-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#722ed1"><CollectionTag /></el-icon>
          <span>素材标签库</span>
          <span class="subtitle">AI 智能标签（内容 / 风格 / 情绪 / 色彩 / 用途五维度），无模型 Key 时自动降级为确定性规则标签</span>
        </div>
        <div class="actions">
          <el-select v-model="kind" style="width: 130px" @change="reload">
            <el-option label="角色素材" value="character" />
            <el-option label="场景素材" value="scene" />
            <el-option label="道具素材" value="prop" />
          </el-select>
          <el-button :loading="loading" @click="reload">刷新</el-button>
          <el-popconfirm
            title="为当前类别下尚未打标签的素材批量生成标签，确认执行？"
            @confirm="doBatchTag"
          >
            <template #reference>
              <el-button type="primary" :loading="batching">批量补标签</el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>

      <!-- 作用域概览 -->
      <el-row :gutter="16" v-if="summary">
        <el-col :span="6" v-for="s in scopeCards" :key="s.key">
          <div class="stat-card" :class="s.key">
            <div class="label">{{ s.label }}</div>
            <div class="value">{{ fmtInt(s.count) }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 五维度标签分布 -->
    <el-card class="dim-card" shadow="never" v-loading="loading">
      <template #header>
        <span>标签词典（{{ kindLabel }} · 共 {{ tags.length }} 个标签）</span>
      </template>
      <el-empty v-if="!tags.length" description="暂无标签，可点击「批量补标签」为素材生成标签" />
      <div v-else class="dimensions">
        <div v-for="dim in dimensions" :key="dim.key" class="dim-block">
          <div class="dim-title">
            <el-tag :color="dim.color" effect="dark" style="border:none;color:#fff">{{ dim.label }}</el-tag>
            <span class="dim-count">{{ tagsByDim(dim.key).length }} 个</span>
          </div>
          <div class="tag-cloud">
            <el-tag
              v-for="t in tagsByDim(dim.key)"
              :key="t.tag_id"
              class="cloud-tag"
              :style="cloudStyle(t)"
              effect="light"
            >
              {{ t.name }}
              <span class="usage">×{{ t.usage_count }}</span>
            </el-tag>
            <span v-if="!tagsByDim(dim.key).length" class="empty-dim">—</span>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { CollectionTag } from '@element-plus/icons-vue'
import { materialAPI } from '@/api/material'

const loading = ref(false)
const batching = ref(false)
const kind = ref('character')
const tags = ref([])
const summary = ref(null)

const dimensions = [
  { key: 'content', label: '内容', color: '#409eff' },
  { key: 'style', label: '风格', color: '#722ed1' },
  { key: 'emotion', label: '情绪', color: '#eb2f96' },
  { key: 'color', label: '色彩', color: '#13c2c2' },
  { key: 'usage', label: '用途', color: '#fa8c16' }
]

const kindLabel = computed(() => ({ character: '角色素材', scene: '场景素材', prop: '道具素材' }[kind.value]))

const scopeCards = computed(() => {
  if (!summary.value) return []
  // 后端返回 { character:{project,personal,team,public}, scene:{...}, prop:{...} }
  // 这里跨三类聚合总量展示
  const agg = { project: 0, personal: 0, team: 0, public: 0 }
  for (const kindKey of Object.keys(summary.value)) {
    const s = summary.value[kindKey] || {}
    agg.project += s.project || 0
    agg.personal += s.personal || 0
    agg.team += s.team || 0
    agg.public += s.public || 0
  }
  return [
    { key: 'project', label: '项目级素材', count: agg.project },
    { key: 'personal', label: '个人库素材', count: agg.personal },
    { key: 'team', label: '团队库素材', count: agg.team },
    { key: 'public', label: '公共库素材', count: agg.public }
  ]
})

function fmtInt(n) {
  return (Number(n) || 0).toLocaleString('zh-CN')
}
function tagsByDim(dim) {
  return tags.value.filter((t) => t.dimension === dim)
}
function cloudStyle(t) {
  const size = Math.min(20, 12 + Math.log2((t.usage_count || 1) + 1) * 2)
  return { fontSize: size + 'px' }
}

async function loadDict() {
  loading.value = true
  try {
    const res = await materialAPI.tagDictionary({ kind: kind.value })
    tags.value = res.tags || []
  } finally {
    loading.value = false
  }
}
async function loadSummary() {
  try {
    const res = await materialAPI.scopeSummary()
    summary.value = res
  } catch (e) {
    summary.value = null
  }
}
function reload() {
  loadDict()
  loadSummary()
}
async function doBatchTag() {
  batching.value = true
  try {
    const res = await materialAPI.batchTag(kind.value, 50)
    ElMessage.success(`已处理 ${res.processed ?? 0} / ${res.total ?? 0} 个未打标签素材`)
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '批量打标签失败')
  } finally {
    batching.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.material-tags-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 16px;
}
.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stat-card {
  border-radius: 10px;
  padding: 16px;
  color: #fff;
  background: linear-gradient(135deg, #409eff, #66b1ff);
}
.stat-card.personal {
  background: linear-gradient(135deg, #722ed1, #9254de);
}
.stat-card.team {
  background: linear-gradient(135deg, #13c2c2, #36cfc9);
}
.stat-card.public {
  background: linear-gradient(135deg, #fa8c16, #ffa940);
}
.stat-card .label {
  font-size: 13px;
  opacity: 0.9;
}
.stat-card .value {
  font-size: 26px;
  font-weight: 700;
  margin-top: 6px;
}
.dim-block {
  margin-bottom: 18px;
}
.dim-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.dim-count {
  font-size: 12px;
  color: #909399;
}
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cloud-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cloud-tag .usage {
  font-size: 11px;
  opacity: 0.6;
}
.empty-dim {
  color: #c0c4cc;
}
</style>
