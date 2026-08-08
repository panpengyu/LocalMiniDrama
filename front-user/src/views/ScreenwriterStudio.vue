<template>
  <div class="screenwriter-studio">
    <!-- 页头 -->
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="$router.back()">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">AI 编剧工作台</h2>
      </div>
      <p class="page-desc">输入一句话创意，AI 帮你生成大纲、角色、分集与分镜</p>
    </div>

    <div class="studio-layout">
      <!-- 左：输入面板 -->
      <div class="input-panel">
        <div class="panel-title">创意输入</div>

        <div class="form-section">
          <div class="form-label">一句话创意 <span class="required">*</span></div>
          <el-input
            v-model="idea"
            type="textarea"
            :rows="4"
            placeholder="例如：一个都市女总裁在婚礼当天被未婚夫抛弃，转身与神秘乞丐签下契约婚姻……"
          />
        </div>

        <div class="form-section">
          <div class="form-label">标题（可选）</div>
          <el-input v-model="title" placeholder="给这个故事起个名字" />
        </div>

        <div class="form-row">
          <div class="form-item">
            <div class="form-label">题材</div>
            <el-select v-model="genre" placeholder="选择题材" clearable>
              <el-option
                v-for="g in genres"
                :key="g.key || g"
                :label="g.labelZh || g.name || g"
                :value="g.key || g"
              />
            </el-select>
          </div>
          <div class="form-item">
            <div class="form-label">风格</div>
            <el-select v-model="style" placeholder="选择风格" clearable>
              <el-option
                v-for="s in styles"
                :key="s.key || s"
                :label="s.labelZh || s.name || s"
                :value="s.key || s"
              />
            </el-select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-item">
            <div class="form-label">结构</div>
            <el-select v-model="structure">
              <el-option label="三幕式" value="three_act" />
              <el-option label="英雄之旅" value="heros_journey" />
              <el-option label="起承转合" value="qi_cheng_zhuan_he" />
            </el-select>
          </div>
          <div class="form-item">
            <div class="form-label">分集数</div>
            <el-input-number
              v-model="episodeCount"
              :min="1"
              :max="100"
              controls-position="right"
              class="episode-count"
            />
          </div>
        </div>

        <el-button
          type="primary"
          :loading="generating"
          :disabled="!idea.trim()"
          class="action-btn"
          @click="onGenerateOutline"
        >
          {{ generating ? '生成中...' : '生成大纲' }}
        </el-button>
        <el-button
          :loading="creatingProject"
          :disabled="!outline"
          class="action-btn ghost"
          @click="onCreateProject"
        >
          一键创建项目
        </el-button>
      </div>

      <!-- 中：大纲可视化编辑器 -->
      <div class="outline-panel" v-loading="generating">
        <div class="panel-header">
          <span class="panel-title">大纲编辑</span>
          <div v-if="outline" class="panel-actions">
            <el-button size="small" type="primary" plain :loading="saving" @click="onSaveOutline">保存修改</el-button>
            <el-button size="small" :loading="generatingCharacters" @click="onGenerateCharacters">生成角色</el-button>
            <el-button size="small" :loading="generatingEpisodes" @click="onGenerateEpisodes">生成分集</el-button>
          </div>
        </div>

        <div v-if="!outline" class="empty-state">
          <el-icon class="empty-icon"><Document /></el-icon>
          <p>在左侧输入创意后，点击「生成大纲」</p>
        </div>

        <div v-else class="outline-content">
          <div class="outline-meta">
            <el-input v-model="outline.title" class="meta-title" placeholder="大纲标题" />
            <el-input
              v-model="outline.premise"
              type="textarea"
              :rows="2"
              placeholder="故事梗概"
            />
          </div>

          <div v-if="outlineActs.length === 0" class="empty-state small">
            <p>该结构暂无可视化分幕数据，可手动编辑后保存</p>
          </div>

          <div v-else class="acts-flow">
            <div v-for="(act, idx) in outlineActs" :key="idx" class="act-card">
              <div class="act-header">
                <el-tag type="success" effect="dark" round>第 {{ act.act_number || idx + 1 }} 幕</el-tag>
                <el-icon v-if="idx < outlineActs.length - 1" class="act-arrow"><Right /></el-icon>
              </div>
              <el-input v-model="act.title" placeholder="本幕标题" class="act-title-input" />
              <el-input
                v-model="act.summary"
                type="textarea"
                :rows="3"
                placeholder="本幕摘要"
              />
              <div class="key-events">
                <div class="events-label">
                  <span>关键事件</span>
                  <el-button size="small" text type="primary" @click="addEvent(act)">+ 添加</el-button>
                </div>
                <div
                  v-for="(_, ei) in act.key_events || []"
                  :key="ei"
                  class="event-item"
                >
                  <el-input v-model="act.key_events[ei]" size="small" placeholder="事件描述" />
                  <el-button size="small" text type="danger" @click="removeEvent(act, ei)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
                <div v-if="!act.key_events || act.key_events.length === 0" class="events-empty">
                  暂无关键事件
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：结果面板 -->
      <div class="result-panel">
        <el-tabs v-model="activeTab" class="result-tabs">
          <el-tab-pane label="角色档案" name="characters">
            <div v-if="characters.length === 0" class="empty-state small">
              <el-icon class="empty-icon"><User /></el-icon>
              <p>点击「生成角色」后显示</p>
            </div>
            <div v-else class="char-list">
              <el-card v-for="(c, i) in characters" :key="i" class="char-card" shadow="never">
                <div class="char-head">
                  <el-input v-model="c.name" class="char-name-input" placeholder="姓名" />
                  <el-tag v-if="c.role" size="small">{{ c.role }}</el-tag>
                </div>
                <div class="char-field">
                  <span class="field-label">外貌</span>
                  <el-input v-model="c.appearance" type="textarea" :rows="2" />
                </div>
                <div class="char-field">
                  <span class="field-label">性格</span>
                  <el-input v-model="c.personality" type="textarea" :rows="2" />
                </div>
              </el-card>
            </div>
          </el-tab-pane>

          <el-tab-pane label="分集剧情" name="episodes">
            <div v-if="episodes.length === 0" class="empty-state small">
              <el-icon class="empty-icon"><Film /></el-icon>
              <p>点击「生成分集」后显示</p>
            </div>
            <el-collapse v-else v-model="activeEpisodes" class="ep-collapse">
              <el-collapse-item
                v-for="ep in episodes"
                :key="ep.episodeId || ep.episodeNumber"
                :name="ep.episodeId || ep.episodeNumber"
              >
                <template #title>
                  <div class="ep-title">
                    <el-tag size="small" type="warning">第 {{ ep.episodeNumber }} 集</el-tag>
                    <span class="ep-name">{{ ep.title }}</span>
                  </div>
                </template>
                <div class="ep-body">
                  <div class="char-field">
                    <span class="field-label">摘要</span>
                    <el-input v-model="ep.summary" type="textarea" :rows="3" />
                  </div>
                  <div class="char-field">
                    <span class="field-label">悬念</span>
                    <el-input v-model="ep.cliffhanger" type="textarea" :rows="2" />
                  </div>
                  <el-button
                    size="small"
                    type="warning"
                    plain
                    :loading="regeneratingId === (ep.episodeId || ep.episodeNumber)"
                    @click="onRegenerateEpisode(ep)"
                  >
                    重新生成
                  </el-button>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-tab-pane>

          <el-tab-pane label="分镜脚本" name="frames">
            <div v-if="episodes.length > 0" class="frames-toolbar">
              <span class="field-label">选择分集</span>
              <el-select
                v-model="selectedEpisodeId"
                placeholder="选择分集"
                class="frames-select"
                @change="loadFrames"
              >
                <el-option
                  v-for="ep in episodes"
                  :key="ep.episodeId || ep.episodeNumber"
                  :label="`第 ${ep.episodeNumber} 集` + (ep.title ? ' · ' + ep.title : '')"
                  :value="ep.episodeId"
                />
              </el-select>
              <el-button
                size="small"
                type="primary"
                :disabled="!selectedEpisodeId"
                :loading="generatingFrames"
                @click="onGenerateStoryboard"
              >
                生成分镜
              </el-button>
            </div>

            <div v-if="frames.length === 0" class="empty-state small">
              <el-icon class="empty-icon"><Picture /></el-icon>
              <p>选择分集并生成后显示分镜</p>
            </div>
            <div v-else class="frame-list">
              <el-card v-for="(f, i) in frames" :key="i" class="frame-card" shadow="never">
                <div class="frame-head">
                  <el-tag size="small">镜头 {{ f.frameNumber || i + 1 }}</el-tag>
                  <el-tag v-if="f.shotType" size="small" type="info">{{ f.shotType }}</el-tag>
                </div>
                <div class="frame-desc">{{ f.visualDescription || f.description }}</div>
                <div v-if="f.dialogue" class="frame-dialogue">「{{ f.dialogue }}」</div>
              </el-card>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Document, Right, Delete, User, Film, Picture } from '@element-plus/icons-vue'
import { screenwriterAPI } from '@/api/screenwriter'

const router = useRouter()

// 输入
const idea = ref('')
const title = ref('')
const genre = ref('')
const style = ref('')
const structure = ref('three_act')
const episodeCount = ref(8)

// 字典
const genres = ref([])
const styles = ref([])

// 加载态
const generating = ref(false)
const saving = ref(false)
const creatingProject = ref(false)
const generatingCharacters = ref(false)
const generatingEpisodes = ref(false)
const generatingFrames = ref(false)
const regeneratingId = ref(null)

// 数据
const outline = ref(null)
const characters = ref([])
const episodes = ref([])
const frames = ref([])

// UI
const activeTab = ref('characters')
const activeEpisodes = ref([])
const selectedEpisodeId = ref(null)

// 大纲分幕（兼容 acts / act_list / structure 字段）
const outlineActs = computed(() => {
  const o = outline.value
  if (!o) return []
  if (Array.isArray(o.acts)) return o.acts
  if (Array.isArray(o.act_list)) return o.act_list
  if (Array.isArray(o.structure)) return o.structure
  return []
})

onMounted(async () => {
  try {
    const [gRes, sRes] = await Promise.all([
      screenwriterAPI.listGenres().catch(() => []),
      screenwriterAPI.listStyles().catch(() => []),
    ])
    genres.value = pickList(gRes, 'genres')
    styles.value = pickList(sRes, 'styles')
  } catch (_) {
    // 字典加载失败不阻塞页面
  }
})

/** 从多种可能的返回结构中提取数组 */
function pickList(res, field) {
  if (!res) return []
  // 同步接口返回 { mode, result: {...} }，先解包
  const inner = res.result !== undefined ? res.result : res
  if (Array.isArray(inner)) return inner
  if (field && Array.isArray(inner?.[field])) return inner[field]
  if (Array.isArray(inner?.items)) return inner.items
  if (Array.isArray(inner?.data)) return inner.data
  return []
}

function buildBody() {
  const body = { idea: idea.value.trim() }
  if (title.value.trim()) body.title = title.value.trim()
  if (genre.value) body.genre = genre.value
  if (style.value) body.style = style.value
  if (structure.value) body.structure = structure.value
  if (episodeCount.value) body.episode_count = episodeCount.value
  return body
}

function normalizeOutline(res) {
  if (!res) return null
  // 同步接口返回 { mode, jobId, jobType, result: {...outline } }
  const o = res.result || res.outline || res.data || res
  const acts = o.acts || o.act_list || o.structure || []
  return { ...o, acts: Array.isArray(acts) ? acts : [] }
}

async function onGenerateOutline() {
  if (!idea.value.trim()) return
  generating.value = true
  try {
    const res = await screenwriterAPI.generateOutlineSync(buildBody())
    outline.value = normalizeOutline(res)
    ElMessage.success('大纲生成成功')
  } catch (_) {
    // 错误已由请求拦截器统一提示
  } finally {
    generating.value = false
  }
}

async function onSaveOutline() {
  if (!outline.value?.outlineId) {
    ElMessage.warning('当前大纲缺少 ID，无法保存')
    return
  }
  saving.value = true
  try {
    await screenwriterAPI.updateOutline(outline.value.outlineId, {
      title: outline.value.title,
      premise: outline.value.premise,
      acts: outline.value.acts,
    })
    ElMessage.success('大纲已保存')
  } catch (_) {
  } finally {
    saving.value = false
  }
}

async function onGenerateCharacters() {
  if (!outline.value?.outlineId) {
    ElMessage.warning('请先生成大纲')
    return
  }
  generatingCharacters.value = true
  activeTab.value = 'characters'
  try {
    const res = await screenwriterAPI.generateCharactersSync({
      outline_id: outline.value.outlineId,
      ...buildBody(),
    })
    characters.value = pickList(res, 'characters')
    ElMessage.success(`已生成 ${characters.value.length} 个角色`)
  } catch (_) {
  } finally {
    generatingCharacters.value = false
  }
}

async function onGenerateEpisodes() {
  if (!outline.value?.outlineId) {
    ElMessage.warning('请先生成大纲')
    return
  }
  generatingEpisodes.value = true
  activeTab.value = 'episodes'
  try {
    const res = await screenwriterAPI.generateEpisodesSync({
      outline_id: outline.value.outlineId,
      ...buildBody(),
    })
    episodes.value = pickList(res, 'episodes')
    if (episodes.value.length > 0) {
      activeEpisodes.value = [episodes.value[0].episodeId || episodes.value[0].episodeNumber]
    }
    ElMessage.success(`已生成 ${episodes.value.length} 集`)
  } catch (_) {
  } finally {
    generatingEpisodes.value = false
  }
}

async function onRegenerateEpisode(ep) {
  if (!ep.episodeId) {
    ElMessage.warning('该分集缺少 ID，无法重新生成')
    return
  }
  regeneratingId.value = ep.episodeId
  try {
    const res = await screenwriterAPI.regenerateEpisode(ep.episodeId, {
      outline_id: outline.value?.outlineId,
      idea: idea.value,
    })
    const newEp = res?.episode || res?.result || res
    if (newEp) {
      const idx = episodes.value.findIndex((e) => e.episodeId === ep.episodeId)
      if (idx >= 0) episodes.value[idx] = { ...episodes.value[idx], ...newEp }
    }
    ElMessage.success('分集已重新生成')
  } catch (_) {
  } finally {
    regeneratingId.value = null
  }
}

async function loadFrames() {
  if (!selectedEpisodeId.value) {
    frames.value = []
    return
  }
  try {
    const res = await screenwriterAPI.listFrames(selectedEpisodeId.value)
    frames.value = pickList(res, 'frames')
  } catch (_) {
    frames.value = []
  }
}

async function onGenerateStoryboard() {
  if (!selectedEpisodeId.value) return
  generatingFrames.value = true
  try {
    await screenwriterAPI.generateStoryboardSync({
      episode_id: selectedEpisodeId.value,
      outline_id: outline.value?.outlineId,
    })
    await loadFrames()
    ElMessage.success('分镜已生成')
  } catch (_) {
  } finally {
    generatingFrames.value = false
  }
}

async function onCreateProject() {
  if (!outline.value?.outlineId) return
  creatingProject.value = true
  try {
    const res = await screenwriterAPI.createProject({
      outline_id: outline.value.outlineId,
      name: outline.value.title || title.value || undefined,
      title: title.value,
      genre: genre.value,
      style: style.value,
      structure: structure.value,
      episode_count: episodeCount.value,
    })
    ElMessage.success('项目已创建，即将跳转...')
    const projectId = res?.projectId || res?.dramaId
    if (projectId) {
      // 跳转到项目详情页
      setTimeout(() => router.push(`/drama/${projectId}`), 800)
    }
  } catch (_) {
  } finally {
    creatingProject.value = false
  }
}

function addEvent(act) {
  if (!Array.isArray(act.key_events)) act.key_events = []
  act.key_events.push('')
}

function removeEvent(act, idx) {
  act.key_events.splice(idx, 1)
}
</script>

<style scoped>
.screenwriter-studio {
  height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-header {
  margin-bottom: 16px;
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 0;
}
.page-desc {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}

.studio-layout {
  flex: 1;
  display: flex;
  gap: 16px;
  align-items: stretch;
  min-height: 0;
}

/* 三栏通用面板 */
.input-panel,
.outline-panel,
.result-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.input-panel { width: 320px; flex-shrink: 0; }
.outline-panel { flex: 1.3; min-width: 0; }
.result-panel { flex: 1; min-width: 0; }

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-bright);
  margin-bottom: 12px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-header .panel-title { margin-bottom: 0; }
.panel-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* 表单 */
.form-section { margin-bottom: 14px; }
.form-row { display: flex; gap: 10px; margin-bottom: 14px; }
.form-item { flex: 1; }
.form-item .el-select { width: 100%; }
.episode-count { width: 100%; }
.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.required { color: var(--el-color-danger, #ef4444); }

.action-btn {
  width: 100%;
  margin-top: 6px;
  margin-left: 0 !important;
}
.action-btn.ghost { margin-top: 8px; }

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-subtle);
  gap: 10px;
  min-height: 240px;
  text-align: center;
}
.empty-state.small { min-height: 160px; }
.empty-icon { font-size: 40px; }

/* 大纲 */
.outline-content { display: flex; flex-direction: column; gap: 14px; }
.outline-meta { display: flex; flex-direction: column; gap: 8px; }
.meta-title :deep(.el-input__inner) { font-weight: 600; font-size: 15px; }

.acts-flow {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.act-card {
  flex: 0 0 240px;
  background: var(--bg-inner);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.act-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.act-arrow { color: var(--text-subtle); margin-left: auto; }
.act-title-input :deep(.el-input__inner) { font-weight: 600; }

.key-events { display: flex; flex-direction: column; gap: 6px; }
.events-label {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.event-item { display: flex; gap: 4px; align-items: center; }
.events-empty { font-size: 12px; color: var(--text-faint); }

/* 结果面板 */
.result-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }

.char-list,
.frame-list { display: flex; flex-direction: column; gap: 10px; }

.char-card,
.frame-card {
  background-color: var(--bg-inner) !important;
  border-color: var(--border-color) !important;
  border-radius: 10px !important;
}
.char-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.char-name-input { flex: 1; }
.char-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.field-label { font-size: 12px; color: var(--text-muted); }

.ep-title { display: flex; align-items: center; gap: 8px; }
.ep-name { color: var(--text-bright); font-weight: 500; }
.ep-body { display: flex; flex-direction: column; gap: 10px; padding: 4px 4px 8px; }

.frames-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.frames-select { width: 200px; }
.frame-head { display: flex; gap: 6px; margin-bottom: 6px; }
.frame-desc { font-size: 13px; color: var(--text-primary); line-height: 1.6; }
.frame-dialogue {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-muted);
  font-style: italic;
}
</style>
