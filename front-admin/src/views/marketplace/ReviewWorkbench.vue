<template>
  <div class="mkt-workbench">
    <!-- 顶部：市场概览指标 -->
    <el-card shadow="never" class="top-card">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#a78bfa"><Shop /></el-icon>
          <span>模板市场审核工作台</span>
          <span class="subtitle">模板审核 · 创作者认证 · 提现审核 · 分成参数</span>
        </div>
        <el-button :icon="Refresh" :loading="loadingStats" @click="loadStats">刷新概览</el-button>
      </div>
      <div class="stat-grid" v-loading="loadingStats && !statsLoaded" element-loading-text="加载概览…">
        <template v-if="statsLoaded">
          <div class="stat-cell">
            <div class="stat-num">{{ stats.templates.listed }}</div>
            <div class="stat-label">在售模板</div>
          </div>
          <div class="stat-cell warn">
            <div class="stat-num">{{ stats.templates.in_review }}</div>
            <div class="stat-label">待审核</div>
          </div>
          <div class="stat-cell">
            <div class="stat-num">{{ stats.transactions.downloads }}</div>
            <div class="stat-label">累计获取</div>
          </div>
          <div class="stat-cell">
            <div class="stat-num">¥{{ fmtMoney(stats.transactions.gmv) }}</div>
            <div class="stat-label">成交额 GMV</div>
          </div>
          <div class="stat-cell">
            <div class="stat-num">¥{{ fmtMoney(stats.revenue.platform_income) }}</div>
            <div class="stat-label">平台分成收入</div>
          </div>
          <div class="stat-cell">
            <div class="stat-num">{{ stats.creators.approved }}<em>/{{ stats.creators.total }}</em></div>
            <div class="stat-label">认证创作者</div>
          </div>
        </template>
        <!-- 首屏拉取前的骨架占位，避免瞬时显示「0 / 暂无数据」 -->
        <template v-else>
          <div v-for="n in 6" :key="n" class="stat-cell skeleton">
            <div class="stat-num skeleton-bar"></div>
            <div class="stat-label skeleton-bar sm"></div>
          </div>
        </template>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" class="mkt-tabs" @tab-change="onTabChange">
      <!-- ================= 模板审核队列 ================= -->
      <el-tab-pane name="review">
        <template #label>
          <span class="tab-label">
            模板审核
            <el-badge v-if="stats.templates.in_review" :value="stats.templates.in_review" type="danger" class="tab-badge" />
          </span>
        </template>

        <el-card shadow="never" class="filter-card">
          <div class="filters">
            <el-select v-model="reviewFilter.status" style="width: 160px" @change="reloadReviewQueue">
              <el-option label="待处理（默认）" value="" />
              <el-option label="待审核 pending" value="pending" />
              <el-option label="AI通过待复审" value="ai_passed" />
              <el-option label="已上架 listed" value="listed" />
              <el-option label="已驳回 rejected" value="rejected" />
              <el-option label="已下架 delisted" value="delisted" />
              <el-option label="全部" value="all" />
            </el-select>
            <el-button :icon="Refresh" :loading="loadingQueue" @click="reloadReviewQueue">刷新</el-button>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <el-table :data="queue" v-loading="loadingQueue" stripe border row-key="id">
            <el-table-column label="模板" min-width="240">
              <template #default="{ row }">
                <div class="tpl-cell">
                  <el-image
                    v-if="assetUrl(row.cover_image)"
                    :src="assetUrl(row.cover_image)"
                    fit="cover"
                    class="tpl-cover"
                    :preview-src-list="[assetUrl(row.cover_image)]"
                    preview-teleported
                  />
                  <div v-else class="tpl-cover placeholder"><el-icon><Picture /></el-icon></div>
                  <div class="tpl-cell-text">
                    <div class="tpl-cell-title" :title="row.title">{{ row.title }}</div>
                    <div class="tpl-cell-sub">{{ row.template_no }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="创作者" width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.creator_name || '—' }}</template>
            </el-table-column>
            <el-table-column label="分类" width="100">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ categoryLabel(row.category) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="定价" width="110">
              <template #default="{ row }">{{ priceLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="AI 预审" width="130">
              <template #default="{ row }">
                <div v-if="row.ai_review_passed != null" class="ai-cell">
                  <el-tag :type="row.ai_review_passed ? 'success' : 'danger'" size="small" effect="light">
                    {{ row.ai_review_passed ? 'AI通过' : 'AI驳回' }}
                  </el-tag>
                  <span class="ai-score">{{ Number(row.ai_review_score).toFixed(0) }}分</span>
                </div>
                <span v-else class="text-muted">未预审</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="openReviewDrawer(row)">审核</el-button>
                <el-button
                  v-if="row.status === 'listed'"
                  size="small" link type="warning"
                  @click="doListing(row, false)"
                >下架</el-button>
                <el-button
                  v-else-if="row.status === 'delisted'"
                  size="small" link type="success"
                  @click="doListing(row, true)"
                >恢复上架</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="queuePage"
              v-model:page-size="queuePageSize"
              :total="queueTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next, jumper"
              @current-change="loadReviewQueue"
              @size-change="onQueueSizeChange"
            />
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 创作者认证 ================= -->
      <el-tab-pane label="创作者认证" name="creators">
        <el-card shadow="never" class="filter-card">
          <div class="filters">
            <el-select v-model="creatorFilter.verify_status" placeholder="认证状态" clearable style="width: 160px" @change="reloadCreators">
              <el-option label="待认证 pending" value="pending" />
              <el-option label="已认证 approved" value="approved" />
              <el-option label="已驳回 rejected" value="rejected" />
            </el-select>
            <el-input
              v-model="creatorFilter.keyword"
              placeholder="搜索展示名 / 联系方式"
              clearable
              style="width: 240px"
              @keyup.enter="reloadCreators"
              @clear="reloadCreators"
            />
            <el-button :icon="Search" @click="reloadCreators">搜索</el-button>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <el-table :data="creators" v-loading="loadingCreators" stripe border row-key="id">
            <el-table-column label="创作者" min-width="200">
              <template #default="{ row }">
                <div class="creator-cell">
                  <el-avatar :size="36" :src="assetUrl(row.avatar)">
                    <el-icon><UserFilled /></el-icon>
                  </el-avatar>
                  <div class="creator-text">
                    <div class="creator-name">{{ row.display_name }}</div>
                    <div class="creator-sub">用户ID: {{ row.user_id }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="联系方式" width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.contact || '—' }}</template>
            </el-table-column>
            <el-table-column label="收款渠道" width="150">
              <template #default="{ row }">
                <span v-if="row.settle_account">{{ settleLabel(row.settle_account_type) }} · {{ maskAccount(row.settle_account) }}</span>
                <span v-else class="text-muted">未填写</span>
              </template>
            </el-table-column>
            <el-table-column label="分成比例" width="110" align="center">
              <template #default="{ row }">
                {{ row.commission_rate == null ? `默认 ${creatorPct(platformRate)}` : creatorPct(row.commission_rate) }}
              </template>
            </el-table-column>
            <el-table-column label="上架/收益" width="140">
              <template #default="{ row }">{{ row.template_count || 0 }} 个 / ¥{{ fmtMoney(row.total_income) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="verifyTag(row.verify_status)" size="small" effect="dark">{{ verifyLabel(row.verify_status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="row.verify_status === 'pending'"
                  size="small" link type="primary"
                  @click="openVerifyDialog(row)"
                >认证审核</el-button>
                <el-button size="small" link @click="openVerifyDialog(row)">调整</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="creatorPage"
              v-model:page-size="creatorPageSize"
              :total="creatorTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next, jumper"
              @current-change="loadCreators"
              @size-change="onCreatorSizeChange"
            />
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 提现审核 ================= -->
      <el-tab-pane label="提现审核" name="withdrawals">
        <el-card shadow="never" class="filter-card">
          <div class="filters">
            <el-select v-model="withdrawFilter.status" placeholder="提现状态" clearable style="width: 160px" @change="reloadWithdrawals">
              <el-option label="待审核 pending" value="pending" />
              <el-option label="已通过 approved" value="approved" />
              <el-option label="已打款 paid" value="paid" />
              <el-option label="已驳回 rejected" value="rejected" />
            </el-select>
            <el-button :icon="Refresh" :loading="loadingWithdrawals" @click="reloadWithdrawals">刷新</el-button>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <el-table :data="withdrawals" v-loading="loadingWithdrawals" stripe border row-key="id">
            <el-table-column prop="withdraw_no" label="提现单号" min-width="180" show-overflow-tooltip />
            <el-table-column label="创作者" width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.creator_name || `#${row.creator_id}` }}</template>
            </el-table-column>
            <el-table-column label="金额" width="120">
              <template #default="{ row }"><span class="money">¥{{ fmtMoney(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column label="收款账户" min-width="180">
              <template #default="{ row }">
                <span v-if="row.account">{{ settleLabel(row.account_type) }} · {{ maskAccount(row.account) }}</span>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="申请时间" width="170">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="withdrawTag(row.status)" size="small" effect="dark">{{ withdrawLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="170" fixed="right">
              <template #default="{ row }">
                <template v-if="row.status === 'pending'">
                  <el-button size="small" link type="success" @click="openWithdrawReview(row, true)">通过打款</el-button>
                  <el-button size="small" link type="danger" @click="openWithdrawReview(row, false)">驳回</el-button>
                </template>
                <span v-else class="text-muted" :title="row.review_remark || ''">{{ row.review_remark || '已处理' }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrap">
            <el-pagination
              v-model:current-page="withdrawPage"
              v-model:page-size="withdrawPageSize"
              :total="withdrawTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next, jumper"
              @current-change="loadWithdrawals"
              @size-change="onWithdrawSizeChange"
            />
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 平台参数 ================= -->
      <el-tab-pane label="分成参数" name="settings">
        <el-card shadow="never" class="settings-card">
          <div class="settings-head">
            <el-icon :size="20" color="#a78bfa"><Setting /></el-icon>
            <span>分成与提现参数</span>
          </div>
          <el-form label-width="140px" class="settings-form">
            <el-form-item label="平台分成比例">
              <div class="rate-row">
                <el-slider
                  v-model="settingsForm.platform_rate_pct"
                  :min="0" :max="90" :step="1"
                  show-input
                  class="rate-slider"
                />
                <span class="rate-hint">平台抽成 <b>{{ settingsForm.platform_rate_pct }}%</b>，创作者获得 <b>{{ 100 - settingsForm.platform_rate_pct }}%</b></span>
              </div>
            </el-form-item>
            <el-form-item label="最低提现金额">
              <el-input-number v-model="settingsForm.min_withdrawal" :min="1" :step="1" :precision="2" />
              <span class="rate-hint">元起提</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingSettings" @click="saveSettings">保存参数</el-button>
            </el-form-item>
          </el-form>
          <el-alert
            type="info"
            :closable="false"
            title="说明：分成比例在下一笔付费购买结算时生效；对已设置「专属分成比例」的创作者，以其专属比例为准。"
            show-icon
          />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 模板审核抽屉 -->
    <el-drawer v-model="reviewVisible" :title="reviewTpl?.title || '模板审核'" size="48%" class="review-drawer" @closed="onReviewClosed">
      <div v-if="reviewLoading" v-loading="true" class="drawer-loading" />
      <div v-else-if="reviewTpl" class="review-detail">
        <div class="review-cover-wrap">
          <el-image
            v-if="assetUrl(reviewTpl.cover_image)"
            :src="assetUrl(reviewTpl.cover_image)"
            fit="cover"
            class="review-cover"
            :preview-src-list="previewImages"
            preview-teleported
          />
          <div v-else class="review-cover placeholder"><el-icon :size="40"><Picture /></el-icon></div>
        </div>

        <div class="review-head">
          <h3>{{ reviewTpl.title }}</h3>
          <div class="review-tags">
            <el-tag size="small" type="info">{{ categoryLabel(reviewTpl.category) }}</el-tag>
            <el-tag size="small">{{ priceLabel(reviewTpl) }}</el-tag>
            <el-tag :type="statusTag(reviewTpl.status)" size="small" effect="dark">{{ statusLabel(reviewTpl.status) }}</el-tag>
          </div>
          <p class="review-meta">编号 {{ reviewTpl.template_no }} · 创作者 {{ reviewTpl.creator_name || '—' }}</p>
          <p v-if="reviewTpl.summary" class="review-summary">{{ reviewTpl.summary }}</p>
        </div>

        <!-- AI 预审结果 -->
        <template v-if="reviewTpl.review_state?.ai_review_detail">
          <el-divider content-position="left">AI 预审结果</el-divider>
          <div class="ai-panel" :class="{ blocked: !reviewTpl.review_state.ai_review_passed }">
            <div class="ai-panel-row">
              <span>合规综合分</span>
              <b>{{ Number(reviewTpl.review_state.ai_review_score).toFixed(1) }} / 100</b>
            </div>
            <div class="ai-panel-row">
              <span>预审结论</span>
              <el-tag :type="reviewTpl.review_state.ai_review_passed ? 'success' : 'danger'" size="small">
                {{ reviewTpl.review_state.ai_review_passed ? '通过（待人工复核）' : '拦截（严重违规）' }}
              </el-tag>
            </div>
            <div v-if="aiSegments.length" class="ai-hits">
              <div class="ai-hits-title">命中风险片段：</div>
              <div v-for="(seg, i) in aiSegments" :key="i" class="ai-hit">
                <el-tag size="small" type="warning">{{ segFieldLabel(seg.field) }}</el-tag>
                <span class="ai-hit-label">{{ seg.riskLabel }}</span>
                <span class="ai-hit-score">{{ seg.riskScore }}分</span>
              </div>
            </div>
            <div v-else class="ai-clean">未检出风险片段</div>
          </div>
        </template>

        <!-- 模板内容摘要 -->
        <el-divider content-position="left">模板内容</el-divider>
        <div class="content-summary">
          <div class="cs-item"><span>角色预设</span><b>{{ contentCounts.characters }} 个</b></div>
          <div class="cs-item"><span>场景预设</span><b>{{ contentCounts.scenes }} 个</b></div>
          <div class="cs-item"><span>风格配置</span><b>{{ contentCounts.hasStyle ? '已配置' : '无' }}</b></div>
        </div>
        <div v-if="reviewTpl.description" class="review-desc">{{ reviewTpl.description }}</div>

        <!-- 审核轨迹 -->
        <el-divider content-position="left">审核轨迹</el-divider>
        <el-timeline v-if="reviewLogs.length" class="review-timeline">
          <el-timeline-item
            v-for="log in reviewLogs"
            :key="log.id"
            :timestamp="fmtTime(log.created_at)"
            :type="logDotType(log.action)"
            placement="top"
          >
            <div class="log-action">{{ actionLabel(log.action) }}
              <span v-if="log.from_status || log.to_status" class="log-flow">
                {{ statusLabel(log.from_status) }} → {{ statusLabel(log.to_status) }}
              </span>
            </div>
            <div v-if="log.remark" class="log-remark">{{ log.remark }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无审核记录" :image-size="50" />

        <!-- 复审操作 -->
        <div v-if="canManualReview" class="review-actions">
          <el-input
            v-model="reviewRemark"
            type="textarea"
            :rows="2"
            placeholder="审核意见（驳回时必填）"
            maxlength="500"
            show-word-limit
          />
          <div class="review-btns">
            <el-button type="danger" plain :loading="submittingReview" @click="submitReview(false)">驳回</el-button>
            <el-button type="success" :loading="submittingReview" @click="submitReview(true)">通过上架</el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 创作者认证对话框 -->
    <el-dialog v-model="verifyVisible" title="创作者认证审核" width="480px" @closed="verifyTarget = null">
      <div v-if="verifyTarget" class="verify-body">
        <div class="verify-brief">
          <el-avatar :size="48" :src="assetUrl(verifyTarget.avatar)">
            <el-icon><UserFilled /></el-icon>
          </el-avatar>
          <div>
            <div class="verify-name">{{ verifyTarget.display_name }}</div>
            <div class="verify-sub">{{ verifyTarget.contact || '未填写联系方式' }}</div>
          </div>
        </div>
        <p v-if="verifyTarget.bio" class="verify-bio">{{ verifyTarget.bio }}</p>
        <el-form label-width="110px">
          <el-form-item label="专属分成比例">
            <el-input-number
              v-model="verifyForm.creator_pct"
              :min="0" :max="90" :step="1"
              placeholder="留空用平台默认"
            />
            <span class="rate-hint">% 平台抽成，留空则用默认 {{ platformPct }}%</span>
          </el-form-item>
          <el-form-item label="审核意见">
            <el-input v-model="verifyForm.remark" type="textarea" :rows="2" placeholder="驳回时必填" maxlength="500" show-word-limit />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="verifyVisible = false">取消</el-button>
        <el-button type="danger" plain :loading="submittingVerify" @click="submitVerify(false)">驳回</el-button>
        <el-button type="primary" :loading="submittingVerify" @click="submitVerify(true)">通过认证</el-button>
      </template>
    </el-dialog>

    <!-- 提现审核对话框 -->
    <el-dialog v-model="withdrawReviewVisible" :title="withdrawApprove ? '通过并打款' : '驳回提现'" width="440px" @closed="withdrawTarget = null">
      <div v-if="withdrawTarget" class="withdraw-body">
        <div class="withdraw-line"><span>创作者</span><b>{{ withdrawTarget.creator_name || `#${withdrawTarget.creator_id}` }}</b></div>
        <div class="withdraw-line"><span>提现金额</span><b class="money">¥{{ fmtMoney(withdrawTarget.amount) }}</b></div>
        <div class="withdraw-line"><span>收款账户</span><b>{{ settleLabel(withdrawTarget.account_type) }} · {{ maskAccount(withdrawTarget.account) }}</b></div>
        <el-input
          v-model="withdrawRemark"
          type="textarea"
          :rows="2"
          :placeholder="withdrawApprove ? '打款备注（选填）' : '驳回原因（必填）'"
          maxlength="500"
          show-word-limit
          style="margin-top: 12px"
        />
        <el-alert
          v-if="withdrawApprove"
          type="warning"
          :closable="false"
          show-icon
          title="通过后视为已完成线下打款，创作者已提现金额将累加。"
          style="margin-top: 10px"
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          title="驳回后冻结金额将退回创作者可提现余额。"
          style="margin-top: 10px"
        />
      </div>
      <template #footer>
        <el-button @click="withdrawReviewVisible = false">取消</el-button>
        <el-button :type="withdrawApprove ? 'success' : 'danger'" :loading="submittingWithdraw" @click="submitWithdrawReview">
          {{ withdrawApprove ? '确认打款' : '确认驳回' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Shop, Refresh, Search, Picture, UserFilled, Setting } from '@element-plus/icons-vue'
import { marketplaceAdminAPI } from '@/api/marketplace'

// ============ 概览 ============
const emptyStats = () => ({
  templates: { total: 0, listed: 0, in_review: 0, paid: 0 },
  transactions: { downloads: 0, purchases: 0, gmv: 0 },
  revenue: { platform_income: 0, creator_income: 0 },
  creators: { total: 0, approved: 0 },
  platform_rate: 0.3
})
const stats = ref(emptyStats())
const loadingStats = ref(false)
// 首屏概览是否已成功拉取；用于骨架占位，避免拉取完成前瞬时渲染「0 / 暂无数据」
const statsLoaded = ref(false)
const platformRate = computed(() => Number(stats.value.platform_rate) || 0.3)
const platformPct = computed(() => Math.round(platformRate.value * 100))

async function loadStats() {
  loadingStats.value = true
  try {
    const res = await marketplaceAdminAPI.stats()
    stats.value = { ...emptyStats(), ...res }
    statsLoaded.value = true
  } catch (e) {
    // 拉取失败时保留已有概览（若首屏则维持骨架态），并显式提示，避免静默清零误导
    if (!statsLoaded.value) stats.value = emptyStats()
    ElMessage.error('概览数据加载失败，请点击「刷新概览」重试')
  } finally {
    loadingStats.value = false
  }
}

const activeTab = ref('review')
function onTabChange(name) {
  if (name === 'review' && !queue.value.length) loadReviewQueue()
  if (name === 'creators' && !creators.value.length) loadCreators()
  if (name === 'withdrawals' && !withdrawals.value.length) loadWithdrawals()
  if (name === 'settings') syncSettingsForm()
}

// ============ 模板审核队列 ============
const queue = ref([])
const queueTotal = ref(0)
const queuePage = ref(1)
const queuePageSize = ref(20)
const loadingQueue = ref(false)
const reviewFilter = reactive({ status: '' })

async function loadReviewQueue() {
  loadingQueue.value = true
  try {
    const res = await marketplaceAdminAPI.reviewQueue({
      status: reviewFilter.status || undefined,
      page: queuePage.value,
      page_size: queuePageSize.value
    })
    queue.value = res?.items ?? []
    queueTotal.value = res?.total ?? queue.value.length
  } catch (e) {
    queue.value = []
  } finally {
    loadingQueue.value = false
  }
}
function reloadReviewQueue() { queuePage.value = 1; loadReviewQueue() }
function onQueueSizeChange() { queuePage.value = 1; loadReviewQueue() }

// 审核抽屉
const reviewVisible = ref(false)
const reviewLoading = ref(false)
const reviewTpl = ref(null)
const reviewLogs = ref([])
const reviewRemark = ref('')
const submittingReview = ref(false)

async function openReviewDrawer(row) {
  reviewVisible.value = true
  reviewLoading.value = true
  reviewTpl.value = null
  reviewLogs.value = []
  reviewRemark.value = ''
  try {
    const [detail, logs] = await Promise.all([
      marketplaceAdminAPI.getTemplate(row.id),
      marketplaceAdminAPI.reviewLogs(row.id)
    ])
    reviewTpl.value = detail
    reviewLogs.value = logs?.items ?? []
  } catch (e) {
    reviewVisible.value = false
  } finally {
    reviewLoading.value = false
  }
}
function onReviewClosed() {
  reviewTpl.value = null
  reviewLogs.value = []
  reviewRemark.value = ''
}

const canManualReview = computed(() =>
  reviewTpl.value && ['pending', 'ai_reviewing', 'ai_passed'].includes(reviewTpl.value.status)
)
const aiSegments = computed(() => {
  const d = reviewTpl.value?.review_state?.ai_review_detail
  return Array.isArray(d?.segments) ? d.segments : []
})
const previewImages = computed(() => {
  const t = reviewTpl.value
  if (!t) return []
  const list = []
  if (t.cover_image) list.push(assetUrl(t.cover_image))
  const previews = Array.isArray(t.preview_images) ? t.preview_images : []
  previews.forEach((p) => { const u = assetUrl(p); if (u) list.push(u) })
  return list
})
const contentCounts = computed(() => {
  const c = reviewTpl.value?.content || {}
  return {
    characters: Array.isArray(c.character_presets) ? c.character_presets.length : 0,
    scenes: Array.isArray(c.scene_presets) ? c.scene_presets.length : 0,
    hasStyle: !!c.style_config
  }
})

async function submitReview(approve) {
  if (!approve && !reviewRemark.value.trim()) {
    ElMessage.warning('驳回必须填写审核意见')
    return
  }
  submittingReview.value = true
  try {
    await marketplaceAdminAPI.review(reviewTpl.value.template_id ?? reviewTpl.value.id, {
      approve,
      remark: reviewRemark.value.trim() || undefined
    })
    ElMessage.success(approve ? '已通过并上架' : '已驳回')
    reviewVisible.value = false
    await Promise.all([loadReviewQueue(), loadStats()])
  } catch (e) {
    // request 拦截器已提示
  } finally {
    submittingReview.value = false
  }
}

async function doListing(row, listed) {
  try {
    if (!listed) {
      await ElMessageBox.confirm(`确认下架模板「${row.title}」？下架后用户将无法获取。`, '下架确认', { type: 'warning' })
    }
    await marketplaceAdminAPI.setListing(row.id, { listed })
    ElMessage.success(listed ? '已恢复上架' : '已下架')
    await Promise.all([loadReviewQueue(), loadStats()])
  } catch (e) {
    if (e === 'cancel') return
  }
}

// ============ 创作者认证 ============
const creators = ref([])
const creatorTotal = ref(0)
const creatorPage = ref(1)
const creatorPageSize = ref(20)
const loadingCreators = ref(false)
const creatorFilter = reactive({ verify_status: '', keyword: '' })

async function loadCreators() {
  loadingCreators.value = true
  try {
    const res = await marketplaceAdminAPI.listCreators({
      verify_status: creatorFilter.verify_status || undefined,
      keyword: creatorFilter.keyword || undefined,
      page: creatorPage.value,
      page_size: creatorPageSize.value
    })
    creators.value = res?.items ?? []
    creatorTotal.value = res?.total ?? creators.value.length
  } catch (e) {
    creators.value = []
  } finally {
    loadingCreators.value = false
  }
}
function reloadCreators() { creatorPage.value = 1; loadCreators() }
function onCreatorSizeChange() { creatorPage.value = 1; loadCreators() }

const verifyVisible = ref(false)
const verifyTarget = ref(null)
const verifyForm = reactive({ creator_pct: null, remark: '' })
const submittingVerify = ref(false)

function openVerifyDialog(row) {
  verifyTarget.value = row
  // 后端 commission_rate 为「创作者分成比例」抑或平台？以 schema 注释：commission_rate 为专属分成比例(创作者所得占比)?
  // 实为平台默认 rate 存 marketplace_platform_rate=平台抽成；creator commission_rate 语义同为「平台抽成比例」保持一致
  verifyForm.creator_pct = row.commission_rate == null ? null : Math.round(Number(row.commission_rate) * 100)
  verifyForm.remark = ''
  verifyVisible.value = true
}

async function submitVerify(approve) {
  if (!approve && !verifyForm.remark.trim()) {
    ElMessage.warning('驳回必须填写审核意见')
    return
  }
  submittingVerify.value = true
  try {
    const payload = { approve, remark: verifyForm.remark.trim() || undefined }
    if (approve && verifyForm.creator_pct != null && verifyForm.creator_pct !== '') {
      payload.commission_rate = Number((verifyForm.creator_pct / 100).toFixed(4))
    }
    await marketplaceAdminAPI.verifyCreator(verifyTarget.value.id, payload)
    ElMessage.success(approve ? '已通过认证' : '已驳回')
    verifyVisible.value = false
    await Promise.all([loadCreators(), loadStats()])
  } catch (e) {
    // request 拦截器已提示
  } finally {
    submittingVerify.value = false
  }
}

// ============ 提现审核 ============
const withdrawals = ref([])
const withdrawTotal = ref(0)
const withdrawPage = ref(1)
const withdrawPageSize = ref(20)
const loadingWithdrawals = ref(false)
const withdrawFilter = reactive({ status: '' })

async function loadWithdrawals() {
  loadingWithdrawals.value = true
  try {
    const res = await marketplaceAdminAPI.listWithdrawals({
      status: withdrawFilter.status || undefined,
      page: withdrawPage.value,
      page_size: withdrawPageSize.value
    })
    withdrawals.value = res?.items ?? []
    withdrawTotal.value = res?.total ?? withdrawals.value.length
  } catch (e) {
    withdrawals.value = []
  } finally {
    loadingWithdrawals.value = false
  }
}
function reloadWithdrawals() { withdrawPage.value = 1; loadWithdrawals() }
function onWithdrawSizeChange() { withdrawPage.value = 1; loadWithdrawals() }

const withdrawReviewVisible = ref(false)
const withdrawTarget = ref(null)
const withdrawApprove = ref(true)
const withdrawRemark = ref('')
const submittingWithdraw = ref(false)

function openWithdrawReview(row, approve) {
  withdrawTarget.value = row
  withdrawApprove.value = approve
  withdrawRemark.value = ''
  withdrawReviewVisible.value = true
}

async function submitWithdrawReview() {
  if (!withdrawApprove.value && !withdrawRemark.value.trim()) {
    ElMessage.warning('驳回必须填写原因')
    return
  }
  submittingWithdraw.value = true
  try {
    await marketplaceAdminAPI.reviewWithdrawal(withdrawTarget.value.id, {
      approve: withdrawApprove.value,
      remark: withdrawRemark.value.trim() || undefined
    })
    ElMessage.success(withdrawApprove.value ? '已通过打款' : '已驳回')
    withdrawReviewVisible.value = false
    await loadWithdrawals()
  } catch (e) {
    // request 拦截器已提示
  } finally {
    submittingWithdraw.value = false
  }
}

// ============ 平台参数 ============
const settingsForm = reactive({ platform_rate_pct: 30, min_withdrawal: 10 })
const savingSettings = ref(false)

function syncSettingsForm() {
  settingsForm.platform_rate_pct = Math.round(platformRate.value * 100)
  // min_withdrawal 无独立 stats 字段，保留当前值（首次以默认 10 呈现，保存后回读）
}

async function saveSettings() {
  savingSettings.value = true
  try {
    const res = await marketplaceAdminAPI.updateSettings({
      platform_rate: Number((settingsForm.platform_rate_pct / 100).toFixed(4)),
      min_withdrawal: Number(settingsForm.min_withdrawal)
    })
    if (res?.platform_rate != null) {
      stats.value.platform_rate = Number(res.platform_rate)
      settingsForm.platform_rate_pct = Math.round(Number(res.platform_rate) * 100)
    }
    if (res?.min_withdrawal != null) settingsForm.min_withdrawal = Number(res.min_withdrawal)
    ElMessage.success('参数已保存')
    await loadStats()
  } catch (e) {
    // request 拦截器已提示
  } finally {
    savingSettings.value = false
  }
}

// ============ 工具函数 ============
const STATIC_BASE = ''
function assetUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u
  if (u.startsWith('/static') || u.startsWith('/api')) return u
  return `${STATIC_BASE}${u.startsWith('/') ? '' : '/'}${u}`
}
function fmtMoney(v) { return Number(v || 0).toFixed(2) }
function fmtTime(t) {
  if (!t) return '—'
  const d = new Date(String(t).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function priceLabel(t) {
  if (!t) return '—'
  if (t.pricing_type !== 'paid' || Number(t.price) === 0) return '免费'
  return `¥${Number(t.price).toFixed(2)}`
}
function creatorPct(rate) {
  const r = Number(rate)
  if (!Number.isFinite(r)) return '—'
  return `创作者 ${Math.round((1 - r) * 100)}%`
}
function maskAccount(acc) {
  if (!acc) return '—'
  const s = String(acc)
  if (s.length <= 4) return s
  return `${s.slice(0, 3)}****${s.slice(-2)}`
}

const CATEGORY_MAP = {
  urban: '都市', ancient: '古风', scifi: '科幻', campus: '校园',
  suspense: '悬疑', romance: '言情', fantasy: '玄幻', general: '通用'
}
function categoryLabel(c) { return CATEGORY_MAP[c] || c || '通用' }

const STATUS_MAP = {
  draft: '草稿', pending: '待审核', ai_reviewing: 'AI预审中', ai_passed: 'AI通过',
  rejected: '已驳回', listed: '已上架', delisted: '已下架'
}
function statusLabel(s) { return STATUS_MAP[s] || s || '—' }
function statusTag(s) {
  return { listed: 'success', pending: 'warning', ai_passed: 'primary', ai_reviewing: 'info', rejected: 'danger', delisted: 'info', draft: 'info' }[s] || 'info'
}

const VERIFY_MAP = { pending: '待认证', approved: '已认证', rejected: '已驳回' }
function verifyLabel(s) { return VERIFY_MAP[s] || s || '—' }
function verifyTag(s) { return { approved: 'success', pending: 'warning', rejected: 'danger' }[s] || 'info' }

const WITHDRAW_MAP = { pending: '待审核', approved: '已通过', paid: '已打款', rejected: '已驳回' }
function withdrawLabel(s) { return WITHDRAW_MAP[s] || s || '—' }
function withdrawTag(s) { return { paid: 'success', approved: 'primary', pending: 'warning', rejected: 'danger' }[s] || 'info' }

const SETTLE_MAP = { alipay: '支付宝', wechat: '微信', bank: '银行卡' }
function settleLabel(t) { return SETTLE_MAP[t] || t || '账户' }

const ACTION_MAP = {
  submit: '提交审核', resubmit: '重新提交', ai_pass: 'AI预审通过', ai_reject: 'AI预审驳回',
  approve: '人工复审通过', reject: '人工复审驳回', delist: '下架', relist: '恢复上架'
}
function actionLabel(a) { return ACTION_MAP[a] || a }
function logDotType(a) {
  return { approve: 'success', ai_pass: 'success', relist: 'success', reject: 'danger', ai_reject: 'danger', delist: 'warning', submit: 'primary', resubmit: 'primary' }[a] || 'info'
}
function segFieldLabel(f) {
  return { title: '标题', summary: '简介', description: '描述', tags: '标签' }[f] || f
}

onMounted(async () => {
  await loadStats()
  await loadReviewQueue()
  syncSettingsForm()
})
</script>

<style scoped>
.mkt-workbench { padding: 16px; }

.top-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
.toolbar-title .subtitle { color: var(--text-subtle); font-size: 13px; font-weight: 400; margin-left: 8px; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-top: 16px;
}
.stat-cell {
  background: var(--bg-inner);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
}
.stat-cell.warn { border-color: #f59e0b55; background: linear-gradient(180deg, #f59e0b12, transparent); }
.stat-num { font-size: 22px; font-weight: 700; color: var(--text-bright); }
.stat-num em { font-size: 14px; color: var(--text-subtle); font-style: normal; }
.stat-label { font-size: 12px; color: var(--text-subtle); margin-top: 4px; }

/* 首屏概览骨架占位 */
.stat-cell.skeleton { pointer-events: none; }
.skeleton-bar {
  margin: 0 auto;
  height: 22px; width: 60%;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-page) 25%, var(--border-color) 37%, var(--bg-page) 63%);
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
}
.skeleton-bar.sm { height: 12px; width: 42%; margin-top: 8px; }
@keyframes skeleton-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

.mkt-tabs { margin-top: 16px; }
.tab-label { display: inline-flex; align-items: center; gap: 4px; }
.tab-badge { margin-left: 2px; }

.filter-card { margin-top: 4px; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.pagination-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }
.text-muted { color: var(--text-subtle); }
.money { color: #f59e0b; font-weight: 600; }

/* 模板单元格 */
.tpl-cell { display: flex; align-items: center; gap: 10px; }
.tpl-cover { width: 48px; height: 48px; border-radius: 6px; flex-shrink: 0; }
.tpl-cover.placeholder {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-page); color: var(--text-subtle); border: 1px solid var(--border-color);
}
.tpl-cell-text { min-width: 0; }
.tpl-cell-title { font-weight: 600; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tpl-cell-sub { font-size: 12px; color: var(--text-subtle); }

.ai-cell { display: flex; align-items: center; gap: 6px; }
.ai-score { font-size: 12px; color: var(--text-subtle); }

/* 创作者单元格 */
.creator-cell { display: flex; align-items: center; gap: 10px; }
.creator-name { font-weight: 600; color: var(--text-bright); }
.creator-sub { font-size: 12px; color: var(--text-subtle); }

/* 审核抽屉 */
.drawer-loading { height: 200px; }
.review-detail { padding: 0 4px 24px; }
.review-cover-wrap { width: 100%; }
.review-cover { width: 100%; height: 200px; border-radius: 10px; }
.review-cover.placeholder {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-page); color: var(--text-subtle); border: 1px solid var(--border-color);
}
.review-head h3 { margin: 14px 0 8px; font-size: 1.15rem; color: var(--text-bright); }
.review-tags { display: flex; gap: 6px; margin-bottom: 8px; }
.review-meta { color: var(--text-subtle); font-size: 0.82rem; margin: 0 0 6px; }
.review-summary { color: var(--text-muted); font-size: 0.9rem; margin: 0; line-height: 1.5; }

.ai-panel {
  background: var(--bg-inner); border: 1px solid var(--border-color);
  border-radius: 10px; padding: 12px 14px;
}
.ai-panel.blocked { border-color: #ef444455; background: linear-gradient(180deg, #ef444412, transparent); }
.ai-panel-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 0.9rem; color: var(--text-muted); }
.ai-panel-row b { color: var(--text-bright); }
.ai-hits { margin-top: 8px; }
.ai-hits-title { font-size: 0.82rem; color: var(--text-subtle); margin-bottom: 6px; }
.ai-hit { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 0.85rem; }
.ai-hit-label { color: #f59e0b; }
.ai-hit-score { color: var(--text-subtle); }
.ai-clean { font-size: 0.85rem; color: #22c55e; margin-top: 6px; }

.content-summary { display: flex; gap: 12px; }
.cs-item {
  flex: 1; background: var(--bg-inner); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 10px; text-align: center;
}
.cs-item span { display: block; font-size: 0.78rem; color: var(--text-subtle); }
.cs-item b { display: block; margin-top: 4px; color: var(--text-bright); }
.review-desc {
  margin-top: 12px; background: var(--bg-page); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 12px; font-size: 0.86rem; color: var(--text-muted);
  line-height: 1.6; white-space: pre-wrap; max-height: 200px; overflow-y: auto;
}

.review-timeline { padding-left: 4px; }
.log-action { font-weight: 600; color: var(--text-bright); font-size: 0.9rem; }
.log-flow { font-weight: 400; font-size: 0.8rem; color: var(--text-subtle); margin-left: 6px; }
.log-remark { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }

.review-actions {
  margin-top: 20px; padding-top: 16px; border-top: 1px dashed var(--border-color);
}
.review-btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }

/* 认证对话框 */
.verify-brief { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.verify-name { font-weight: 600; color: var(--text-bright); font-size: 1rem; }
.verify-sub { font-size: 0.82rem; color: var(--text-subtle); }
.verify-bio {
  font-size: 0.86rem; color: var(--text-muted); line-height: 1.5;
  background: var(--bg-inner); border-radius: 8px; padding: 10px; margin: 0 0 12px;
}

/* 提现对话框 */
.withdraw-line { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.9rem; color: var(--text-muted); }
.withdraw-line b { color: var(--text-bright); }

/* 参数 */
.settings-card { max-width: 720px; }
.settings-head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 16px; }
.settings-form { margin-bottom: 8px; }
.rate-row { display: flex; align-items: center; gap: 16px; width: 100%; }
.rate-slider { flex: 1; max-width: 360px; }
.rate-hint { font-size: 0.82rem; color: var(--text-subtle); margin-left: 8px; }
.rate-hint b { color: var(--text-bright); }
</style>
