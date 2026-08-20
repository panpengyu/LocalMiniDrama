<template>
  <!--
    ImageGenerate.vue
    说明：本文件为图片生成页面的 Vue 单文件组件（SFC），包含三个主要部分：
      1. 左侧主面板（`.main-content`）：提示词输入、样例、参数和生成按钮等交互控件。
      2. 右侧结果面板（`.results-panel`）：展示生成历史、收藏、预览、下载等功能。
      3. 侧边浮层（`.model-floating-panel` / 风格词库 / 预览对话框）：用于模型选择、风格选择和大图预览。
    注：模板中使用了 Element Plus 的部分组件（如 `el-select`, `el-dialog`），脚本区实现了交互逻辑和数据模拟。
  -->
  <div class="image-generate-page">
    <div class="main-content" @click="handleMainContentClick">
      <!-- 标签栏：文生图/图生图切换 -->
      <div class="tabs-bar">
        <div :class="['tab-card', { active: activeTab === 'text2image' }]" @click="activeTab = 'text2image'">
          <div class="tab-title">文生图</div>
          <!-- 模型选择器：点击时先切换到当前标签页，再显示模型列表 -->
          <div class="tab-model" @click.stop="openModelSelector('text2image')">
            <span class="model-name">{{ text2imageModel.name }}</span>
            <span :class="['model-arrow', { expanded: showModelSelector && modelSelectorType === 'text2image' }]">▼</span>
          </div>
        </div>
        <div :class="['tab-card', { active: activeTab === 'image2image' }]" @click="activeTab = 'image2image'">
          <div class="tab-title">图生图</div>
          <!-- 模型选择器：点击时先切换到当前标签页，再显示模型列表 -->
          <div class="tab-model" @click.stop="openModelSelector('image2image')">
            <span class="model-name">{{ image2imageModel.name }}</span>
            <span :class="['model-arrow', { expanded: showModelSelector && modelSelectorType === 'image2image' }]">▼</span>
          </div>
        </div>
      </div>

      <div class="scroll-content">
        <div v-if="activeTab === 'image2image'" class="reference-section">
          <div class="ref-header">
            <span class="ref-label">请至少上传1张以上参考图（不限类型）</span>
            <span class="ref-count">+图片/{{ referenceImages.length }}/14</span>
          </div>
          <div class="ref-images">
            <div v-for="(img, index) in referenceImages" :key="index" class="ref-image-item">
              <img :src="img" class="ref-img" />
              <span class="ref-img-label">图片{{ index + 1 }}</span>
              <button class="ref-remove" @click.stop="removeReferenceImage(index)">×</button>
            </div>
            <div class="ref-upload" @click.stop="triggerUpload">
              <span class="upload-icon">+</span>
              <span class="upload-text">上传参考图</span>
            </div>
            <input type="file" ref="uploadInput" class="upload-input" accept="image/*" multiple @change="handleUpload" />
          </div>
        </div>

        <div class="prompt-section">
          <textarea 
            v-model="prompt" 
            class="prompt-input" 
            :placeholder="placeholderText" 
            rows="10"
          ></textarea>
          <div class="prompt-actions">
            <button class="action-btn" @click="prompt = ''; referenceImages = []">🗑️</button>
            <button class="action-btn" @click="showStyleLibrary = true">@</button>
            <button class="action-btn style-library-btn" @click="showStyleLibrary = true">风格词库</button>
            <div v-if="activeTab === 'image2image' && referenceImages.length > 0" class="ref-tags">
              <span 
                v-for="(_, index) in referenceImages" 
                :key="index" 
                class="ref-tag"
                @click="insertRefTag(index)"
              >@图片{{ index + 1 }}</span>
            </div>
          </div>
        </div>

        <div class="samples-section">
          <div class="section-label">样例:</div>
          <div class="samples-scroll">
            <div 
              v-for="sample in filteredSamples" 
              :key="sample.name" 
              class="sample-item"
              @click="selectSample(sample)"
              @mouseenter="hoveredSample = sample.name"
              @mouseleave="hoveredSample = null"
            >
              <img :src="sample.image" :alt="sample.name" class="sample-img" />
              <div v-if="hoveredSample === sample.name" class="sample-tooltip">{{ sample.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="footer-section">
        <div class="params-row">
          <div class="param-item">
            <el-select v-model="size" class="param-select">
              <el-option label="2K" value="2k" />
              <el-option label="4K" value="4k" />
              <el-option label="8K" value="8k" />
            </el-select>
          </div>
          <div class="param-item">
            <el-select v-model="ratio" class="param-select">
              <el-option label="1:1" value="1:1" />
              <el-option label="16:9" value="16:9" />
              <el-option label="9:16" value="9:16" />
              <el-option label="4:3" value="4:3" />
              <el-option label="3:4" value="3:4" />
            </el-select>
          </div>
        </div>
        <!-- 生成按钮：当前为前端模拟，点击后调用 `generate()` -->
        <button class="generate-btn" :loading="loading" @click="generate">
          <span class="btn-text">生成</span>
          <span class="btn-cost">(7积分)</span>
        </button>
      </div>
    </div>

    <!-- 模型选择浮层：贴紧 main-content 右侧，fixed 定位避免被 overflow 隐藏 -->
    <div v-if="showModelSelector" class="model-floating-panel" @click.stop>
      <div class="panel-header">
        <span class="panel-title">{{ modelSelectorType === 'text2image' ? '文生图' : '图生图' }}</span>
        <button class="panel-close" @click="showModelSelector = false">×</button>
      </div>
      <div class="panel-content">
        <div 
          v-for="model in currentModels" 
          :key="model.name" 
          :class="['model-item', { active: currentModel.name === model.name }]"
          @click="selectModel(model)"
        >
          <div class="model-icon-wrapper">
            <div :class="['model-icon', model.type]">
              <span>{{ model.name.charAt(0) }}</span>
            </div>
          </div>
          <div class="model-info">
            <div class="model-title">{{ model.name }}</div>
            <div class="model-desc">{{ model.desc }}</div>
            <div class="model-tags">
              <span v-for="tag in model.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="results-panel">
      <!-- 顶部分类标签栏 -->
      <div class="panel-header">
        <!-- 分类标签：全部/图像/视频/音乐 -->
        <div class="category-tabs">
          <button :class="['category-tab', { active: contentCategory === 'all' }]" @click="contentCategory = 'all'">全部</button>
          <button :class="['category-tab', { active: contentCategory === 'image' }]" @click="contentCategory = 'image'">图像</button>
          <button :class="['category-tab', { active: contentCategory === 'video' }]" @click="contentCategory = 'video'">视频</button>
          <button :class="['category-tab', { active: contentCategory === 'audio' }]" @click="contentCategory = 'audio'">音乐</button>
        </div>
        <!-- 右侧操作按钮 -->
        <div class="header-actions">
          <button class="action-btn" @click="clearAll">清空全部</button>
        </div>
      </div>

      <!-- 过滤后的结果列表 -->
      <div class="results-container" v-if="filteredResults.length > 0">
        <div v-for="(result, idx) in filteredResults" :key="result.id" class="result-card">
          <!-- 卡片头部：显示类型、模型、用户名、时间 -->
          <div class="card-header">
            <div class="card-title">
              <!-- <span class="card-index">#{{ result.id }}</span> -->
              <!-- 生成类型：文生图/图生图 -->
              <span class="card-type"><b>{{ result.type === 'text2image' ? '文生图' : '图生图' }} </b>｜ </span>
              <!-- 模型：markdown代码块风格 -->
              <span class="card-model">{{ result.model }}</span>
              <!-- 用户名：markdown代码块风格 -->
              <span class="card-user">{{ result.username || 'admin' }}</span>
              <!-- 时间 -->
              <span class="card-time">{{ result.time }}</span>
            </div>
          </div>
          <!-- 图片展示区域：渐变背景 + 图片浮层 -->
          <div class="card-image-wrap">
            <!-- 渐变背景层：始终显示 -->
            <div class="image-background"></div>
            <!-- 图片层：生成完成后显示，浮在背景上 -->
            <img 
              v-if="result.image && !result.loading" 
              :src="result.image" 
              :alt="'生成图片'" 
              class="card-image" 
              @click="previewImage(result.image)"
            />
            <!-- 加载中提示：生成过程中显示在渐变背景上 -->
            <div class="card-loading" v-if="result.loading">
              <el-icon class="loading-spinner"><Loading /></el-icon>
              <span>AI努力生成中...</span>
            </div>
          </div>
          <!-- 提示词展示区域 -->
          <div class="card-prompt">{{ result.prompt }}</div>
          <!-- 底部操作按钮区域 -->
          <div class="card-footer">
            <div class="footer-left">
              <button class="footer-btn" @click="downloadImage(result.image)">下载</button>
              <button class="footer-btn" @click="previewImage(result.image)">查看大图</button>
              <button class="footer-btn" @click="deleteResult(idx)">删除</button>
            </div>
            <div class="footer-right">
              <!-- 重新编辑：将当前图片的提示词、模型等恢复到左侧编辑区 -->
              <button class="footer-btn edit-btn" @click="reEdit(result)">重新编辑</button>
              <!-- 重新生成：基于当前图片的参数直接生成新图片 -->
              <button class="footer-btn regenerate-btn" @click="regenerate(result)">重新生成</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div class="empty-state" v-else>
        <div class="empty-icon">🖼️</div>
        <div class="empty-title">暂无{{ contentCategory === 'image' ? '图像' : contentCategory === 'video' ? '视频' : contentCategory === 'audio' ? '音乐' : '' }}生成记录</div>
        <div class="empty-desc">在左侧输入提示词，点击"生成"开始创作</div>
      </div>

      <!-- 右侧可滚动历史缩略图列表 -->
      <div class="history-sidebar">
        <div class="history-list">
          <div 
            v-for="(result, idx) in filteredResults" 
            :key="result.id" 
            :class="['history-item', { active: selectedResultId === result.id }]"
            @click="scrollToResult(idx)"
          >
            <img :src="result.image" :alt="'缩略图'" class="history-thumb" />
          </div>
        </div>
      </div>
    </div>

    <!-- 风格词库对话框 -->
    <el-dialog v-model="showStyleLibrary" width="600px" title="风格词库" :close-on-click-modal="true">
      <div class="style-library">
        <div class="library-categories">
          <button 
            v-for="cat in styleCategories" 
            :key="cat" 
            :class="['category-btn', { active: selectedCategory === cat }]"
            @click="selectedCategory = cat"
          >{{ cat }}</button>
        </div>
        <div class="library-content">
          <div 
            v-for="style in filteredStyles" 
            :key="style.name" 
            class="library-item"
            @click="addStyle(style)"
          >
            <img :src="style.image" :alt="style.name" class="library-img" />
            <div class="library-name">{{ style.name }}</div>
            <div class="library-tags">{{ style.tags }}</div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 大图预览对话框：纯图片居中显示，完全无边框无白边，关闭按钮浮动在右上角 -->
    <!-- 
      关键：通过内联 :style 对象 + !important 级别强制覆盖 Element Plus 默认样式，
      确保 背景透明 / 边框0 / 圆角0 / 阴影无 / padding0 等属性100%生效，
      解决 CSS 选择器优先级或加载顺序无法覆盖的问题。
    -->
    <el-dialog 
      v-model="showPreview" 
      :width="'auto'"
      :title="''"
      :close-on-click-modal="true"
      :show-close="false"
      :modal="true"
      :modal-class="'preview-modal'"
      :lock-scroll="true"
      :center="true"
      class="preview-dialog"
      custom-class="preview-dialog-custom"
      :style="dialogInlineStyle"
      ref="previewDialogRef"
    >
      <!-- 浮动关闭按钮 -->
      <button class="preview-close-btn" @click.stop="showPreview = false">×</button>
      <img :src="previewUrl" class="preview-full" alt="预览大图" />
    </el-dialog>


  </div>
</template>

<script setup>
/*
  脚本说明（中文注释）：
  - 使用 Composition API（`ref`, `computed`）管理局部状态。
  - 使用 Element Plus 的 `ElMessage` 显示提示。
  - 此处为演示/前端模拟逻辑，真实项目中图片生成应调用后端/AI 服务。
*/
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
// 演示/示例图片 URL 统一收敛到外部资源常量（见文件头部说明，部署时可整体替换为自有资源）
import { STYLE_IMAGES, SAMPLE_IMAGES, MOCK_GENERATED_IMAGES } from '@/constants/externalAssets'

// 获取当前登录用户
const userStore = useUserStore()
userStore.loadUser()

// --- 视图状态（选项卡 / 页签）
const activeTab = ref('text2image') // 当前左侧是“文生图”还是“图生图”
const resultTab = ref('history') // 结果面板当前子页（全部历史 / 我的收藏）

// --- 主交互数据
const prompt = ref('') // 用户输入的提示词
const size = ref('2k') // 目标分辨率（UI 选项）
const ratio = ref('16:9') // 宽高比
const loading = ref(false) // 生成按钮的 loading 状态
const results = ref([]) // 生成历史数组（本地内存模拟）

// --- 预览 / 弹窗控制
const showPreview = ref(false)
const previewUrl = ref('')
const showStyleLibrary = ref(false)
const selectedCategory = ref('全部')
const showModelSelector = ref(false)
const modelSelectorType = ref('text2image')
const hoveredSample = ref(null)
const uploadInput = ref(null)
const referenceImages = ref([])

// 内容分类标签：全部/图像/视频/音乐
const contentCategory = ref('all')

// 选中的结果ID，用于右侧历史列表高亮
const selectedResultId = ref(null)

// --- 模型列表（前端静态配置，用于模型选择浮层）
const text2imageModels = [
  { name: 'Seedream 4.5', type: 'seedream', desc: '中文原生精准文生，商业场景高效出图', tags: ['精准文字渲染', '商业审美', '标准化输出'] },
  { name: 'Seedream 5.0-lite', type: 'seedream', desc: '深度推理图，中文原生高清出图', tags: ['深度推理', '联网搜索', '中文友好'] },
  { name: 'GPT Image-2 臻享版', type: 'gpt', desc: '超强中文语义适配，全风格兼容能力', tags: ['全风格', '高清渲染', '细节优化'] },
  { name: 'GPT Image-2 折扣版', type: 'gpt', desc: '超强中文语义适配，全风格兼容能力', tags: ['全风格', '高清渲染', '细节优化'] },
  { name: 'Nano-banana2', type: 'nano', desc: '行业标准，全尺寸、多分辨率进阶选择', tags: ['4K', '全尺寸', '一致性领先'] },
  { name: '可灵v3-标准版', type: 'keling', desc: '均衡稳定、上手简单、日常全场景适配', tags: ['综合均衡无短板', '易上手低门槛'] },
  { name: '可灵v3-全能版', type: 'keling', desc: '可灵v3-全能型，无短板全能适配', tags: ['全模态全能型', '场景智能延展', '覆盖专业'] },
  { name: 'MJ v8.1', type: 'mj', desc: '电影级写实光影渲染，物体结构精准', tags: ['写实光影', '结构精准', '场景全能'] },
  { name: 'MJ v7', type: 'mj', desc: '经典通用写实基底，适配全题材', tags: ['通用百搭', '低门槛'] },
  { name: 'Wan2.7-极速版', type: 'wan', desc: '快、稳、够用、好看，灵感快速试探', tags: ['日常随手创作', '日常氛围感', '轻量化'] },
  { name: 'Wan2.6', type: 'wan', desc: '进阶版，全尺寸生成，多风格支持', tags: ['进阶版', '全尺寸', '多种生成能力'] },
  { name: 'Wan2.5', type: 'wan', desc: '基础版，全尺寸生成，多风格适配', tags: ['全尺寸', '多种生成能力', '中文友好'] },
]

const image2imageModels = [
  { name: 'Seedream 4.5', type: 'seedream', desc: '中文原生精准图生，商业场景高效出图', tags: ['精准文字渲染', '商业审美', '标准化输出'] },
  { name: 'Seedream 5.0-lite', type: 'seedream', desc: '深度推理图，中文原生高清出图', tags: ['深度推理', '联网搜索', '中文友好'] },
  { name: 'GPT Image-2 臻享版', type: 'gpt', desc: '超强中文语义适配，全风格兼容能力', tags: ['全风格', '高清渲染', '细节优化'] },
  { name: 'GPT Image-2 折扣版', type: 'gpt', desc: '超强中文语义适配，全风格兼容能力', tags: ['全风格', '高清渲染', '细节优化'] },
  { name: 'Nano-banana2', type: 'nano', desc: '行业标准，全尺寸、多分辨率进阶选择', tags: ['4K', '全尺寸', '一致性领先'] },
]

const text2imageModel = ref(text2imageModels[0])
const image2imageModel = ref(image2imageModels[0])

const currentModels = computed(() => {
  return activeTab.value === 'text2image' ? text2imageModels : image2imageModels
})

const currentModel = computed(() => {
  return activeTab.value === 'text2image' ? text2imageModel.value : image2imageModel.value
})

// 文本提示输入框占位说明
const placeholderText = '你可以在这里输入图片生成需求哦~比如:让角色与场景→「穿着未来科技服的少年站在悬浮列车旁，背景是星际港口，冷色调光影」，越具体(比如补充元素、风格、色词、构图)，生成的内容越贴合你的想象——点击查看 使用手册，学习更多AI操作技巧。'

// 风格词库相关
const styleCategories = ['全部', '人物', '场景', '风格', '光影', '色彩']

const styleLibrary = [
  { name: '写实人像', category: '人物', tags: '高清、细腻、真实感', image: STYLE_IMAGES['写实人像'] },
  { name: '动漫少女', category: '人物', tags: '二次元、可爱、萌系', image: STYLE_IMAGES['动漫少女'] },
  { name: '赛博朋克', category: '风格', tags: '未来感、霓虹灯、高科技', image: STYLE_IMAGES['赛博朋克'] },
  { name: '古风山水', category: '场景', tags: '中国风、水墨画、意境', image: STYLE_IMAGES['古风山水'] },
  { name: '科幻星球', category: '场景', tags: '宇宙、外星、科幻', image: STYLE_IMAGES['科幻星球'] },
  { name: '暖光温馨', category: '光影', tags: '暖色、温馨、柔和', image: STYLE_IMAGES['暖光温馨'] },
  { name: '冷色调', category: '色彩', tags: '蓝色、冷光、神秘', image: STYLE_IMAGES['冷色调'] },
  { name: '油画风格', category: '风格', tags: '艺术、油画、古典', image: STYLE_IMAGES['油画风格'] },
]

// 根据选中分类过滤风格库
const filteredStyles = computed(() => {
  if (selectedCategory.value === '全部') {
    return styleLibrary
  }
  return styleLibrary.filter(s => s.category === selectedCategory.value)
})

// UI 示例样例，用于一键填充提示词
const samples = [
  { name: '奇幻森林', prompt: '神秘的奇幻森林，发光的蘑菇，小精灵，魔法氛围', image: SAMPLE_IMAGES['奇幻森林'], models: ['Seedream 4.5', 'Seedream 5.0-lite'] },
  { name: '未来战士', prompt: '世界上最帅气的魔装机神风格武神·共工金属流体机甲设计草图，主色深红色，点缀色黄金色，流畅华丽，炫酷，有棱角，威武霸气，对称，夸张的装备，身形修长，装饰繁多，丰富细节，全身模型展示。红色海浪为基底，火神·共工字体运用到图纸上，包括对机甲各部分大量尺寸、解释性文本注释、英文设计说明，不同角度的零散截图增加了场景深度，每个细节都有展示，炫彩融合暗黑。暗黑美学，国风科幻，CG艺术，特写，压迫感。', image: SAMPLE_IMAGES['未来战士'], models: ['Seedream 4.5', 'GPT Image-2 臻享版'] },
  { name: '云端城堡', prompt: '漂浮在云端的城堡，梦幻天空，童话风格', image: SAMPLE_IMAGES['云端城堡'], models: ['Seedream 4.5', 'MJ v8.1'] },
  { name: '小满时节', prompt: '中国传统节气小满，田园风光，清新自然', image: SAMPLE_IMAGES['小满时节'], models: ['Seedream 4.5', 'Wan2.7-极速版'] },
  { name: '水墨山水', prompt: '中国水墨画风格，山水意境，留白艺术', image: SAMPLE_IMAGES['水墨山水'], models: ['Seedream 4.5', 'MJ v7'] },
  { name: '樱花少女', prompt: '樱花树下的少女，粉色浪漫，日系风格', image: SAMPLE_IMAGES['樱花少女'], models: ['Seedream 4.5', '可灵v3-标准版'] },
  { name: '星空夜景', prompt: '璀璨星空，银河，夜景，浪漫氛围', image: SAMPLE_IMAGES['星空夜景'], models: ['Seedream 4.5', 'Nano-banana2'] },
  { name: '猫咪', prompt: '水粉油画，朦胧感，插画，大师级别，弥散渐变，磨砂质感，毛茸茸的花猫在地上待着，周边是植被，叶子透过阳光温暖的洒在猫咪身上，毛发边缘透光，可爱', image: SAMPLE_IMAGES['猫咪'], models: ['Seedream 4.5', 'Seedream 5.0-lite', 'GPT Image-2 臻享版'] },
]

const filteredSamples = computed(() => {
  const currentModelName = currentModel.value.name
  return samples.filter(sample => !sample.models || sample.models.includes(currentModelName))
})

/**
 * 根据内容分类过滤结果列表
 * - all: 显示所有生成内容
 * - image: 仅显示文生图/图生图的图像
 * - video: 仅显示视频生成内容
 * - audio: 仅显示音乐生成内容
 */
const filteredResults = computed(() => {
  if (contentCategory.value === 'all') {
    return results.value
  }
  return results.value.filter(result => result.category === contentCategory.value)
})

// 本地 id 计数器，模拟生成记录 id
let resultIdCounter = Date.now()

function selectSample(sample) {
  prompt.value = sample.prompt
  if (activeTab.value === 'image2image') {
    referenceImages.value = [sample.image]
  }
}

function insertRefTag(index) {
  if (prompt.value) {
    prompt.value += ` @图片${index + 1}`
  } else {
    prompt.value = `@图片${index + 1}`
  }
}

/**
 * 打开模型选择器
 * 先切换到对应的标签页，再显示模型列表浮窗
 * 参数：type - 'text2image' 或 'image2image'
 */
function openModelSelector(type) {
  // 先切换到对应的标签页
  activeTab.value = type
  // 再打开模型选择器
  modelSelectorType.value = type
  showModelSelector.value = true
}

function triggerUpload() {
  uploadInput.value?.click()
}

function handleUpload(e) {
  const files = e.target.files
  if (files) {
    Array.from(files).forEach(file => {
      if (referenceImages.value.length < 14) {
        const reader = new FileReader()
        reader.onload = (e) => {
          referenceImages.value.push(e.target.result)
        }
        reader.readAsDataURL(file)
      }
    })
  }
  e.target.value = ''
}

/**
 * 滚动到指定结果卡片
 * 参数：index - 结果在过滤后列表中的索引
 */
function scrollToResult(index) {
  const resultCards = document.querySelectorAll('.result-card')
  if (resultCards[index]) {
    resultCards[index].scrollIntoView({ behavior: 'smooth', block: 'center' })
    selectedResultId.value = filteredResults.value[index].id
  }
}

function removeReferenceImage(index) {
  referenceImages.value.splice(index, 1)
}

/**
 * 将风格词追加到当前 prompt
 * 参数：style - 风格对象，包含 `tags` 字段（逗号分隔）
 */
function addStyle(style) {
  if (prompt.value) {
    prompt.value += `, ${style.tags}`
  } else {
    prompt.value = style.tags
  }
  showStyleLibrary.value = false
}

/**
 * 重新编辑功能
 * 将当前图片的提示词、模型等参数恢复到左侧编辑区域，方便用户修改后重新生成
 * 参数：result - 结果对象，包含 prompt、model 等信息
 */
function reEdit(result) {
  // 恢复提示词
  prompt.value = result.prompt
  
  // 根据模型名称判断是文生图还是图生图，并恢复对应的模型
  if (text2imageModels.some(m => m.name === result.model)) {
    activeTab.value = 'text2image'
    text2imageModel.value = text2imageModels.find(m => m.name === result.model) || text2imageModels[0]
    referenceImages.value = []
  } else {
    activeTab.value = 'image2image'
    image2imageModel.value = image2imageModels.find(m => m.name === result.model) || image2imageModels[0]
    // 如果是图生图，尝试从图片生成参考图（这里简化处理，暂不恢复参考图）
    referenceImages.value = []
  }
}

/**
 * 重新生成功能
 * 基于当前图片的参数（提示词、模型、尺寸、比例等）直接生成新图片
 * 参数：result - 结果对象，包含 prompt、model 等信息
 */
function regenerate(result) {
  // 先执行重新编辑，恢复参数
  reEdit(result)
  
  // 直接调用生成函数
  generate()
}

/**
 * 生成图片（模拟）
 * - 本函数为演示：会校验输入、把一条加载中的记录插入到 `results`，并在定时器完成后替换为 mock 图片。
 * - 生产环境应替换为调用后端 API 的异步请求并处理真实返回。
 */
function generate() {
  if (!prompt.value.trim()) {
    ElMessage.warning('请输入提示词')
    return
  }

  loading.value = true

  const newResults = [{
    id: ++resultIdCounter,
    image: '',
    prompt: prompt.value,
    model: currentModel.value.name,
    time: new Date().toLocaleString('zh-CN'),
    loading: true,
    favorite: false,
    // 分类类型：image(图像)、video(视频)、audio(音乐)
    category: 'image',
    // 生成类型：text2image(文生图)、image2image(图生图)
    type: activeTab.value,
    // 生成用户：从用户 store 获取实际登录用户名
    username: userStore.user?.username || userStore.user?.name || 'admin'
  }]

  // 将新的“生成中”记录插入历史顶部
  results.value = [...newResults, ...results.value]

  // 模拟异步生成（2s 后返回随机 mock 图片；mock 图片 URL 见 externalAssets.js）
  setTimeout(() => {
    const mockImages = MOCK_GENERATED_IMAGES

    results.value[0].image = mockImages[Math.floor(Math.random() * mockImages.length)]
    results.value[0].loading = false

    loading.value = false
    ElMessage.success('图片生成成功')
  }, 2000)
}

// 预览图片（弹窗展示）
function previewImage(url) {
  previewUrl.value = url
  showPreview.value = true
}

/**
 * 稳定哈希函数（djb2 算法），用于根据图片 URL 生成不变的短文件名前缀
 *  - 输入：URL 字符串
 *  - 输出：8 位 16 进制字符串（同一 URL 永远返回同一值）
 */
function stableUrlHash(str) {
  let h = 5381
  const len = str.length
  for (let i = 0; i < len; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i)
    h |= 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 根据 Content-Type 推断文件扩展名（兜底用，尽量与实际格式对齐）
 */
function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('bmp')) return 'bmp'
  if (ct.includes('svg')) return 'svg'
  return 'jpg'
}

/**
 * 可靠的图片下载函数（三层策略，确保不预览直接保存）
 *
 * 为什么原来的写法不行：
 *   当 href 指向跨域 URL 时，浏览器出于安全策略会忽略 <a download> 属性，
 *   直接导航到该 URL → 变成在浏览器中预览图片，而不是保存文件。
 *
 * 三层策略（按优先级）：
 *   1) 同源下载代理接口（推荐，最可靠）：
 *        请求本域 /api/v1/tools/download-proxy?url=...&filename=...
 *        后端通过 HTTP 拉取远端图片流，返回时显式设置
 *        Content-Disposition: attachment → 浏览器 100% 触发保存，绝不预览
 *   2) 前端 fetch + Blob（兜底，依赖远端返回正确的 CORS 头）：
 *        fetch(url) → 拿到 blob → 创建 blob: 同源 URL → <a download>
 *   3) 传统 <a download>（保底，仅对同源 URL 有效）：
 *        直接创建 a 标签触发下载。跨域时浏览器仍可能预览，但至少不会丢功能。
 *
 * 文件名稳定性：
 *   同一 URL 使用 djb2 哈希生成固定前缀，确保同一张图片多次下载文件名一致。
 *   扩展名优先从 URL 路径提取，否则默认 jpg；fetch-blob 兜底阶段会根据 Content-Type 再校正。
 */
function downloadImage(url) {
  if (!url) {
    ElMessage.warning('图片地址为空，无法下载')
    return
  }

  const urlHash = stableUrlHash(url)

  // 从 URL path 推导扩展名（如果 path 本身带扩展名则直接使用）
  let extFromUrl = 'jpg'
  let urlBasename = null
  try {
    const u = new URL(url, window.location.origin)
    const pathname = u.pathname || ''
    const base = pathname.substring(pathname.lastIndexOf('/') + 1)
    if (base) {
      const m = base.match(/\.(jpe?g|png|gif|webp|bmp|svg)$/i)
      if (m) {
        extFromUrl = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
        urlBasename = base
      }
    }
  } catch (_) {}

  // 稳定文件名：优先 URL path 的真实文件名，否则用固定哈希 + 扩展名
  const preferredFilename = urlBasename
    ? urlBasename
    : `image_${urlHash}.${extFromUrl}`

  // ================================================
  // 策略 1：同源代理下载（最可靠，100% 不预览，优先使用）
  // ================================================
  try {
    const proxyUrl = `/api/v1/tools/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(preferredFilename)}`

    const a = document.createElement('a')
    a.href = proxyUrl
    a.download = preferredFilename
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { try { document.body.removeChild(a) } catch(_) {} }, 100)
    ElMessage.success('开始下载图片...')
    return
  } catch (e) {
    console.warn('[downloadImage] 代理下载失败，降级到 fetch+Blob：', e)
  }

  // ================================================
  // 策略 2：fetch + Blob（兜底，依赖远端允许跨域）
  // ================================================
  ;(async function tryFetchBlob() {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' })
      if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status || 'unknown'}`)
      const blob = await resp.blob()

      // 根据真实 Content-Type 校正扩展名
      const correctedExt = extFromContentType(blob.type)
      const blobFilename = /image_([a-f0-9]+)\.(jpg|png|webp|gif|bmp|svg)$/i.test(preferredFilename)
        ? `image_${urlHash}.${correctedExt}`
        : preferredFilename

      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = blobFilename
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        try { document.body.removeChild(a) } catch(_) {}
        try { URL.revokeObjectURL(objectUrl) } catch(_) {}
      }, 1500)
      ElMessage.success('开始下载图片...')
      return
    } catch (err) {
      console.warn('[downloadImage] fetch+Blob 也失败，最终降级到传统 a 标签：', err)

      // ================================================
      // 策略 3：传统 <a download> 标签（保底方案）
      // ================================================
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = preferredFilename
        a.rel = 'noopener noreferrer'
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        setTimeout(() => { try { document.body.removeChild(a) } catch(_) {} }, 100)
        ElMessage.info('下载请求已发送，若打开了预览页，请右键图片→另存为')
      } catch (finalErr) {
        console.error('[downloadImage] 所有下载策略均失败：', finalErr)
        ElMessage.error('下载失败，请稍后重试，或手动右键图片另存为')
      }
    }
  })()
}

// 收藏切换
function toggleFavorite(idx) {
  results.value[idx].favorite = !results.value[idx].favorite
  ElMessage.success(results.value[idx].favorite ? '已收藏' : '已取消收藏')
}

// 删除单条记录
function deleteResult(idx) {
  results.value.splice(idx, 1)
  ElMessage.success('已删除')
}

// 清空所有记录
function clearAll() {
  results.value = []
  ElMessage.success('已清空全部记录')
}

function selectModel(model) {
  if (modelSelectorType.value === 'text2image') {
    text2imageModel.value = model
  } else {
    image2imageModel.value = model
  }
  showModelSelector.value = false
}

// 点击主区域时，若点击点不属于模型选择器，则关闭浮层（用于点击空白处收起）
function handleMainContentClick(e) {
  if (!e.target.closest('.tab-model')) {
    showModelSelector.value = false
  }
}

// 全局点击事件：点击模型选择器外部区域时关闭模型列表
function handleGlobalClick(e) {
  if (showModelSelector.value) {
    if (!e.target.closest('.model-floating-panel') && !e.target.closest('.tab-model')) {
      showModelSelector.value = false
    }
  }
}

// ============================================================
// 预览对话框：强制去除边框（内联 style 对象）
// Vue 的 style 绑定不直接支持 !important，这里使用 CSSStyleDeclaration
// 的 setProperty 形式，通过下面的 watch 在运行时注入到真实 DOM 上。
// ============================================================

// 预览对话框 ref
const previewDialogRef = ref(null)

// 内联 style 基础对象（对部分支持的属性先声明）
const dialogInlineStyle = {
  // Vue 会忽略带有 !important 的属性值，
  // 因此这里仅作为 fallback，真正的强制覆盖通过下面的 watch + DOM setProperty 完成
  backgroundColor: 'transparent',
  background: 'transparent',
  border: 'none',
  borderRadius: '0px',
  boxShadow: 'none',
  padding: '0px',
  margin: '0px',
  outline: 'none'
}

/**
 * 强制对预览对话框及遮罩层注入最高优先级的 inline 样式（带 !important）
 * 这是唯一能 100% 覆盖 Element Plus 默认样式的方案
 */
function forceApplyPreviewDialogStyles() {
  // 给浏览器一帧渲染时间，等 dialog DOM 出现
  nextTick(() => {
    setTimeout(() => {
      // 1. 处理 el-dialog 主容器
      const dialogEl = document.querySelector('.el-dialog.preview-dialog') || 
                       document.querySelector('.el-dialog.preview-dialog-custom')
      if (dialogEl) {
        const props = [
          ['background-color', 'transparent'],
          ['background', 'transparent'],
          ['background-image', 'none'],
          ['border', '0'],
          ['border-style', 'none'],
          ['border-radius', '0px'],
          ['border-top-left-radius', '0px'],
          ['border-top-right-radius', '0px'],
          ['border-bottom-left-radius', '0px'],
          ['border-bottom-right-radius', '0px'],
          ['box-shadow', 'none'],
          ['-webkit-box-shadow', 'none'],
          ['outline', '0'],
          ['padding', '0px'],
          ['padding-top', '0px'],
          ['padding-bottom', '0px'],
          ['padding-left', '0px'],
          ['padding-right', '0px'],
          ['margin', '0px'],
          ['margin-top', '0px'],
          ['margin-bottom', '0px'],
          ['margin-left', '0px'],
          ['margin-right', '0px'],
          ['overflow', 'visible']
        ]
        props.forEach(([p, v]) => dialogEl.style.setProperty(p, v, 'important'))
      }

      // 2. 处理遮罩层 overlay - 必须全屏 100vw x 100vh
      const overlayEl = document.querySelector('.el-overlay.preview-modal') || 
                        document.querySelector('.el-modal-dialog.preview-modal')
      if (overlayEl) {
        const overlayProps = [
          ['background-color', 'rgba(0, 0, 0, 0.95)'],
          ['background', 'rgba(0, 0, 0, 0.95)'],
          ['backdrop-filter', 'none'],
          ['-webkit-backdrop-filter', 'none'],
          ['position', 'fixed'],
          ['top', '0px'],
          ['left', '0px'],
          ['right', '0px'],
          ['bottom', '0px'],
          ['width', '100vw'],
          ['height', '100vh'],
          ['z-index', '20000'],
          ['overflow', 'hidden'],
          ['padding', '0px'],
          ['margin', '0px'],
          ['border', '0']
        ]
        overlayProps.forEach(([p, v]) => overlayEl.style.setProperty(p, v, 'important'))
      }

      // 3. 处理 overlay-dialog 居中容器 - 也必须全屏
      const overlayDialogEl = document.querySelector('.el-overlay.preview-modal > .el-overlay-dialog') || 
                               document.querySelector('.el-modal-dialog.preview-modal > .el-overlay-dialog')
      if (overlayDialogEl) {
        const odProps = [
          ['position', 'fixed'],
          ['top', '0px'],
          ['left', '0px'],
          ['right', '0px'],
          ['bottom', '0px'],
          ['width', '100vw'],
          ['height', '100vh'],
          ['display', 'flex'],
          ['align-items', 'center'],
          ['justify-content', 'center'],
          ['padding', '0px'],
          ['margin', '0px'],
          ['background', 'transparent'],
          ['background-color', 'transparent'],
          ['overflow', 'hidden'],
          ['border', '0']
        ]
        odProps.forEach(([p, v]) => overlayDialogEl.style.setProperty(p, v, 'important'))
      }

      // 4. 处理 dialog body
      const bodyEl = document.querySelector('.el-dialog.preview-dialog .el-dialog__body') ||
                     document.querySelector('.el-dialog.preview-dialog-custom .el-dialog__body')
      if (bodyEl) {
        const bodyProps = [
          ['background-color', 'transparent'],
          ['background', 'transparent'],
          ['border', '0'],
          ['border-radius', '0px'],
          ['padding', '0px'],
          ['margin', '0px'],
          ['line-height', '0px'],
          ['font-size', '0px'],
          ['overflow', 'visible']
        ]
        bodyProps.forEach(([p, v]) => bodyEl.style.setProperty(p, v, 'important'))
      }

      // 5. 隐藏 header
      const headerEl = document.querySelector('.el-dialog.preview-dialog .el-dialog__header') ||
                       document.querySelector('.el-dialog.preview-dialog-custom .el-dialog__header')
      if (headerEl) {
        headerEl.style.setProperty('display', 'none', 'important')
        headerEl.style.setProperty('visibility', 'hidden', 'important')
        headerEl.style.setProperty('opacity', '0', 'important')
        headerEl.style.setProperty('width', '0px', 'important')
        headerEl.style.setProperty('height', '0px', 'important')
        headerEl.style.setProperty('padding', '0px', 'important')
        headerEl.style.setProperty('margin', '0px', 'important')
        headerEl.style.setProperty('border', '0', 'important')
        headerEl.style.setProperty('overflow', 'hidden', 'important')
      }
    }, 0)
  })
}

// 监听 showPreview 状态变化，打开时强制注入样式
watch(showPreview, (val) => {
  if (val === true) {
    // 打开瞬间先执行一次
    forceApplyPreviewDialogStyles()
    // 再延迟执行两次，确保 Element Plus 内部动态设置样式后仍能被我们覆盖
    setTimeout(forceApplyPreviewDialogStyles, 50)
    setTimeout(forceApplyPreviewDialogStyles, 200)
  }
})

// 挂载时添加全局点击监听
onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})
</script>

<style scoped>
.image-generate-page {
  display: flex;
  height: 100vh;
  background: #0a0a0f;
  color: #fff;
}

.main-content {
  width: 25%;
  padding: 0;
  overflow-y: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  position: relative;
}

.tabs-bar {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.tab-card {
  flex: 1;
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.tab-card.active {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-color: transparent;
}

.tab-title {
  font-size: 16px;
  font-weight: 600;
}

.tab-model {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
}

.tab-card.active .tab-model {
  color: rgba(255, 255, 255, 0.9);
}

.tab-model {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.tab-model:hover {
  background: rgba(255, 255, 255, 0.1);
}

.model-name {
  font-size: 12px;
}

.model-arrow {
  font-size: 10px;
  opacity: 0.6;
  transition: transform 0.2s;
}

.model-arrow.expanded {
  transform: rotate(180deg);
}

.tab-menu-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 16px;
  cursor: pointer;
}

.reference-section {
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.ref-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.ref-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.ref-count {
  font-size: 12px;
  color: #3b82f6;
}

.ref-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ref-image-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 6px;
  overflow: hidden;
}

.ref-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ref-img-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 6px;
  font-size: 10px;
  color: #fff;
}

.ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ref-upload {
  width: 80px;
  height: 80px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.ref-upload:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.upload-icon {
  font-size: 24px;
  color: rgba(255, 255, 255, 0.4);
}

.upload-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 4px;
}

.upload-input {
  display: none;
}

.ref-tags {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.ref-tag {
  padding: 4px 8px;
  background: rgba(139, 92, 246, 0.2);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 4px;
  font-size: 12px;
  color: #a78bfa;
  cursor: pointer;
  transition: all 0.2s;
}

.ref-tag:hover {
  background: rgba(139, 92, 246, 0.3);
}

.scroll-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.prompt-section {
  margin-bottom: 24px;
}

.prompt-help {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.8;
  margin-bottom: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.help-link {
  color: #3b82f6;
  cursor: pointer;
}

.prompt-input {
  width: 100%;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
  resize: none;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.prompt-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.prompt-input:focus {
  border-color: #3b82f6;
}

.prompt-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.style-library-btn {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: #3b82f6;
}

.samples-section {
  margin-bottom: 24px;
}

.section-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 12px;
}

.samples-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.samples-scroll::-webkit-scrollbar {
  display: none;
}

.sample-item {
  flex-shrink: 0;
  width: calc((100% - 48px) / 7);
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  transition: transform 0.2s;
  position: relative;
}

.sample-item:hover {
  transform: scale(1.1);
}

.sample-img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.sample-tooltip {
  position: absolute;
  bottom: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: #fff;
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
}

.footer-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
  background: #0a0a0f;
}

.params-row {
  display: flex;
  gap: 12px;
}

.param-item {
  width: 100px;
}

.param-select {
  width: 100%;
}

/* 参数选择器样式 */
.param-select :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
}

.param-select :deep(.el-select__wrapper:hover) {
  border-color: rgba(255, 255, 255, 0.2);
}

/* 下拉选择器文字颜色 */
.param-select :deep(.el-select__placeholder) {
  color: rgba(255, 255, 255, 0.6);
}

.param-select :deep(.el-select__value) {
  color: rgba(255, 255, 255, 0.9);
}

.param-select :deep(.el-select__icon) {
  color: rgba(255, 255, 255, 0.5);
}

.generate-btn {
  padding: 14px 32px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s;
  box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
}

.btn-cost {
  font-size: 14px;
  font-weight: 400;
  opacity: 0.8;
}

/* 结果面板：自适应剩余空间，留出右侧历史侧边栏的位置 */
.results-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  padding-right: 80px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

/* 分类标签栏 */
.category-tabs {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px;
}

/* 分类标签按钮 */
.category-tab {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.category-tab.active {
  background: rgba(59, 130, 246, 0.3);
  color: #fff;
}

/* 右侧历史缩略图侧边栏 */
.history-sidebar {
  position: fixed;
  right: 0;
  top: 60px;
  bottom: 0;
  width: 64px;
  background: transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 100;
  padding-right: 8px;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  width: 52px;
  height: 52px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
  opacity: 0.6;
}

.history-item:hover {
  opacity: 1;
}

.history-item.active {
  border-color: #3b82f6;
  opacity: 1;
}

.history-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.results-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.result-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  overflow: hidden;
}

/* 卡片头部 */
.card-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

/* 卡片标题区域 */
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 卡片ID */
.card-index {
  font-size: 14px;
  font-weight: 600;
  color: #3b82f6;
}

/* 生成类型：文生图/图生图 */
.card-type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

/* 模型：markdown代码块风格 */
.card-model {
  font-size: 11px;
  color: #e5e7eb;
  padding: 2px 8px;
  background: rgba(55, 65, 81, 0.8);
  border-radius: 3px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
}

/* 用户名：markdown代码块风格 */
.card-user {
  font-size: 11px;
  color: #d1d5db;
  padding: 2px 8px;
  background: rgba(55, 65, 81, 0.8);
  border-radius: 3px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
}

/* 时间 */
.card-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-left: auto;
}

/* 图片容器：固定高度 */
.card-image-wrap {
  position: relative;
  height: 280px;
  overflow: hidden;
}

/* 渐变背景层：生成过程中显示炫酷渐变 */
.image-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: 
    linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(59, 130, 246, 0.2) 30%, rgba(34, 197, 94, 0.2) 60%, rgba(14, 165, 233, 0.3) 100%),
    radial-gradient(circle at 30% 50%, rgba(139, 92, 246, 0.2) 0%, transparent 50%),
    radial-gradient(circle at 70% 50%, rgba(59, 130, 246, 0.15) 0%, transparent 50%);
  opacity: 1;
  z-index: 1;
}

/* 图片层：生成完成后浮在背景上 */
.card-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 2;
}

.card-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  z-index: 3;
}

.loading-spinner {
  font-size: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 提示词区域：减少padding */
.card-prompt {
  padding: 8px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

/* 卡片底部操作区域：减少padding */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

/* 左侧操作按钮组 */
.footer-left {
  display: flex;
  gap: 8px;
}

/* 右侧操作按钮组 */
.footer-right {
  display: flex;
  gap: 8px;
}

/* 底部按钮基础样式 */
.footer-btn {
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

/* 重新编辑按钮样式 */
.footer-btn.edit-btn {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}

.footer-btn.edit-btn:hover {
  background: rgba(139, 92, 246, 0.25);
}

/* 重新生成按钮样式 */
.footer-btn.regenerate-btn {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.footer-btn.regenerate-btn:hover {
  background: rgba(59, 130, 246, 0.25);
}

.footer-btn:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.4);
  color: #fff;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: rgba(255, 255, 255, 0.3);
}

.empty-icon {
  font-size: 80px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
}

.empty-desc {
  font-size: 14px;
}

.style-library {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.library-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-btn {
  padding: 6px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.category-btn.active {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  color: #fff;
}

.library-content {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.library-item {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
}

.library-item:hover {
  border-color: rgba(59, 130, 246, 0.3);
  transform: translateY(-2px);
}

.library-img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.library-name {
  font-size: 13px;
  color: #fff;
  padding: 8px;
  font-weight: 500;
}

.library-tags {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 8px 8px;
}

/* ============================================================
   大图预览对话框：完全无边框纯图片展示
   覆盖 Element Plus Dialog 的所有层级默认样式
   ============================================================ */

/* 第1层：遮罩层 - 确保纯深色背景无边框感 */
.preview-dialog :deep(.el-overlay),
.preview-dialog :deep(.el-overlay-dialog) {
  background: rgba(0, 0, 0, 0.95) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* 第2层：wrapper容器 - flex垂直水平居中，无边距 */
.preview-dialog :deep(.el-dialog__wrapper) {
  background: rgba(0, 0, 0, 0.95) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}

/* 第3层：dialog主容器 - 核心：清除所有边框/圆角/阴影/背景变量 */
.preview-dialog :deep(.el-dialog) {
  /* 覆盖Element Plus的所有CSS变量，从根源去除边框 */
  --el-dialog-border-radius: 0px !important;
  --el-dialog-box-shadow: none !important;
  --el-dialog-margin-top: 0 !important;
  --el-dialog-padding-primary: 0px !important;
  --el-dialog-header-border-bottom: none !important;
  --el-dialog-footer-border-top: none !important;
  --el-bg-color: transparent !important;
  --el-fill-color-blank: transparent !important;

  /* 强制覆盖所有计算样式属性 */
  background: transparent !important;
  background-color: transparent !important;
  border: 0 !important;
  border-style: none !important;
  border-width: 0 !important;
  border-color: transparent !important;
  border-top: 0 !important;
  border-right: 0 !important;
  border-bottom: 0 !important;
  border-left: 0 !important;
  border-radius: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  outline: 0 !important;
  outline-style: none !important;
  outline-width: 0 !important;
  outline-color: transparent !important;

  margin: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;

  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;

  width: auto !important;
  height: auto !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  min-height: auto !important;

  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
  position: relative !important;
}

/* 伪元素：防止::before或::after叠加形成边框 */
.preview-dialog :deep(.el-dialog::before),
.preview-dialog :deep(.el-dialog::after) {
  display: none !important;
  content: none !important;
  border: 0 !important;
  background: transparent !important;
}

/* 第4层：header - 彻底隐藏不占位 */
.preview-dialog :deep(.el-dialog__header) {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-bottom: 0 !important;
  overflow: hidden !important;
  position: absolute !important;
  top: -9999px !important;
  left: -9999px !important;
}

.preview-dialog :deep(.el-dialog__header::before),
.preview-dialog :deep(.el-dialog__header::after) {
  display: none !important;
  content: none !important;
}

/* 第5层：body内容区 - 纯透明无边距无内边距 */
.preview-dialog :deep(.el-dialog__body) {
  background: transparent !important;
  background-color: transparent !important;
  border: 0 !important;
  border-style: none !important;
  border-top: 0 !important;
  border-bottom: 0 !important;
  border-left: 0 !important;
  border-right: 0 !important;
  border-color: transparent !important;
  border-radius: 0 !important;
  padding: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  box-shadow: none !important;
  outline: 0 !important;
}

.preview-dialog :deep(.el-dialog__body::before),
.preview-dialog :deep(.el-dialog__body::after) {
  display: none !important;
  content: none !important;
  border: 0 !important;
  background: transparent !important;
}

/* 第6层：footer - 彻底隐藏不占位 */
.preview-dialog :deep(.el-dialog__footer) {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
  position: absolute !important;
  top: -9999px !important;
  left: -9999px !important;
}

/* 预览大图：纯图片自适应，不添加任何额外容器边框 */
.preview-full {
  display: block !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain !important;
  margin: 0 auto !important;
  border: 0 !important;
  border-radius: 0 !important;
  padding: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  line-height: 0 !important;
  vertical-align: middle !important;
}

/* 浮动关闭按钮：参考图2效果，宽高44px、圆角50%、深色半透明背景 */
.preview-close-btn {
  position: fixed !important;
  top: 20px !important;
  right: 20px !important;
  width: 44px !important;
  height: 44px !important;
  border-radius: 50% !important;
  background: rgba(0, 0, 0, 0.6) !important;
  border: 0 !important;
  border-style: none !important;
  outline: 0 !important;
  box-shadow: none !important;
  color: #ffffff !important;
  font-size: 24px !important;
  font-weight: 300 !important;
  line-height: 44px !important;
  text-align: center !important;
  cursor: pointer !important;
  z-index: 99999 !important;
  padding: 0 !important;
  margin: 0 !important;
  transition: background 0.2s ease, transform 0.2s ease !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

.preview-close-btn:hover {
  background: rgba(239, 68, 68, 0.85) !important;
  transform: scale(1.08) !important;
}

.preview-close-btn:focus,
.preview-close-btn:focus-visible,
.preview-close-btn:focus-within {
  outline: 0 !important;
  border: 0 !important;
  box-shadow: none !important;
}

.model-floating-panel {
  position: fixed;
  left: 25%;
  top: 0;
  bottom: 0;
  width: 380px;
  background: #0f0f1a;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 8px 0 32px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: rgba(59, 130, 246, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.panel-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close:hover {
  color: #fff;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.model-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 8px;
  border: 2px solid transparent;
  margin-bottom: 8px;
}

.model-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.model-item.active {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.5);
}

.model-icon-wrapper {
  flex-shrink: 0;
}

.model-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: #3b82f6;
  flex-shrink: 0;
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 2px;
}

.model-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.model-tags .tag {
  padding: 1px 6px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.6);
}

.model-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}

.model-icon.seedream {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, rgba(99, 102, 241, 0.4) 100%);
  color: #a78bfa;
}

.model-icon.gpt {
  background: linear-gradient(135deg, rgba(200, 200, 200, 0.2) 0%, rgba(150, 150, 150, 0.2) 100%);
  color: #ccc;
}

.model-icon.nano {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.3) 0%, rgba(245, 158, 11, 0.3) 100%);
  color: #fbbf24;
}

.model-icon.keling {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.3) 0%, rgba(59, 130, 246, 0.3) 100%);
  color: #22d3ee;
}

.model-icon.mj {
  background: linear-gradient(135deg, rgba(200, 200, 200, 0.2) 0%, rgba(150, 150, 150, 0.2) 100%);
  color: #ccc;
}

.model-icon.wan {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%);
  color: #a855f7;
}
</style>

<!-- ============================================================
   全局样式块（不使用 scoped）：
   由于 Element Plus Dialog 的默认样式是全局注入的，
   且 el-dialog 组件内部的 CSS 变量、背景色、内边距等
   无法通过 scoped + :deep 完全覆盖（特别是当 dialog 通过
   teleport 被渲染到远离组件根节点的位置时）。
   因此在这里使用无 scoped 的全局选择器，基于 dialog 自身的
   class 名精确命中，彻底去除所有边框、白色背景、圆角、阴影。
   ============================================================ -->
<style>
/* 遮罩层：确保覆盖整个视口，纯深色背景0.95 */
.el-overlay.preview-modal,
.el-modal-dialog.preview-modal {
  background-color: rgba(0, 0, 0, 0.95) !important;
  background: rgba(0, 0, 0, 0.95) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 20000 !important;
  overflow: hidden !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
}

/* overlay-dialog 容器：flex居中，无边距 */
.el-overlay.preview-modal > .el-overlay-dialog,
.el-modal-dialog.preview-modal > .el-overlay-dialog {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  background-color: transparent !important;
  border: 0 !important;
  overflow: hidden !important;
}

/* ============================================================
   el-dialog 主容器
   这是图1中白色背景 + 16px内边距 + 16px圆角的真正来源！
   必须使用 dialog 元素自身带有的 class 精确选择。
   ============================================================ */
.el-dialog.preview-dialog,
.el-dialog.preview-dialog-custom {
  /* ======= 覆盖 Element Plus 全部 CSS 变量（从根源清除） ======= */
  --el-bg-color: transparent !important;
  --el-fill-color-blank: transparent !important;
  --el-dialog-padding-primary: 0px !important;
  --el-dialog-border-radius: 0px !important;
  --el-dialog-header-border-bottom: none !important;
  --el-dialog-footer-border-top: none !important;
  --el-dialog-box-shadow: none !important;
  --el-dialog-margin-top: 0 !important;
  --el-dialog-width: auto !important;

  /* ======= 背景：强制完全透明，去除白色底 ======= */
  background-color: transparent !important;
  background: transparent !important;
  background-image: none !important;

  /* ======= 边框：清除所有边框、圆角、外轮廓 ======= */
  border: 0 !important;
  border-style: none !important;
  border-width: 0 !important;
  border-color: transparent !important;
  border-top: 0 !important;
  border-right: 0 !important;
  border-bottom: 0 !important;
  border-left: 0 !important;
  border-radius: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  outline: 0 !important;
  outline-style: none !important;
  outline-width: 0 !important;
  outline-color: transparent !important;
  -webkit-tap-highlight-color: transparent !important;

  /* ======= 阴影：彻底去除box-shadow和所有投影 ======= */
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  -moz-box-shadow: none !important;
  filter: none !important;
  -webkit-filter: none !important;

  /* ======= 内边距：去除16px padding，这是白色空白区的直接原因 ======= */
  padding: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;

  /* ======= 外边距：去除默认的 margin-top: 15vh ======= */
  margin: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;

  /* ======= 定位：自然居中，不偏移 ======= */
  position: relative !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
  -webkit-transform: none !important;

  /* ======= 尺寸：让图片决定 dialog 大小 ======= */
  width: auto !important;
  height: auto !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  min-width: 0 !important;
  min-height: 0 !important;

  /* ======= 溢出：不裁剪 ======= */
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}

/* 去除伪元素可能的边框或叠加层 */
.el-dialog.preview-dialog::before,
.el-dialog.preview-dialog::after,
.el-dialog.preview-dialog-custom::before,
.el-dialog.preview-dialog-custom::after {
  display: none !important;
  content: none !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* ============================================================
   el-dialog__header：彻底隐藏，不占据任何空间
   ============================================================ */
.el-dialog.preview-dialog .el-dialog__header,
.el-dialog.preview-dialog-custom .el-dialog__header {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-bottom: 0 !important;
  overflow: hidden !important;
  position: absolute !important;
  top: -99999px !important;
  left: -99999px !important;
  pointer-events: none !important;
}

.el-dialog.preview-dialog .el-dialog__header::before,
.el-dialog.preview-dialog .el-dialog__header::after {
  display: none !important;
  content: none !important;
}

/* ============================================================
   el-dialog__body：内容区，纯透明，无边距无内边距
   ============================================================ */
.el-dialog.preview-dialog .el-dialog__body,
.el-dialog.preview-dialog-custom .el-dialog__body {
  background-color: transparent !important;
  background: transparent !important;
  border: 0 !important;
  border-style: none !important;
  border-top: 0 !important;
  border-bottom: 0 !important;
  border-left: 0 !important;
  border-right: 0 !important;
  border-color: transparent !important;
  border-radius: 0 !important;
  padding: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
  width: 100% !important;
  height: auto !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  box-shadow: none !important;
  outline: 0 !important;
  display: block !important;
  line-height: 0 !important;
  font-size: 0 !important;
}

.el-dialog.preview-dialog .el-dialog__body::before,
.el-dialog.preview-dialog .el-dialog__body::after,
.el-dialog.preview-dialog-custom .el-dialog__body::before,
.el-dialog.preview-dialog-custom .el-dialog__body::after {
  display: none !important;
  content: none !important;
  border: 0 !important;
  background: transparent !important;
}

/* ============================================================
   el-dialog__footer：彻底隐藏
   ============================================================ */
.el-dialog.preview-dialog .el-dialog__footer,
.el-dialog.preview-dialog-custom .el-dialog__footer {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
  position: absolute !important;
  top: -99999px !important;
  left: -99999px !important;
}

/* ============================================================
   预览大图：纯图片，不添加任何容器边框
   ============================================================ */
.el-dialog.preview-dialog .preview-full,
.el-dialog.preview-dialog-custom .preview-full,
.preview-full {
  display: block !important;
  max-width: 95vw !important;
  max-height: 95vh !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain !important;
  margin: 0 auto !important;
  border: 0 !important;
  border-style: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  background-color: transparent !important;
  background: transparent !important;
  line-height: 0 !important;
  vertical-align: middle !important;
  user-select: none !important;
  -webkit-user-drag: none !important;
  user-drag: none !important;
}

/* ============================================================
   浮动关闭按钮：参考图2效果，完全无边框
   ============================================================ */
.el-dialog.preview-dialog .preview-close-btn,
.el-dialog.preview-dialog-custom .preview-close-btn,
.preview-close-btn {
  position: fixed !important;
  top: 20px !important;
  right: 20px !important;
  width: 44px !important;
  height: 44px !important;
  line-height: 44px !important;
  text-align: center !important;
  border-radius: 50% !important;
  background-color: rgba(0, 0, 0, 0.6) !important;
  background: rgba(0, 0, 0, 0.6) !important;
  border: 0 !important;
  border-style: none !important;
  border-width: 0 !important;
  border-color: transparent !important;
  outline: 0 !important;
  outline-style: none !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  color: #ffffff !important;
  font-size: 24px !important;
  font-weight: 300 !important;
  cursor: pointer !important;
  z-index: 99999 !important;
  padding: 0 !important;
  margin: 0 !important;
  transition: background-color 0.2s ease, transform 0.2s ease !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.preview-close-btn:hover {
  background-color: rgba(239, 68, 68, 0.85) !important;
  background: rgba(239, 68, 68, 0.85) !important;
  transform: scale(1.08) !important;
  -webkit-transform: scale(1.08) !important;
}

.preview-close-btn:focus,
.preview-close-btn:focus-visible,
.preview-close-btn:focus-within,
.preview-close-btn:active {
  outline: 0 !important;
  border: 0 !important;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
}

/* ============================================================
   安全网：预览对话框内*所有*元素都不允许有白色背景
   （防止某些遗漏的内部子元素出现白色斑块）
   ============================================================ */
.el-dialog.preview-dialog *,
.el-dialog.preview-dialog-custom * {
  background-color: transparent !important;
  background: transparent !important;
  border-color: transparent !important;
}
</style>