<template>
  <div class="material-recommend">
    <!-- 顶部标题 -->
    <div class="page-head">
      <div class="page-head-inner">
        <h2 class="page-title">为你推荐</h2>
        <p class="page-sub">基于你的创作画像（题材 / 风格 / 标签）与全站热门度个性化推荐素材与模板</p>
      </div>
    </div>

    <div class="body" v-loading="loading">
      <!-- 个性化推荐组合（S16-T01） -->
      <template v-if="homeData">
        <section class="rec-section" v-for="dim in DIMS" :key="dim.key">
          <div class="section-head">
            <h3 class="section-title">{{ dim.name }}推荐</h3>
            <el-button size="small" text type="primary" @click="openDim(dim.key)">
              查看全部 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <div class="item-grid" v-if="(homeData.materials?.[dim.key] || []).length">
            <div class="item-card" v-for="item in homeData.materials[dim.key]" :key="`${dim.key}-${item.id}`" @click="onClickItem(dim.key, item)">
              <div class="item-thumb">
                <img v-if="item.cover_url" :src="item.cover_url" alt="" @error="onImgError" />
                <div v-else class="thumb-fallback"><el-icon :size="30"><component :is="dim.icon" /></el-icon></div>
                <div class="score-badge" v-if="item.score">{{ (Number(item.score) * 100).toFixed(0) }}%</div>
              </div>
              <div class="item-info">
                <div class="item-name">{{ item.name || item.title }}</div>
                <div class="item-meta">
                  <span class="rec-tag">{{ sourceLabel(item.source) }}</span>
                  <span class="rec-meta">{{ item.usage_count ? `使用 ${item.usage_count} 次` : (item.download_count ? `下载 ${item.download_count}` : '') }}</span>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无推荐" :image-size="60" />
        </section>

        <!-- 模板推荐 -->
        <section class="rec-section">
          <div class="section-head">
            <h3 class="section-title">模板推荐</h3>
            <el-button size="small" text type="primary" @click="$router.push('/template-market')">
              去模板市场 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <div class="item-grid" v-if="(homeData.templates || []).length">
            <div class="item-card" v-for="item in homeData.templates" :key="`tpl-${item.id}`" @click="onClickTemplate(item)">
              <div class="item-thumb">
                <img v-if="item.cover_url" :src="item.cover_url" alt="" @error="onImgError" />
                <div v-else class="thumb-fallback"><el-icon :size="30"><Grid /></el-icon></div>
                <div class="score-badge" v-if="item.score">{{ (Number(item.score) * 100).toFixed(0) }}%</div>
              </div>
              <div class="item-info">
                <div class="item-name">{{ item.title }}</div>
                <div class="item-meta">
                  <span class="rec-tag">{{ sourceLabel(item.source) }}</span>
                  <span class="rec-meta" v-if="item.download_count">下载 {{ item.download_count }}</span>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无推荐" :image-size="60" />
        </section>
      </template>

      <!-- 全站热门榜（S16-T01） -->
      <section class="rec-section" v-if="trending.length">
        <div class="section-head">
          <h3 class="section-title">全站热门</h3>
          <div class="trending-tabs">
            <span
              v-for="tab in TRENDING_TABS"
              :key="tab.key"
              class="trending-tab"
              :class="{ active: trendingDim === tab.key }"
              @click="switchTrending(tab.key)"
            >{{ tab.name }}</span>
          </div>
        </div>
        <div class="trending-list">
          <div class="trending-item" v-for="(item, idx) in trending" :key="idx" @click="onClickTrending(item)">
            <div class="rank" :class="rankClass(idx)">{{ idx + 1 }}</div>
            <div class="trending-info">
              <div class="trending-name">{{ item.name || item.title }}</div>
              <div class="trending-meta">
                <span class="rec-meta">{{ item.usage_count ? `使用 ${item.usage_count} 次` : (item.download_count ? `下载 ${item.download_count}` : '') }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ArrowRight, Grid, User, PictureFilled, Box } from '@element-plus/icons-vue'
import recommendAPI from '@/api/recommend'

const DIMS = [
  { key: 'character', name: '角色', icon: User },
  { key: 'scene', name: '场景', icon: PictureFilled },
  { key: 'prop', name: '道具', icon: Box }
]
const TRENDING_TABS = [
  { key: '', name: '综合' },
  { key: 'character', name: '角色' },
  { key: 'scene', name: '场景' },
  { key: 'prop', name: '道具' },
  { key: 'template', name: '模板' }
]

const loading = ref(false)
const homeData = ref(null)
const trending = ref([])
const trendingDim = ref('')

function sourceLabel(s) {
  return { personalized: '个性化', popular: '热门', collaborative: '协同', cold_start: '新品' }[s] || s || '推荐'
}
function rankClass(idx) {
  if (idx === 0) return 'rank-gold'
  if (idx === 1) return 'rank-silver'
  if (idx === 2) return 'rank-bronze'
  return ''
}
function onImgError(e) { e.target.style.display = 'none' }

async function loadHome() {
  loading.value = true
  try {
    homeData.value = await recommendAPI.home({ materialLimit: 4, templateLimit: 4 })
  } catch (e) { /* 拦截器已提示 */ } finally { loading.value = false }
}

async function switchTrending(key) {
  trendingDim.value = key
  try {
    trending.value = await recommendAPI.trending({ dimension: key, limit: 10 })
  } catch (e) { /* 拦截器已提示 */ }
}

function onClickItem(dim, item) {
  recommendAPI.feedback({ itemType: 'material', dimension: dim, itemId: item.id, action: 'click', source: item.source }).catch(() => {})
  // 跳转素材库详情
  const map = { character: '/material-library?type=character&id=', scene: '/material-library?type=scene&id=', prop: '/material-library?type=prop&id=' }
  // 素材库入口在作品列表页抽屉中，这里统一回到作品列表
  window.location.href = '/'
}

function onClickTemplate(item) {
  recommendAPI.feedback({ itemType: 'template', dimension: 'template', itemId: item.id, action: 'click', source: item.source }).catch(() => {})
  window.location.href = '/template-market'
}

function onClickTrending(item) {
  recommendAPI.feedback({ itemType: item.dimension === 'template' ? 'template' : 'material', dimension: item.dimension || '', itemId: item.id, action: 'click', source: 'popular' }).catch(() => {})
}

onMounted(() => {
  loadHome()
  switchTrending('')
})
</script>

<style scoped>
.material-recommend {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.1) 0%, transparent 60%);
}
html.light .material-recommend { background: #f5f3ff; }

.page-head { padding: 32px 0 20px; border-bottom: 1px solid rgba(139, 92, 246, 0.15); }
.page-head-inner { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.page-title {
  font-size: 26px; font-weight: 700; margin: 0;
  background: linear-gradient(135deg, #c084fc 0%, #a5b4fc 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
html.light .page-title {
  background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.page-sub { margin-top: 6px; color: #94a3b8; font-size: 14px; }
html.light .page-sub { color: #64748b; }

.body { max-width: 1080px; margin: 0 auto; padding: 24px; min-height: 60vh; }
.rec-section { margin-bottom: 36px; }
.section-head {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;
}
.section-title { font-size: 18px; font-weight: 700; color: #e2e8f0; margin: 0; }
html.light .section-title { color: #1e293b; }

.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.item-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.12);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.25s;
}
html.light .item-card { background: #fff; border-color: #e5e7eb; }
.item-card:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(139, 92, 246, 0.2); }
.item-thumb {
  position: relative; height: 110px; background: rgba(139, 92, 246, 0.08);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.item-thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb-fallback { color: #8b5cf6; }
.score-badge {
  position: absolute; top: 8px; right: 8px;
  background: rgba(139, 92, 246, 0.9); color: #fff;
  font-size: 12px; padding: 2px 8px; border-radius: 10px;
}
.item-info { padding: 10px 12px; }
.item-name { font-weight: 600; color: #e2e8f0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
html.light .item-name { color: #1e293b; }
.item-meta { margin-top: 6px; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.rec-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: rgba(139, 92, 246, 0.15); color: #c084fc;
}
html.light .rec-tag { background: #f5f3ff; color: #7c3aed; }
.rec-meta { font-size: 12px; color: #94a3b8; }
html.light .rec-meta { color: #64748b; }

.trending-tabs { display: flex; gap: 10px; }
.trending-tab {
  font-size: 13px; color: #94a3b8; cursor: pointer; padding: 2px 10px; border-radius: 12px;
  transition: all 0.2s;
}
html.light .trending-tab { color: #64748b; }
.trending-tab.active { color: #c084fc; background: rgba(139, 92, 246, 0.15); }
html.light .trending-tab.active { color: #7c3aed; background: #f5f3ff; }

.trending-list { display: flex; flex-direction: column; gap: 8px; }
.trending-item {
  display: flex; align-items: center; gap: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(139, 92, 246, 0.1);
  border-radius: 10px; padding: 12px 16px; cursor: pointer;
  transition: all 0.2s;
}
html.light .trending-item { background: #fff; border-color: #e5e7eb; }
.trending-item:hover { border-color: #8b5cf6; transform: translateX(4px); }
.rank {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: #64748b; background: rgba(148, 163, 184, 0.12);
}
.rank-gold { color: #f59e0b; background: rgba(245, 158, 11, 0.15); }
.rank-silver { color: #94a3b8; background: rgba(148, 163, 184, 0.15); }
.rank-bronze { color: #d97706; background: rgba(217, 119, 6, 0.15); }
.trending-info { flex: 1; min-width: 0; }
.trending-name { font-weight: 600; color: #e2e8f0; }
html.light .trending-name { color: #1e293b; }
.trending-meta { margin-top: 2px; }
</style>
