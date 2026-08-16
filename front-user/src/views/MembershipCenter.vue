<template>
  <div class="membership-center">
    <!-- 顶部：当前会员状态 -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="current-plan">
          <div class="plan-badge" :style="{ background: currentBadgeColor }">
            <el-icon><Trophy /></el-icon>
            <span>{{ mine?.plan?.name || '免费版' }}</span>
          </div>
          <h2 class="hero-title">我的会员中心</h2>
          <p class="hero-sub">
            <template v-if="mine?.membership && mine?.is_active">
              <span v-if="mine.membership.billing_cycle === 'lifetime'">终身有效</span>
              <span v-else>有效期至 {{ formatDate(mine.membership.expires_at) }}</span>
              <el-tag v-if="Number(mine.membership.auto_renew) === 1" size="small" type="success" effect="dark" class="ml8">已开启自动续费</el-tag>
            </template>
            <template v-else>
              当前为免费版，升级会员解锁更高配额与全部高级能力
            </template>
          </p>
          <div v-if="mine?.membership && mine?.is_active && mine.membership.billing_cycle !== 'lifetime'" class="hero-actions">
            <el-switch
              v-model="autoRenewOn"
              inline-prompt
              active-text="自动续费"
              inactive-text="自动续费"
              :loading="autoRenewLoading"
              @change="onToggleAutoRenew"
            />
            <el-button text class="cancel-btn" @click="onCancel">取消会员</el-button>
          </div>
        </div>

        <!-- 配额用量 -->
        <div class="quota-panel">
          <div class="quota-title">
            <el-icon><DataLine /></el-icon>
            <span>本周期配额用量</span>
            <span v-if="quota?.period_key" class="period">{{ quota.period_key }}</span>
          </div>
          <div class="quota-grid">
            <div v-for="m in quotaMetrics" :key="m.key" class="quota-item">
              <div class="quota-item-head">
                <span class="q-label">{{ m.label }}</span>
                <span class="q-value">
                  <template v-if="m.unlimited">不限</template>
                  <template v-else>{{ m.used }} / {{ m.limit }}</template>
                </span>
              </div>
              <el-progress
                :percentage="m.percentage"
                :status="m.percentage >= 100 ? 'exception' : (m.percentage >= 80 ? 'warning' : '')"
                :stroke-width="8"
                :show-text="false"
                class="q-bar"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 套餐对比与购买 -->
    <section class="plans-section">
      <div class="section-head">
        <h3>选择适合你的套餐</h3>
        <el-radio-group v-model="cycle" size="large" class="cycle-switch">
          <el-radio-button label="monthly">月付</el-radio-button>
          <el-radio-button label="yearly">
            年付
            <span class="save-tag">省 2 个月</span>
          </el-radio-button>
          <el-radio-button label="lifetime">终身</el-radio-button>
        </el-radio-group>
      </div>

      <div v-loading="loadingPlans" class="plans-grid">
        <div
          v-for="plan in visiblePlans"
          :key="plan.id"
          class="plan-card"
          :class="{ current: plan.level_code === mine?.level_code, featured: plan.level_code === 'pro' }"
        >
          <div v-if="plan.level_code === 'pro'" class="ribbon">推荐</div>
          <div class="plan-name" :style="{ color: plan.badge_color || '#c084fc' }">{{ plan.name }}</div>
          <div class="plan-price">
            <template v-if="priceOf(plan) === null">
              <span class="price-na">不支持{{ cycleLabel }}</span>
            </template>
            <template v-else-if="Number(priceOf(plan)) === 0">
              <span class="price-num">免费</span>
            </template>
            <template v-else>
              <span class="price-symbol">¥</span>
              <span class="price-num">{{ priceOf(plan) }}</span>
              <span class="price-unit">/ {{ cycleUnit }}</span>
            </template>
          </div>
          <ul class="plan-quota">
            <li><el-icon><Check /></el-icon>{{ fmtQuota(plan.quota?.monthly_generations) }} 次/月 AI 生成</li>
            <li><el-icon><Check /></el-icon>{{ fmtQuota(plan.quota?.max_projects) }} 个项目</li>
            <li><el-icon><Check /></el-icon>{{ fmtStorage(plan.quota?.storage_mb) }} 存储空间</li>
            <li><el-icon><Check /></el-icon>{{ fmtQuota(plan.quota?.max_collaborators) }} 人协作</li>
          </ul>
          <div class="plan-foot">
            <el-button
              v-if="plan.level_code === mine?.level_code"
              disabled
              class="plan-btn"
            >当前套餐</el-button>
            <el-button
              v-else-if="plan.level_rank === 0"
              disabled
              class="plan-btn"
            >免费版</el-button>
            <el-button
              v-else-if="priceOf(plan) === null"
              disabled
              class="plan-btn"
            >不可选</el-button>
            <el-button
              v-else
              type="primary"
              class="plan-btn buy"
              @click="openPurchase(plan)"
            >
              {{ plan.level_rank > (mine?.plan?.level_rank ?? 0) ? '立即升级' : '购买' }}
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <!-- S17-T02 优惠券 -->
    <section class="coupon-section">
      <div class="section-head">
        <h3>优惠券</h3>
        <span class="coupon-tip">兑换后下单可抵扣，每张券每个账号限领一次</span>
      </div>
      <div class="coupon-redeem">
        <el-input
          v-model="redeemCode"
          placeholder="输入兑换码，如 NEWYEAR2026"
          clearable
          class="redeem-input"
          @keyup.enter="onRedeem"
        />
        <el-button type="primary" :loading="redeeming" @click="onRedeem">兑换</el-button>
        <el-button text :icon="Refresh" @click="loadCoupons">刷新</el-button>
      </div>
      <el-table :data="coupons" v-loading="loadingCoupons" class="coupon-table" empty-text="暂无优惠券，输入兑换码兑换">
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="code" label="券码" width="130" />
        <el-table-column label="优惠" width="120">
          <template #default="{ row }">{{ fmtCouponValue(row) }}</template>
        </el-table-column>
        <el-table-column label="使用门槛" width="120">
          <template #default="{ row }">{{ row.min_spend > 0 ? `满 ¥${Number(row.min_spend).toFixed(2)}` : '无门槛' }}</template>
        </el-table-column>
        <el-table-column label="有效期至" width="160">
          <template #default="{ row }">{{ row.end_at ? formatDate(row.end_at) : '长期' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'used' ? 'info' : 'success'">
              {{ row.status === 'used' ? '已使用' : '可用' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 订单/账单记录 -->
    <section class="orders-section">
      <div class="section-head">
        <h3>我的订单</h3>
        <el-button text :icon="Refresh" @click="loadOrders">刷新</el-button>
      </div>
      <el-table :data="orders" v-loading="loadingOrders" class="orders-table" empty-text="暂无订单记录">
        <el-table-column prop="order_no" label="订单号" min-width="200" />
        <el-table-column prop="plan_name" label="套餐" min-width="100" />
        <el-table-column label="周期" width="90">
          <template #default="{ row }">{{ cycleName(row.billing_cycle) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ orderTypeName(row.order_type) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ Number(row.amount).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="支付方式" width="100">
          <template #default="{ row }">{{ payMethodName(row.pay_method) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="payStatusTag(row.pay_status)" effect="light" size="small">
              {{ payStatusName(row.pay_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.pay_status === 'pending'"
              type="primary" size="small" link
              @click="resumePay(row)"
            >继续支付</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 购买对话框 -->
    <el-dialog v-model="purchaseVisible" title="确认购买" width="440px" class="purchase-dialog" :close-on-click-modal="false">
      <div v-if="selectedPlan" class="purchase-body">
        <div class="pb-row">
          <span class="pb-label">套餐</span>
          <span class="pb-value">{{ selectedPlan.name }}</span>
        </div>
        <div class="pb-row">
          <span class="pb-label">计费周期</span>
          <span class="pb-value">{{ cycleName(cycle) }}</span>
        </div>
        <div class="pb-row">
          <span class="pb-label">原价</span>
          <span class="pb-value">¥{{ Number(priceOf(selectedPlan)).toFixed(2) }}</span>
        </div>
        <div class="pb-row">
          <span class="pb-label">优惠券</span>
          <el-select v-model="selectedCouponId" placeholder="不使用优惠券" clearable class="coupon-select" size="small">
            <el-option v-for="c in usableCoupons" :key="c.id" :label="`${c.name}（${c.code}）`" :value="c.id" />
          </el-select>
        </div>

        <div class="pb-pay">
          <div class="pb-label">支付方式</div>
          <el-radio-group v-model="payMethod" class="pay-methods">
            <el-radio value="wechat">微信支付</el-radio>
            <el-radio value="alipay">支付宝</el-radio>
            <el-radio value="points">积分抵扣</el-radio>
          </el-radio-group>
        </div>

        <el-checkbox
          v-if="cycle !== 'lifetime'"
          v-model="autoRenewOnPurchase"
          class="pb-autorenew"
        >开通自动续费（到期前自动扣费续期）</el-checkbox>

        <el-alert
          v-if="payMethod !== 'points'"
          type="info" :closable="false" show-icon
          title="现金渠道需商户已开通"
          description="若渠道未配置商户凭据，订单将以待支付状态保留，可稍后在订单列表继续支付。"
          class="pb-alert"
        />
      </div>
      <template #footer>
        <el-button @click="purchaseVisible = false">取消</el-button>
        <el-button type="primary" :loading="purchasing" @click="confirmPurchase">
          确认支付 ¥{{ selectedPlan ? Number(priceOf(selectedPlan)).toFixed(2) : '0.00' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Trophy, DataLine, Check, Refresh } from '@element-plus/icons-vue'
import membershipAPI from '@/api/membership'

const mine = ref(null)
const quota = ref(null)
const plans = ref([])
const orders = ref([])

const loadingPlans = ref(false)
const loadingOrders = ref(false)
const autoRenewLoading = ref(false)

const cycle = ref('monthly')
const autoRenewOn = ref(false)

// 购买对话框状态
const purchaseVisible = ref(false)
const selectedPlan = ref(null)
const payMethod = ref('wechat')
const autoRenewOnPurchase = ref(false)
const purchasing = ref(false)

// S17-T02 优惠券状态
const redeemCode = ref('')
const redeeming = ref(false)
const loadingCoupons = ref(false)
const coupons = ref([])
const selectedCouponId = ref(null)
const usableCoupons = computed(() => coupons.value.filter(c => c.status === 'claimed'))

const currentBadgeColor = computed(() => mine.value?.plan?.badge_color || 'linear-gradient(135deg,#a855f7,#6366f1)')

const cycleLabel = computed(() => cycleName(cycle.value))
const cycleUnit = computed(() => (cycle.value === 'monthly' ? '月' : cycle.value === 'yearly' ? '年' : '永久'))

// 免费版不在“终身”视图重复展示，其余按 level_rank 升序
const visiblePlans = computed(() => {
  return [...plans.value]
    .filter((p) => p.enabled !== 0 && p.enabled !== false)
    .sort((a, b) => Number(a.level_rank) - Number(b.level_rank))
})

// 配额指标结构 → 进度条数据
const quotaMetrics = computed(() => {
  const m = quota.value?.metrics
  if (!m) return []
  const map = [
    { key: 'generation', label: '本月 AI 生成' },
    { key: 'project', label: '项目数量' },
    { key: 'storage', label: '存储空间' },
    { key: 'collaborator', label: '协作人数' }
  ]
  return map
    .filter((x) => m[x.key])
    .map((x) => {
      const item = m[x.key]
      const unlimited = item.unlimited || Number(item.limit) < 0
      const used = Number(item.used) || 0
      const limit = Number(item.limit) || 0
      const percentage = unlimited || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
      return {
        key: x.key,
        label: x.label,
        unlimited,
        used: x.key === 'storage' ? fmtStorage(used) : used,
        limit: x.key === 'storage' ? fmtStorage(limit) : limit,
        percentage
      }
    })
})

function priceOf(plan) {
  if (!plan) return null
  if (cycle.value === 'monthly') return plan.price_monthly
  if (cycle.value === 'yearly') return plan.price_yearly
  return plan.price_lifetime
}

function fmtQuota(v) {
  return Number(v) < 0 ? '不限' : (v ?? 0)
}
function fmtStorage(mb) {
  const n = Number(mb)
  if (n < 0) return '不限'
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} GB`
  return `${n} MB`
}

function cycleName(c) {
  return { monthly: '月付', yearly: '年付', lifetime: '终身' }[c] || c
}
function orderTypeName(t) {
  return { new: '新购', renew: '续费', upgrade: '升级', downgrade: '降级' }[t] || t
}
function payMethodName(m) {
  return { wechat: '微信支付', alipay: '支付宝', points: '积分抵扣' }[m] || m
}
function payStatusName(s) {
  return { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' }[s] || s
}
function payStatusTag(s) {
  return { pending: 'warning', paid: 'success', closed: 'info', refunded: 'danger' }[s] || 'info'
}

function formatDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDateTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function loadMine() {
  try {
    mine.value = await membershipAPI.getMine()
    quota.value = mine.value?.quota || null
    autoRenewOn.value = Number(mine.value?.membership?.auto_renew) === 1
  } catch (e) { /* 拦截器已提示 */ }
}

async function loadPlans() {
  loadingPlans.value = true
  try {
    const res = await membershipAPI.listPlans()
    plans.value = res?.items || []
  } finally {
    loadingPlans.value = false
  }
}

async function loadOrders() {
  loadingOrders.value = true
  try {
    const res = await membershipAPI.listOrders({ limit: 20, offset: 0 })
    orders.value = res?.items || []
  } finally {
    loadingOrders.value = false
  }
}

function openPurchase(plan) {
  selectedPlan.value = plan
  payMethod.value = 'wechat'
  autoRenewOnPurchase.value = false
  selectedCouponId.value = null
  purchaseVisible.value = true
}

// S17-T02 优惠券：兑换 / 列表 / 展示
async function loadCoupons() {
  loadingCoupons.value = true
  try {
    const res = await membershipAPI.listMyCoupons()
    coupons.value = (res && res.items) || []
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    loadingCoupons.value = false
  }
}

function fmtCouponValue(row) {
  return row.type === 'percent' ? `${Number(row.value).toFixed(0)}% 折扣` : `减 ¥${Number(row.value).toFixed(2)}`
}

async function onRedeem() {
  const code = redeemCode.value.trim()
  if (!code) {
    ElMessage.warning('请输入兑换码')
    return
  }
  redeeming.value = true
  try {
    await membershipAPI.redeemCoupon(code)
    ElMessage.success('兑换成功')
    redeemCode.value = ''
    await loadCoupons()
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    redeeming.value = false
  }
}

async function confirmPurchase() {
  if (!selectedPlan.value) return
  purchasing.value = true
  try {
    const selectedCoupon = usableCoupons.value.find(c => c.id === selectedCouponId.value)
    const created = await membershipAPI.createOrder({
      level_code: selectedPlan.value.level_code,
      cycle: cycle.value,
      pay_method: payMethod.value,
      auto_renew: autoRenewOnPurchase.value,
      coupon_code: selectedCoupon ? selectedCoupon.code : undefined
    })
    const order = created?.order
    const gateway = created?.gateway
    await settleOrder(order, gateway)
  } catch (e) {
    // INSUFFICIENT_POINTS 等错误由拦截器提示
  } finally {
    purchasing.value = false
  }
}

// 依据渠道结果决定后续：积分/免费→即时确认；现金→按凭据是否配置提示
async function settleOrder(order, gateway) {
  if (!order) return
  // 积分抵扣或折抵后免费：直接确认支付即时开通
  if (order.pay_method === 'points' || (gateway && gateway.free)) {
    const res = await membershipAPI.payOrder(order.order_no, { auto_renew: autoRenewOnPurchase.value })
    if (res) {
      ElMessage.success('开通成功，已生效')
      purchaseVisible.value = false
      await Promise.all([loadMine(), loadOrders(), loadCoupons()])
    }
    return
  }
  // 现金渠道未开通：保留待支付
  if (gateway && gateway.configured === false) {
    ElMessage.warning(gateway.message || '支付渠道尚未开通，订单已保留为待支付')
    purchaseVisible.value = false
    await loadOrders()
    return
  }
  // 支付宝：官方 SDK 统一下单（S17-T06），返回真实收银台地址 → 新窗口打开并轮询支付结果
  if (order.pay_method === 'alipay' && gateway && gateway.pay_url) {
    window.open(gateway.pay_url, '_blank', 'noopener,noreferrer')
    ElMessage.info('已打开支付宝收银台，请在新窗口完成支付；支付成功后会员将自动开通')
    purchaseVisible.value = false
    await waitOrderPaid(order.order_no)
    await loadOrders()
    return
  }
  // 微信渠道已开通：订单保留为待支付，待回调开通（真实收银台需商户资质与备案后接入）
  ElMessage.info('订单已创建，请在收银台完成支付')
  purchaseVisible.value = false
  await loadOrders()
}

// 轮询订单支付状态（支付宝收银台支付完成后，后台回调自动开通会员）
async function waitOrderPaid(orderNo, maxSeconds = 300) {
  const started = Date.now()
  while (Date.now() - started < maxSeconds * 1000) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const res = await membershipAPI.listOrders({ limit: 20 })
      const found = (res?.items || []).find(o => String(o.order_no) === String(orderNo))
      if (found && found.pay_status === 'paid') {
        ElMessage.success('支付成功，会员已开通')
        await loadMine()
        return
      }
      if (found && ['closed', 'refunded'].includes(found.pay_status)) return
    } catch (_) { /* 网络抖动继续轮询 */ }
  }
}

async function resumePay(row) {
  try {
    const res = await membershipAPI.payOrder(row.order_no, {})
    if (res) {
      ElMessage.success('支付成功，会员已开通')
      await Promise.all([loadMine(), loadOrders()])
    }
  } catch (e) { /* 拦截器已提示（如渠道未开通/积分不足） */ }
}

async function onToggleAutoRenew(val) {
  autoRenewLoading.value = true
  try {
    await membershipAPI.setAutoRenew(val)
    ElMessage.success(val ? '已开启自动续费' : '已关闭自动续费')
    await loadMine()
  } catch (e) {
    autoRenewOn.value = !val // 回滚
  } finally {
    autoRenewLoading.value = false
  }
}

async function onCancel() {
  try {
    await ElMessageBox.confirm('取消后将关闭自动续费，会员权益保留至到期。确认取消吗？', '取消会员', {
      confirmButtonText: '确认取消',
      cancelButtonText: '再想想',
      type: 'warning'
    })
    await membershipAPI.cancel()
    ElMessage.success('已取消会员（保留至到期）')
    await loadMine()
  } catch (e) { /* 用户取消或拦截器提示 */ }
}

onMounted(() => {
  loadMine()
  loadPlans()
  loadOrders()
  loadCoupons()
})
</script>

<style scoped>
.membership-center {
  padding: 24px 28px 48px;
  background: #f5f5f7;
  min-height: 100vh;
  box-sizing: border-box;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  margin-bottom: 28px;
  box-shadow: 0 12px 40px rgba(49, 46, 129, 0.28);
}
.hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #6d28d9 100%);
}
.hero-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 15% 20%, rgba(168, 85, 247, 0.45), transparent 40%),
    radial-gradient(circle at 85% 80%, rgba(99, 102, 241, 0.4), transparent 45%);
}
.hero-inner {
  position: relative;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 28px;
  padding: 32px 36px;
  color: #fff;
}
.plan-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 14px;
  color: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
.hero-title {
  margin: 16px 0 8px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 1px;
}
.hero-sub {
  margin: 0;
  color: #c7d2fe;
  font-size: 14px;
}
.ml8 { margin-left: 8px; }
.hero-actions {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.cancel-btn { color: #fca5a5; }

/* 配额面板 */
.quota-panel {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  padding: 18px 20px;
  backdrop-filter: blur(6px);
}
.quota-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 16px;
  font-size: 15px;
}
.quota-title .period {
  margin-left: auto;
  font-size: 12px;
  color: #a5b4fc;
  font-weight: 400;
}
.quota-grid {
  display: grid;
  gap: 14px;
}
.quota-item-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 6px;
}
.q-label { color: #e0e7ff; }
.q-value { color: #fff; font-weight: 600; }
.q-bar :deep(.el-progress-bar__outer) { background: rgba(255, 255, 255, 0.18); }

/* ---------- Plans ---------- */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.section-head h3 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: #1e1b4b;
}
.cycle-switch :deep(.el-radio-button__inner) { font-weight: 500; }
.save-tag {
  margin-left: 6px;
  font-size: 11px;
  color: #f59e0b;
  font-weight: 600;
}
.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  margin-bottom: 36px;
}
.plan-card {
  position: relative;
  background: #fff;
  border: 2px solid #ececf3;
  border-radius: 16px;
  padding: 26px 22px;
  transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
  display: flex;
  flex-direction: column;
}
.plan-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 16px 40px rgba(99, 102, 241, 0.18);
}
.plan-card.featured {
  border-color: #a855f7;
  box-shadow: 0 12px 32px rgba(168, 85, 247, 0.22);
}
.plan-card.current {
  border-color: #6366f1;
  background: linear-gradient(180deg, #f5f3ff 0%, #fff 60%);
}
.ribbon {
  position: absolute;
  top: 14px;
  right: -30px;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #a855f7, #6366f1);
  color: #fff;
  font-size: 12px;
  padding: 4px 36px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.plan-name {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 14px;
}
.plan-price {
  display: flex;
  align-items: baseline;
  gap: 2px;
  margin-bottom: 20px;
  min-height: 44px;
}
.price-symbol { font-size: 18px; color: #1e1b4b; font-weight: 600; }
.price-num { font-size: 34px; font-weight: 800; color: #1e1b4b; }
.price-unit { font-size: 14px; color: #94a3b8; margin-left: 4px; }
.price-na { font-size: 14px; color: #cbd5e1; }
.plan-quota {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  flex: 1;
}
.plan-quota li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  font-size: 14px;
  color: #475569;
}
.plan-quota li .el-icon { color: #10b981; }
.plan-btn { width: 100%; }
.plan-btn.buy {
  --el-button-bg-color: #6366f1;
  --el-button-border-color: #6366f1;
  --el-button-hover-bg-color: #4f46e5;
  --el-button-hover-border-color: #4f46e5;
  font-weight: 600;
}

/* ---------- S17-T02 Coupons ---------- */
.coupon-section { margin-top: 36px; }
.coupon-tip {
  font-size: 12px;
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.08);
  padding: 4px 10px;
  border-radius: 999px;
}
.coupon-redeem {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  max-width: 520px;
}
.redeem-input { flex: 1; }
.coupon-table {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}
.coupon-select { width: 100%; }

/* ---------- Orders ---------- */
.orders-section { margin-top: 8px; }
.orders-table {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}

/* ---------- Purchase dialog ---------- */
.purchase-dialog :deep(.el-dialog) { border-radius: 14px; }
.purchase-body { padding: 4px 2px; }
.pb-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px dashed #eee;
  font-size: 14px;
}
.pb-label { color: #64748b; }
.pb-value { color: #1e293b; font-weight: 600; }
.pb-pay { margin: 16px 0 8px; }
.pay-methods {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.pb-autorenew { margin-top: 8px; }
.pb-alert { margin-top: 14px; }

@media (max-width: 900px) {
  .hero-inner { grid-template-columns: 1fr; }
}
</style>
