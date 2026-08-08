<template>
  <!-- S3-T04: 一站式工作台左侧项目导航树 -->
  <!-- el-tree 结构：项目 → 剧本 / 角色 / 场景 / 道具 / 分镜 / 音频 / 导出 -->
  <div class="pnav">
    <div class="pnav-head">
      <div class="pnav-title" :title="projectTitle">
        <el-icon><FolderOpened /></el-icon>
        <span class="pnav-title-text">{{ projectTitle || '未命名项目' }}</span>
      </div>
    </div>

    <div class="pnav-search">
      <el-input v-model="filterText" size="small" placeholder="搜索节点…" clearable>
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <div class="pnav-tree-shell">
      <el-scrollbar>
        <el-tree
          ref="treeRef"
          :data="treeData"
          node-key="key"
          :props="{ label: 'title', children: 'children' }"
          :default-expand-all="true"
          :expand-on-click-node="false"
          :filter-node-method="onFilter"
          :current-node-key="selectedKey"
          :highlight-current="true"
          class="pnav-tree"
          @node-click="onNodeClick"
        >
          <template #default="{ node, data }">
            <span class="pnav-node" :class="[ `type-${data.type}` ]">
              <span class="pnav-icon">
                <component :is="iconFor(data.type, data)" :size="14" />
              </span>
              <span class="pnav-label">{{ data.title }}</span>
              <el-tag
                v-if="data.count != null"
                size="small" effect="plain" type="info"
                class="pnav-count"
              >{{ data.count }}</el-tag>
              <el-button
                v-if="data.quickAdd"
                link type="primary" size="small" class="pnav-plus"
                @click.stop="onQuickAdd(data.type)"
              >
                <el-icon><Plus /></el-icon>
              </el-button>
            </span>
          </template>
        </el-tree>
      </el-scrollbar>
    </div>

    <div class="pnav-foot">
      <el-button size="small" type="primary" style="width:100%" @click="$emit('go-screenwriter')">
        <el-icon><MagicStick /></el-icon>
        AI 编剧助手
      </el-button>
      <el-button size="small" style="width:100%; margin-top:6px" @click="$emit('go-canvas')">
        <el-icon><Box /></el-icon>
        打开独立画布
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import {
  FolderOpened, Search, Plus, MagicStick, Box,
  Document, User, PictureFilled, Present, Film, Headset, Download,
} from '@element-plus/icons-vue'

const props = defineProps({
  projectTitle: { type: String, default: '' },
  script: { type: Object, default: null },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propsList: { type: Array, default: () => [] },
  storyboards: { type: Array, default: () => [] },
  audios: { type: Array, default: () => [] },
  episodes: { type: Array, default: () => [] },
  selectedKey: { type: String, default: 'script:root' },
})
const emit = defineEmits(['select', 'quick-add', 'go-screenwriter', 'go-canvas'])

const filterText = ref('')
const treeRef = ref(null)

const TYPES = {
  ROOT: 'root', SCRIPT: 'script',
  CHAR_GROUP: 'group:characters', CHAR: 'character',
  SCENE_GROUP: 'group:scenes', SCENE: 'scene',
  PROP_GROUP: 'group:props', PROP: 'prop',
  SB_GROUP: 'group:storyboards', EP: 'episode', SB: 'storyboard',
  AUDIO_GROUP: 'group:audios', AUDIO: 'audio',
  EXPORT_GROUP: 'group:export', EXPORT: 'export',
}

const treeData = computed(() => [
  // 1. 剧本
  {
    key: 'script:root', type: TYPES.SCRIPT, title: props.script?.title || '剧本',
    count: 1, quickAdd: false,
  },
  // 2. 角色
  {
    key: 'group:characters', type: TYPES.CHAR_GROUP, title: '角色',
    count: props.characters.length, quickAdd: true,
    children: props.characters.map((c) => ({
      key: `character:${c.id}`,
      type: TYPES.CHAR,
      title: c.name || '未命名角色',
      payload: c,
      extra: c.role ? `（${roleLabel(c.role)}）` : '',
    })),
  },
  // 3. 场景
  {
    key: 'group:scenes', type: TYPES.SCENE_GROUP, title: '场景',
    count: props.scenes.length, quickAdd: true,
    children: props.scenes.map((s) => ({
      key: `scene:${s.id}`,
      type: TYPES.SCENE,
      title: s.location || '未命名场景',
      payload: s,
      extra: s.time || '',
    })),
  },
  // 4. 道具
  {
    key: 'group:props', type: TYPES.PROP_GROUP, title: '道具',
    count: props.propsList.length, quickAdd: true,
    children: props.propsList.map((p) => ({
      key: `prop:${p.id}`,
      type: TYPES.PROP,
      title: p.name || '未命名道具',
      payload: p,
    })),
  },
  // 5. 分镜（按集分组）
  {
    key: 'group:storyboards', type: TYPES.SB_GROUP, title: '分镜',
    count: props.storyboards.length, quickAdd: true,
    children: (props.episodes.length ? props.episodes : [{ id: 'all', title: '全部分镜' }]).map((ep) => ({
      key: `episode:${ep.id}`,
      type: TYPES.EP,
      title: ep.title || (ep.episode_number ? `第 ${ep.episode_number} 集` : '全部集'),
      count: props.storyboards.filter((sb) => ep.id === 'all' || sb.episode_id === ep.id).length,
      children: props.storyboards
        .filter((sb) => ep.id === 'all' || sb.episode_id === ep.id)
        .map((sb) => ({
          key: `storyboard:${sb.id}`,
          type: TYPES.SB,
          title: `#${sb.storyboard_number || ''} ${(sb.action || '').slice(0, 14) || '分镜'}`,
          payload: sb,
        })),
    })),
  },
  // 6. 音频
  {
    key: 'group:audios', type: TYPES.AUDIO_GROUP, title: '音频',
    count: props.audios.length, quickAdd: false,
    children: props.audios.map((a) => ({
      key: `audio:${a.id}`,
      type: TYPES.AUDIO,
      title: a.name || a.title || `音频 ${a.id}`,
      payload: a,
    })),
  },
  // 7. 导出
  {
    key: 'group:export', type: TYPES.EXPORT_GROUP, title: '导出',
    children: [
      { key: 'export:pdf', type: TYPES.EXPORT, title: '导出剧本 PDF' },
      { key: 'export:json', type: TYPES.EXPORT, title: '导出项目 JSON（含分镜/角色）' },
      { key: 'export:video', type: TYPES.EXPORT, title: '一键导出成片视频' },
      { key: 'export:package', type: TYPES.EXPORT, title: '打包素材（图片+音频+字幕）' },
    ],
  },
])

watch(filterText, (v) => treeRef.value?.filter(v))
function onFilter(value, data) {
  if (!value) return true
  const kw = String(value).toLowerCase()
  return String(data.title || '').toLowerCase().includes(kw)
}

function onNodeClick(data) {
  emit('select', {
    type: data.type,
    key: data.key,
    payload: data.payload || null,
    title: data.title,
  })
}
function onQuickAdd(groupType) {
  emit('quick-add', { groupType })
}
function iconFor(type) {
  const map = {
    [TYPES.SCRIPT]: Document,
    [TYPES.CHAR_GROUP]: User,
    [TYPES.CHAR]: User,
    [TYPES.SCENE_GROUP]: PictureFilled,
    [TYPES.SCENE]: PictureFilled,
    [TYPES.PROP_GROUP]: Present,
    [TYPES.PROP]: Present,
    [TYPES.SB_GROUP]: Film,
    [TYPES.EP]: Document,
    [TYPES.SB]: Film,
    [TYPES.AUDIO_GROUP]: Headset,
    [TYPES.AUDIO]: Headset,
    [TYPES.EXPORT_GROUP]: Download,
    [TYPES.EXPORT]: Download,
  }
  return map[type] || FolderOpened
}
function roleLabel(role) {
  return { protagonist: '主角', antagonist: '反派', supporting: '配角', cameo: '客串', narrator: '旁白' }[role] || role
}
defineExpose({ setFilter: (v) => (filterText.value = v) })
</script>

<style scoped>
.pnav {
  height: 100%;
  display: flex; flex-direction: column;
  background: linear-gradient(180deg, #fafafa 0%, #fff 100%);
  border-right: 1px solid var(--el-border-color-lighter);
}
.pnav-head {
  padding: 10px 14px;
  background: linear-gradient(90deg, #4f46e5, #6366f1);
  color: #fff;
}
.pnav-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
.pnav-title-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}

.pnav-search { padding: 10px 10px 6px; }
.pnav-tree-shell { flex: 1; overflow: hidden; padding: 0 4px 6px; }
.pnav-tree { background: transparent; }
.pnav-tree :deep(.el-tree-node__content) { height: 30px; }
.pnav-tree :deep(.is-current > .el-tree-node__content) {
  background: rgba(99, 102, 241, .1);
  border-radius: 4px;
}

.pnav-node {
  display: flex; align-items: center; gap: 6px;
  width: 100%; font-size: 13px;
  overflow: hidden;
}
.pnav-icon { color: #6366f1; }
.pnav-node.type-character .pnav-icon { color: #e11d48; }
.pnav-node.type-scene .pnav-icon { color: #059669; }
.pnav-node.type-prop .pnav-icon { color: #d97706; }
.pnav-node.type-storyboard .pnav-icon, .pnav-node.type-episode .pnav-icon { color: #2563eb; }
.pnav-node.type-audio .pnav-icon { color: #7c3aed; }
.pnav-node.type-export .pnav-icon { color: #475569; }
.pnav-label {
  flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pnav-count { font-size: 11px; padding: 0 5px; height: 18px; line-height: 18px; }
.pnav-plus { opacity: 0; transition: opacity .15s; }
.pnav-node:hover .pnav-plus { opacity: 1; }

.pnav-foot { padding: 10px 12px 14px; border-top: 1px solid var(--el-border-color-lighter); background: #fff; }
</style>
