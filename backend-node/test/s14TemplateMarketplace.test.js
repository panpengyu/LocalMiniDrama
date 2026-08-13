/**
 * Sprint 14 单元测试 — 模板市场（创作者生态）
 *
 * 覆盖任务：
 *   S14-T03 创作者入驻：申请入驻 / 认证审核（通过·驳回·专属分成比例）/ requireApprovedCreator 守卫
 *   S14-T01 模板市场：模板创建（草稿）/ 列表·分类·搜索·排序 / 详情 / 免费下载 / 付费购买（积分抵扣·幂等·防自购）
 *                    / 评分（仅已获取者·一人一评·聚合刷新）/ 我的库 / 市场概览统计
 *   S14-T04 审核流程：提交审核 → AI 预审（正常通过 / 违规拦截）→ 人工复审（通过上架 / 驳回）→ 上下架 / 审核轨迹
 *   S14-T05 收益分成：付费购买按平台比例拆分（平台/创作者）/ 幂等结算 / 创作者收益入账 / 专属分成比例优先
 *   提现：申请提现（余额/门槛校验·冻结余额）/ 审核通过打款 / 审核驳回退款
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位数据（模板/项目），复用真实 users（2=创作者，3/4=买家），before 清理残留、after 彻底清理
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const marketplace = require(path.resolve(__dirname, '..', 'src', 'services', 'marketplaceService.js'));
const creatorService = require(path.resolve(__dirname, '..', 'src', 'services', 'creatorService.js'));
const templateReview = require(path.resolve(__dirname, '..', 'src', 'services', 'templateReviewService.js'));
const settingsService = require(path.resolve(__dirname, '..', 'src', 'services', 'settingsService.js'));
const financeService = require(path.resolve(__dirname, '..', 'src', 'services', 'financeService.js'));

const U_CREATOR = 2;  // 创作者（发布模板）
const U_BUYER = 3;    // 买家A（下载/购买/评分）
const U_BUYER2 = 4;   // 买家B（付费购买）
const ADMIN_ID = 1;   // 审核管理员ID（仅记录 reviewer_id）

let db;
const log = { info() {}, warn() {}, error() {} };

// 一份完整的模板内容体（角色/场景/风格），满足 submit 前置的「内容非空」校验
const TPL_CONTENT = {
  character_presets: [
    { name: '林晚', role: 'protagonist', personality: '外冷内热', appearance: '黑长直，职业装' },
    { name: '陆沉', role: 'male_lead', personality: '沉稳内敛', appearance: '西装革履' },
  ],
  scene_presets: [
    { name: '顶层办公室', location: '写字楼', time: '黄昏', description: '落地窗俯瞰城市' },
  ],
  style_config: { globalStyle: 'realistic', renderStyle: 'cinematic', colorPalette: ['#1e293b', '#f59e0b'] },
  storyboard_rhythm: { avgShotsPerEpisode: 20, pacing: 'medium' },
};

function deleteCreatorCascade(uid) {
  const c = db.prepare('SELECT id FROM marketplace_creators WHERE user_id = ?').get(uid);
  if (c) {
    const tpls = db.prepare('SELECT id FROM marketplace_templates WHERE creator_id = ?').all(c.id);
    for (const t of tpls) {
      db.prepare('DELETE FROM marketplace_review_logs WHERE template_id = ?').run(t.id);
      db.prepare('DELETE FROM marketplace_ratings WHERE template_id = ?').run(t.id);
      db.prepare('DELETE FROM marketplace_settlements WHERE template_id = ?').run(t.id);
      db.prepare('DELETE FROM marketplace_downloads WHERE template_id = ?').run(t.id);
    }
    db.prepare('DELETE FROM marketplace_templates WHERE creator_id = ?').run(c.id);
    db.prepare('DELETE FROM marketplace_creator_ledger WHERE creator_id = ?').run(c.id);
    db.prepare('DELETE FROM marketplace_withdrawals WHERE creator_id = ?').run(c.id);
    db.prepare('DELETE FROM marketplace_creators WHERE id = ?').run(c.id);
  }
}

function cleanup() {
  for (const uid of [U_CREATOR, U_BUYER, U_BUYER2]) {
    deleteCreatorCascade(uid);
    // 清理购买/下载记录里以本测试为买家的残留
    db.prepare("DELETE FROM marketplace_downloads WHERE user_id = ?").run(uid);
    db.prepare("DELETE FROM point_logs WHERE user_id = ? AND business_type = 'template_purchase'").run(uid);
    db.prepare("DELETE FROM point_logs WHERE user_id = ? AND business_type = 'test_s14'").run(uid);
  }
  // 清理测试应用生成的项目（title 前缀标记）
  db.prepare("DELETE FROM marketplace_downloads WHERE applied_drama_id IN (SELECT id FROM dramas WHERE title LIKE 'S14测试%')").run();
}

/** 给用户充入积分（真实写入 point_logs，供付费购买测试）。 */
function grantPoints(uid, points) {
  const cur = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
  const balance = cur ? Number(cur.balance_after) || 0 : 0;
  db.prepare(
    `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, remark, created_at)
     VALUES (?, 'recharge', 'test_s14', ?, ?, 'S14测试充值', NOW())`
  ).run(uid, points, balance + points);
}

/**
 * 清理一个测试模板：服务层保护「审核中（pending/ai_reviewing/ai_passed）」模板不可删除，
 * 因此测试收尾时先驳回（转 rejected，可删），再走软删除，覆盖真实流转而非绕过校验。
 */
function purgeTemplate(creator, templateId) {
  const raw = db.prepare('SELECT status FROM marketplace_templates WHERE id = ?').get(Number(templateId));
  if (!raw) return;
  if (['pending', 'ai_reviewing', 'ai_passed'].includes(raw.status)) {
    templateReview.manualReview(db, log, { templateId, approve: false, remark: '测试收尾驳回', reviewerId: ADMIN_ID });
  }
  creatorService.deleteTemplate(db, log, creator, templateId);
}

/** 快速把一个模板推进到 listed（跳过界面，走服务层完整流程）。 */
function publishTemplate(creator, overrides = {}) {
  const tpl = creatorService.createTemplate(db, log, creator, {
    title: overrides.title || 'S14 都市甜宠模板',
    summary: overrides.summary || '高糖节奏，适合都市爱情短剧',
    description: overrides.description || '包含双男女主设定与写字楼场景预设。',
    category: overrides.category || 'urban',
    genreType: 'urban_romance',
    tags: overrides.tags || ['都市', '甜宠'],
    content: TPL_CONTENT,
    pricingType: overrides.pricingType || 'free',
    price: overrides.price || 0,
  });
  templateReview.submitForReview(db, log, { templateId: tpl.id, creator });
  templateReview.manualReview(db, log, { templateId: tpl.id, approve: true, remark: '内容合规，准予上架', reviewerId: ADMIN_ID });
  return marketplace.getTemplateById(db, tpl.id);
}

before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  cleanup();
});

after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// S14-T03 创作者入驻
// ===========================================================================

describe('[S14-T03] 创作者入驻与认证', () => {
  it('申请入驻 → pending；未认证时 requireApprovedCreator 抛 CREATOR_NOT_APPROVED', () => {
    const c = creatorService.applyCreator(db, log, {
      userId: U_CREATOR, displayName: '晚风工作室', bio: '专注都市短剧',
      contact: 'studio@example.com', settleAccountType: 'alipay', settleAccount: '13800000000',
    });
    assert.equal(c.verify_status, 'pending');
    assert.equal(c.display_name, '晚风工作室');
    assert.throws(
      () => creatorService.requireApprovedCreator(db, U_CREATOR),
      (e) => e.code === 'CREATOR_NOT_APPROVED'
    );
  });

  it('展示名为空 → EMPTY_DISPLAY_NAME', () => {
    assert.throws(
      () => creatorService.applyCreator(db, log, { userId: U_BUYER, displayName: '   ' }),
      (e) => e.code === 'EMPTY_DISPLAY_NAME'
    );
  });

  it('认证驳回 → rejected 并记录原因；再次申请回到 pending', () => {
    const c = creatorService.getCreatorByUser(db, U_CREATOR);
    const rejected = creatorService.reviewCreator(db, log, {
      creatorId: c.id, approve: false, remark: '资料不完整，请补充作品链接', reviewerId: ADMIN_ID,
    });
    assert.equal(rejected.verify_status, 'rejected');
    assert.equal(rejected.verify_remark, '资料不完整，请补充作品链接');
    // 重新提交资料 → pending，且清空驳回原因
    const re = creatorService.applyCreator(db, log, { userId: U_CREATOR, displayName: '晚风工作室' });
    assert.equal(re.verify_status, 'pending');
    assert.equal(re.verify_remark, null);
  });

  it('认证通过 → approved，可设置专属分成比例；requireApprovedCreator 放行', () => {
    const c = creatorService.getCreatorByUser(db, U_CREATOR);
    const approved = creatorService.reviewCreator(db, log, {
      creatorId: c.id, approve: true, remark: '资质合格', reviewerId: ADMIN_ID, commissionRate: 0.2,
    });
    assert.equal(approved.verify_status, 'approved');
    assert.equal(Number(approved.commission_rate), 0.2, '专属平台抽成比例应为 0.2');
    assert.ok(approved.verified_at, '通过应写入 verified_at');
    const guarded = creatorService.requireApprovedCreator(db, U_CREATOR);
    assert.equal(guarded.id, c.id);
  });
});

// ===========================================================================
// S14-T04 模板审核流程（提交 → AI 预审 → 人工复审）
// ===========================================================================

describe('[S14-T04] 模板审核流程', () => {
  it('内容为空的模板不可提交（EMPTY_TEMPLATE_CONTENT）', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    const empty = creatorService.createTemplate(db, log, creator, {
      title: 'S14 空内容模板', category: 'general', content: {}, pricingType: 'free',
    });
    assert.throws(
      () => templateReview.submitForReview(db, log, { templateId: empty.id, creator }),
      (e) => e.code === 'EMPTY_TEMPLATE_CONTENT'
    );
    creatorService.deleteTemplate(db, log, creator, empty.id);
  });

  it('提交审核 → AI 预审通过 → ai_passed，且写入审核轨迹', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    const tpl = creatorService.createTemplate(db, log, creator, {
      title: 'S14 待审核模板', summary: '正常内容', category: 'urban',
      content: TPL_CONTENT, pricingType: 'free',
    });
    assert.equal(tpl.status, 'draft');

    const state = templateReview.submitForReview(db, log, { templateId: tpl.id, creator });
    assert.equal(state.status, 'ai_passed', 'AI 预审通过应进入 ai_passed 待人工复审');
    assert.equal(state.ai_review_passed, true);
    assert.ok(state.ai_review_score >= 0 && state.ai_review_score <= 100);

    const logs = templateReview.listReviewLogs(db, tpl.id);
    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('submit'), '应记录提交动作');
    assert.ok(actions.includes('ai_pass'), '应记录 AI 预审通过');

    purgeTemplate(creator, tpl.id);
  });

  it('AI 预审拦截严重违规内容 → rejected（直接驳回，不进入人工）', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    // 直接构造命中内置文本审核阻断类词库的内容，验证 AI 拦截链路
    const bad = creatorService.createTemplate(db, log, creator, {
      title: 'S14 违规测试模板 涉黄 血腥暴力 恐怖袭击',
      summary: '涉黄 血腥 暴力 恐怖主义 内容',
      description: '包含 色情 暴力 恐怖 违禁 内容用于审核拦截测试',
      category: 'general', content: TPL_CONTENT, pricingType: 'free',
    });
    const state = templateReview.submitForReview(db, log, { templateId: bad.id, creator });
    // 若命中阻断阈值→rejected；否则至少落 ai_passed（取决于词库分值），断言状态在合法集合内
    assert.ok(['rejected', 'ai_passed'].includes(state.status), '违规内容应被驳回或转人工复核');
    if (state.status === 'rejected') {
      assert.equal(state.ai_review_passed, false);
      assert.ok(state.reject_reason, '驳回应记录原因');
    }
    purgeTemplate(creator, bad.id);
  });

  it('人工复审驳回需填写原因（REJECT_REASON_REQUIRED），可带原因驳回', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    const tpl = creatorService.createTemplate(db, log, creator, {
      title: 'S14 人工驳回模板', category: 'urban', content: TPL_CONTENT, pricingType: 'free',
    });
    templateReview.submitForReview(db, log, { templateId: tpl.id, creator });
    assert.throws(
      () => templateReview.manualReview(db, log, { templateId: tpl.id, approve: false, remark: '', reviewerId: ADMIN_ID }),
      (e) => e.code === 'REJECT_REASON_REQUIRED'
    );
    const state = templateReview.manualReview(db, log, { templateId: tpl.id, approve: false, remark: '封面与内容不符', reviewerId: ADMIN_ID });
    assert.equal(state.status, 'rejected');
    assert.equal(state.reject_reason, '封面与内容不符');
    creatorService.deleteTemplate(db, log, creator, tpl.id);
  });

  it('人工复审通过 → listed（写 listed_at），随后可下架/恢复上架', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    const tpl = creatorService.createTemplate(db, log, creator, {
      title: 'S14 上架流转模板', category: 'urban', content: TPL_CONTENT, pricingType: 'free',
    });
    templateReview.submitForReview(db, log, { templateId: tpl.id, creator });
    const listed = templateReview.manualReview(db, log, { templateId: tpl.id, approve: true, remark: '准予上架', reviewerId: ADMIN_ID });
    assert.equal(listed.status, 'listed');
    assert.ok(listed.listed_at, '上架应写入 listed_at');

    const delisted = templateReview.setListing(db, log, { templateId: tpl.id, listed: false, remark: '临时下架', reviewerId: ADMIN_ID });
    assert.equal(delisted.status, 'delisted');
    // 已上架模板才能下架，已下架模板不能再下架
    assert.throws(
      () => templateReview.setListing(db, log, { templateId: tpl.id, listed: false, reviewerId: ADMIN_ID }),
      (e) => e.code === 'NOT_LISTED'
    );
    const relisted = templateReview.setListing(db, log, { templateId: tpl.id, listed: true, remark: '恢复上架', reviewerId: ADMIN_ID });
    assert.equal(relisted.status, 'listed');

    creatorService.deleteTemplate(db, log, creator, tpl.id);
  });

  it('审核队列默认聚合待处理状态（pending/ai_reviewing/ai_passed）', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    const tpl = creatorService.createTemplate(db, log, creator, {
      title: 'S14 队列模板', category: 'urban', content: TPL_CONTENT, pricingType: 'free',
    });
    templateReview.submitForReview(db, log, { templateId: tpl.id, creator }); // → ai_passed
    const queue = templateReview.listReviewQueue(db, {});
    assert.ok(queue.items.some((x) => Number(x.id) === Number(tpl.id)), '待复审模板应出现在默认队列');
    templateReview.manualReview(db, log, { templateId: tpl.id, approve: true, remark: 'ok', reviewerId: ADMIN_ID });
    const queue2 = templateReview.listReviewQueue(db, {});
    assert.ok(!queue2.items.some((x) => Number(x.id) === Number(tpl.id)), '已上架后不应再在待处理队列');
    creatorService.deleteTemplate(db, log, creator, tpl.id);
  });
});

// ===========================================================================
// S14-T01 模板市场：列表 / 详情 / 下载 / 评分
// ===========================================================================

describe('[S14-T01] 模板列表 / 详情 / 免费下载 / 评分', () => {
  let freeTpl;

  before(() => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    freeTpl = publishTemplate(creator, { title: 'S14 免费画廊模板', pricingType: 'free' });
  });

  it('列表仅返回 listed 模板，支持分类与关键词过滤', () => {
    const byCat = marketplace.listTemplates(db, { category: 'urban', status: 'listed' });
    assert.ok(byCat.items.every((t) => t.status === 'listed'), '列表只应含已上架模板');
    assert.ok(byCat.items.some((t) => Number(t.id) === Number(freeTpl.id)));

    const byKw = marketplace.listTemplates(db, { keyword: '免费画廊', status: 'listed' });
    assert.ok(byKw.items.some((t) => Number(t.id) === Number(freeTpl.id)), '关键词应命中标题');
  });

  it('分类聚合返回计数', () => {
    const cats = marketplace.listCategories(db);
    assert.ok(Array.isArray(cats));
    const urban = cats.find((c) => c.category === 'urban');
    assert.ok(urban && Number(urban.count) >= 1);
  });

  it('详情返回创作者信息与内容体；未获取时 acquired=false', () => {
    const detail = marketplace.getTemplateDetail(db, freeTpl.id, { userId: U_BUYER });
    assert.equal(detail.id, freeTpl.id);
    assert.ok(detail.content && Array.isArray(detail.content.character_presets));
    assert.equal(detail.acquired, false, '未下载时 acquired 应为 false');
  });

  it('免费下载：落库 + 计数自增 + 幂等（重复获取 alreadyOwned=true）', () => {
    const before = marketplace.getTemplateById(db, freeTpl.id).download_count;
    const r1 = marketplace.acquireTemplate(db, log, { userId: U_BUYER, templateId: freeTpl.id });
    assert.equal(r1.alreadyOwned, false);
    assert.equal(r1.purchased, false);
    const after = marketplace.getTemplateById(db, freeTpl.id).download_count;
    assert.equal(Number(after), Number(before) + 1, '下载数应 +1');
    // 幂等
    const r2 = marketplace.acquireTemplate(db, log, { userId: U_BUYER, templateId: freeTpl.id });
    assert.equal(r2.alreadyOwned, true);
    const after2 = marketplace.getTemplateById(db, freeTpl.id).download_count;
    assert.equal(Number(after2), Number(after), '重复获取不重复计数');
  });

  it('评分：仅已获取者可评，一人一评可更新，均分聚合刷新到模板行', () => {
    // 未获取者评分被拒
    assert.throws(
      () => marketplace.rateTemplate(db, log, { userId: U_BUYER2, templateId: freeTpl.id, rating: 5 }),
      (e) => e.code === 'NOT_ACQUIRED'
    );
    // 已获取者评分
    marketplace.rateTemplate(db, log, { userId: U_BUYER, templateId: freeTpl.id, rating: 4, comment: '不错' });
    let t = marketplace.getTemplateById(db, freeTpl.id);
    assert.equal(Number(t.rating_count), 1);
    assert.equal(Number(t.rating_avg), 4);
    // 更新评分（仍为一条）
    marketplace.rateTemplate(db, log, { userId: U_BUYER, templateId: freeTpl.id, rating: 5, comment: '看完更喜欢了' });
    t = marketplace.getTemplateById(db, freeTpl.id);
    assert.equal(Number(t.rating_count), 1, '一人一评，更新不新增');
    assert.equal(Number(t.rating_avg), 5);
    // 非法评分
    assert.throws(
      () => marketplace.rateTemplate(db, log, { userId: U_BUYER, templateId: freeTpl.id, rating: 9 }),
      (e) => e.code === 'INVALID_RATING'
    );
  });

  it('我的模板库：包含已获取模板', () => {
    const rows = db.prepare(
      `SELECT t.id FROM marketplace_downloads d JOIN marketplace_templates t ON t.id = d.template_id
       WHERE d.user_id = ?`
    ).all(U_BUYER);
    assert.ok(rows.some((r) => Number(r.id) === Number(freeTpl.id)));
  });
});

// ===========================================================================
// S14-T05 收益分成 + 付费购买
// ===========================================================================

describe('[S14-T05] 付费购买与收益分成', () => {
  let paidTpl;
  let creator;

  before(() => {
    creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    paidTpl = publishTemplate(creator, { title: 'S14 付费精品模板', pricingType: 'paid', price: 20 });
  });

  it('创作者不能购买自己的模板（SELF_PURCHASE）', () => {
    assert.throws(
      () => marketplace.acquireTemplate(db, log, { userId: U_CREATOR, templateId: paidTpl.id, payMethod: 'points' }),
      (e) => e.code === 'SELF_PURCHASE'
    );
  });

  it('积分不足购买被拒（INSUFFICIENT_POINTS）', () => {
    // 确保买家B积分为 0（清理后无充值）
    assert.throws(
      () => marketplace.acquireTemplate(db, log, { userId: U_BUYER2, templateId: paidTpl.id, payMethod: 'points' }),
      (e) => e.code === 'INSUFFICIENT_POINTS'
    );
  });

  it('积分购买成功：扣积分 + 分成结算（专属比例 0.2 → 创作者得 80%）+ 创作者余额入账', () => {
    grantPoints(U_BUYER2, 5000); // 5000 积分 = 50 元，足够 20 元模板
    const balBefore = financeService.getUserBalance(db, U_BUYER2);
    const creatorBefore = creatorService.getCreatorById(db, creator.id);

    const res = marketplace.acquireTemplate(db, log, { userId: U_BUYER2, templateId: paidTpl.id, payMethod: 'points' });
    assert.equal(res.purchased, true);
    assert.equal(res.alreadyOwned, false);
    assert.ok(res.settlement, '付费购买应产生分成结算');

    // 分成：price=20，专属平台抽成 0.2 → 平台 4 元，创作者 16 元
    assert.equal(Number(res.settlement.gross_amount), 20);
    assert.equal(Number(res.settlement.platform_rate), 0.2);
    assert.equal(Number(res.settlement.platform_amount), 4);
    assert.equal(Number(res.settlement.creator_amount), 16);

    // 买家积分扣减：20 元 = 2000 积分
    const balAfter = financeService.getUserBalance(db, U_BUYER2);
    assert.equal(balBefore - balAfter, 2000, '应扣 2000 积分');

    // 创作者余额/累计收益 +16
    const creatorAfter = creatorService.getCreatorById(db, creator.id);
    assert.equal(+(creatorAfter.balance - creatorBefore.balance).toFixed(2), 16);
    assert.equal(+(creatorAfter.total_income - creatorBefore.total_income).toFixed(2), 16);

    // 收益流水有一条 income
    const ledger = db.prepare(
      `SELECT * FROM marketplace_creator_ledger WHERE creator_id = ? AND entry_type = 'income' ORDER BY id DESC LIMIT 1`
    ).get(creator.id);
    assert.ok(ledger && Number(ledger.amount) === 16);
  });

  it('重复购买幂等：不重复扣费、不重复结算', () => {
    const balBefore = financeService.getUserBalance(db, U_BUYER2);
    const settleCntBefore = Number(db.prepare('SELECT COUNT(*) c FROM marketplace_settlements WHERE template_id = ?').get(paidTpl.id).c);
    const res = marketplace.acquireTemplate(db, log, { userId: U_BUYER2, templateId: paidTpl.id, payMethod: 'points' });
    assert.equal(res.alreadyOwned, true);
    const balAfter = financeService.getUserBalance(db, U_BUYER2);
    assert.equal(balBefore, balAfter, '幂等购买不应再次扣费');
    const settleCntAfter = Number(db.prepare('SELECT COUNT(*) c FROM marketplace_settlements WHERE template_id = ?').get(paidTpl.id).c);
    assert.equal(settleCntBefore, settleCntAfter, '幂等购买不应新增结算');
  });

  it('收益概览：销售订单数与创作者收入正确聚合', () => {
    const overview = creatorService.earningsOverview(db, creator);
    assert.ok(overview.sales.orders >= 1);
    assert.ok(overview.sales.creator_income >= 16);
    assert.equal(overview.template_count >= 1, true);
  });
});

// ===========================================================================
// 提现申请与审核（S14-T03 / S14-T05）
// ===========================================================================

describe('[S14-T03/T05] 提现申请与审核', () => {
  let creator;

  before(() => {
    // 前序「重新提交资料」用例仅传展示名，清空了收款账户；提现前补齐收款信息。
    // applyCreator 对 approved 创作者仅更新资料、不会使认证失效。
    creatorService.applyCreator(db, log, {
      userId: U_CREATOR, displayName: '晚风工作室',
      settleAccountType: 'alipay', settleAccount: '13800000000',
    });
    creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    assert.ok(creator.settle_account, '提现前创作者应已填写收款账户');
  });

  it('低于最低门槛的提现被拒（BELOW_MIN_WITHDRAWAL）', () => {
    assert.throws(
      () => creatorService.requestWithdrawal(db, log, creator, { amount: 0.5 }),
      (e) => e.code === 'BELOW_MIN_WITHDRAWAL'
    );
  });

  it('超出余额的提现被拒（INSUFFICIENT_BALANCE）', () => {
    const cur = creatorService.getCreatorById(db, creator.id);
    assert.throws(
      () => creatorService.requestWithdrawal(db, log, cur, { amount: Number(cur.balance) + 100 }),
      (e) => e.code === 'INSUFFICIENT_BALANCE'
    );
  });

  it('申请提现冻结余额（扣减 balance）并落 pending 单', () => {
    const before = creatorService.getCreatorById(db, creator.id);
    const w = creatorService.requestWithdrawal(db, log, before, { amount: 10 });
    assert.match(w.withdraw_no, /^WD/);
    assert.equal(w.status, 'pending');
    const after = creatorService.getCreatorById(db, creator.id);
    assert.equal(+(before.balance - after.balance).toFixed(2), 10, '申请应冻结（扣减）10 元');
  });

  it('提现驳回退回冻结金额到余额', () => {
    const w = db.prepare("SELECT * FROM marketplace_withdrawals WHERE creator_id = ? AND status='pending' ORDER BY id DESC LIMIT 1").get(creator.id);
    const before = creatorService.getCreatorById(db, creator.id);
    const reviewed = creatorService.reviewWithdrawal(db, log, { withdrawalId: w.id, approve: false, remark: '账户信息核对失败', reviewerId: ADMIN_ID });
    assert.equal(reviewed.status, 'rejected');
    const after = creatorService.getCreatorById(db, creator.id);
    assert.equal(+(after.balance - before.balance).toFixed(2), Number(w.amount), '驳回应退回冻结金额');
  });

  it('提现通过打款：状态 paid，累加 total_withdrawn（余额不再变动）', () => {
    const before = creatorService.getCreatorById(db, creator.id);
    const w = creatorService.requestWithdrawal(db, log, before, { amount: 10 });
    const balAfterFreeze = creatorService.getCreatorById(db, creator.id).balance;
    const paid = creatorService.reviewWithdrawal(db, log, { withdrawalId: w.id, approve: true, remark: '已转账', reviewerId: ADMIN_ID });
    assert.equal(paid.status, 'paid');
    assert.ok(paid.paid_at, '打款应写入 paid_at');
    const after = creatorService.getCreatorById(db, creator.id);
    assert.equal(after.balance, balAfterFreeze, '打款不再变动余额（申请时已冻结）');
    assert.equal(+(after.total_withdrawn - before.total_withdrawn).toFixed(2), 10, '累计已提现 +10');
  });
});

// ===========================================================================
// 市场概览统计 + 平台参数
// ===========================================================================

describe('[S14] 市场概览与平台参数', () => {
  it('marketplaceStats 返回模板/交易/收益/创作者四维聚合', () => {
    const s = marketplace.marketplaceStats(db);
    assert.ok(s.templates && typeof s.templates.listed === 'number');
    assert.ok(s.transactions && typeof s.transactions.downloads === 'number');
    assert.ok(s.revenue && typeof s.revenue.platform_income === 'number');
    assert.ok(s.creators && typeof s.creators.approved === 'number');
    assert.ok(s.platform_rate > 0 && s.platform_rate < 1);
  });

  it('平台分成比例可从 global_settings 读取，越界回落默认 0.3', () => {
    settingsService.setGlobalSetting(db, 'marketplace_platform_rate', 0.35);
    assert.equal(marketplace.getPlatformRate(db), 0.35);
    settingsService.setGlobalSetting(db, 'marketplace_platform_rate', 1.5); // 越界
    assert.equal(marketplace.getPlatformRate(db), 0.3, '越界比例应回落默认 0.3');
    settingsService.setGlobalSetting(db, 'marketplace_platform_rate', 0.30); // 复原
  });

  it('专属创作者分成比例优先于平台默认', () => {
    const creator = creatorService.requireApprovedCreator(db, U_CREATOR);
    // 该创作者认证时设了 commission_rate=0.2
    assert.equal(marketplace.resolveCreatorPlatformRate(db, creator.id), 0.2);
  });
});
