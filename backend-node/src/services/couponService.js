'use strict';

/**
 * Sprint 17 - S17-T02 优惠券管理
 *
 * 职责：
 *   - 管理端：优惠券的发放（createCoupon）、编辑（updateCoupon）、失效（disableCoupon）、
 *     列表（listCoupons）与领取/核销记录（listRedemptions）。
 *   - 用户端：兑换（redeemCoupon）、我的优惠券（listUserCoupons）、下单抵扣（consumeCoupon）、
 *     关单回退（releaseCoupon）。
 *
 * 数据模型：
 *   - coupons：券定义（券码/面额/门槛/有效期/适用范围/库存）
 *   - coupon_redemptions：领取/核销记录（coupon_id+user_id 唯一防重复领取）
 *   - membership_orders.coupon_id/coupon_code/original_amount/discount_amount：订单抵扣落账
 *
 * 全链路（满足验收「创建→兑换→下单抵扣→核销」）：
 *   1) 管理端创建优惠券（真实落库 coupons）
 *   2) 用户用券码兑换 → 写 coupon_redemptions(claimed)，used_count+1（库存原子扣减）
 *   3) 用户下单携带券码 → consumeCoupon 原子核销为 used，订单记录抵扣明细
 *   4) 订单超时关闭 → releaseCoupon 回退为 claimed，用户可再次使用
 *
 * 所有数据落地 MySQL，无 mock。
 */

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

function decorateCoupon(row) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    type: row.type,                    // amount / percent
    value: row.value === null ? null : Number(row.value),
    min_spend: row.min_spend === null ? 0 : Number(row.min_spend),
    scope: row.scope,
    total_stock: Number(row.total_stock),
    used_count: Number(row.used_count),
    start_at: row.start_at || null,
    end_at: row.end_at || null,
    enabled: row.enabled ? 1 : 0,
    remark: row.remark || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getCouponByCode(db, code) {
  const row = db.prepare('SELECT * FROM coupons WHERE code = ?').get(String(code || '').trim().toUpperCase());
  return row ? decorateCoupon(row) : null;
}

function getCouponById(db, id) {
  const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(id));
  return row ? decorateCoupon(row) : null;
}

function bad(code, msg) {
  const err = new Error(msg);
  err.code = code;
  return err;
}

/** 管理端：优惠券列表（关键字 / 状态过滤） */
function listCoupons(db, query = {}) {
  const where = [];
  const params = [];
  if (query.keyword) {
    where.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  if (query.enabled !== undefined && query.enabled !== '') {
    where.push('enabled = ?');
    params.push(query.enabled ? 1 : 0);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM coupons ${whereSql} ORDER BY id DESC LIMIT 500`).all(...params);
  return rows.map(decorateCoupon);
}

/** 管理端：发放优惠券 */
function createCoupon(db, data) {
  const b = data || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!code) throw bad('INVALID_ARGS', '缺少兑换码 code');
  if (getCouponByCode(db, code)) throw bad('DUPLICATE_COUPON', `券码「${code}」已存在`);
  const type = b.type === 'percent' ? 'percent' : 'amount';
  const value = Number(b.value);
  if (!Number.isFinite(value) || value < 0) throw bad('INVALID_ARGS', '面额/折扣率必须是大于等于 0 的数字');
  if (type === 'percent' && (value <= 0 || value > 100)) throw bad('INVALID_ARGS', '折扣率需在 (0,100] 之间，如 10 表示 9 折');
  const totalStock = b.total_stock == null ? 0 : Number(b.total_stock);
  if (!Number.isInteger(totalStock) || totalStock < 0) throw bad('INVALID_ARGS', '库存必须为非负整数（0 表示不限）');
  db.prepare(`INSERT INTO coupons
      (code, name, type, value, min_spend, scope, total_stock, used_count, start_at, end_at, enabled, remark,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ${nowExpr(db)}, ${nowExpr(db)})`).run(
    code,
    String(b.name || code),
    type,
    value,
    b.min_spend == null ? 0 : Number(b.min_spend),
    b.scope || 'membership',
    totalStock,
    b.start_at || null,
    b.end_at || null,
    b.enabled === undefined ? 1 : (b.enabled ? 1 : 0),
    b.remark || null
  );
  return getCouponByCode(db, code);
}

/** 管理端：编辑优惠券（动态字段，未传保持不变） */
function updateCoupon(db, id, data) {
  const pid = Number(id);
  const exist = getCouponById(db, pid);
  if (!exist) throw bad('COUPON_NOT_FOUND', '优惠券不存在');
  const b = data || {};
  const updates = [];
  const params = [];
  const strFields = ['name', 'scope', 'remark', 'start_at', 'end_at'];
  for (const f of strFields) if (b[f] !== undefined) { updates.push(`${f} = ?`); params.push(b[f] === '' ? null : b[f]); }
  const numFields = ['value', 'min_spend', 'total_stock'];
  for (const f of numFields) if (b[f] !== undefined) { updates.push(`${f} = ?`); params.push(b[f] === null ? null : Number(b[f])); }
  if (b.type !== undefined && b.type !== exist.type) { updates.push('type = ?'); params.push(b.type === 'percent' ? 'percent' : 'amount'); }
  if (b.code !== undefined) {
    const code = String(b.code).trim().toUpperCase();
    if (code !== exist.code) {
      if (getCouponByCode(db, code)) throw bad('DUPLICATE_COUPON', `券码「${code}」已存在`);
      updates.push('code = ?'); params.push(code);
    }
  }
  if (b.enabled !== undefined) { updates.push('enabled = ?'); params.push(b.enabled ? 1 : 0); }
  if (updates.length) {
    params.push(pid);
    db.prepare(`UPDATE coupons SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  return getCouponById(db, pid);
}

/** 管理端：失效优惠券（不再可兑换/使用） */
function disableCoupon(db, id) {
  const pid = Number(id);
  if (!getCouponById(db, pid)) throw bad('COUPON_NOT_FOUND', '优惠券不存在');
  db.prepare('UPDATE coupons SET enabled = 0 WHERE id = ?').run(pid);
  return getCouponById(db, pid);
}

/** 管理端：领取/核销记录（按券过滤） */
function listRedemptions(db, couponId, query = {}) {
  const where = ['coupon_id = ?'];
  const params = [Number(couponId)];
  if (query.status) { where.push('status = ?'); params.push(query.status); }
  const rows = db.prepare(
    `SELECT * FROM coupon_redemptions WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`
  ).all(...params);
  return rows.map((r) => ({
    id: Number(r.id),
    coupon_id: Number(r.coupon_id),
    user_id: Number(r.user_id),
    code: r.code,
    status: r.status,
    order_no: r.order_no || null,
    amount: r.amount === null ? null : Number(r.amount),
    claimed_at: r.claimed_at,
    used_at: r.used_at || null,
  }));
}

/** 校验券当前是否可兑换/可使用（不修改数据） */
function assertCouponUsable(coupon, db) {
  if (!coupon) throw bad('COUPON_NOT_FOUND', '优惠券不存在');
  if (!coupon.enabled) throw bad('COUPON_DISABLED', '优惠券已失效');
  const now = new Date();
  if (coupon.start_at && new Date(coupon.start_at) > now) throw bad('COUPON_NOT_STARTED', '优惠券尚未生效');
  if (coupon.end_at && new Date(coupon.end_at) < now) throw bad('COUPON_EXPIRED', '优惠券已过期');
  if (coupon.total_stock > 0 && coupon.used_count >= coupon.total_stock) throw bad('COUPON_SOLD_OUT', '优惠券已被领完');
  return true;
}

/**
 * 用户端：兑换码兑换（领取）优惠券。
 * 事务内：校验 → 写领取记录（唯一约束防重复）→ 库存原子 +1。
 */
function redeemCoupon(db, userId, code) {
  const uid = Number(userId);
  const coupon = getCouponByCode(db, code);
  assertCouponUsable(coupon, db);
  const runTx = db.transaction(() => {
    // 原子校验库存（防止并发超发）
    const stockOk = db.prepare(
      `UPDATE coupons SET used_count = used_count + 1
       WHERE id = ? AND (total_stock = 0 OR used_count < total_stock)`
    ).run(coupon.id).changes;
    if (!stockOk) throw bad('COUPON_SOLD_OUT', '优惠券已被领完');
    try {
      db.prepare(`INSERT INTO coupon_redemptions (coupon_id, user_id, code, status, claimed_at)
        VALUES (?, ?, ?, 'claimed', ${nowExpr(db)})`).run(coupon.id, uid, coupon.code);
    } catch (e) {
      if ((e.message || '').toLowerCase().includes('duplicate')) {
        // 已领取过：回滚库存增量
        db.prepare('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = ?').run(coupon.id);
        throw bad('COUPON_ALREADY_CLAIMED', '该优惠券已领取过，请勿重复兑换');
      }
      throw e;
    }
    return coupon;
  });
  return runTx();
}

/** 用户端：我的优惠券（含抵扣订单号与状态） */
function listUserCoupons(db, userId) {
  const rows = db.prepare(
    `SELECT r.*, c.name AS coupon_name, c.type AS coupon_type, c.value AS coupon_value,
            c.min_spend AS min_spend, c.end_at AS end_at
     FROM coupon_redemptions r
     JOIN coupons c ON c.id = r.coupon_id
     WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`
  ).all(Number(userId));
  return rows.map((r) => ({
    id: Number(r.id),
    coupon_id: Number(r.coupon_id),
    code: r.code,
    name: r.coupon_name,
    type: r.coupon_type,
    value: Number(r.coupon_value),
    min_spend: Number(r.min_spend),
    end_at: r.end_at || null,
    status: r.status,
    order_no: r.order_no || null,
    amount: r.amount === null ? null : Number(r.amount),
    claimed_at: r.claimed_at,
    used_at: r.used_at || null,
  }));
}

/**
 * 下单抵扣：校验用户已领取的券并计算抵扣金额，事务内核销（used）。
 * @param {number} baseAmount 优惠前应付金额（已含升级折抵）
 * @returns {{ coupon, discount }}
 */
function consumeCoupon(db, userId, code, orderNo, baseAmount) {
  const uid = Number(userId);
  const coupon = getCouponByCode(db, code);
  assertCouponUsable(coupon, db);
  if (coupon.scope && coupon.scope !== 'membership') throw bad('COUPON_SCOPE', '该优惠券不适用于会员购买');
  const base = Number(baseAmount) || 0;
  if (base <= 0) throw bad('COUPON_NO_AMOUNT', '订单无需支付，无需使用优惠券');
  if (base < Number(coupon.min_spend)) {
    throw bad('COUPON_MIN_SPEND', `订单金额未达到优惠券使用门槛（满 ¥${Number(coupon.min_spend).toFixed(2)}）`);
  }
  const redemption = db.prepare(
    'SELECT * FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?'
  ).get(coupon.id, uid);
  if (!redemption) throw bad('COUPON_NOT_CLAIMED', '请先在会员中心兑换该优惠券后再下单');
  if (redemption.status === 'used') throw bad('COUPON_ALREADY_USED', '该优惠券已使用过');

  // 计算抵扣额：amount → min(面额, 订单额)；percent → 订单额 × 折扣率%
  let discount;
  if (coupon.type === 'percent') {
    discount = +(base * Number(coupon.value) / 100).toFixed(2);
  } else {
    discount = +Math.min(Number(coupon.value), base).toFixed(2);
  }
  discount = Math.max(0, Math.min(base, discount));

  const runTx = db.transaction(() => {
    // 原子核销：仅当仍为 claimed 时成功（防并发双花）
    const claimed = db.prepare(
      `UPDATE coupon_redemptions SET status = 'used', order_no = ?, amount = ?, used_at = ${nowExpr(db)}
       WHERE id = ? AND status = 'claimed'`
    ).run(orderNo, discount, redemption.id).changes;
    if (!claimed) throw bad('COUPON_ALREADY_USED', '该优惠券已被占用');
    return discount;
  });
  const finalDiscount = runTx();
  return { coupon, discount: finalDiscount };
}

/** 订单关闭回退：核销记录恢复为已领取（claimed），用户可再次使用。 */
function releaseCoupon(db, orderNo) {
  const rows = db.prepare('SELECT id FROM coupon_redemptions WHERE order_no = ? AND status = ?').all(orderNo, 'used');
  if (!rows.length) return 0;
  const runTx = db.transaction(() => {
    for (const r of rows) {
      db.prepare(
        `UPDATE coupon_redemptions SET status = 'claimed', order_no = NULL, amount = NULL, used_at = NULL WHERE id = ?`
      ).run(r.id);
    }
    return rows.length;
  });
  return runTx();
}

module.exports = {
  listCoupons,
  createCoupon,
  updateCoupon,
  disableCoupon,
  listRedemptions,
  redeemCoupon,
  listUserCoupons,
  consumeCoupon,
  releaseCoupon,
  getCouponByCode,
  getCouponById,
};
