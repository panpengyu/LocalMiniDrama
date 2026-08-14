<template>
  <div class="help-center">
    <!-- 顶部标题 -->
    <div class="page-head">
      <div class="page-head-inner">
        <h2 class="page-title">帮助中心</h2>
        <p class="page-sub">从入门到精通，快速上手本地短剧创作</p>
      </div>
    </div>

    <div class="body" v-loading="loading">
      <!-- 分类统计 -->
      <div class="category-bar">
        <div
          v-for="cat in categories"
          :key="cat.key"
          class="category-item"
          :class="{ active: activeCategory === cat.key }"
          @click="switchCategory(cat.key)"
        >
          <div class="cat-icon">{{ cat.icon }}</div>
          <div class="cat-name">{{ cat.name }}</div>
          <div class="cat-count">{{ stats[cat.key] || 0 }} 篇</div>
        </div>
      </div>

      <!-- 文章列表 -->
      <div class="doc-list" v-if="docs.length">
        <div class="doc-item" v-for="doc in docs" :key="doc.id" @click="openDoc(doc)">
          <div class="doc-tag" :class="'tag-' + doc.category">{{ catName(doc.category) }}</div>
          <div class="doc-main">
            <div class="doc-title">{{ doc.title }}</div>
            <div class="doc-summary" v-if="doc.summary">{{ doc.summary }}</div>
          </div>
          <el-icon class="doc-arrow"><ArrowRight /></el-icon>
        </div>
      </div>
      <el-empty v-else description="暂无相关文档" />

      <!-- 精选推荐 -->
      <div class="featured" v-if="activeCategory === 'all' && featured.length">
        <h3 class="featured-title">精选文章</h3>
        <div class="featured-grid">
          <div class="featured-card" v-for="doc in featured" :key="doc.id" @click="openDoc(doc)">
            <div class="fc-tag">{{ catName(doc.category) }}</div>
            <div class="fc-title">{{ doc.title }}</div>
            <div class="fc-summary" v-if="doc.summary">{{ doc.summary }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 文档详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="currentDoc?.title || '文档详情'" size="52%" destroy-on-close>
      <div class="doc-content" v-loading="detailLoading" v-html="renderContent"></div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import helpAPI from '@/api/help'

const CATS = [
  { key: 'all', name: '全部', icon: '📚' },
  { key: 'manual', name: '使用手册', icon: '📖' },
  { key: 'faq', name: '常见问题', icon: '❓' },
  { key: 'video', name: '视频教程', icon: '🎬' },
  { key: 'best_practice', name: '最佳实践', icon: '🏆' }
]

const loading = ref(false)
const docs = ref([])
const featured = ref([])
const stats = ref({})
const activeCategory = ref('all')
const categories = CATS
const detailVisible = ref(false)
const detailLoading = ref(false)
const currentDoc = ref(null)

const catName = key => CATS.find(c => c.key === key)?.name || key

const renderContent = computed(() => {
  const c = currentDoc.value?.content || ''
  return c
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>')
})

async function loadOverview() {
  try {
    const res = await helpAPI.overview()
    stats.value = res?.stats || {}
    featured.value = res?.featured || []
  } catch (e) { /* 拦截器已提示 */ }
}

async function loadDocs() {
  loading.value = true
  try {
    const res = await helpAPI.docs(activeCategory.value === 'all' ? {} : { category: activeCategory.value })
    docs.value = res?.items || []
  } catch (e) { /* 拦截器已提示 */ } finally {
    loading.value = false
  }
}

function switchCategory(key) {
  activeCategory.value = key
  loadDocs()
}

async function openDoc(doc) {
  currentDoc.value = doc
  detailVisible.value = true
  detailLoading.value = true
  try {
    const res = await helpAPI.doc(doc.id)
    currentDoc.value = res
  } catch (e) {
    ElMessage.error('加载文档失败')
  } finally {
    detailLoading.value = false
  }
}

onMounted(() => {
  loadOverview()
  loadDocs()
})
</script>

<style scoped>
.help-center {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.1) 0%, transparent 60%);
}
html.light .help-center {
  background: #f5f3ff;
}

.page-head {
  padding: 32px 0 20px;
  border-bottom: 1px solid rgba(139, 92, 246, 0.15);
}
.page-head-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0;
  background: linear-gradient(135deg, #c084fc 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
html.light .page-title {
  background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.page-sub {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 14px;
}
html.light .page-sub { color: #64748b; }

.body {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px;
  min-height: 60vh;
}

.category-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.category-item {
  flex: 1;
  min-width: 120px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.15);
  border-radius: 12px;
  padding: 14px;
  text-align: center;
  cursor: pointer;
  transition: all 0.25s;
}
html.light .category-item {
  background: #fff;
  border-color: #e5e7eb;
}
.category-item:hover { transform: translateY(-2px); }
.category-item.active {
  border-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.12);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.2);
}
html.light .category-item.active {
  background: #f5f3ff;
}
.cat-icon { font-size: 26px; }
.cat-name { margin-top: 6px; font-weight: 600; color: #e2e8f0; }
html.light .cat-name { color: #1e293b; }
.cat-count { margin-top: 2px; font-size: 12px; color: #94a3b8; }
html.light .cat-count { color: #64748b; }

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.doc-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.12);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.25s;
}
html.light .doc-item {
  background: #fff;
  border-color: #e5e7eb;
}
.doc-item:hover {
  border-color: #8b5cf6;
  transform: translateX(4px);
}
.doc-tag {
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 20px;
}
.tag-manual { background: rgba(139, 92, 246, 0.15); color: #c084fc; }
html.light .tag-manual { background: #f5f3ff; color: #7c3aed; }
.tag-faq { background: rgba(59, 130, 246, 0.15); color: #93c5fd; }
html.light .tag-faq { background: #eff6ff; color: #2563eb; }
.tag-video { background: rgba(236, 72, 153, 0.15); color: #f9a8d4; }
html.light .tag-video { background: #fdf2f8; color: #db2777; }
.tag-best_practice { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; }
html.light .tag-best_practice { background: #ecfdf5; color: #059669; }
.doc-main { flex: 1; min-width: 0; }
.doc-title { font-weight: 600; color: #e2e8f0; }
html.light .doc-title { color: #1e293b; }
.doc-summary {
  margin-top: 4px;
  font-size: 13px;
  color: #94a3b8;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
html.light .doc-summary { color: #64748b; }
.doc-arrow { color: #64748b; }

.featured { margin-top: 32px; }
.featured-title {
  font-size: 18px;
  font-weight: 700;
  color: #e2e8f0;
  margin-bottom: 16px;
}
html.light .featured-title { color: #1e293b; }
.featured-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.featured-card {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(99, 102, 241, 0.05) 100%);
  border: 1px solid rgba(139, 92, 246, 0.18);
  border-radius: 12px;
  padding: 18px;
  cursor: pointer;
  transition: all 0.25s;
}
html.light .featured-card {
  background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
}
.featured-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.18);
}
.fc-tag { font-size: 12px; color: #c084fc; }
html.light .fc-tag { color: #7c3aed; }
.fc-title { margin-top: 8px; font-weight: 600; color: #e2e8f0; }
html.light .fc-title { color: #1e293b; }
.fc-summary {
  margin-top: 6px;
  font-size: 13px;
  color: #94a3b8;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
html.light .fc-summary { color: #64748b; }

.doc-content {
  line-height: 1.8;
  color: #cbd5e1;
  font-size: 14px;
}
html.light .doc-content { color: #334155; }
</style>
