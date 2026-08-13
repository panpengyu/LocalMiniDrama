<template>
  <div class="tpl-market">
    <!-- 顶部：市场概览 -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="hero-head">
          <h2 class="hero-title">
            <el-icon><ShoppingBag /></el-icon>
            模板市场
          </h2>
          <p class="hero-sub">发现由创作者打造的优质漫剧模板，一键应用到你的项目</p>
        </div>
        <div class="hero-stats">
          <div class="stat">
            <div class="stat-num">{{ stats?.templates?.listed ?? 0 }}</div>
            <div class="stat-label">在售模板</div>
          </div>
          <div class="stat">
            <div class="stat-num">{{ stats?.transactions?.downloads ?? 0 }}</div>
            <div class="stat-label">累计获取</div>
          </div>
          <div class="stat">
            <div class="stat-num">{{ stats?.creators?.approved ?? 0 }}</div>
            <div class="stat-label">认证创作者</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 标签页：模板画廊 / 我的模板库 -->
    <el-tabs v-model="activeTab" class="market-tabs" @tab-change="onTabChange">
      <el-tab-pane label="模板画廊" name="gallery">
        <!-- 筛选工具条 -->
        <div class="toolbar">
          <div class="toolbar-left">
            <el-input
              v-model="filters.keyword"
              placeholder="搜索模板标题 / 简介 / 描述"
              clearable
              class="search-input"
              @keyup.enter="reloadTemplates(true)"
              @clear="reloadTemplates(true)"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button type="primary" @click="reloadTemplates(true)">搜索</el-button>
          </div>
          <div class="toolbar-right">
            <el-select v-model="filters.pricingType" placeholder="价格" clearable class="mini-select" @change="reloadTemplates(true)">
              <el-option label="全部" value="" />
              <el-option label="免费" value="free" />
              <el-option label="付费" value="paid" />
            </el-select>
            <el-select v-model="filters.sort" class="mini-select" @change="reloadTemplates(true)">
              <el-option label="最新上架" value="latest" />
              <el-option label="最多获取" value="popular" />
              <el-option label="评分最高" value="rating" />
              <el-option label="价格从低到高" value="price_asc" />
              <el-option label="价格从高到低" value="price_desc" />
            </el-select>
          </div>
        </div>

        <!-- 分类导航 -->
        <div class="category-bar">
          <span
            class="cat-chip"
            :class="{ active: !filters.category }"
            @click="selectCategory('')"
          >全部</span>
          <span
            v-for="c in categories"
            :key="c.category"
            class="cat-chip"
            :class="{ active: filters.category === c.category }"
            @click="selectCategory(c.category)"
          >{{ categoryLabel(c.category) }}<em>{{ c.count }}</em></span>
        </div>

        <!-- 模板网格 -->
        <div v-loading="loadingTemplates" class="tpl-grid">
          <el-empty v-if="!loadingTemplates && templates.length === 0" description="暂无符合条件的模板" />
          <div
            v-for="t in templates"
            :key="t.id"
            class="tpl-card"
            @click="openDetail(t.id)"
          >
            <div class="tpl-cover">
              <img v-if="coverUrl(t)" :src="coverUrl(t)" :alt="t.title" @error="onImgError" />
              <div v-else class="cover-placeholder"><el-icon><Picture /></el-icon></div>
              <span class="price-tag" :class="{ free: t.pricing_type !== 'paid' || Number(t.price) === 0 }">
                {{ priceLabel(t) }}
              </span>
            </div>
            <div class="tpl-body">
              <div class="tpl-title" :title="t.title">{{ t.title }}</div>
              <div class="tpl-summary">{{ t.summary || '暂无简介' }}</div>
              <div class="tpl-meta">
                <span class="creator">
                  <el-icon><User /></el-icon>{{ t.creator_name || '匿名创作者' }}
                </span>
                <span class="rating">
                  <el-rate :model-value="Number(t.rating_avg) || 0" disabled size="small" :max="5" />
                  <em>{{ (Number(t.rating_avg) || 0).toFixed(1) }}</em>
                </span>
              </div>
              <div class="tpl-foot">
                <span class="cat">{{ categoryLabel(t.category) }}</span>
                <span class="dl"><el-icon><Download /></el-icon>{{ t.download_count || 0 }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="templateTotal > filters.pageSize" class="pager">
          <el-pagination
            layout="prev, pager, next, total"
            :total="templateTotal"
            :page-size="filters.pageSize"
            :current-page="filters.page"
            @current-change="onPageChange"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="我的模板库" name="library">
        <div v-loading="loadingLibrary" class="tpl-grid">
          <el-empty v-if="!loadingLibrary && library.length === 0" description="还没有获取任何模板，去画廊逛逛吧" />
          <div v-for="t in library" :key="t.acquire_id" class="tpl-card">
            <div class="tpl-cover" @click="openDetail(t.id)">
              <img v-if="coverUrl(t)" :src="coverUrl(t)" :alt="t.title" @error="onImgError" />
              <div v-else class="cover-placeholder"><el-icon><Picture /></el-icon></div>
              <span class="acquire-tag">{{ t.acquire_type === 'purchase' ? '已购买' : '已下载' }}</span>
            </div>
            <div class="tpl-body">
              <div class="tpl-title" :title="t.title">{{ t.title }}</div>
              <div class="tpl-summary">{{ t.summary || '暂无简介' }}</div>
              <div class="lib-actions">
                <el-button
                  v-if="t.applied_drama_id"
                  size="small"
                  @click="$router.push(`/drama/${t.applied_drama_id}`)"
                >查看项目</el-button>
                <el-button
                  type="primary"
                  size="small"
                  :loading="applyingId === t.id"
                  @click="applyTemplate(t.id)"
                >应用创建项目</el-button>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="detailVisible"
      :title="detail?.title || '模板详情'"
      size="46%"
      class="detail-drawer"
      @closed="detail = null"
    >
      <div v-if="detail" v-loading="loadingDetail" class="detail">
        <!-- 预览图集 -->
        <div class="detail-preview">
          <el-carousel
            v-if="previewList.length"
            height="240px"
            :autoplay="false"
            indicator-position="outside"
            arrow="always"
          >
            <el-carousel-item v-for="(img, i) in previewList" :key="i">
              <img :src="img" class="preview-img" @error="onImgError" />
            </el-carousel-item>
          </el-carousel>
          <div v-else class="preview-empty"><el-icon><Picture /></el-icon><span>暂无预览图</span></div>
        </div>

        <!-- 概要信息 -->
        <div class="detail-head">
          <div class="detail-meta">
            <el-tag size="small" effect="plain">{{ categoryLabel(detail.category) }}</el-tag>
            <el-tag v-if="detail.genre_type" size="small" type="info" effect="plain">{{ detail.genre_type }}</el-tag>
            <span class="detail-creator"><el-icon><User /></el-icon>{{ detail.creator_name || '匿名创作者' }}</span>
          </div>
          <div class="detail-price">{{ priceLabel(detail) }}</div>
        </div>
        <p class="detail-summary">{{ detail.summary }}</p>
        <div class="detail-rating">
          <el-rate :model-value="Number(detail.rating_avg) || 0" disabled />
          <span>{{ (Number(detail.rating_avg) || 0).toFixed(1) }} 分 · {{ detail.rating_count || 0 }} 条评价 · {{ detail.download_count || 0 }} 次获取</span>
        </div>

        <!-- 内容体概览 -->
        <div class="detail-content">
          <h4>模板包含</h4>
          <div class="content-chips">
            <span class="c-chip"><el-icon><Avatar /></el-icon>角色预设 {{ contentCounts.characters }}</span>
            <span class="c-chip"><el-icon><Location /></el-icon>场景预设 {{ contentCounts.scenes }}</span>
            <span class="c-chip"><el-icon><MagicStick /></el-icon>{{ contentCounts.hasStyle ? '含风格配置' : '无风格配置' }}</span>
          </div>
        </div>

        <div v-if="detail.description" class="detail-desc">
          <h4>详细介绍</h4>
          <p>{{ detail.description }}</p>
        </div>

        <!-- 操作区 -->
        <div class="detail-actions">
          <template v-if="detail.acquired">
            <el-button type="success" plain disabled>
              <el-icon><CircleCheck /></el-icon>已获取
            </el-button>
            <el-button type="primary" :loading="applyingId === detail.id" @click="applyTemplate(detail.id)">
              应用创建项目
            </el-button>
          </template>
          <template v-else>
            <el-button
              type="primary"
              size="large"
              :loading="acquiring"
              @click="acquireTemplate(detail)"
            >
              {{ isPaid(detail) ? `购买（${needPoints(detail)} 积分）` : '免费下载' }}
            </el-button>
          </template>
        </div>

        <!-- 评分区 -->
        <div class="detail-reviews">
          <div class="reviews-head">
            <h4>用户评价（{{ detail.rating_count || 0 }}）</h4>
            <el-button v-if="detail.acquired" size="small" text type="primary" @click="rateVisible = true">
              <el-icon><EditPen /></el-icon>写评价
            </el-button>
          </div>
          <el-empty v-if="!detail.recent_ratings || detail.recent_ratings.length === 0" description="暂无评价" :image-size="64" />
          <div v-for="r in (detail.recent_ratings || [])" :key="r.id" class="review-item">
            <div class="review-top">
              <span class="review-user">{{ r.user_nickname || r.user_name || '匿名用户' }}</span>
              <el-rate :model-value="Number(r.rating) || 0" disabled size="small" />
            </div>
            <p v-if="r.comment" class="review-comment">{{ r.comment }}</p>
            <span class="review-time">{{ formatDateTime(r.updated_at || r.created_at) }}</span>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 评分对话框 -->
    <el-dialog v-model="rateVisible" title="发表评价" width="420px" class="rate-dialog">
      <div class="rate-form">
        <div class="rate-row">
          <span class="rate-label">评分</span>
          <el-rate v-model="rateForm.rating" :max="5" />
        </div>
        <el-input
          v-model="rateForm.comment"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          placeholder="分享你的使用体验（选填）"
        />
      </div>
      <template #footer>
        <el-button @click="rateVisible = false">取消</el-button>
        <el-button type="primary" :loading="submittingRate" @click="submitRate">提交评价</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ShoppingBag, Search, Picture, User, Download, Avatar, Location,
  MagicStick, CircleCheck, EditPen
} from '@element-plus/icons-vue'
import { marketplaceAPI } from '@/api/marketplace'

const router = useRouter()

// 100 积分 = 1 元（与后端 financeService.POINTS_PER_YUAN 口径一致）
const POINTS_PER_YUAN = 100

const CATEGORY_LABELS = {
  general: '通用', urban: '都市', ancient: '古装', scifi: '科幻',
  campus: '校园', suspense: '悬疑', fantasy: '玄幻', romance: '言情',
  history: '历史', comedy: '喜剧'
}

const activeTab = ref('gallery')

const stats = ref(null)
const categories = ref([])

const templates = ref([])
const templateTotal = ref(0)
const loadingTemplates = ref(false)
const filters = reactive({
  keyword: '', category: '', pricingType: '', sort: 'latest', page: 1, pageSize: 12
})

const library = ref([])
const loadingLibrary = ref(false)

const detailVisible = ref(false)
const loadingDetail = ref(false)
const detail = ref(null)
const acquiring = ref(false)
const applyingId = ref(null)

const rateVisible = ref(false)
const submittingRate = ref(false)
const rateForm = reactive({ rating: 5, comment: '' })

const previewList = computed(() => {
  if (!detail.value) return []
  const list = []
  if (detail.value.cover_image) list.push(coverUrl(detail.value))
  const previews = Array.isArray(detail.value.preview_images) ? detail.value.preview_images : []
  previews.forEach((p) => { if (p) list.push(assetUrl(p)) })
  return list
})

const contentCounts = computed(() => {
  const c = detail.value?.content || {}
  return {
    characters: Array.isArray(c.character_presets) ? c.character_presets.length : 0,
    scenes: Array.isArray(c.scene_presets) ? c.scene_presets.length : 0,
    hasStyle: !!c.style_config
  }
})

function categoryLabel(c) {
  return CATEGORY_LABELS[c] || c || '通用'
}
function assetUrl(url) {
  if (!url) return ''
  return url.startsWith('http') ? url : '/static/' + String(url).replace(/^\//, '')
}
function coverUrl(t) {
  return t?.cover_image ? assetUrl(t.cover_image) : ''
}
function onImgError(e) {
  if (e?.target) e.target.style.display = 'none'
}
function isPaid(t) {
  return t?.pricing_type === 'paid' && Number(t?.price) > 0
}
function needPoints(t) {
  return Math.round((Number(t?.price) || 0) * POINTS_PER_YUAN)
}
function priceLabel(t) {
  return isPaid(t) ? `¥${Number(t.price).toFixed(2)}` : '免费'
}
function formatDateTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function loadStats() {
  try { stats.value = await marketplaceAPI.stats() } catch (e) { /* 拦截器已提示 */ }
}
async function loadCategories() {
  try {
    const res = await marketplaceAPI.listCategories()
    categories.value = res?.items || []
  } catch (e) { /* 拦截器已提示 */ }
}

async function reloadTemplates(resetPage = false) {
  if (resetPage) filters.page = 1
  loadingTemplates.value = true
  try {
    const res = await marketplaceAPI.listTemplates({
      keyword: filters.keyword || undefined,
      category: filters.category || undefined,
      pricing_type: filters.pricingType || undefined,
      sort: filters.sort,
      page: filters.page,
      page_size: filters.pageSize
    })
    templates.value = res?.items || []
    templateTotal.value = Number(res?.total) || 0
  } finally {
    loadingTemplates.value = false
  }
}

function selectCategory(cat) {
  filters.category = cat
  reloadTemplates(true)
}
function onPageChange(p) {
  filters.page = p
  reloadTemplates()
}

async function loadLibrary() {
  loadingLibrary.value = true
  try {
    const res = await marketplaceAPI.myLibrary({ limit: 60, offset: 0 })
    library.value = res?.items || []
  } finally {
    loadingLibrary.value = false
  }
}

function onTabChange(name) {
  if (name === 'library') loadLibrary()
}

async function openDetail(id) {
  detailVisible.value = true
  loadingDetail.value = true
  detail.value = null
  try {
    detail.value = await marketplaceAPI.getTemplate(id)
  } catch (e) {
    detailVisible.value = false
  } finally {
    loadingDetail.value = false
  }
}

async function acquireTemplate(t) {
  if (!t) return
  const paid = isPaid(t)
  if (paid) {
    try {
      await ElMessageBox.confirm(
        `购买《${t.title}》将消耗 ${needPoints(t)} 积分，确认购买？`,
        '确认购买', { type: 'warning', confirmButtonText: '确认购买', cancelButtonText: '再想想' }
      )
    } catch (e) { return }
  }
  acquiring.value = true
  try {
    const res = await marketplaceAPI.acquire(t.id, { pay_method: 'points' })
    ElMessage.success(res?.alreadyOwned ? '你已拥有该模板' : (paid ? '购买成功' : '下载成功'))
    if (detail.value && detail.value.id === t.id) detail.value.acquired = true
    loadStats()
  } catch (e) { /* 拦截器已提示 */ } finally {
    acquiring.value = false
  }
}

async function applyTemplate(id) {
  applyingId.value = id
  try {
    const drama = await marketplaceAPI.apply(id, {})
    ElMessage.success('已应用模板并创建项目')
    if (drama?.id) router.push(`/drama/${drama.id}`)
  } catch (e) { /* 拦截器已提示 */ } finally {
    applyingId.value = null
  }
}

async function submitRate() {
  if (!detail.value) return
  if (!(rateForm.rating >= 1 && rateForm.rating <= 5)) {
    ElMessage.warning('请先选择评分')
    return
  }
  submittingRate.value = true
  try {
    await marketplaceAPI.rate(detail.value.id, { rating: rateForm.rating, comment: rateForm.comment || null })
    ElMessage.success('评价已提交')
    rateVisible.value = false
    rateForm.comment = ''
    // 刷新详情评分聚合
    detail.value = await marketplaceAPI.getTemplate(detail.value.id)
  } catch (e) { /* 拦截器已提示 */ } finally {
    submittingRate.value = false
  }
}

onMounted(() => {
  loadStats()
  loadCategories()
  reloadTemplates(true)
})
</script>

<style scoped>
.tpl-market {
  padding: 20px 28px 40px;
  min-height: 100vh;
  background: #f5f6fa;
}

/* Hero */
.hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  padding: 28px 32px;
  margin-bottom: 20px;
  color: #fff;
}
.hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, #6d28d9 0%, #4338ca 45%, #0ea5e9 100%);
}
.hero-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 85% 20%, rgba(255,255,255,0.25), transparent 45%);
}
.hero-inner {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.hero-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 26px;
  margin: 0 0 8px;
}
.hero-sub { margin: 0; opacity: 0.9; font-size: 14px; }
.hero-stats { display: flex; gap: 18px; }
.stat {
  background: rgba(255,255,255,0.16);
  backdrop-filter: blur(6px);
  border-radius: 14px;
  padding: 14px 22px;
  text-align: center;
  min-width: 92px;
}
.stat-num { font-size: 26px; font-weight: 700; }
.stat-label { font-size: 12px; opacity: 0.85; margin-top: 2px; }

/* Tabs */
.market-tabs :deep(.el-tabs__item) { font-size: 15px; }

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.toolbar-left { display: flex; gap: 10px; align-items: center; }
.search-input { width: 340px; }
.toolbar-right { display: flex; gap: 10px; }
.mini-select { width: 150px; }

/* Category */
.category-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.cat-chip {
  padding: 6px 14px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid #e5e7eb;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  transition: all .2s;
}
.cat-chip em {
  font-style: normal;
  margin-left: 6px;
  color: #9ca3af;
  font-size: 12px;
}
.cat-chip:hover { border-color: #a5b4fc; color: #4338ca; }
.cat-chip.active {
  background: linear-gradient(135deg,#6d28d9,#4338ca);
  color: #fff;
  border-color: transparent;
}
.cat-chip.active em { color: rgba(255,255,255,0.75); }

/* Grid */
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 18px;
  min-height: 200px;
}
.tpl-card {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(15,23,42,0.06);
  cursor: pointer;
  transition: transform .2s, box-shadow .2s;
  display: flex;
  flex-direction: column;
}
.tpl-card:hover { transform: translateY(-4px); box-shadow: 0 10px 24px rgba(67,56,202,0.16); }
.tpl-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background: linear-gradient(135deg,#eef2ff,#e0e7ff);
  overflow: hidden;
}
.tpl-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #a5b4fc; font-size: 42px;
}
.price-tag {
  position: absolute; top: 10px; right: 10px;
  background: rgba(220,38,38,0.92);
  color: #fff;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.price-tag.free { background: rgba(16,185,129,0.92); }
.acquire-tag {
  position: absolute; top: 10px; right: 10px;
  background: rgba(79,70,229,0.9);
  color: #fff;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
}
.tpl-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.tpl-title { font-size: 15px; font-weight: 600; color: #1f2937; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-summary {
  font-size: 12px; color: #6b7280; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: 36px;
}
.tpl-meta { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
.tpl-meta .creator { font-size: 12px; color: #6b7280; display: flex; align-items: center; gap: 4px; }
.tpl-meta .rating { display: flex; align-items: center; gap: 4px; }
.tpl-meta .rating em { font-style: normal; font-size: 12px; color: #f59e0b; font-weight: 600; }
.tpl-foot { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #9ca3af; }
.tpl-foot .cat { color: #6366f1; }
.tpl-foot .dl { display: flex; align-items: center; gap: 3px; }

.pager { display: flex; justify-content: center; margin-top: 24px; }

.lib-actions { display: flex; gap: 8px; margin-top: auto; }

/* Detail drawer */
.detail { padding: 4px 8px 24px; }
.detail-preview { margin-bottom: 16px; }
.preview-img { width: 100%; height: 240px; object-fit: cover; border-radius: 10px; }
.preview-empty {
  height: 200px; border-radius: 10px;
  background: linear-gradient(135deg,#eef2ff,#e0e7ff);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: #a5b4fc; font-size: 36px;
}
.preview-empty span { font-size: 13px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-creator { font-size: 13px; color: #6b7280; display: flex; align-items: center; gap: 4px; }
.detail-price { font-size: 22px; font-weight: 700; color: #dc2626; }
.detail-summary { color: #4b5563; margin: 10px 0; line-height: 1.6; }
.detail-rating { display: flex; align-items: center; gap: 10px; color: #6b7280; font-size: 13px; margin-bottom: 16px; }
.detail-content h4, .detail-desc h4 { margin: 12px 0 8px; font-size: 15px; color: #1f2937; }
.content-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.c-chip {
  display: flex; align-items: center; gap: 5px;
  background: #f3f4f6; border-radius: 8px; padding: 6px 12px; font-size: 13px; color: #4b5563;
}
.detail-desc p { color: #4b5563; line-height: 1.7; white-space: pre-wrap; }
.detail-actions { display: flex; gap: 12px; margin: 20px 0; }
.detail-reviews { border-top: 1px solid #eef0f5; padding-top: 16px; }
.reviews-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.reviews-head h4 { margin: 0; font-size: 15px; }
.review-item { padding: 10px 0; border-bottom: 1px dashed #eef0f5; }
.review-top { display: flex; justify-content: space-between; align-items: center; }
.review-user { font-size: 13px; font-weight: 600; color: #374151; }
.review-comment { margin: 6px 0; color: #4b5563; font-size: 13px; line-height: 1.5; }
.review-time { font-size: 12px; color: #9ca3af; }

.rate-form { display: flex; flex-direction: column; gap: 14px; }
.rate-row { display: flex; align-items: center; gap: 12px; }
.rate-label { font-size: 14px; color: #4b5563; }
</style>
