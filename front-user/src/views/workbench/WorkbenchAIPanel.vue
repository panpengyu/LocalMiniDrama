<template>
  <!-- S3-T06: 一站式创作工作台 — 右侧 AI 助手面板 -->
  <!-- 4 Tab: AI编剧 / AI分镜 / AI配音 / AI优化 + 生成队列进度 -->
  <div class="ai-panel">
    <div class="ai-panel-head">
      <div class="ai-panel-title">
        <el-icon><MagicStick /></el-icon>
        <span>AI 助手</span>
      </div>
      <el-button link type="primary" size="small" @click="$emit('collapse')">
        {{ collapsed ? '展开' : '收起' }}
      </el-button>
    </div>

    <el-tabs v-model="activeTab" class="ai-tabs" v-if="!collapsed">
      <!-- ============== Tab 1: AI编剧 ============== -->
      <el-tab-pane label="AI编剧" name="screenwriter">
        <div class="ai-body">
          <el-form size="default" label-position="top">
            <el-form-item label="一句话创意">
              <el-input v-model="promptIdea" type="textarea" :rows="3"
                placeholder="例：一名失忆的侦探在小镇醒来，发现自己与十年前的连环命案有着千丝万缕的联系…" />
            </el-form-item>
            <el-form-item label="创作模板">
              <el-select v-model="swTemplate" placeholder="选择剧本结构模板" style="width:100%">
                <el-option label="三幕式（开端/对抗/结局）" value="three_act" />
                <el-option label="起承转合" value="kikaku" />
                <el-option label="英雄之旅（12阶段）" value="hero_journey" />
                <el-option label="救猫咪节拍表" value="save_the_cat" />
              </el-select>
            </el-form-item>
            <div class="ai-sw-actions">
              <el-button type="primary" :loading="swBusy.outline" @click="onGenerate('outline')">
                <el-icon><Document /></el-icon>
                生成大纲
              </el-button>
              <el-button :loading="swBusy.characters" @click="onGenerate('characters')">
                <el-icon><UserFilled /></el-icon>
                生成角色
              </el-button>
              <el-button :loading="swBusy.episodes" @click="onGenerate('episodes')">
                <el-icon><Collection /></el-icon>
                拆分分集
              </el-button>
            </div>
            <div class="ai-quick-presets">
              <div class="ai-presets-title">快速预设</div>
              <div class="ai-preset-list">
                <el-tag
                  v-for="p in presetIdeas" :key="p"
                  class="ai-preset-tag" effect="plain" type="info" size="small"
                  @click="promptIdea = p"
                >{{ p }}</el-tag>
              </div>
            </div>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- ============== Tab 2: AI分镜 ============== -->
      <el-tab-pane label="AI分镜" name="storyboard">
        <div class="ai-body">
          <el-form size="default" label-position="top">
            <el-form-item label="剧本片段">
              <el-input v-model="sbScript" type="textarea" :rows="5"
                placeholder="粘贴剧本段落或选择画布上的剧本节点自动填充" />
            </el-form-item>
            <div class="ai-row">
              <el-form-item label="镜头风格" style="flex:1">
                <el-select v-model="sbStyle" placeholder="选风格">
                  <el-option label="电影感 2.35:1" value="cinematic_235" />
                  <el-option label="竖屏短剧 9:16" value="vertical_916" />
                  <el-option label="日式动漫感" value="anime_jp" />
                  <el-option label="悬疑低饱和" value="noir_mood" />
                </el-select>
              </el-form-item>
              <el-form-item label="分镜数" style="width:120px; margin-left:12px">
                <el-input-number v-model="sbCount" :min="1" :max="40" />
              </el-form-item>
            </div>
            <div class="ai-sw-actions">
              <el-button type="primary" :loading="sbBusy.generate" @click="onSBGenerate">
                <el-icon><Film /></el-icon>
                一键生成分镜脚本
              </el-button>
              <el-button :loading="sbBusy.polish" @click="onSBPolish">
                <el-icon><Wand /></el-icon>
                润色镜头提示词
              </el-button>
            </div>
            <!-- 生成的分镜列表 -->
            <div v-if="sbFrames.length" class="sb-frames-list">
              <div class="sb-frames-head">
                <span>分镜列表（{{ sbFrames.length }}）</span>
                <el-button link type="primary" size="small" @click="emit('generated', { kind: 'storyboard', frames: sbFrames, inject: true })">
                  注入画布
                </el-button>
              </div>
              <el-scrollbar max-height="320px">
                <div v-for="(f, idx) in sbFrames" :key="idx" class="sb-frame-card">
                  <div class="sb-frame-head">
                    <span class="sb-frame-num">#{{ f.frame_number }}</span>
                    <el-tag size="small" effect="plain">{{ f.shot_type_label || f.shot_type }}</el-tag>
                    <el-tag size="small" type="info" effect="plain">{{ f.emotion_label || f.emotion }}</el-tag>
                    <span class="sb-frame-dur">{{ f.duration }}</span>
                    <el-button link size="small" type="danger" @click="onFrameDelete(idx)">删除</el-button>
                  </div>
                  <el-input
                    v-model="f.visual_description"
                    type="textarea" :rows="2" size="small"
                    placeholder="视觉描述" @change="onFrameEdit(f, 'visual_description', f.visual_description)"
                  />
                  <el-input
                    v-model="f.prompt"
                    type="textarea" :rows="2" size="small"
                    placeholder="SD Prompt" @change="onFrameEdit(f, 'prompt', f.prompt)"
                    style="margin-top:4px"
                  />
                  <div class="sb-frame-meta">
                    <span>运镜：{{ f.camera_movement_label || f.camera_movement }}</span>
                    <span>构图：{{ f.composition_label || f.composition }}</span>
                    <span>转场：{{ f.transition_label || f.transition }}</span>
                  </div>
                </div>
              </el-scrollbar>
            </div>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- ============== Tab 3: AI配音 ============== -->
      <el-tab-pane label="AI配音" name="tts">
        <div class="ai-body">
          <el-form size="default" label-position="top">
            <el-form-item label="角色音色绑定">
              <div class="ai-voice-grid">
                <div v-for="c in characterList" :key="c.id" class="ai-voice-item">
                  <div class="ai-voice-cname">{{ c.name }}<span class="ai-voice-role">{{ c.role }}</span></div>
                  <el-select v-model="c.voice" placeholder="选择音色" size="small">
                    <el-option v-for="v in (ttsVoiceList.length ? ttsVoiceList : defaultVoices)" :key="v.id" :label="v.name" :value="v.id" />
                  </el-select>
                  <el-button link type="primary" size="small" @click="onVoiceBind(c)" style="margin-top:4px">绑定</el-button>
                </div>
                <div v-if="!characterList.length" class="ai-voice-empty">
                  本项目暂无角色，先到「AI编剧」生成角色。
                </div>
              </div>
            </el-form-item>
            <el-form-item label="批量 TTS 台词">
              <el-input v-model="ttsDialogue" type="textarea" :rows="4"
                placeholder="角色名:台词&#10;例：&#10;林深:这里到底发生过什么？&#10;苏暖:(低下头)我…我不想再提起。" />
            </el-form-item>
            <div class="ai-sw-actions">
              <el-button type="primary" :loading="ttsBusy.extract" @click="onTTSExtract">
                从分镜提取台词
              </el-button>
              <el-button :loading="ttsBusy.generate" @click="onTTSGenerate">
                <el-icon><Microphone /></el-icon>
                批量生成配音
              </el-button>
            </div>
            <!-- 配音结果列表 -->
            <div v-if="ttsResults.length" class="tts-results-list">
              <div class="tts-results-head">配音结果（{{ ttsResults.length }}）</div>
              <el-scrollbar max-height="240px">
                <div v-for="(r, idx) in ttsResults" :key="idx" class="tts-result-item" :class="r.status">
                  <div class="tts-r-head">
                    <el-tag size="small" :type="r.status === 'success' ? 'success' : 'danger'">{{ r.status === 'success' ? '成功' : '失败' }}</el-tag>
                    <span class="tts-r-char">{{ r.characterName }}</span>
                    <span class="tts-r-text">{{ r.text }}</span>
                  </div>
                  <audio v-if="r.audioPath" :src="'/static/' + r.audioPath" controls style="width:100%;height:28px" />
                  <div v-if="r.error" class="tts-r-err">{{ r.error }}</div>
                </div>
              </el-scrollbar>
            </div>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- ============== Tab 4: AI优化 ============== -->
      <el-tab-pane label="AI优化" name="optimize">
        <div class="ai-body">
          <div class="ai-opt-section">
            <div class="ai-opt-title">剧本优化</div>
            <div class="ai-opt-actions">
              <el-button size="small">节奏诊断与压缩</el-button>
              <el-button size="small">悬念点增强</el-button>
              <el-button size="small">对白口语化润色</el-button>
              <el-button size="small">高潮前置（黄金 3 秒）</el-button>
            </div>
          </div>
          <div class="ai-opt-section">
            <div class="ai-opt-title">角色优化</div>
            <div class="ai-opt-actions">
              <el-button size="small">补充人物弧光</el-button>
              <el-button size="small">强化对立矛盾</el-button>
              <el-button size="small">CP 情感线增强</el-button>
              <el-button size="small">反派动机合理化</el-button>
            </div>
          </div>
          <div class="ai-opt-section">
            <div class="ai-opt-title">画面优化</div>
            <div class="ai-opt-actions">
              <el-button size="small">全片风格统一化</el-button>
              <el-button size="small">镜头语言升级</el-button>
              <el-button size="small">光影氛围重写</el-button>
              <el-button size="small">构图多样性诊断</el-button>
            </div>
          </div>
          <div class="ai-opt-section">
            <div class="ai-opt-title">一致性修复</div>
            <div class="ai-opt-actions">
              <el-button type="warning" size="small">重新提取角色指纹</el-button>
              <el-button type="warning" size="small">一致性低于阈值的分镜重绘</el-button>
              <el-button size="small">连戏漏洞扫描</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- ============ 生成队列 & 进度 (Sprint 3 交付物要求) ============ -->
    <div v-if="!collapsed" class="ai-queue">
      <div class="ai-queue-head">
        <span class="ai-queue-title">
          <el-icon><Loading /></el-icon>
          生成队列
        </span>
        <el-tag size="small" type="primary">{{ runningCount }} 进行中</el-tag>
        <el-tag size="small" effect="plain">{{ queue.length }} 条</el-tag>
      </div>
      <el-scrollbar max-height="240px">
        <div class="ai-queue-list">
          <div v-if="queue.length === 0" class="ai-queue-empty">暂无任务，到上方 Tab 启动创作。</div>
          <div v-for="q in queue" :key="q.id" class="ai-queue-item" :class="q.status">
            <div class="ai-q-head">
              <el-tag size="small" :type="qTagType(q.status)" effect="dark">{{ qLabel(q.type) }}</el-tag>
              <span class="ai-q-title">{{ q.title }}</span>
              <el-button v-if="q.status === 'running'" link size="small" type="danger" @click="onCancel(q.id)">取消</el-button>
            </div>
            <el-progress
              v-if="q.status !== 'failed'"
              :percentage="q.progress"
              :status="q.status === 'success' ? 'success' : (q.status === 'failed' ? 'exception' : undefined)"
              :stroke-width="6"
            />
            <div v-if="q.status === 'failed'" class="ai-q-err">{{ q.error || '未知错误' }}</div>
            <div class="ai-q-foot">
              <span class="ai-q-time">{{ q.updatedAt }}</span>
              <span class="ai-q-progress">{{ q.progress }}%</span>
            </div>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { MagicStick, Document, UserFilled, Collection, Film, MagicStick as Wand, Microphone, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { screenwriterAPI } from '@/api/screenwriter'
import { storyboardAIAPI } from '@/api/storyboardAI'
import { ttsPipelineAPI } from '@/api/ttsPipeline'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const log = useWorkbenchLogger('WorkbenchAIPanel')

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null },
  characterList: { type: Array, default: () => [] },
  outlineId: { type: String, default: null },
})
const emit = defineEmits(['collapse', 'generated', 'queueUpdate'])

const activeTab = ref('screenwriter')
// ---- AI编剧 ----
const promptIdea = ref('')
const swTemplate = ref('three_act')
const swBusy = reactive({ outline: false, characters: false, episodes: false })
const presetIdeas = [
  '寒门学子救下落难千金，从报恩到相恋，跨越门第的爱情',
  '失忆侦探在边陲小镇重启人生，旧案的真相正在逼近',
  '外卖员穿越进剧本杀世界，必须用外卖员思维破解凶案才能回家',
  '女主整容归来，向毁掉她人生的继妹和未婚夫展开一场精密复仇',
]
// ---- AI分镜 ----
const sbScript = ref('')
const sbStyle = ref('vertical_916')
const sbCount = ref(8)
const sbBusy = reactive({ generate: false, polish: false })
const sbFrames = ref([])          // 生成的分镜列表
const sbEditingFrame = ref(null)   // 当前编辑的分镜
// ---- AI配音 ----
const ttsDialogue = ref('')
const ttsBusy = reactive({ extract: false, generate: false, bind: false })
const ttsVoiceList = ref([])       // 音色列表
const ttsEmotionList = ref([])     // 情感列表
const ttsResults = ref([])         // 配音生成结果
const ttsDialogues = ref([])       // 提取的台词列表
// ---- 生成队列 ----
const queue = ref([])
const runningCount = computed(() => queue.value.filter(q => q.status === 'running').length)

// 默认音色列表（API未返回时的兜底）
const defaultVoices = [
  { id: 'female_soft', name: '女声-温柔旁白' },
  { id: 'female_sweet', name: '女声-甜美白领' },
  { id: 'male_deep', name: '男声-沉稳男主' },
  { id: 'male_teen', name: '男声-年轻少年' },
  { id: 'male_villain', name: '反派-沙哑磁性' },
]

onMounted(() => {
  loadVoiceDicts()
})

// 记录任务启动时间（用于耗时统计）
const _taskStartMap = new Map()

async function onGenerate(kind, extra = {}) {
  const field = kind
  if (swBusy[field]) {
    log.warn('[AI] 重复点击拦截', { kind })
    return
  }
  swBusy[field] = true
  const qid = pushQueue(kind, `生成${kind === 'outline' ? '大纲' : kind === 'characters' ? '角色' : '分集'}…`)
  const end = log.startMeasure(`AI.gen.${kind}`)
  try {
    log.info('[AI] 启动生成任务', { kind, dramaId: Number(props.dramaId), extra, qid, len: promptIdea.value?.length || 0 })
    let result = null
    if (kind === 'outline') {
      const res = await screenwriterAPI.generateOutlineSync({ idea: promptIdea.value, template: swTemplate.value })
      result = res?.data
      ElMessage.success('大纲已生成')
      emit('generated', { kind: 'outline', data: result })
    } else if (kind === 'characters') {
      const res = await screenwriterAPI.generateCharactersSync({
        outline_id: extra?.outlineId,
        idea: promptIdea.value,
      })
      result = res?.data
      ElMessage.success('角色已生成')
      emit('generated', { kind: 'characters', data: result })
    } else {
      const res = await screenwriterAPI.generateEpisodesSync({ idea: promptIdea.value })
      result = res?.data
      ElMessage.success('分集已拆分')
      emit('generated', { kind: 'episodes', data: result })
    }
    const ms = end(true, { kind, qid, hasData: !!result })
    updateQueue(qid, 100, 'success')
    log.info('[AI] 生成成功', { kind, qid, totalMs: ms, dataKeys: result ? Object.keys(result).slice(0, 5) : [] })
  } catch (e) {
    end(false, { kind, qid, errMsg: e?.message })
    log.error('[AI] 生成失败', e, { kind, qid, dramaId: Number(props.dramaId) })
    updateQueue(qid, 0, 'failed', e?.message || '生成失败')
    ElMessage.error(e?.message || '生成失败')
  } finally {
    swBusy[field] = false
  }
}

async function onSBGenerate() {
  if (!sbScript.value.trim()) { log.warn('[SB] 空剧本片段'); return ElMessage.warning('请先粘贴剧本片段') }
  if (sbBusy.generate) { log.warn('[SB] 重复生成拦截'); return }
  sbBusy.generate = true
  const qid = pushQueue('storyboard', `生成分镜脚本 x${sbCount.value}`)
  const end = log.startMeasure('AI.gen.storyboard')
  try {
    log.info('[SB] 启动分镜生成', { dramaId: Number(props.dramaId), scriptLen: sbScript.value.length, count: sbCount.value, style: sbStyle.value, qid })
    updateQueue(qid, 30, 'running')
    const res = await storyboardAIAPI.generate({
      scriptText: sbScript.value,
      dramaId: Number(props.dramaId) || null,
      style: sbStyle.value,
      count: sbCount.value,
      characters: (props.characterList || []).map(c => ({ name: c.name })),
    })
    const data = res?.data || res
    sbFrames.value = data?.frames || []
    updateQueue(qid, 100, 'success')
    const ms = end(true, { qid, count: sbFrames.value.length })
    ElMessage.success(`已生成 ${sbFrames.value.length} 个分镜`)
    log.info('[SB] 分镜生成成功', { qid, totalMs: ms, count: sbFrames.value.length })
    emit('generated', { kind: 'storyboard', frames: sbFrames.value, generationId: data?.generationId })
  } catch (e) {
    end(false, { qid, errMsg: e?.message })
    log.error('[SB] 分镜生成失败', e, { qid })
    updateQueue(qid, 0, 'failed', e?.message)
    ElMessage.error(e?.message || '分镜生成失败')
  } finally {
    sbBusy.generate = false
  }
}

async function onSBPolish() {
  if (sbBusy.polish) return
  if (!sbFrames.value.length) return ElMessage.warning('请先生成分镜')
  sbBusy.polish = true
  const qid = pushQueue('storyboard', '润色镜头提示词')
  try {
    // 批量润色所有分镜的 prompt
    let polished = 0
    for (let i = 0; i < sbFrames.value.length; i++) {
      updateQueue(qid, Math.round(((i + 1) / sbFrames.value.length) * 100), 'running')
      try {
        const res = await storyboardAIAPI.polishPrompt({
          frame: sbFrames.value[i],
          style: sbStyle.value,
        })
        const prompt = res?.data?.prompt
        if (prompt) { sbFrames.value[i].prompt = prompt; polished++ }
      } catch (_) { /* 单帧失败跳过 */ }
    }
    updateQueue(qid, 100, 'success')
    ElMessage.success(`已润色 ${polished} 个分镜提示词`)
    log.info('[SB] 提示词润色完成', { polished })
    emit('generated', { kind: 'storyboard', frames: sbFrames.value, polished: true })
  } catch (e) {
    log.error('[SB] 润色失败', e)
    updateQueue(qid, 0, 'failed', e?.message)
    ElMessage.error(e?.message || '润色失败')
  } finally {
    sbBusy.polish = false
  }
}

// 编辑单个分镜字段
function onFrameEdit(frame, field, value) {
  frame[field] = value
  log.info('[SB] 分镜字段编辑', { frameNumber: frame.frame_number, field })
}

// 删除分镜
function onFrameDelete(index) {
  sbFrames.value.splice(index, 1)
  sbFrames.value.forEach((f, i) => { f.frame_number = i + 1 })
  log.info('[SB] 删除分镜', { index })
}

// ---- AI配音 ----
async function loadVoiceDicts() {
  try {
    const [vRes, eRes] = await Promise.all([
      ttsPipelineAPI.listVoices(),
      ttsPipelineAPI.listEmotions(),
    ])
    ttsVoiceList.value = vRes?.data?.items || []
    ttsEmotionList.value = eRes?.data?.items || []
  } catch (_) {}
}

async function onTTSExtract() {
  if (ttsBusy.extract) return
  if (!props.dramaId) return ElMessage.warning('请先选择项目')
  ttsBusy.extract = true
  const qid = pushQueue('tts', '提取分镜台词')
  try {
    const res = await ttsPipelineAPI.extractDialogues({ dramaId: Number(props.dramaId) })
    const items = res?.data?.items || []
    ttsDialogues.value = items
    // 填充到批量台词输入框
    ttsDialogue.value = items.map(i => `${i.characterName}:${i.text}`).join('\n')
    updateQueue(qid, 100, 'success')
    ElMessage.success(`已提取 ${items.length} 条台词`)
    log.info('[TTS] 台词提取成功', { count: items.length })
  } catch (e) {
    log.error('[TTS] 台词提取失败', e)
    updateQueue(qid, 0, 'failed', e?.message)
    ElMessage.error(e?.message || '台词提取失败')
  } finally {
    ttsBusy.extract = false
  }
}

async function onTTSGenerate() {
  if (ttsBusy.generate) return
  // 解析台词输入框
  const lines = ttsDialogue.value.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return ElMessage.warning('请先输入或提取台词')
  ttsBusy.generate = true
  const qid = pushQueue('tts', `批量配音 x${lines.length}`)
  try {
    const items = lines.map((line, i) => {
      const m = line.match(/^(.{1,20}?)[:：](.+)$/)
      return {
        characterName: m ? m[1].replace(/[（）()]/g, '').trim() : '旁白',
        text: m ? m[2].trim() : line,
        sortOrder: i,
      }
    })
    updateQueue(qid, 30, 'running')
    const res = await ttsPipelineAPI.batchSynthesize({
      dramaId: Number(props.dramaId) || null,
      items,
    })
    const data = res?.data || res
    ttsResults.value = data?.results || []
    updateQueue(qid, 100, 'success')
    ElMessage.success(`配音完成：成功${data?.success || 0}/${data?.total || 0}`)
    log.info('[TTS] 批量配音完成', { total: data?.total, success: data?.success, failed: data?.failed })
    emit('generated', { kind: 'tts', results: ttsResults.value })
  } catch (e) {
    log.error('[TTS] 批量配音失败', e)
    updateQueue(qid, 0, 'failed', e?.message)
    ElMessage.error(e?.message || '配音生成失败')
  } finally {
    ttsBusy.generate = false
  }
}

// 保存角色音色绑定
async function onVoiceBind(character) {
  try {
    await ttsPipelineAPI.bindVoice({
      dramaId: Number(props.dramaId),
      characterId: character.id,
      characterName: character.name,
      voiceId: character.voice || 'female_soft',
      emotion: character.emotion || 'neutral',
    })
    ElMessage.success(`${character.name} 音色已绑定`)
    log.info('[TTS] 音色绑定', { characterId: character.id, voice: character.voice })
  } catch (e) {
    ElMessage.error(e?.message || '绑定失败')
  }
}

// ---- 队列函数 ----
function pushQueue(type, title) {
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const item = {
    id, type, title,
    status: 'running', progress: 0,
    createdAt: nowStr(), updatedAt: nowStr(),
    error: null,
  }
  queue.value.unshift(item)
  _taskStartMap.set(id, { t: Date.now(), type })
  log.info('[Queue] 入队 → running', { qid: id, type, title, total: queue.value.length, running: runningCount.value })
  emit('queueUpdate', { queue: queue.value, runningCount: runningCount.value })
  return id
}
function updateQueue(id, progress, status, error = null) {
  const q = queue.value.find(x => x.id === id)
  if (!q) { log.warn('[Queue] update找不到任务', { qid: id }); return }
  q.progress = Math.max(0, Math.min(100, progress))
  q.status = status || q.status
  q.updatedAt = nowStr()
  if (error) q.error = error
  // 终态时输出耗时
  if (status === 'success' || status === 'failed') {
    const start = _taskStartMap.get(id)
    const dur = start ? Date.now() - start.t : null
    if (dur != null) log.info(`[Queue] ${status === 'success' ? '完成 ✓' : '失败 ✗'}`, {
      qid: id, type: q.type, progress: q.progress, durMs: dur, error: error || null,
    })
    _taskStartMap.delete(id)
  } else {
    log.debug('[Queue] 进度更新', { qid: id, type: q.type, progress: q.progress, status: q.status })
  }
  emit('queueUpdate', { queue: queue.value, runningCount: runningCount.value })
}
function onCancel(id) {
  log.warn('[Queue] 用户取消任务', { qid: id })
  updateQueue(id, 0, 'failed', '用户取消')
  ElMessage.info('已取消任务')
}
function nowStr() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
function qLabel(t) { return { outline: '大纲', characters: '角色', episodes: '分集', storyboard: '分镜', tts: '配音', image: '生图', video: '生视频' }[t] || t }
function qTagType(s) { return { running: 'primary', success: 'success', failed: 'danger', pending: 'info' }[s] || 'info' }
</script>

<style scoped>
.ai-panel {
  display: flex; flex-direction: column;
  height: 100%; background: #fff;
  border-left: 1px solid var(--el-border-color-lighter);
}
.ai-panel-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(90deg, #eef2ff, #ecfeff);
}
.ai-panel-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #4338ca; }
.ai-tabs { padding: 6px 4px 0; }
.ai-tabs :deep(.el-tabs__header) { margin: 0 4px; }
.ai-body { padding: 6px 12px 10px; }

.ai-row { display: flex; gap: 4px; align-items: flex-start; }
.ai-sw-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ai-quick-presets { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color-darker); }
.ai-presets-title { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.ai-preset-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ai-preset-tag { cursor: pointer; max-width: 100%; }

.ai-voice-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.ai-voice-item {
  border: 1px solid var(--el-border-color-lighter); padding: 8px; border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
.ai-voice-cname { font-size: 13px; margin-bottom: 6px; font-weight: 500; }
.ai-voice-role {
  font-size: 11px; font-weight: 400; color: var(--el-text-color-secondary);
  margin-left: 6px;
}
.ai-voice-empty { grid-column: 1 / -1; padding: 18px; text-align: center; color: var(--el-text-color-secondary); font-size: 12px; }

.ai-opt-section {
  padding: 10px 0; border-bottom: 1px dashed var(--el-border-color-darker);
}
.ai-opt-section:last-child { border-bottom: none; }
.ai-opt-title { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.ai-opt-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.ai-queue {
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  padding: 10px 12px 12px;
  margin-top: auto;
}
.ai-queue-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--el-text-color-primary);
  margin-bottom: 8px;
}
.ai-queue-title { display: flex; align-items: center; gap: 4px; }
.ai-queue-list { display: flex; flex-direction: column; gap: 8px; }
.ai-queue-empty { font-size: 12px; color: var(--el-text-color-secondary); text-align: center; padding: 10px; }
.ai-queue-item {
  background: #fff; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
}
.ai-queue-item.running { border-left: 3px solid #409eff; }
.ai-queue-item.success { border-left: 3px solid #67c23a; }
.ai-queue-item.failed { border-left: 3px solid #f56c6c; background: #fef2f2; }
.ai-q-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 6px; }
.ai-q-title { flex: 1; font-size: 12px; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-q-err { font-size: 12px; color: #dc2626; margin: 4px 0; }
.ai-q-foot { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--el-text-color-secondary); }

/* S4-T02: 分镜列表样式 */
.sb-frames-list { margin-top: 12px; border-top: 1px dashed var(--el-border-color-darker); padding-top: 10px; }
.sb-frames-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.sb-frame-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 8px; margin-bottom: 8px; background: var(--el-fill-color-lighter); }
.sb-frame-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.sb-frame-num { font-size: 13px; font-weight: 700; color: #4338ca; }
.sb-frame-dur { font-size: 11px; color: var(--el-text-color-secondary); margin-left: auto; }
.sb-frame-meta { display: flex; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--el-text-color-secondary); flex-wrap: wrap; }

/* S4-T04: 配音结果样式 */
.tts-results-list { margin-top: 12px; border-top: 1px dashed var(--el-border-color-darker); padding-top: 10px; }
.tts-results-head { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.tts-result-item { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 8px; margin-bottom: 8px; background: var(--el-fill-color-lighter); }
.tts-result-item.success { border-left: 3px solid #67c23a; }
.tts-result-item.failed { border-left: 3px solid #f56c6c; background: #fef2f2; }
.tts-r-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
.tts-r-char { font-size: 12px; font-weight: 600; color: #4338ca; }
.tts-r-text { font-size: 12px; color: var(--el-text-color-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tts-r-err { font-size: 11px; color: #dc2626; margin-top: 4px; }
</style>
