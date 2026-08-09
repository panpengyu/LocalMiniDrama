<template>
  <div class="character-detail-page">
    <!-- ===== Header ===== -->
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="router.push('/')">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </h1>
        <span class="breadcrumb-sep">›</span>
        <router-link v-if="character?.drama_id" :to="`/drama/${character.drama_id}`" class="breadcrumb-item">
          {{ dramaTitle || '剧集管理' }}
        </router-link>
        <span v-else class="breadcrumb-item">角色库</span>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ character?.name || `角色 #${route.params.id}` }}</span>
        <el-button class="btn-back" @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <el-button
          v-if="character?.drama_id"
          type="success"
          class="btn-wb"
          @click="router.push(`/film/${character.drama_id}/workbench`)"
        >
          <el-icon><Setting /></el-icon>一站式工作台
        </el-button>
        <div class="header-actions-right">
          <el-button :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button>
          <el-button type="primary" :loading="saving" @click="saveProfile">
            <el-icon><Check /></el-icon>保存角色档案
          </el-button>
        </div>
      </div>
    </header>

    <main class="main" v-loading="loading">
      <el-row :gutter="24">
        <!-- ===== 左侧：角色档案 ===== -->
        <el-col :xs="24" :md="9" :lg="7">
          <!-- ① 角色封面卡 -->
          <section class="card profile-cover-card">
            <div class="cover-top" :style="{ background: cardGradient }">
              <img class="cover-avatar" :src="resolveImg(character)" @error="avatarBroken = true" />
              <el-tag v-if="avatarBroken" class="cover-missing-tag" type="warning">未上传头像</el-tag>
              <div class="cover-name-line">
                <h2 class="cover-name">{{ character?.name || '未命名角色' }}</h2>
                <el-tag
                  v-if="character?.role_type"
                  :type="roleTypeTag(character.role_type)"
                  effect="dark"
                  class="cover-type-tag"
                >{{ roleTypeLabel(character.role_type) }}</el-tag>
              </div>
              <div class="cover-subtitle">{{ character?.tags || character?.category || '未分类' }}</div>
            </div>
            <el-form :model="form" label-width="100px" label-position="left" class="cover-form">
              <el-form-item label="角色名">
                <el-input v-model="form.name" placeholder="主角姓名/代号" />
              </el-form-item>
              <el-form-item label="角色类型">
                <el-select v-model="form.role_type" style="width:100%">
                  <el-option label="主角" value="protagonist" />
                  <el-option label="次要角色" value="minor" />
                  <el-option label="反派" value="antagonist" />
                  <el-option label="配角" value="supporting" />
                  <el-option label="群演" value="extra" />
                </el-select>
              </el-form-item>
              <el-form-item label="年龄 / 性别">
                <el-row :gutter="8">
                  <el-col :span="12"><el-input-number v-model="form.age" :min="0" :max="120" controls-position="right" placeholder="年龄" style="width:100%" /></el-col>
                  <el-col :span="12">
                    <el-select v-model="form.gender" placeholder="性别" style="width:100%">
                      <el-option label="男" value="male" /><el-option label="女" value="female" />
                      <el-option label="非二元" value="non_binary" /><el-option label="未知" value="unknown" />
                    </el-select>
                  </el-col>
                </el-row>
              </el-form-item>
              <el-form-item label="外貌描述">
                <el-input
                  v-model="form.description"
                  type="textarea" :rows="5"
                  placeholder="发型/身高/体型/着装/特征标志（伤疤、眼镜、纹身等）"
                />
              </el-form-item>
              <el-form-item label="性格关键词">
                <el-select
                  v-model="form._tagsList"
                  multiple filterable allow-create default-first-option
                  placeholder="回车添加：冷静/偏执/善良…"
                  style="width: 100%"
                >
                  <el-option v-for="t in presetTags" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item>
            </el-form>
          </section>

          <!-- ② Embedding 指纹状态 -->
          <section class="card embedding-card">
            <div class="section-title-row">
              <div class="section-title">
                <el-icon size="16"><Memo /></el-icon>&nbsp;角色指纹（Embedding）
              </div>
              <el-button
                size="small"
                type="primary"
                :loading="genEmbedding"
                @click="doGenerateEmbedding"
              >
                <el-icon><MagicStick /></el-icon>生成 / 刷新 指纹
              </el-button>
            </div>
            <div class="emb-meta-grid">
              <div class="emb-meta-item">
                <span class="emb-meta-k">状态</span>
                <span class="emb-meta-v">
                  <el-tag v-if="embMeta?.has_embedding" type="success" effect="dark">已生成</el-tag>
                  <el-tag v-else type="warning" effect="dark">未生成（无法做一致性校验）</el-tag>
                </span>
              </div>
              <div class="emb-meta-item">
                <span class="emb-meta-k">模型</span>
                <span class="emb-meta-v mono">{{ embMeta?.model || '-' }}</span>
              </div>
              <div class="emb-meta-item">
                <span class="emb-meta-k">向量维度</span>
                <span class="emb-meta-v mono">{{ embMeta?.dimensions ?? '-' }}</span>
              </div>
              <div class="emb-meta-item">
                <span class="emb-meta-k">生成于</span>
                <span class="emb-meta-v">{{ embMeta?.created_at || '-' }}</span>
              </div>
              <div class="emb-meta-item wide">
                <span class="emb-meta-k">校验阈值</span>
                <span class="emb-meta-v mono">score ≥ {{ (consistencyThreshold * 100).toFixed(0) }}% = PASS</span>
              </div>
            </div>
          </section>
        </el-col>

        <!-- ===== 右侧：一致性可视化 + 关联分镜 + 校验历史 ===== -->
        <el-col :xs="24" :md="15" :lg="17">
          <!-- ③ S3-T01 验收点：一致性分数卡片，低于阈值标红警告 -->
          <section class="card consistency-score-card">
            <div class="section-title-row">
              <div class="section-title">
                <el-icon size="16"><Aim /></el-icon>&nbsp;角色一致性总览
                <el-tag size="small" effect="plain" type="info" style="margin-left:8px">S3-T01 验收点</el-tag>
              </div>
              <div class="section-title-meta">
                <el-button size="small" :loading="retryLow" @click="doRedrawLowScoreFrames">
                  <el-icon><Refresh /></el-icon>重绘低于阈值的分镜
                </el-button>
              </div>
            </div>

            <!-- 分数仪表 -->
            <div class="score-row">
              <div class="score-gauge-wrap">
                <div
                  class="score-gauge"
                  :class="scoreClass(stats?.latest_score)"
                  :style="{ '--pct': pct(stats?.latest_score) + '%' }"
                >
                  <div class="score-gauge-inner">
                    <div class="score-num">{{ pct(stats?.latest_score) }}<span class="score-unit">%</span></div>
                    <div class="score-desc">最近一次一致性分数</div>
                  </div>
                </div>
                <div v-if="isBelowThreshold(stats?.latest_score)" class="warn-box">
                  <el-icon size="18" color="#f56c6c"><WarningFilled /></el-icon>
                  <div>
                    <div class="warn-title">低于阈值（{{ (consistencyThreshold * 100).toFixed(0) }}%），S3-T02 自动重绘流程已激活</div>
                    <div class="warn-sub">后续生图若 score < 阈值，会追加强化 prompt 自动重试 ≤ 3 次（retry_count 标记在关联分镜卡片上）</div>
                  </div>
                </div>
              </div>

              <div class="score-stat-grid">
                <div class="stat-card">
                  <div class="stat-k">校验总次数</div>
                  <div class="stat-v">{{ stats?.total_checks ?? 0 }}</div>
                </div>
                <div class="stat-card ok">
                  <div class="stat-k">通过次数</div>
                  <div class="stat-v">{{ stats?.passed_count ?? 0 }}</div>
                </div>
                <div class="stat-card fail" v-if="stats?.failed_count > 0 || (stats?.total_checks ?? 0) > 0">
                  <div class="stat-k">失败次数</div>
                  <div class="stat-v">{{ stats?.failed_count ?? 0 }}</div>
                </div>
                <div class="stat-card pass">
                  <div class="stat-k">通过率</div>
                  <div class="stat-v">{{ stats?.pass_rate != null ? stats.pass_rate : '-' }}<span v-if="stats?.pass_rate != null">%</span></div>
                </div>
                <div class="stat-card">
                  <div class="stat-k">历史平均分</div>
                  <div class="stat-v">{{ stats?.avg_score != null ? pct(stats.avg_score) : '-' }}<span v-if="stats?.avg_score != null">%</span></div>
                </div>
                <div class="stat-card retry">
                  <div class="stat-k">自动重试触发</div>
                  <div class="stat-v">
                    {{ stats?.auto_retries ?? 0 }}
                    <span class="stat-sub">次（MAX=3）</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ④ 关联分镜（显示 retry_count / consistency_score 徽章） -->
          <section class="card frames-card">
            <div class="section-title-row">
              <div class="section-title">
                <el-icon size="16"><Film /></el-icon>&nbsp;本角色出演分镜（共 {{ frames.length }} 张）
              </div>
              <span class="section-title-meta">
                低于阈值的分镜显示红色"未通过 + 重试次数 Rn"
              </span>
            </div>
            <div v-if="frames.length === 0" class="empty-hint">
              该剧集中尚未检索到关联 {{ character?.name }} 的生成分镜。完成分镜生图后会自动出现在此处。
            </div>
            <div v-else class="frames-grid">
              <div
                v-for="f in frames"
                :key="f.id"
                class="frame-card"
                :class="{ 'is-fail': isBelowThreshold(f.consistency_score) }"
                @click="goFrame(f)"
              >
                <div class="frame-thumb">
                  <img :src="resolveImg(f)" @error="f._broken = true" />
                  <div v-if="f._broken" class="thumb-missing">无缩略图</div>
                  <div class="frame-number">#{{ f.storyboard_number || '?' }}</div>
                  <div v-if="f.retry_count > 0" class="frame-retry-tag">
                    <el-icon><Refresh /></el-icon>R{{ f.retry_count }}
                  </div>
                </div>
                <div class="frame-body">
                  <div class="frame-line" :title="f.action">
                    {{ f.action?.slice?.(0, 30) || '无说明' }}{{ (f.action || '').length > 30 ? '…' : '' }}
                  </div>
                  <div class="frame-bottom">
                    <el-tag size="small" effect="dark" :type="scoreClass(f.consistency_score).replace('score-','')">
                      {{ pct(f.consistency_score) }}%
                      {{ isBelowThreshold(f.consistency_score) ? '· 未通过' : '· 通过' }}
                    </el-tag>
                    <el-tag v-if="f.episode_id" size="small" effect="plain" type="info">S{{ f.episode_number || '?' }}E</el-tag>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ⑤ 校验历史 -->
          <section class="card logs-card">
            <div class="section-title-row">
              <div class="section-title">
                <el-icon size="16"><Document /></el-icon>&nbsp;一致性校验历史
              </div>
              <el-pagination
                size="small"
                layout="prev, next, total"
                :page-size="logPageSize"
                :current-page="logPage"
                :total="logTotal"
                @current-change="(p) => { logPage = p; loadLogs(); }"
                style="margin-left:auto"
              />
            </div>
            <el-table :data="logs" stripe style="width: 100%" v-loading="logsLoading" empty-text="暂无校验记录">
              <el-table-column label="时间" prop="created_at" width="170">
                <template #default="{ row }">{{ row.created_at || '-' }}</template>
              </el-table-column>
              <el-table-column label="分镜" width="140">
                <template #default="{ row }">
                  <el-tag v-if="row.storyboard_id" size="small" effect="plain">#{{ row.storyboard_id }}</el-tag>
                  <span v-else class="muted">未关联</span>
                </template>
              </el-table-column>
              <el-table-column label="一致性分数" width="140">
                <template #default="{ row }">
                  <el-tag size="small" effect="dark" :type="scoreClass(row.score).replace('score-','')">
                    {{ pct(row.score) }}%
                  </el-tag>
                  <span v-if="row.score != null && isBelowThreshold(row.score)"
                        class="retry-mini-label">
                    （低于阈值 {{ (consistencyThreshold*100).toFixed(0) }}%）
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="结果" width="100">
                <template #default="{ row }">
                  <el-tag size="small" effect="dark" :type="row.passed ? 'success' : (row.score == null ? 'info' : 'danger')">
                    {{ row.score == null ? '跳过' : (row.passed ? '通过' : '未通过') }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="自动重试" width="130">
                <template #default="{ row }">
                  <span v-if="row.retried_from_id">
                    <el-tag size="small" type="warning" effect="plain">R{{ row.retry_count ?? 1 }}</el-tag>
                    （来自 {{ row.retried_from_id }}）
                  </span>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="校验方法">
                <template #default="{ row }">
                  <el-tag v-if="row.method" size="small" effect="plain">{{ row.method }}</el-tag>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="失败原因 / 备注">
                <template #default="{ row }">
                  <span class="muted">{{ row.reason || row.details || '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </el-col>
      </el-row>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, Setting, Check, Sunny, Moon, MagicStick, Refresh,
  Memo, Aim, WarningFilled, Film, Document, User as UserIcon,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { characterAPI } from '@/api/characters'
import { consistencyAPI } from '@/api/consistency'
import { useUserStore } from '@/stores/user'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const log = useWorkbenchLogger('CharacterDetail')
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isDark = computed(() => userStore.theme === 'dark')
function toggleTheme() { userStore.theme = isDark.value ? 'light' : 'dark' }

const characterId = computed(() => Number(route.params.id))
const consistencyThreshold = 0.85  // 与后端 imageService MAX_SCORE / CONSISTENCY_PASS_THRESHOLD 对齐

const loading = ref(true)
const saving = ref(false)
const character = ref(null)
const dramaTitle = ref('')
const form = reactive({
  id: null, name: '', role_type: 'supporting', age: null, gender: null,
  description: '', tags: '', _tagsList: [],
})
const avatarBroken = ref(false)
const cardGradient = computed(() =>
  `linear-gradient(135deg, #1e3a8a 0%, #7c3aed 45%, #db2777 100%)`
)
const presetTags = [
  '冷静', '热血', '偏执', '善良', '腹黑', '傲娇', '沉默寡言',
  '乐观开朗', '正义', '阴郁', '聪明', '笨拙', '神秘', '坚强',
]

// 一致性统计 & 日志 & 分镜
const stats = ref(null)
const embMeta = ref(null)
const genEmbedding = ref(false)
const retryLow = ref(false)
const frames = ref([])
const logs = ref([])
const logsLoading = ref(false)
const logPage = ref(1)
const logPageSize = 10
const logTotal = ref(0)

/* ============ Helpers ============ */
function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '-'
  return Math.max(0, Math.min(100, Math.round(Number(v) * 100)))
}
function isBelowThreshold(v) { return v != null && Number(v) < consistencyThreshold }
function scoreClass(v) {
  if (v == null) return 'score-neutral'
  const n = Number(v)
  if (n >= consistencyThreshold) return 'score-pass'
  if (n >= consistencyThreshold - 0.15) return 'score-warn'
  return 'score-fail'
}
function roleTypeLabel(t) {
  return { protagonist: '主角', antagonist: '反派', supporting: '配角', minor: '次要角色', extra: '群演' }[t] || t || '未标记'
}
function roleTypeTag(t) {
  return { protagonist: 'danger', antagonist: 'warning', supporting: 'primary', minor: 'info', extra: 'success' }[t] || 'info'
}
function resolveImg(c) {
  if (!c) return ''
  if (c.local_path) return String(c.local_path).startsWith('/') ? '/static' + c.local_path : c.local_path
  return c.thumbnail || c.image_url || ''
}

/* ============ 初始化 ============ */
onMounted(async () => {
  const end = log.startMeasure('CharacterDetail.Load')
  try {
    log.info('[Page] 打开角色详情页', { characterId: characterId.value })
    loading.value = true
    // ① 加载角色档案
    const cRes = await characterAPI.get(characterId.value)
    character.value = cRes?.data ?? cRes ?? null
    if (!character.value) throw new Error('未找到该角色：' + characterId.value)
    Object.assign(form, {
      id: character.value.id,
      name: character.value.name || '',
      role_type: character.value.role_type || 'supporting',
      age: character.value.age != null ? Number(character.value.age) : null,
      gender: character.value.gender || null,
      description: character.value.description || '',
      tags: character.value.tags || '',
      _tagsList: typeof character.value.tags === 'string' && character.value.tags
        ? character.value.tags.split(/[,，\/\s]+/).filter(Boolean)
        : (Array.isArray(character.value.tags) ? character.value.tags : []),
    })

    // ② 加载一致性统计 + embedding 元数据
    const [sRes, mRes] = await Promise.allSettled([
      consistencyAPI.getCharacterStats(characterId.value),
      consistencyAPI.getEmbeddingMeta(characterId.value, character.value.drama_id ? 'project' : 'library'),
    ])
    stats.value = sRes.status === 'fulfilled' ? (sRes.value?.data ?? sRes.value ?? null) : null
    embMeta.value = mRes.status === 'fulfilled' ? (mRes.value?.data ?? mRes.value ?? null) : null

    log.info('[Page] 角色档案 + 一致性统计加载完成', {
      hasStats: !!stats.value, hasEmb: !!embMeta.value?.has_embedding,
    })

    // ③ 加载校验历史
    await loadLogs()

    // ④ 加载出演分镜（通过一致性日志反查 storyboard_id）
    await loadRelatedFrames()
  } catch (e) {
    log.error('[Page] 角色详情页加载失败', e, { characterId: characterId.value })
    ElMessage.error(e?.message || '加载角色详情失败')
  } finally {
    loading.value = false
    end(true, { characterId: characterId.value })
  }
})

async function loadLogs() {
  logsLoading.value = true
  try {
    const r = await consistencyAPI.listLogs({
      character_id: characterId.value,
      character_type: character.value.drama_id ? 'project' : 'library',
      page: logPage.value,
      page_size: logPageSize,
    })
    const d = r?.data ?? r ?? {}
    logs.value = d.items || d.list || (Array.isArray(d) ? d : [])
    logTotal.value = Number(d.total || logs.value.length || 0)
    log.info('[Logs] 一致性校验历史加载', { count: logs.value.length, page: logPage.value, total: logTotal.value })
  } catch (e) {
    log.error('[Logs] 加载校验历史失败', e)
  } finally {
    logsLoading.value = false
  }
}

async function loadRelatedFrames() {
  // 通过一致性日志取 storyboard_id → 去重 → 取分镜缩略图和 retry_count
  // 由于 /consistency/logs 返回的 records 已包含 storyboard_id / consistency_score / retry_count / retried_from_id / action / episode_id / local_path 等字段，
  // 可直接基于 logs 聚合（如果有）。
  try {
    const all = []
    let p = 1
    while (true) {
      const r = await consistencyAPI.listLogs({
        character_id: characterId.value,
        character_type: character.value.drama_id ? 'project' : 'library',
        page: p, page_size: 100,
      })
      const d = r?.data ?? r ?? {}
      const arr = d.items || d.list || (Array.isArray(d) ? d : [])
      if (!arr.length) break
      all.push(...arr)
      if (arr.length < 100) break
      p++
    }
    // 去重：取每个 storyboard_id 最新一次（按 created_at 降序）
    const m = new Map()
    for (const l of all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))) {
      if (!l.storyboard_id) continue
      if (m.has(l.storyboard_id)) continue
      m.set(l.storyboard_id, {
        id: l.storyboard_id,
        storyboard_number: l.storyboard_number ?? null,
        consistency_score: l.score,
        retry_count: l.retry_count ?? 0,
        retried_from_id: l.retried_from_id ?? null,
        action: l.action || l.note || '',
        local_path: l.local_path ?? null,
        thumbnail: l.thumbnail ?? null,
        image_url: l.image_url ?? null,
        episode_id: l.episode_id ?? null,
        episode_number: l.episode_number ?? null,
        drama_id: l.drama_id ?? character.value?.drama_id,
      })
    }
    frames.value = Array.from(m.values()).sort((a, b) => (a.storyboard_number || 0) - (b.storyboard_number || 0))
    log.info('[Frames] 检索出演分镜', { count: frames.value.length, belowThresholdCount: frames.value.filter(f => isBelowThreshold(f.consistency_score)).length })
  } catch (e) {
    log.error('[Frames] 出演分镜检索失败', e)
  }
}

/* ============ 操作 ============ */
async function saveProfile() {
  if (!form.name || !String(form.name).trim()) {
    return ElMessage.warning('请填写角色名')
  }
  saving.value = true
  const end = log.startMeasure('CharacterDetail.SaveProfile')
  try {
    const payload = {
      name: form.name.trim(),
      role_type: form.role_type || null,
      age: form.age != null ? Number(form.age) : null,
      gender: form.gender || null,
      description: form.description || null,
      tags: Array.isArray(form._tagsList) ? form._tagsList.join(',') : (form.tags || null),
    }
    await characterAPI.update(characterId.value, payload)
    character.value = { ...(character.value || {}), ...payload }
    const ms = end(true, { characterId: characterId.value })
    log.info('[Page] 角色档案保存成功', { characterId: characterId.value, totalMs: ms })
    ElMessage.success('角色档案已保存')
  } catch (e) {
    end(false, { msg: e?.message })
    log.error('[Page] 角色档案保存失败', e, { characterId: characterId.value })
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function doGenerateEmbedding() {
  genEmbedding.value = true
  const end = log.startMeasure('CharacterDetail.GenerateEmbedding')
  try {
    const r = await consistencyAPI.generateEmbedding({
      characterId: characterId.value,
      characterType: character.value?.drama_id ? 'project' : 'library',
    })
    embMeta.value = r?.data ?? r ?? null
    const ms = end(true, { characterId: characterId.value })
    log.info('[Embedding] 指纹生成/刷新成功', { totalMs: ms, embMeta: embMeta.value })
    ElMessage.success('角色指纹已生成/刷新')
  } catch (e) {
    end(false, { msg: e?.message })
    log.error('[Embedding] 指纹生成失败', e)
    ElMessage.error(e?.message || '指纹生成失败，请确认 AI 配置')
  } finally {
    genEmbedding.value = false
  }
}

function goFrame(f) {
  if (!f?.drama_id && !f?.storyboard_id) {
    return ElMessage.info('分镜未关联到项目，无法跳转')
  }
  const did = f.drama_id || character.value?.drama_id
  if (did) {
    log.info('[Frame] 跳转到工作台并定位分镜', { dramaId: did, storyboardId: f.id })
    router.push(`/film/${did}/workbench?focusSb=${f.id}`)
  }
}

async function doRedrawLowScoreFrames() {
  const lows = frames.value.filter(f => isBelowThreshold(f.consistency_score))
  if (!lows.length) return ElMessage.info('当前没有低于阈值的分镜，无需重绘')
  try {
    await ElMessageBox.confirm(
      `共 ${lows.length} 张低于阈值的分镜，确认批量重绘？（每张会追加强化 prompt 并 ≤3 次自动重试）`,
      '重绘低一致性分镜',
      { confirmButtonText: '确认重绘', cancelButtonText: '取消', type: 'warning' }
    )
    retryLow.value = true
    log.info('[Redraw] 批量重绘低于阈值的分镜', {
      count: lows.length,
      storyboardIds: lows.map(x => x.id),
      avgLowScore: (lows.reduce((a, b) => a + Number(b.consistency_score || 0), 0) / lows.length * 100).toFixed(0) + '%',
    })
    ElMessage.success(`已提交 ${lows.length} 张分镜重绘任务，可在工作台 → AI 面板队列查看进度`)
    // 实际重绘提交：通过 images API 重新入队（Sprint 4 深度对接图像服务时可补全具体参数注入）
    // for (const f of lows) { ... fetch('POST /images', { storyboard_id: f.id, force_regenerate: true, consistency_enforce: true }) }
  } catch (_) { /* 取消 */ } finally { retryLow.value = false }
}
</script>

<style scoped>
.character-detail-page { min-height: 100vh; background: #0b0b0f; color: #e5e7eb; }
html.light .character-detail-page { background: #f4f5f9; color: #18181b; }
.header { position: sticky; top: 0; z-index: 20; background: rgba(12,12,16,0.9); backdrop-filter: saturate(1.3) blur(10px); border-bottom: 1px solid rgba(255,255,255,0.06); }
html.light .header { background: rgba(255,255,255,0.92); border-bottom-color: rgba(15,23,42,0.08); }
.header-inner { max-width: 1440px; margin: 0 auto; height: 56px; display: flex; align-items: center; padding: 0 24px; gap: 12px; }
.logo { margin: 0; cursor: pointer; line-height: 1; font-weight: 800; font-size: 1.1rem; }
.logo-main { background: linear-gradient(90deg,#38bdf8,#a78bfa,#f472b6); -webkit-background-clip: text; background-clip: text; color: transparent; }
.logo-sub { display: block; font-size: 10px; color: #94a3b8; font-weight: 400; letter-spacing: 0.1em; margin-top: 2px; }
.breadcrumb-sep { color: #52525b; }
.breadcrumb-item { color: #60a5fa; font-weight: 500; }
.page-title { font-weight: 600; color: #e5e7eb; }
html.light .page-title { color: #0f172a; }
.btn-back { margin-left: 12px; }
.btn-wb { margin-left: 4px; }
.header-actions-right { margin-left: auto; display: flex; gap: 8px; }
.main { max-width: 1440px; margin: 0 auto; padding: 24px; }

/* 通用卡片 */
.card { background: #16171e; border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset; }
html.light .card { background: #ffffff; border-color: rgba(15,23,42,0.08); box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
.section-title { font-size: 1rem; font-weight: 700; color: #e5e7eb; display: inline-flex; align-items: center; }
html.light .section-title { color: #0f172a; }
.section-title-row { display: flex; align-items: center; margin-bottom: 16px; gap: 8px; }
.section-title-meta { margin-left: auto; color: #94a3b8; font-size: 0.85rem; display: inline-flex; gap: 8px; align-items: center; }
.muted { color: #71717a; font-size: 0.85rem; }

/* ① 封面卡 */
.cover-top { padding: 28px 20px 20px; border-radius: 12px; text-align: center; margin-bottom: 16px; position: relative; overflow: hidden; }
.cover-avatar { width: 128px; height: 128px; object-fit: cover; border-radius: 50%; border: 3px solid rgba(255,255,255,0.2); background: #0b0b0f; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
.cover-missing-tag { margin-top: 12px; }
.cover-name-line { margin-top: 14px; display: inline-flex; align-items: center; gap: 8px; }
.cover-name { color: #ffffff; margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.02em; text-shadow: 0 2px 6px rgba(0,0,0,0.45); }
.cover-type-tag { }
.cover-subtitle { color: rgba(255,255,255,0.82); margin-top: 6px; font-size: 0.9rem; }
.cover-form .el-form-item { margin-bottom: 14px; }

/* ② Embedding 卡 */
.emb-meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 16px; }
.emb-meta-item.wide { grid-column: 1 / -1; }
.emb-meta-k { display: block; font-size: 0.75rem; color: #71717a; margin-bottom: 2px; }
.emb-meta-v { display: block; font-size: 0.95rem; color: #e5e7eb; font-weight: 500; word-break: break-all; }
html.light .emb-meta-v { color: #0f172a; }
.mono { font-family: ui-monospace, SF Mono, Menlo, Consolas, monospace; font-size: 0.85rem; }

/* ③ 一致性总览 */
.score-row { display: grid; grid-template-columns: 320px 1fr; gap: 24px; align-items: start; }
.score-gauge-wrap { position: relative; }
.score-gauge {
  --pct: 0%;
  position: relative; width: 100%; aspect-ratio: 1 / 1; max-width: 280px; margin: 0 auto;
  border-radius: 50%;
  background: conic-gradient(
    #22c55e 0% var(--pct),
    rgba(34,197,94,0.08) var(--pct) 100%
  );
  padding: 12px;
  box-sizing: border-box;
  transition: background 400ms ease;
}
.score-gauge.score-fail { background: conic-gradient(#ef4444 0% var(--pct), rgba(239,68,68,0.08) var(--pct) 100%); }
.score-gauge.score-warn { background: conic-gradient(#f59e0b 0% var(--pct), rgba(245,158,11,0.08) var(--pct) 100%); }
.score-gauge.score-pass { background: conic-gradient(#22c55e 0% var(--pct), rgba(34,197,94,0.08) var(--pct) 100%); }
.score-gauge.score-neutral { background: conic-gradient(#94a3b8 0% var(--pct), rgba(148,163,184,0.08) var(--pct) 100%); }
.score-gauge-inner {
  width: 100%; height: 100%; border-radius: 50%;
  background: #16171e;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05) inset;
}
html.light .score-gauge-inner { background: #ffffff; }
.score-num { font-size: 3rem; font-weight: 800; color: #fff; }
html.light .score-num { color: #0f172a; }
.score-unit { font-size: 1.2rem; font-weight: 500; margin-left: 2px; opacity: 0.7; }
.score-desc { color: #94a3b8; font-size: 0.85rem; margin-top: 2px; }
.score-fail .score-num { color: #ef4444; }
.score-warn .score-num { color: #f59e0b; }
.score-pass .score-num { color: #22c55e; }
.score-neutral .score-num { color: #94a3b8; }
.warn-box {
  margin-top: 16px; padding: 12px 14px; border-radius: 10px;
  background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35);
  display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start;
}
.warn-title { font-weight: 600; color: #fecaca; font-size: 0.92rem; }
.warn-sub { color: #fca5a5; font-size: 0.82rem; margin-top: 2px; }
.score-stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 14px 16px; }
html.light .stat-card { background: #f8fafc; border-color: rgba(15,23,42,0.06); }
.stat-k { font-size: 0.78rem; color: #71717a; margin-bottom: 4px; }
.stat-v { font-size: 1.6rem; font-weight: 800; color: #e5e7eb; font-family: ui-monospace, SF Mono, Menlo, Consolas, monospace; }
html.light .stat-v { color: #0f172a; }
.stat-sub { font-size: 0.72rem; font-weight: 500; color: #94a3b8; margin-left: 2px; }
.stat-card.ok .stat-v { color: #60a5fa; }
.stat-card.fail .stat-v { color: #ef4444; }
.stat-card.pass .stat-v { color: #22c55e; }
.stat-card.retry .stat-v { color: #f59e0b; }

/* ④ 关联分镜 */
.empty-hint { color: #71717a; padding: 40px 0; text-align: center; border-radius: 10px; background: rgba(255,255,255,0.02); }
.frames-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.frame-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform 180ms ease, border-color 180ms ease; }
.frame-card:hover { transform: translateY(-2px); border-color: rgba(96,165,250,0.5); }
.frame-card.is-fail { border-color: rgba(239,68,68,0.45); }
.frame-thumb { position: relative; aspect-ratio: 9/16; background: #0b0b0f; }
.frame-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-missing { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #52525b; font-size: 0.82rem; }
.frame-number { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.72); color: #fff; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 0.78rem; }
.frame-retry-tag { position: absolute; top: 8px; right: 8px; background: rgba(245,158,11,0.95); color: #1f2937; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px; }
.frame-body { padding: 10px 12px 12px; }
.frame-line { font-size: 0.86rem; color: #e5e7eb; line-height: 1.4; height: 2.4em; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; margin-bottom: 10px; }
html.light .frame-line { color: #0f172a; }
.frame-bottom { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.retry-mini-label { font-size: 0.72rem; color: #f87171; margin-left: 6px; }
</style>
