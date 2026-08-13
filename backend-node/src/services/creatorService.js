'use strict';

/**
 * Sprint 14 - S14-T03 创作者入驻系统
 *
 * 职责：
 *   - 创作者认证：申请入驻 → 待审核 → 管理端通过/驳回
 *   - 模板发布：创作者创建/编辑自己的市场模板（草稿态），管理其上下架前的内容
 *   - 收益统计：创作者收益概览（可提现余额 / 累计收益 / 已提现 / 销量），收益流水
 *   - 提现：申请提现（冻结余额）→ 管理端审核（通过打款 / 驳回退回）
 *
 * 数据存储：全部落地本地 MySQL（marketplace_creators / marketplace_templates /
 *           marketplace_withdrawals / marketplace_creator_ledger）。无 mock。
 * 金额单位：元（DECIMAL）；分成结算见 marketplaceService.settlePurchase。
 */

const marketplaceService = require('./marketplaceService');

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

// ===========================================================================
// 创作者认证 / 入驻
// ===========================================================================

/** 读取用户的创作者档案（不存在返回 null）。 */
function getCreatorByUser(db, userId) {
  const row = db.prepare('SELECT * FROM marketplace_creators WHERE user_id = ?').get(Number(userId));
  return decorateCreator(row);
}

/** 按创作者档案ID读取。 */
function getCreatorById(db, id) {
  const row = db.prepare('SELECT * FROM marketplace_creators WHERE id = ?').get(Number(id));
  return decorateCreator(row);
}

function decorateCreator(row) {
  if (!row) return null;
  return {
    ...row,
    balance: +Number(row.balance || 0).toFixed(2),
    total_income: +Number(row.total_income || 0).toFixed(2),
    total_withdrawn: +Number(row.total_withdrawn || 0).toFixed(2),
    commission_rate: row.commission_rate == null ? null : Number(row.commission_rate),
  };
}

/**
 * 申请入驻 / 更新入驻资料。
 *   - 首次申请：创建档案，verify_status='pending'
 *   - 已存在且为 rejected：重新提交，回到 pending
 *   - 已存在且为 pending/approved：仅更新资料（approved 不会因资料更新而失效）
 */
function applyCreator(db, log, { userId, displayName, bio, avatar, realName, contact, settleAccountType, settleAccount }) {
  const uid = Number(userId);
  if (!displayName || !String(displayName).trim()) {
    const e = new Error('创作者展示名必填'); e.code = 'EMPTY_DISPLAY_NAME'; throw e;
  }

  const existing = db.prepare('SELECT * FROM marketplace_creators WHERE user_id = ?').get(uid);
  if (existing) {
    const nextStatus = existing.verify_status === 'rejected' ? 'pending' : existing.verify_status;
    db.prepare(
      `UPDATE marketplace_creators
         SET display_name = ?, bio = ?, avatar = ?, real_name = ?, contact = ?,
             settle_account_type = ?, settle_account = ?, verify_status = ?,
             verify_remark = CASE WHEN ? = 'pending' THEN NULL ELSE verify_remark END,
             updated_at = ${nowExpr(db)}
       WHERE id = ?`
    ).run(
      String(displayName).trim(), bio || null, avatar || null, realName || null, contact || null,
      settleAccountType || null, settleAccount || null, nextStatus, nextStatus, existing.id
    );
    if (log) log.info('[S14-T03] 更新创作者资料', { userId: uid, status: nextStatus });
    return getCreatorById(db, existing.id);
  }

  const res = db.prepare(
    `INSERT INTO marketplace_creators
       (user_id, display_name, bio, avatar, real_name, contact, settle_account_type, settle_account, verify_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(uid, String(displayName).trim(), bio || null, avatar || null, realName || null, contact || null,
    settleAccountType || null, settleAccount || null);
  const id = res.lastInsertRowid || res.insertId;
  if (log) log.info('[S14-T03] 创作者入驻申请', { userId: uid, creatorId: id });
  return getCreatorById(db, id);
}

/**
 * 管理端审核创作者认证。
 * @param {object} opts { creatorId, approve, remark, reviewerId, commissionRate }
 */
function reviewCreator(db, log, { creatorId, approve, remark, reviewerId, commissionRate }) {
  const c = getCreatorById(db, creatorId);
  if (!c) { const e = new Error('创作者不存在'); e.code = 'CREATOR_NOT_FOUND'; throw e; }

  const status = approve ? 'approved' : 'rejected';
  const rate = commissionRate != null && Number.isFinite(Number(commissionRate)) ? Number(commissionRate) : null;
  db.prepare(
    `UPDATE marketplace_creators
       SET verify_status = ?, verify_remark = ?, commission_rate = COALESCE(?, commission_rate),
           verified_at = CASE WHEN ? = 'approved' THEN ${nowExpr(db)} ELSE verified_at END,
           updated_at = ${nowExpr(db)}
     WHERE id = ?`
  ).run(status, remark || null, rate, status, c.id);

  if (log) log.info('[S14-T03] 创作者认证审核', { creatorId: c.id, status, reviewerId });
  return getCreatorById(db, c.id);
}

/** 要求当前用户是「已认证」创作者，返回其档案；否则抛错。 */
function requireApprovedCreator(db, userId) {
  const c = getCreatorByUser(db, userId);
  if (!c) { const e = new Error('请先申请成为创作者'); e.code = 'NOT_A_CREATOR'; throw e; }
  if (c.verify_status !== 'approved') { const e = new Error('创作者认证未通过，暂不可发布模板'); e.code = 'CREATOR_NOT_APPROVED'; throw e; }
  return c;
}

/** 创作者列表（管理端，可按认证状态过滤，分页）。 */
function listCreators(db, { verifyStatus, keyword, page, pageSize } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (verifyStatus) { where += ' AND verify_status = ?'; params.push(String(verifyStatus)); }
  if (keyword) { where += ' AND (display_name LIKE ? OR contact LIKE ?)'; const k = '%' + keyword + '%'; params.push(k, k); }

  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM marketplace_creators ${where}`).get(...params).c || 0);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const rows = db.prepare(
    `SELECT * FROM marketplace_creators ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps) || [];
  return { items: rows.map(decorateCreator), total, page: p, pageSize: ps };
}

// ===========================================================================
// 模板发布（创作者创建/编辑自己的市场模板草稿）
// ===========================================================================

/**
 * 创建市场模板（草稿态 draft）。
 * @param {object} data { title, summary, description, category, genreType, tags, coverImage,
 *                        previewImages, content, pricingType, price, sourceTemplateId }
 */
function createTemplate(db, log, creator, data) {
  if (!data.title || !String(data.title).trim()) {
    const e = new Error('模板标题必填'); e.code = 'EMPTY_TITLE'; throw e;
  }
  const pricingType = data.pricingType === 'paid' ? 'paid' : 'free';
  let price = 0;
  if (pricingType === 'paid') {
    price = +Number(data.price || 0).toFixed(2);
    if (!(price > 0)) { const e = new Error('付费模板售价必须大于 0'); e.code = 'INVALID_PRICE'; throw e; }
  }
  const content = data.content || {};

  const templateNo = marketplaceService.genNo('MT');
  const res = db.prepare(
    `INSERT INTO marketplace_templates
       (template_no, creator_id, creator_user_id, source_template_id, title, summary, description,
        category, genre_type, tags, cover_image, preview_images, content_json,
        pricing_type, price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ${nowExpr(db)}, ${nowExpr(db)})`
  ).run(
    templateNo, creator.id, creator.user_id, data.sourceTemplateId || null,
    String(data.title).trim(), data.summary || null, data.description || null,
    data.category || 'general', data.genreType || null,
    marketplaceService.stringifyJson(data.tags),
    data.coverImage || null,
    marketplaceService.stringifyJson(data.previewImages),
    marketplaceService.stringifyJson(content) || '{}',
    pricingType, price
  );
  const id = res.lastInsertRowid || res.insertId;
  bumpCreatorTemplateCount(db, creator.id);
  if (log) log.info('[S14-T03] 创作者创建模板草稿', { creatorId: creator.id, templateId: id, templateNo });
  return marketplaceService.getTemplateById(db, id, { withContent: true });
}

/**
 * 编辑模板（仅本人，且仅 draft/rejected/delisted 态可编辑，避免审核中/已上架被篡改）。
 */
function updateTemplate(db, log, creator, templateId, data) {
  const t = db.prepare('SELECT * FROM marketplace_templates WHERE id = ? AND is_deleted = 0').get(Number(templateId));
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }
  if (Number(t.creator_id) !== Number(creator.id)) { const e = new Error('无权编辑他人模板'); e.code = 'FORBIDDEN'; throw e; }
  if (!['draft', 'rejected', 'delisted'].includes(t.status)) {
    const e = new Error('当前状态不可编辑（审核中/已上架请先下架）'); e.code = 'NOT_EDITABLE'; throw e;
  }

  const fields = [];
  const params = [];
  const setScalar = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (data.title != null) setScalar('title', String(data.title).trim());
  if (data.summary !== undefined) setScalar('summary', data.summary || null);
  if (data.description !== undefined) setScalar('description', data.description || null);
  if (data.category != null) setScalar('category', data.category);
  if (data.genreType !== undefined) setScalar('genre_type', data.genreType || null);
  if (data.tags !== undefined) setScalar('tags', marketplaceService.stringifyJson(data.tags));
  if (data.coverImage !== undefined) setScalar('cover_image', data.coverImage || null);
  if (data.previewImages !== undefined) setScalar('preview_images', marketplaceService.stringifyJson(data.previewImages));
  if (data.content !== undefined) setScalar('content_json', marketplaceService.stringifyJson(data.content) || '{}');

  if (data.pricingType != null) {
    const pt = data.pricingType === 'paid' ? 'paid' : 'free';
    setScalar('pricing_type', pt);
    if (pt === 'free') {
      setScalar('price', 0);
    } else {
      const price = +Number(data.price != null ? data.price : t.price).toFixed(2);
      if (!(price > 0)) { const e = new Error('付费模板售价必须大于 0'); e.code = 'INVALID_PRICE'; throw e; }
      setScalar('price', price);
    }
  } else if (data.price != null && t.pricing_type === 'paid') {
    const price = +Number(data.price).toFixed(2);
    if (!(price > 0)) { const e = new Error('付费模板售价必须大于 0'); e.code = 'INVALID_PRICE'; throw e; }
    setScalar('price', price);
  }

  if (fields.length === 0) return marketplaceService.getTemplateById(db, templateId, { withContent: true });

  fields.push(`updated_at = ${nowExpr(db)}`);
  params.push(Number(templateId));
  db.prepare(`UPDATE marketplace_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  if (log) log.info('[S14-T03] 创作者编辑模板', { creatorId: creator.id, templateId });
  return marketplaceService.getTemplateById(db, templateId, { withContent: true });
}

/** 软删除模板（仅本人，且非审核中/上架态）。 */
function deleteTemplate(db, log, creator, templateId) {
  const t = db.prepare('SELECT * FROM marketplace_templates WHERE id = ? AND is_deleted = 0').get(Number(templateId));
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }
  if (Number(t.creator_id) !== Number(creator.id)) { const e = new Error('无权删除他人模板'); e.code = 'FORBIDDEN'; throw e; }
  if (['pending', 'ai_reviewing', 'ai_passed'].includes(t.status)) {
    const e = new Error('审核中的模板不可删除'); e.code = 'NOT_DELETABLE'; throw e;
  }
  db.prepare(`UPDATE marketplace_templates SET is_deleted = 1, updated_at = ${nowExpr(db)} WHERE id = ?`).run(Number(templateId));
  bumpCreatorTemplateCount(db, creator.id);
  return true;
}

/** 刷新创作者已上架模板数（以 listed 为准）。 */
function bumpCreatorTemplateCount(db, creatorId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM marketplace_templates WHERE creator_id = ? AND is_deleted = 0 AND status = 'listed'`
  ).get(Number(creatorId));
  db.prepare(`UPDATE marketplace_creators SET template_count = ?, updated_at = ${nowExpr(db)} WHERE id = ?`)
    .run(Number(row.c) || 0, Number(creatorId));
}

/** 创作者自己的模板列表（含各状态，分页）。 */
function listMyTemplates(db, creator, { status, page, pageSize } = {}) {
  return marketplaceService.listTemplates(db, {
    creatorId: creator.id,
    status: status || 'all',
    page, pageSize,
  });
}

// ===========================================================================
// 收益统计 / 流水
// ===========================================================================

/** 创作者收益概览。 */
function earningsOverview(db, creator) {
  const c = getCreatorById(db, creator.id);
  const sales = db.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(gross_amount),0) AS gross,
            COALESCE(SUM(creator_amount),0) AS creator_income, COALESCE(SUM(platform_amount),0) AS platform_fee
     FROM marketplace_settlements WHERE creator_id = ?`
  ).get(c.id);
  const pendingWithdraw = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM marketplace_withdrawals WHERE creator_id = ? AND status IN ('pending','approved')`
  ).get(c.id);

  return {
    balance: c.balance,
    total_income: c.total_income,
    total_withdrawn: c.total_withdrawn,
    pending_withdraw: +Number(pendingWithdraw.s || 0).toFixed(2),
    template_count: c.template_count,
    sales: {
      orders: Number(sales.orders) || 0,
      gross: +Number(sales.gross || 0).toFixed(2),
      creator_income: +Number(sales.creator_income || 0).toFixed(2),
      platform_fee: +Number(sales.platform_fee || 0).toFixed(2),
    },
  };
}

/** 创作者收益流水（分页）。 */
function listLedger(db, creator, { limit = 20, offset = 0 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const items = db.prepare(
    `SELECT * FROM marketplace_creator_ledger WHERE creator_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(creator.id, lim, off) || [];
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM marketplace_creator_ledger WHERE creator_id = ?').get(creator.id).c || 0);
  return { items, total };
}

// ===========================================================================
// 提现
// ===========================================================================

/**
 * 申请提现：校验余额与最低提现门槛，事务内冻结余额（扣减 balance）并写流水与提现单。
 * @param {object} opts { amount }
 */
function requestWithdrawal(db, log, creator, { amount }) {
  const c = getCreatorById(db, creator.id);
  const amt = +Number(amount || 0).toFixed(2);
  const min = marketplaceService.getMinWithdrawal(db);
  if (!(amt > 0)) { const e = new Error('提现金额必须大于 0'); e.code = 'INVALID_AMOUNT'; throw e; }
  if (amt < min) { const e = new Error(`单笔提现不得低于 ${min} 元`); e.code = 'BELOW_MIN_WITHDRAWAL'; throw e; }
  if (amt > c.balance) { const e = new Error(`可提现余额不足：余额 ${c.balance} 元`); e.code = 'INSUFFICIENT_BALANCE'; throw e; }
  if (!c.settle_account) { const e = new Error('请先在创作者资料中填写收款账户'); e.code = 'NO_SETTLE_ACCOUNT'; throw e; }

  const withdrawNo = marketplaceService.genNo('WD');
  const runTx = () => {
    // 原子冻结余额：SET balance=balance-amt WHERE balance>=amt，changes===1 才算扣减成功。
    // 杜绝并发提现基于同一旧余额覆盖写导致的超额提现 / 账目错乱（lost update）。
    const changed = db.prepare(
      `UPDATE marketplace_creators SET balance = balance - ?, updated_at = ${nowExpr(db)} WHERE id = ? AND balance >= ?`
    ).run(amt, c.id, amt).changes;
    if (!changed) { const e = new Error(`可提现余额不足`); e.code = 'INSUFFICIENT_BALANCE'; throw e; }
    // 读回扣减后的真实余额作为流水快照
    const balAfter = +(Number(db.prepare('SELECT balance FROM marketplace_creators WHERE id = ?').get(c.id).balance) || 0).toFixed(2);
    const res = db.prepare(
      `INSERT INTO marketplace_withdrawals
         (withdraw_no, creator_id, creator_user_id, amount, account_type, account, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ${nowExpr(db)}, ${nowExpr(db)})`
    ).run(withdrawNo, c.id, c.user_id, amt, c.settle_account_type || null, c.settle_account, );
    const wid = res.lastInsertRowid || res.insertId;
    db.prepare(
      `INSERT INTO marketplace_creator_ledger (creator_id, entry_type, amount, balance_after, ref_type, ref_id, remark, created_at)
       VALUES (?, 'withdraw', ?, ?, 'withdrawal', ?, ?, ${nowExpr(db)})`
    ).run(c.id, -amt, balAfter, wid, `提现申请（${withdrawNo}）`);
    return wid;
  };
  const wid = db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T03] 创作者提现申请', { creatorId: c.id, amount: amt, withdrawNo });
  return db.prepare('SELECT * FROM marketplace_withdrawals WHERE id = ?').get(wid);
}

/**
 * 管理端审核提现。
 *   approve=true  → paid（打款完成），累加 total_withdrawn
 *   approve=false → rejected，退回冻结金额到余额 + 退回流水
 * @param {object} opts { withdrawalId, approve, remark, reviewerId }
 */
function reviewWithdrawal(db, log, { withdrawalId, approve, remark, reviewerId }) {
  const w = db.prepare('SELECT * FROM marketplace_withdrawals WHERE id = ?').get(Number(withdrawalId));
  if (!w) { const e = new Error('提现单不存在'); e.code = 'WITHDRAWAL_NOT_FOUND'; throw e; }
  if (w.status !== 'pending' && w.status !== 'approved') {
    const e = new Error(`提现单当前状态不可审核：${w.status}`); e.code = 'WITHDRAWAL_NOT_REVIEWABLE'; throw e;
  }

  const amt = +Number(w.amount).toFixed(2);
  const runTx = () => {
    if (approve) {
      // 原子抢占状态流转：WHERE status IN ('pending','approved') 保证并发/重复审核下仅一个赢家，
      // changes===0 说明已被处理，避免重复累加 total_withdrawn。
      const changed = db.prepare(
        `UPDATE marketplace_withdrawals
           SET status = 'paid', review_remark = ?, reviewer_id = ?, reviewed_at = ${nowExpr(db)}, paid_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)}
         WHERE id = ? AND status IN ('pending','approved')`
      ).run(remark || null, reviewerId || null, w.id).changes;
      if (!changed) { const e = new Error('提现单已被处理'); e.code = 'WITHDRAWAL_NOT_REVIEWABLE'; throw e; }
      // 冻结金额已在申请时扣减，打款时仅原子累加 total_withdrawn
      db.prepare(`UPDATE marketplace_creators SET total_withdrawn = total_withdrawn + ?, updated_at = ${nowExpr(db)} WHERE id = ?`)
        .run(amt, w.creator_id);
    } else {
      const changed = db.prepare(
        `UPDATE marketplace_withdrawals
           SET status = 'rejected', review_remark = ?, reviewer_id = ?, reviewed_at = ${nowExpr(db)}, updated_at = ${nowExpr(db)}
         WHERE id = ? AND status IN ('pending','approved')`
      ).run(remark || null, reviewerId || null, w.id).changes;
      if (!changed) { const e = new Error('提现单已被处理'); e.code = 'WITHDRAWAL_NOT_REVIEWABLE'; throw e; }
      // 原子退回冻结金额到余额（balance=balance+amt），再读回快照写退回流水
      db.prepare(`UPDATE marketplace_creators SET balance = balance + ?, updated_at = ${nowExpr(db)} WHERE id = ?`).run(amt, w.creator_id);
      const balAfter = +(Number(db.prepare('SELECT balance FROM marketplace_creators WHERE id = ?').get(w.creator_id).balance) || 0).toFixed(2);
      db.prepare(
        `INSERT INTO marketplace_creator_ledger (creator_id, entry_type, amount, balance_after, ref_type, ref_id, remark, created_at)
         VALUES (?, 'withdraw_refund', ?, ?, 'withdrawal', ?, ?, ${nowExpr(db)})`
      ).run(w.creator_id, amt, balAfter, w.id, `提现驳回退回（${w.withdraw_no}）`);
    }
  };
  db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T03] 提现审核', { withdrawalId: w.id, approve: !!approve, reviewerId });
  return db.prepare('SELECT * FROM marketplace_withdrawals WHERE id = ?').get(w.id);
}

/** 创作者自己的提现记录（分页）。 */
function listMyWithdrawals(db, creator, { limit = 20, offset = 0 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const items = db.prepare(
    `SELECT * FROM marketplace_withdrawals WHERE creator_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(creator.id, lim, off) || [];
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM marketplace_withdrawals WHERE creator_id = ?').get(creator.id).c || 0);
  return { items, total };
}

/** 管理端提现列表（可按状态过滤，分页）。 */
function listWithdrawals(db, { status, page, pageSize } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (status) { where += ' AND w.status = ?'; params.push(String(status)); }
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM marketplace_withdrawals w ${where}`).get(...params).c || 0);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const items = db.prepare(
    `SELECT w.*, c.display_name AS creator_name
     FROM marketplace_withdrawals w
     LEFT JOIN marketplace_creators c ON c.id = w.creator_id
     ${where} ORDER BY w.created_at DESC, w.id DESC LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps) || [];
  return { items, total, page: p, pageSize: ps };
}

module.exports = {
  // 认证
  getCreatorByUser,
  getCreatorById,
  applyCreator,
  reviewCreator,
  requireApprovedCreator,
  listCreators,
  // 发布
  createTemplate,
  updateTemplate,
  deleteTemplate,
  bumpCreatorTemplateCount,
  listMyTemplates,
  // 收益
  earningsOverview,
  listLedger,
  // 提现
  requestWithdrawal,
  reviewWithdrawal,
  listMyWithdrawals,
  listWithdrawals,
};
