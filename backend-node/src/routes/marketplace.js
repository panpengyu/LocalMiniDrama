/**
 * Sprint 14 - 模板市场 REST 路由（S14-T01/T02/T03/T04/T05）
 *
 * 用户端 —— 模板画廊（S14-T01/T02）：
 *   GET    /marketplace/templates                 模板列表（分类/搜索/排序/分页）——公开
 *   GET    /marketplace/categories                分类聚合（导航）——公开
 *   GET    /marketplace/stats                      市场概览统计——公开
 *   GET    /marketplace/templates/:id              模板详情（含评分/是否已获取）
 *   POST   /marketplace/templates/:id/acquire      下载(免费)/购买(付费，积分抵扣)
 *   POST   /marketplace/templates/:id/apply        应用模板创建新项目
 *   GET    /marketplace/templates/:id/ratings      评论列表——公开
 *   POST   /marketplace/templates/:id/ratings      提交/更新评分（需已获取）
 *   GET    /marketplace/my/library                 我获取过的模板
 *
 * 创作者端 —— 创作者中心（S14-T03）：
 *   POST   /marketplace/creator/apply              申请入驻 / 更新资料
 *   GET    /marketplace/creator/me                 我的创作者档案
 *   GET    /marketplace/creator/earnings           收益概览
 *   GET    /marketplace/creator/ledger             收益流水
 *   POST   /marketplace/creator/templates          创建模板草稿
 *   PUT    /marketplace/creator/templates/:id      编辑模板
 *   DELETE /marketplace/creator/templates/:id      删除模板
 *   GET    /marketplace/creator/templates          我的模板列表
 *   POST   /marketplace/creator/templates/:id/submit   提交审核（串联 AI 预审）
 *   GET    /marketplace/creator/templates/:id/review-logs  审核轨迹
 *   POST   /marketplace/creator/withdrawals        申请提现
 *   GET    /marketplace/creator/withdrawals        我的提现记录
 *
 * 管理端（super_admin）—— 审核工作台（S14-T04）：
 *   GET    /admin/marketplace/review-queue         待审核队列
 *   GET    /admin/marketplace/templates/:id        审核视角查看模板全文
 *   GET    /admin/marketplace/templates/:id/review-logs  审核轨迹
 *   POST   /admin/marketplace/templates/:id/review 人工复审 {approve, remark}
 *   POST   /admin/marketplace/templates/:id/listing 上/下架 {listed, remark}
 *   GET    /admin/marketplace/creators             创作者列表
 *   POST   /admin/marketplace/creators/:id/verify  创作者认证审核 {approve, remark, commission_rate}
 *   GET    /admin/marketplace/withdrawals          提现列表
 *   POST   /admin/marketplace/withdrawals/:id/review 提现审核 {approve, remark}
 *   PUT    /admin/marketplace/settings             更新分成比例/提现门槛
 *
 * 全部数据落地本地 MySQL，无 mock。
 */

'use strict';

const response = require('../response');
const { requireAuth, requireRole } = require('../middleware/auth');
const marketplaceService = require('../services/marketplaceService');
const creatorService = require('../services/creatorService');
const templateReviewService = require('../services/templateReviewService');
const settingsService = require('../services/settingsService');

function marketplaceRoutes(db, log) {
  const express = require('express');
  const router = express.Router();
  const superAdmin = [requireAuth, requireRole(['super_admin'])];

  // 统一错误码 → HTTP 映射
  function fail(res, err) {
    const badCodes = [
      'EMPTY_DISPLAY_NAME', 'EMPTY_TITLE', 'INVALID_PRICE', 'INVALID_RATING', 'INVALID_AMOUNT',
      'INVALID_PAY_METHOD', 'BELOW_MIN_WITHDRAWAL', 'NO_SETTLE_ACCOUNT', 'NOT_SUBMITTABLE',
      'NOT_EDITABLE', 'NOT_DELETABLE', 'NOT_REVIEWABLE', 'EMPTY_TEMPLATE_CONTENT',
      'REJECT_REASON_REQUIRED', 'NOT_DELISTED', 'NOT_LISTED', 'SELF_PURCHASE', 'TEMPLATE_NOT_LISTED',
      'WITHDRAWAL_NOT_REVIEWABLE',
    ];
    const notFoundCodes = ['TEMPLATE_NOT_FOUND', 'CREATOR_NOT_FOUND', 'WITHDRAWAL_NOT_FOUND', 'NOT_ACQUIRED'];
    const forbiddenCodes = ['FORBIDDEN', 'NOT_A_CREATOR', 'CREATOR_NOT_APPROVED'];
    if (err.code === 'INSUFFICIENT_POINTS') return response.error(res, 402, 'INSUFFICIENT_POINTS', err.message);
    if (err.code === 'INSUFFICIENT_BALANCE') return response.error(res, 402, 'INSUFFICIENT_BALANCE', err.message);
    if (forbiddenCodes.includes(err.code)) return response.forbidden(res, err.message);
    if (badCodes.includes(err.code)) return response.badRequest(res, err.message);
    if (notFoundCodes.includes(err.code)) return response.notFound(res, err.message);
    log.error('[S14] 模板市场接口异常', { code: err.code, error: err.message });
    return response.internalError(res, err.message);
  }

  // 可选登录：解析 token 但不强制（用于详情页判断是否已获取）
  function optionalUserId(req) {
    return req.user && req.user.id ? Number(req.user.id) : null;
  }

  // ===================== 用户端：模板画廊 =====================

  router.get('/marketplace/templates', (req, res) => {
    try {
      const q = req.query || {};
      response.success(res, marketplaceService.listTemplates(db, {
        category: q.category, genreType: q.genre_type, pricingType: q.pricing_type,
        keyword: q.keyword, sort: q.sort, page: q.page, pageSize: q.page_size,
        status: 'listed',
      }));
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/categories', (_req, res) => {
    try { response.success(res, { items: marketplaceService.listCategories(db) }); } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/stats', (_req, res) => {
    try { response.success(res, marketplaceService.marketplaceStats(db)); } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/templates/:id', (req, res) => {
    try {
      const detail = marketplaceService.getTemplateDetail(db, Number(req.params.id), {
        userId: optionalUserId(req), isAdmin: req.user && req.user.role === 'super_admin',
      });
      if (!detail) return response.notFound(res, '模板不存在或未上架');
      response.success(res, detail);
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/templates/:id/ratings', (req, res) => {
    try {
      response.success(res, marketplaceService.listRatings(db, Number(req.params.id), {
        limit: Number(req.query.limit) || 20, offset: Number(req.query.offset) || 0,
      }));
    } catch (err) { fail(res, err); }
  });

  // 获取模板（免费下载 / 付费购买）
  router.post('/marketplace/templates/:id/acquire', requireAuth, (req, res) => {
    try {
      const result = marketplaceService.acquireTemplate(db, log, {
        userId: req.user.id, templateId: Number(req.params.id),
        payMethod: (req.body && req.body.pay_method) || 'points',
      });
      response.success(res, result);
    } catch (err) { fail(res, err); }
  });

  // 应用模板创建项目
  router.post('/marketplace/templates/:id/apply', requireAuth, (req, res) => {
    try {
      const drama = marketplaceService.applyTemplate(db, log, {
        userId: req.user.id, templateId: Number(req.params.id),
        title: (req.body && req.body.title) || null,
      });
      response.created(res, drama);
    } catch (err) { fail(res, err); }
  });

  // 评分
  router.post('/marketplace/templates/:id/ratings', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const rating = marketplaceService.rateTemplate(db, log, {
        userId: req.user.id, templateId: Number(req.params.id),
        rating: b.rating, comment: b.comment || null,
      });
      response.success(res, rating);
    } catch (err) { fail(res, err); }
  });

  // 我获取过的模板
  router.get('/marketplace/my/library', requireAuth, (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = db.prepare(
        `SELECT d.id AS acquire_id, d.acquire_type, d.price_paid, d.applied_drama_id, d.created_at AS acquired_at,
                t.id, t.template_no, t.title, t.summary, t.cover_image, t.category, t.pricing_type, t.price,
                t.rating_avg, t.status
         FROM marketplace_downloads d
         JOIN marketplace_templates t ON t.id = d.template_id
         WHERE d.user_id = ? AND t.is_deleted = 0
         ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`
      ).all(req.user.id, limit, offset) || [];
      const total = Number(db.prepare('SELECT COUNT(*) AS c FROM marketplace_downloads WHERE user_id = ?').get(req.user.id).c || 0);
      response.success(res, { items: rows, total });
    } catch (err) { fail(res, err); }
  });

  // ===================== 创作者中心 =====================

  // 读取当前用户创作者档案（辅助）
  function loadCreator(req) {
    return creatorService.getCreatorByUser(db, req.user.id);
  }

  router.post('/marketplace/creator/apply', requireAuth, (req, res) => {
    try {
      const b = req.body || {};
      const creator = creatorService.applyCreator(db, log, {
        userId: req.user.id, displayName: b.display_name, bio: b.bio, avatar: b.avatar,
        realName: b.real_name, contact: b.contact,
        settleAccountType: b.settle_account_type, settleAccount: b.settle_account,
      });
      response.success(res, creator);
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/me', requireAuth, (req, res) => {
    try { response.success(res, loadCreator(req)); } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/earnings', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      response.success(res, creatorService.earningsOverview(db, c));
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/ledger', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      response.success(res, creatorService.listLedger(db, c, {
        limit: Number(req.query.limit) || 20, offset: Number(req.query.offset) || 0,
      }));
    } catch (err) { fail(res, err); }
  });

  router.post('/marketplace/creator/templates', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      const b = req.body || {};
      const tpl = creatorService.createTemplate(db, log, c, {
        title: b.title, summary: b.summary, description: b.description, category: b.category,
        genreType: b.genre_type, tags: b.tags, coverImage: b.cover_image, previewImages: b.preview_images,
        content: b.content, pricingType: b.pricing_type, price: b.price, sourceTemplateId: b.source_template_id,
      });
      response.created(res, tpl);
    } catch (err) { fail(res, err); }
  });

  router.put('/marketplace/creator/templates/:id', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      const b = req.body || {};
      const tpl = creatorService.updateTemplate(db, log, c, Number(req.params.id), {
        title: b.title, summary: b.summary, description: b.description, category: b.category,
        genreType: b.genre_type, tags: b.tags, coverImage: b.cover_image, previewImages: b.preview_images,
        content: b.content, pricingType: b.pricing_type, price: b.price,
      });
      response.success(res, tpl);
    } catch (err) { fail(res, err); }
  });

  router.delete('/marketplace/creator/templates/:id', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      creatorService.deleteTemplate(db, log, c, Number(req.params.id));
      response.success(res, { deleted: true });
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/templates', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      response.success(res, creatorService.listMyTemplates(db, c, {
        status: req.query.status, page: req.query.page, pageSize: req.query.page_size,
      }));
    } catch (err) { fail(res, err); }
  });

  router.post('/marketplace/creator/templates/:id/submit', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      const state = templateReviewService.submitForReview(db, log, {
        templateId: Number(req.params.id), creator: c,
      });
      response.success(res, state);
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/templates/:id/review-logs', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      const t = marketplaceService.getTemplateById(db, Number(req.params.id));
      if (!t) return response.notFound(res, '模板不存在');
      if (Number(t.creator_id) !== Number(c.id)) return response.forbidden(res, '无权查看他人模板审核记录');
      response.success(res, { items: templateReviewService.listReviewLogs(db, Number(req.params.id)) });
    } catch (err) { fail(res, err); }
  });

  router.post('/marketplace/creator/withdrawals', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      const w = creatorService.requestWithdrawal(db, log, c, { amount: (req.body && req.body.amount) });
      response.created(res, w);
    } catch (err) { fail(res, err); }
  });

  router.get('/marketplace/creator/withdrawals', requireAuth, (req, res) => {
    try {
      const c = creatorService.requireApprovedCreator(db, req.user.id);
      response.success(res, creatorService.listMyWithdrawals(db, c, {
        limit: Number(req.query.limit) || 20, offset: Number(req.query.offset) || 0,
      }));
    } catch (err) { fail(res, err); }
  });

  // ===================== 管理端：审核工作台 =====================

  router.get('/admin/marketplace/review-queue', ...superAdmin, (req, res) => {
    try {
      response.success(res, templateReviewService.listReviewQueue(db, {
        status: req.query.status, page: req.query.page, pageSize: req.query.page_size,
      }));
    } catch (err) { fail(res, err); }
  });

  router.get('/admin/marketplace/templates/:id', ...superAdmin, (req, res) => {
    try {
      const detail = marketplaceService.getTemplateDetail(db, Number(req.params.id), { isAdmin: true });
      if (!detail) return response.notFound(res, '模板不存在');
      detail.review_state = templateReviewService.getReviewState(db, Number(req.params.id));
      response.success(res, detail);
    } catch (err) { fail(res, err); }
  });

  router.get('/admin/marketplace/templates/:id/review-logs', ...superAdmin, (req, res) => {
    try {
      response.success(res, { items: templateReviewService.listReviewLogs(db, Number(req.params.id)) });
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/marketplace/templates/:id/review', ...superAdmin, (req, res) => {
    try {
      const b = req.body || {};
      const state = templateReviewService.manualReview(db, log, {
        templateId: Number(req.params.id), approve: !!b.approve, remark: b.remark || null, reviewerId: req.user.id,
      });
      response.success(res, state);
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/marketplace/templates/:id/listing', ...superAdmin, (req, res) => {
    try {
      const b = req.body || {};
      const state = templateReviewService.setListing(db, log, {
        templateId: Number(req.params.id), listed: !!b.listed, remark: b.remark || null, reviewerId: req.user.id,
      });
      response.success(res, state);
    } catch (err) { fail(res, err); }
  });

  router.get('/admin/marketplace/creators', ...superAdmin, (req, res) => {
    try {
      response.success(res, creatorService.listCreators(db, {
        verifyStatus: req.query.verify_status, keyword: req.query.keyword,
        page: req.query.page, pageSize: req.query.page_size,
      }));
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/marketplace/creators/:id/verify', ...superAdmin, (req, res) => {
    try {
      const b = req.body || {};
      const creator = creatorService.reviewCreator(db, log, {
        creatorId: Number(req.params.id), approve: !!b.approve, remark: b.remark || null,
        reviewerId: req.user.id, commissionRate: b.commission_rate,
      });
      response.success(res, creator);
    } catch (err) { fail(res, err); }
  });

  router.get('/admin/marketplace/withdrawals', ...superAdmin, (req, res) => {
    try {
      response.success(res, creatorService.listWithdrawals(db, {
        status: req.query.status, page: req.query.page, pageSize: req.query.page_size,
      }));
    } catch (err) { fail(res, err); }
  });

  router.post('/admin/marketplace/withdrawals/:id/review', ...superAdmin, (req, res) => {
    try {
      const b = req.body || {};
      const w = creatorService.reviewWithdrawal(db, log, {
        withdrawalId: Number(req.params.id), approve: !!b.approve, remark: b.remark || null, reviewerId: req.user.id,
      });
      response.success(res, w);
    } catch (err) { fail(res, err); }
  });

  // 平台参数（分成比例 / 提现门槛）
  router.put('/admin/marketplace/settings', ...superAdmin, (req, res) => {
    try {
      const b = req.body || {};
      if (b.platform_rate !== undefined) {
        const rate = Number(b.platform_rate);
        if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return response.badRequest(res, '分成比例需在 [0,1) 区间');
        settingsService.setGlobalSetting(db, 'marketplace_platform_rate', rate);
      }
      if (b.min_withdrawal !== undefined) {
        const min = Number(b.min_withdrawal);
        if (!Number.isFinite(min) || min <= 0) return response.badRequest(res, '最低提现金额需大于 0');
        settingsService.setGlobalSetting(db, 'marketplace_min_withdrawal', min);
      }
      response.success(res, {
        platform_rate: marketplaceService.getPlatformRate(db),
        min_withdrawal: marketplaceService.getMinWithdrawal(db),
      });
    } catch (err) { fail(res, err); }
  });

  return router;
}

module.exports = marketplaceRoutes;
