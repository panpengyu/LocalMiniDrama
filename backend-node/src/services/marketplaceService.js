'use strict';

/**
 * Sprint 14 - S14-T01 模板市场后端 + S14-T05 收益分成结算
 *
 * 职责：
 *   S14-T01 模板市场：
 *     - 市场模板列表（分类 / 搜索 / 排序 / 分页 / 只看已上架）
 *     - 模板详情（含创作者信息、评分聚合、当前用户是否已获取）
 *     - 免费下载 / 付费购买（积分抵扣，落 marketplace_downloads，付费触发分成结算）
 *     - 应用市场模板创建项目（复用 templateService.applyTemplate 的 content_json）
 *     - 评分评论（仅已获取者可评，一人一评可更新，聚合刷新到模板行）
 *     - 统计（下载 / 购买 / 评分 / 收益 概览）
 *   S14-T05 收益分成：
 *     - settlePurchase：按平台分成比例（global_settings.marketplace_platform_rate，默认 0.30）
 *       将成交额拆分为平台所得 / 创作者所得，写入 marketplace_settlements + 创作者收益流水，
 *       并累加创作者可提现余额与累计收益。整个购买 + 结算在同一事务内完成，保证一致性与幂等。
 *
 * 数据存储：全部落地本地 MySQL（marketplace_* 系列表 + point_logs），无 mock。
 * 计费约定：金额单位「元」（DECIMAL）；积分与人民币换算沿用 100 积分 = 1 元。
 */

const crypto = require('crypto');
const financeService = require('./financeService');
const settingsService = require('./settingsService');
const dramaService = require('./dramaService');

// 平台默认分成比例（平台抽成 30%，创作者得 70%）——可被 global_settings 覆盖
const DEFAULT_PLATFORM_RATE = 0.3;
// 市场模板可对外展示（可购买/下载）的状态
const LISTED_STATUS = 'listed';

// 双库兼容时间表达式
function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

/** 生成业务编号：前缀 + 时间戳 + 随机（幂等唯一）。 */
function genNo(prefix) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${ts}${rand}`;
}

/** 解析 JSON 列（兼容 MySQL JSON / TEXT / 已是对象）。 */
function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function stringifyJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (_) { return null; }
}

/** 读取平台分成比例（0~1），异常/越界回落默认值。 */
function getPlatformRate(db) {
  const raw = settingsService.getGlobalSetting(db, 'marketplace_platform_rate', DEFAULT_PLATFORM_RATE);
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return DEFAULT_PLATFORM_RATE;
  return rate;
}

/** 读取最低提现金额（元）。 */
function getMinWithdrawal(db) {
  const raw = settingsService.getGlobalSetting(db, 'marketplace_min_withdrawal', 10);
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

// ===========================================================================
// 行装饰
// ===========================================================================

function decorateTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson(row.tags, []),
    preview_images: parseJson(row.preview_images, []),
    ai_review_detail: parseJson(row.ai_review_detail, null),
    price: Number(row.price) || 0,
    rating_avg: Number(row.rating_avg) || 0,
    // content_json 体积较大，列表场景不返回；详情单独解析
  };
}

function decorateTemplateDetail(row) {
  const t = decorateTemplate(row);
  if (!t) return null;
  t.content = parseJson(row.content_json, {});
  return t;
}

// ===========================================================================
// S14-T01 列表 / 搜索 / 详情
// ===========================================================================

/**
 * 市场模板列表。
 * @param {object} q { category, pricingType, keyword, creatorId, status, sort, page, pageSize, includeContent }
 *   - status 默认仅 'listed'（对外）；管理端/创作者可传 'all' 或具体状态
 *   - sort: latest(默认) / popular(下载量) / rating(评分) / price_asc / price_desc
 */
function listTemplates(db, q = {}) {
  const params = [];
  let where = 'WHERE t.is_deleted = 0';

  // 状态过滤
  if (q.status === 'all') {
    // 不加状态限制（仅管理端使用）
  } else if (q.status && q.status !== 'listed') {
    where += ' AND t.status = ?';
    params.push(String(q.status));
  } else {
    where += ' AND t.status = ?';
    params.push(LISTED_STATUS);
  }

  if (q.category) { where += ' AND t.category = ?'; params.push(String(q.category)); }
  if (q.genreType) { where += ' AND t.genre_type = ?'; params.push(String(q.genreType)); }
  if (q.pricingType) { where += ' AND t.pricing_type = ?'; params.push(String(q.pricingType)); }
  if (q.creatorId) { where += ' AND t.creator_id = ?'; params.push(Number(q.creatorId)); }
  if (q.creatorUserId) { where += ' AND t.creator_user_id = ?'; params.push(Number(q.creatorUserId)); }
  if (q.keyword) {
    where += ' AND (t.title LIKE ? OR t.summary LIKE ? OR t.description LIKE ?)';
    const k = '%' + String(q.keyword) + '%';
    params.push(k, k, k);
  }

  const orderMap = {
    latest: 't.listed_at DESC, t.id DESC',
    popular: 't.download_count DESC, t.id DESC',
    rating: 't.rating_avg DESC, t.rating_count DESC, t.id DESC',
    price_asc: 't.price ASC, t.id DESC',
    price_desc: 't.price DESC, t.id DESC',
  };
  const orderBy = orderMap[q.sort] || orderMap.latest;

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM marketplace_templates t ${where}`).get(...params).c || 0
  );

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(60, Math.max(1, parseInt(q.pageSize, 10) || 20));
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(
    `SELECT t.*, c.display_name AS creator_name, c.avatar AS creator_avatar, c.verify_status AS creator_verify_status
     FROM marketplace_templates t
     LEFT JOIN marketplace_creators c ON c.id = t.creator_id
     ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) || [];

  return {
    items: rows.map(decorateTemplate),
    total,
    page,
    pageSize,
  };
}

/** 分类聚合（每个分类的已上架模板数）——用于前端分类导航。 */
function listCategories(db) {
  const rows = db.prepare(
    `SELECT category, COUNT(*) AS count
     FROM marketplace_templates
     WHERE is_deleted = 0 AND status = ?
     GROUP BY category ORDER BY count DESC`
  ).all(LISTED_STATUS) || [];
  return rows.map((r) => ({ category: r.category, count: Number(r.count) || 0 }));
}

/** 按主键读取模板（含创作者信息）。 */
function getTemplateById(db, id, { withContent = false } = {}) {
  const row = db.prepare(
    `SELECT t.*, c.display_name AS creator_name, c.avatar AS creator_avatar,
            c.bio AS creator_bio, c.verify_status AS creator_verify_status
     FROM marketplace_templates t
     LEFT JOIN marketplace_creators c ON c.id = t.creator_id
     WHERE t.id = ? AND t.is_deleted = 0`
  ).get(Number(id));
  return withContent ? decorateTemplateDetail(row) : decorateTemplate(row);
}

/** 按 template_no 读取（不 JOIN，供内部使用）。 */
function getTemplateByNo(db, templateNo) {
  const row = db.prepare('SELECT * FROM marketplace_templates WHERE template_no = ? AND is_deleted = 0').get(String(templateNo));
  return decorateTemplateDetail(row);
}

/**
 * 模板详情（对外）：附带当前用户是否已获取、最近评论。
 * 对外仅返回 status='listed' 的模板；创作者本人/管理端可通过 allowOwner/isAdmin 查看非上架。
 */
function getTemplateDetail(db, id, { userId = null, isAdmin = false } = {}) {
  const t = getTemplateById(db, id, { withContent: true });
  if (!t) return null;

  const isOwner = userId && Number(t.creator_user_id) === Number(userId);
  if (t.status !== LISTED_STATUS && !isAdmin && !isOwner) {
    // 非上架且非本人/管理员 → 视为不可见
    return null;
  }

  let acquired = false;
  if (userId) {
    const own = db.prepare(
      'SELECT id FROM marketplace_downloads WHERE template_id = ? AND user_id = ?'
    ).get(Number(id), Number(userId));
    acquired = !!own;
  }
  t.acquired = acquired;
  t.recent_ratings = listRatings(db, id, { limit: 10, offset: 0 }).items;
  return t;
}

// ===========================================================================
// S14-T01 免费下载 / 付费购买（S14-T05 结算联动）
// ===========================================================================

/**
 * 获取模板（免费下载 / 付费购买统一入口）。
 *   - 已获取：幂等返回既有记录（不重复扣费）
 *   - 免费模板：直接落一条 download 记录
 *   - 付费模板：以积分抵扣（100 积分 = 1 元），事务内扣积分 + 落 purchase 记录 + 分成结算
 *   - 不允许创作者购买自己的模板（无意义且规避刷单）
 *
 * @param {object} opts { userId, templateId, payMethod }
 * @returns {{ download, purchased, alreadyOwned, settlement }}
 */
function acquireTemplate(db, log, opts) {
  const userId = Number(opts.userId);
  const templateId = Number(opts.templateId);
  const payMethod = String(opts.payMethod || 'points');

  const t = getTemplateById(db, templateId, { withContent: false });
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }
  if (t.status !== LISTED_STATUS) { const e = new Error('模板未上架，无法获取'); e.code = 'TEMPLATE_NOT_LISTED'; throw e; }

  // 幂等：已获取直接返回
  const existing = db.prepare('SELECT * FROM marketplace_downloads WHERE template_id = ? AND user_id = ?').get(templateId, userId);
  if (existing) {
    return { download: existing, purchased: existing.acquire_type === 'purchase', alreadyOwned: true, settlement: null };
  }

  const isPaid = t.pricing_type === 'paid' && Number(t.price) > 0;

  // 免费下载
  if (!isPaid) {
    const runTx = () => {
      const res = db.prepare(
        `INSERT INTO marketplace_downloads
           (template_id, user_id, creator_id, acquire_type, price_paid, settled, created_at)
         VALUES (?, ?, ?, 'download', 0.00, 1, ${nowExpr(db)})`
      ).run(templateId, userId, t.creator_id);
      bumpTemplateCounters(db, templateId, { download: 1, purchase: 0 });
      const id = res.lastInsertRowid || res.insertId;
      return db.prepare('SELECT * FROM marketplace_downloads WHERE id = ?').get(id);
    };
    const download = db.transaction ? db.transaction(runTx)() : runTx();
    if (log) log.info('[S14-T01] 免费模板下载', { templateId, userId });
    return { download, purchased: false, alreadyOwned: false, settlement: null };
  }

  // 付费购买
  if (Number(t.creator_user_id) === userId) {
    const e = new Error('不能购买自己发布的模板'); e.code = 'SELF_PURCHASE'; throw e;
  }
  if (payMethod !== 'points') {
    // 现金渠道购买需接入真实收银台，此处仅开放积分抵扣（与会员积分支付口径一致，不伪造支付串）
    const e = new Error('模板购买当前仅支持积分抵扣'); e.code = 'INVALID_PAY_METHOD'; throw e;
  }

  const price = Number(t.price);
  const needPoints = Math.round(price * financeService.POINTS_PER_YUAN);
  // 事务外余额预检（友好前置拦截）；真正扣费在事务内原子完成
  const preBalance = financeService.getUserBalance(db, userId);
  if (preBalance < needPoints) {
    const e = new Error(`积分不足：需 ${needPoints} 积分，当前 ${preBalance}`); e.code = 'INSUFFICIENT_POINTS'; throw e;
  }

  const orderNo = genNo('TP');

  const runTx = () => {
    // 并发防重复购买：锁用户锚点行后再复查「是否已获取」，使同一用户对同一模板的并发购买串行化。
    // 输家在此处看到已存在的获取记录，直接返回，避免重复扣分 / 重复分成 / 重复计数。
    if (db.type === 'mysql') db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(userId);
    const owned = db.prepare('SELECT * FROM marketplace_downloads WHERE template_id = ? AND user_id = ?').get(templateId, userId);
    if (owned) {
      return { download: owned, settlement: null, alreadyOwned: true };
    }

    // 1) 原子扣积分（deductPointsAtomic 内部已锁用户行 + 校验余额）
    financeService.deductPointsAtomic(db, {
      userId, points: needPoints, businessType: 'template_purchase',
      relatedId: orderNo, remark: `购买模板《${t.title}》`,
    });

    // 2) 落购买记录
    const res = db.prepare(
      `INSERT INTO marketplace_downloads
         (template_id, user_id, creator_id, acquire_type, order_no, pay_method, price_paid, settled, created_at)
       VALUES (?, ?, ?, 'purchase', ?, 'points', ?, 0, ${nowExpr(db)})`
    ).run(templateId, userId, t.creator_id, orderNo, price);
    const downloadId = res.lastInsertRowid || res.insertId;

    // 3) 计数
    bumpTemplateCounters(db, templateId, { download: 1, purchase: 1 });

    // 4) 分成结算（S14-T05）
    const settlement = settlePurchase(db, log, {
      downloadId, templateId, creatorId: t.creator_id, buyerUserId: userId, orderNo, grossAmount: price,
    });

    const download = db.prepare('SELECT * FROM marketplace_downloads WHERE id = ?').get(downloadId);
    return { download, settlement, alreadyOwned: false };
  };

  const { download, settlement, alreadyOwned } = db.transaction ? db.transaction(runTx)() : runTx();
  if (alreadyOwned) {
    return { download, purchased: download.acquire_type === 'purchase', alreadyOwned: true, settlement: null };
  }
  if (log) log.info('[S14-T01] 付费模板购买成功', { templateId, userId, price, orderNo });
  return { download, purchased: true, alreadyOwned: false, settlement };
}

/** 模板下载/购买计数自增。 */
function bumpTemplateCounters(db, templateId, { download = 0, purchase = 0 }) {
  db.prepare(
    `UPDATE marketplace_templates
       SET download_count = download_count + ?, purchase_count = purchase_count + ?, updated_at = ${nowExpr(db)}
     WHERE id = ?`
  ).run(download, purchase, templateId);
}

/**
 * S14-T05 分成结算（在购买事务内调用）。
 * 幂等：download_id 唯一，若已结算直接返回既有记录。
 */
function settlePurchase(db, log, { downloadId, templateId, creatorId, buyerUserId, orderNo, grossAmount }) {
  const gross = +Number(grossAmount).toFixed(2);
  const rate = resolveCreatorPlatformRate(db, creatorId);
  const platformAmount = +(gross * rate).toFixed(2);
  const creatorAmount = +(gross - platformAmount).toFixed(2);

  // 幂等检查
  const exist = db.prepare('SELECT * FROM marketplace_settlements WHERE download_id = ?').get(downloadId);
  if (exist) return exist;

  const res = db.prepare(
    `INSERT INTO marketplace_settlements
       (download_id, template_id, creator_id, buyer_user_id, order_no, gross_amount, platform_rate, platform_amount, creator_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr(db)})`
  ).run(downloadId, templateId, creatorId, buyerUserId, orderNo || null, gross, rate, platformAmount, creatorAmount);
  const settlementId = res.lastInsertRowid || res.insertId;

  // 标记购买记录已结算
  db.prepare(`UPDATE marketplace_downloads SET settled = 1 WHERE id = ?`).run(downloadId);

  // 创作者收益入账 + 流水
  creditCreator(db, creatorId, creatorAmount, { refType: 'settlement', refId: settlementId, remark: `模板销售分成（订单 ${orderNo || '-'}）` });

  if (log) log.info('[S14-T05] 模板购买分成结算', { downloadId, gross, rate, platformAmount, creatorAmount });
  return db.prepare('SELECT * FROM marketplace_settlements WHERE id = ?').get(settlementId);
}

/** 解析某创作者适用的平台分成比例：创作者专属 commission_rate 优先，否则平台默认。 */
function resolveCreatorPlatformRate(db, creatorId) {
  const c = db.prepare('SELECT commission_rate FROM marketplace_creators WHERE id = ?').get(Number(creatorId));
  if (c && c.commission_rate != null) {
    const r = Number(c.commission_rate);
    if (Number.isFinite(r) && r >= 0 && r < 1) return r;
  }
  return getPlatformRate(db);
}

/** 创作者收益入账：累加余额/累计收益 + 写流水。金额为「元」。 */
function creditCreator(db, creatorId, amount, { refType, refId, remark } = {}) {
  const amt = +Number(amount).toFixed(2);
  db.prepare(
    `UPDATE marketplace_creators
       SET balance = balance + ?, total_income = total_income + ?, updated_at = ${nowExpr(db)}
     WHERE id = ?`
  ).run(amt, amt, creatorId);
  const row = db.prepare('SELECT balance FROM marketplace_creators WHERE id = ?').get(creatorId);
  const balAfter = row ? +Number(row.balance).toFixed(2) : amt;
  db.prepare(
    `INSERT INTO marketplace_creator_ledger (creator_id, entry_type, amount, balance_after, ref_type, ref_id, remark, created_at)
     VALUES (?, 'income', ?, ?, ?, ?, ?, ${nowExpr(db)})`
  ).run(creatorId, amt, balAfter, refType || null, refId || null, remark || null);
}

// ===========================================================================
// S14-T01 应用市场模板 → 创建项目
// ===========================================================================

/**
 * 应用已获取的市场模板创建新项目。
 * 要求：用户必须已下载/购买该模板（marketplace_downloads 存在）。
 * 复用 content_json 中的角色/场景/风格预设写入新项目（与内置模板一致的数据结构）。
 */
function applyTemplate(db, log, { userId, templateId, title }) {
  const uid = Number(userId);
  const tid = Number(templateId);
  const t = getTemplateById(db, tid, { withContent: true });
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }

  const own = db.prepare('SELECT * FROM marketplace_downloads WHERE template_id = ? AND user_id = ?').get(tid, uid);
  if (!own) { const e = new Error('请先下载或购买该模板'); e.code = 'NOT_ACQUIRED'; throw e; }

  const content = t.content || {};
  const characterPresets = Array.isArray(content.character_presets) ? content.character_presets : [];
  const scenePresets = Array.isArray(content.scene_presets) ? content.scene_presets : [];
  const styleConfig = content.style_config || {};

  const runTx = () => {
    // 直接以 SQL 同步插入 dramas，避免在同步事务内调用 async 的 dramaService.createDrama
    const now = new Date().toISOString();
    const metadataStr = JSON.stringify({
      marketplace_template_id: t.id,
      marketplace_template_no: t.template_no,
      template_title: t.title,
      style_config: styleConfig,
      storyboard_rhythm: content.storyboard_rhythm || null,
    });
    const dramaRes = db.prepare(
      `INSERT INTO dramas (title, description, genre, style, metadata, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(
      title || t.title,
      t.description || t.summary || null,
      t.genre_type || null,
      (styleConfig && styleConfig.globalStyle) || 'realistic',
      metadataStr,
      uid,
      now,
      now
    );
    const drama = { id: dramaRes.lastInsertRowid || dramaRes.insertId };
    if (!drama.id) throw new Error('创建项目失败');

    if (characterPresets.length > 0) {
      const stmt = db.prepare(
        `INSERT INTO characters (drama_id, name, role, description, personality, appearance, voice_style, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      characterPresets.forEach((c, idx) => stmt.run(
        drama.id, c.name || '角色' + (idx + 1), c.role || null, c.description || null,
        c.personality || null, c.appearance || null, c.voice_style || null,
        c.sort_order == null ? idx : Number(c.sort_order), now, now
      ));
    }
    if (scenePresets.length > 0) {
      const stmt = db.prepare(
        `INSERT INTO scenes (drama_id, episode_id, location, time, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      scenePresets.forEach((s) => {
        const prompt = [s.name, s.description].filter(Boolean).join('：') || null;
        stmt.run(drama.id, null, s.location || null, s.time || null, prompt, now, now);
      });
    }

    // 回写应用生成的项目ID
    db.prepare('UPDATE marketplace_downloads SET applied_drama_id = ? WHERE id = ?').run(drama.id, own.id);
    return { dramaId: drama.id, charCount: characterPresets.length, sceneCount: scenePresets.length };
  };

  const result = db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T01] 应用市场模板创建项目', { templateId: tid, userId: uid, dramaId: result.dramaId });
  const drama = dramaService.getDramaById(db, result.dramaId);
  if (drama) {
    drama.applied_characters_count = result.charCount;
    drama.applied_scenes_count = result.sceneCount;
  }
  return drama;
}

// ===========================================================================
// S14-T01 评分评论
// ===========================================================================

/**
 * 提交/更新评分。要求已获取该模板。评分范围 1~5。
 * 一人一评：UNIQUE(template_id, user_id)，重复提交更新既有评分。评分聚合刷新到模板行。
 */
function rateTemplate(db, log, { userId, templateId, rating, comment }) {
  const uid = Number(userId);
  const tid = Number(templateId);
  const r = parseInt(rating, 10);
  if (!(r >= 1 && r <= 5)) { const e = new Error('评分必须为 1~5'); e.code = 'INVALID_RATING'; throw e; }

  const t = getTemplateById(db, tid);
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }

  const own = db.prepare('SELECT id FROM marketplace_downloads WHERE template_id = ? AND user_id = ?').get(tid, uid);
  if (!own) { const e = new Error('请先下载或购买该模板后再评分'); e.code = 'NOT_ACQUIRED'; throw e; }

  const runTx = () => {
    if (db.type === 'mysql') {
      db.prepare(
        `INSERT INTO marketplace_ratings (template_id, user_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ${nowExpr(db)}, ${nowExpr(db)})
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = ${nowExpr(db)}`
      ).run(tid, uid, r, comment || null);
    } else {
      db.prepare(
        `INSERT INTO marketplace_ratings (template_id, user_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ${nowExpr(db)}, ${nowExpr(db)})
         ON CONFLICT(template_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = ${nowExpr(db)}`
      ).run(tid, uid, r, comment || null);
    }
    refreshRatingAggregate(db, tid);
  };
  db.transaction ? db.transaction(runTx)() : runTx();

  if (log) log.info('[S14-T01] 模板评分', { templateId: tid, userId: uid, rating: r });
  return db.prepare('SELECT * FROM marketplace_ratings WHERE template_id = ? AND user_id = ?').get(tid, uid);
}

/** 重新计算模板评分聚合并写回模板行。 */
function refreshRatingAggregate(db, templateId) {
  const agg = db.prepare(
    'SELECT COALESCE(SUM(rating),0) AS s, COUNT(*) AS c FROM marketplace_ratings WHERE template_id = ?'
  ).get(templateId);
  const sum = Number(agg.s) || 0;
  const count = Number(agg.c) || 0;
  const avg = count > 0 ? +(sum / count).toFixed(2) : 0;
  db.prepare(
    `UPDATE marketplace_templates SET rating_sum = ?, rating_count = ?, rating_avg = ?, updated_at = ${nowExpr(db)} WHERE id = ?`
  ).run(sum, count, avg, templateId);
  return { sum, count, avg };
}

/** 评论列表（分页，倒序，附评分者用户名）。 */
function listRatings(db, templateId, { limit = 20, offset = 0 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const items = db.prepare(
    `SELECT r.*, u.nickname AS user_nickname, u.username AS user_name
     FROM marketplace_ratings r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.template_id = ?
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT ? OFFSET ?`
  ).all(Number(templateId), lim, off) || [];
  const total = Number(
    db.prepare('SELECT COUNT(*) AS c FROM marketplace_ratings WHERE template_id = ?').get(Number(templateId)).c || 0
  );
  return { items, total };
}

// ===========================================================================
// S14-T01 统计
// ===========================================================================

/** 市场总体统计概览（管理端/运营看板用）。 */
function marketplaceStats(db) {
  const tpl = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'listed' THEN 1 ELSE 0 END) AS listed,
       SUM(CASE WHEN status = 'pending' OR status = 'ai_reviewing' OR status = 'ai_passed' THEN 1 ELSE 0 END) AS in_review,
       SUM(CASE WHEN pricing_type = 'paid' THEN 1 ELSE 0 END) AS paid_count
     FROM marketplace_templates WHERE is_deleted = 0`
  ).get();
  const dl = db.prepare(
    `SELECT COUNT(*) AS downloads,
            SUM(CASE WHEN acquire_type = 'purchase' THEN 1 ELSE 0 END) AS purchases,
            COALESCE(SUM(price_paid),0) AS gmv
     FROM marketplace_downloads`
  ).get();
  const settle = db.prepare(
    `SELECT COALESCE(SUM(platform_amount),0) AS platform_income, COALESCE(SUM(creator_amount),0) AS creator_income
     FROM marketplace_settlements`
  ).get();
  const creators = db.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN verify_status = 'approved' THEN 1 ELSE 0 END) AS approved
     FROM marketplace_creators`
  ).get();

  return {
    templates: {
      total: Number(tpl.total) || 0,
      listed: Number(tpl.listed) || 0,
      in_review: Number(tpl.in_review) || 0,
      paid: Number(tpl.paid_count) || 0,
    },
    transactions: {
      downloads: Number(dl.downloads) || 0,
      purchases: Number(dl.purchases) || 0,
      gmv: +Number(dl.gmv || 0).toFixed(2),
    },
    revenue: {
      platform_income: +Number(settle.platform_income || 0).toFixed(2),
      creator_income: +Number(settle.creator_income || 0).toFixed(2),
    },
    creators: {
      total: Number(creators.total) || 0,
      approved: Number(creators.approved) || 0,
    },
    platform_rate: getPlatformRate(db),
  };
}

module.exports = {
  DEFAULT_PLATFORM_RATE,
  LISTED_STATUS,
  genNo,
  parseJson,
  stringifyJson,
  getPlatformRate,
  getMinWithdrawal,
  // 列表 / 详情
  listTemplates,
  listCategories,
  getTemplateById,
  getTemplateByNo,
  getTemplateDetail,
  // 交易
  acquireTemplate,
  applyTemplate,
  settlePurchase,
  resolveCreatorPlatformRate,
  creditCreator,
  bumpTemplateCounters,
  // 评分
  rateTemplate,
  refreshRatingAggregate,
  listRatings,
  // 统计
  marketplaceStats,
};
