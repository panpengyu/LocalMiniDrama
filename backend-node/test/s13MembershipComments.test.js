/**
 * Sprint 13 单元测试 — 会员体系 + 评论批注
 *
 * 覆盖任务：
 *   S13-T01 会员等级体系：四级套餐读取 / 配额定义解析 / 价格读取
 *   S13-T02 会员计费系统：订单类型判定(new/renew/upgrade/downgrade) / 升级折抵金额 / 开通-续费-到期
 *   S13-T04 支付集成：下单(幂等订单号) / 积分抵扣支付开通 / 回调幂等 / 超时关单
 *   S13-T05 功能配额限制：生成次数原子占用与超限 / 项目数统计 / 存储用量 / 配额总览
 *   S13-T06 评论批注：节点评论 / 时间戳批注 / 线程回复 / @提及通知 / 已读未读 / 批量回复 / 解决状态
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位 ID（项目 99411，用户复用真实 users 2/3/4），before 清理残留、after 彻底清理
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const membership = require(path.resolve(__dirname, '..', 'src', 'services', 'membershipService.js'));
const payment = require(path.resolve(__dirname, '..', 'src', 'services', 'paymentService.js'));
const quota = require(path.resolve(__dirname, '..', 'src', 'services', 'quotaService.js'));
const comments = require(path.resolve(__dirname, '..', 'src', 'services', 'commentService.js'));

const T_DRAMA = 99411;
const U_OWNER = 2;   // 项目创建者
const U_A = 3;       // 协作者A / 评论者
const U_B = 4;       // 协作者B / 被 @

let db;
const log = { info() {}, warn() {}, error() {} };

function cleanupUser(uid) {
  db.prepare('DELETE FROM user_memberships WHERE user_id = ?').run(uid);
  db.prepare("DELETE FROM membership_orders WHERE user_id = ? AND order_no LIKE 'MO%'").run(uid);
  db.prepare('DELETE FROM membership_quota_usage WHERE user_id = ?').run(uid);
  db.prepare("DELETE FROM point_logs WHERE user_id = ? AND business_type = 'membership'").run(uid);
  db.prepare("DELETE FROM recharges WHERE user_id = ? AND order_no LIKE 'MO%'").run(uid);
}

function cleanup() {
  // 评论相关
  db.prepare('DELETE FROM comment_reads WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM comment_mentions WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM canvas_comments WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM collaboration_notifications WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM collaboration_members WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM dramas WHERE id = ?').run(T_DRAMA);
  // 会员相关
  for (const uid of [U_OWNER, U_A, U_B]) cleanupUser(uid);
}

/** 给用户充入指定积分（真实写入 point_logs，供积分抵扣支付测试）。 */
function grantPoints(uid, points) {
  const cur = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
  const balance = cur ? Number(cur.balance_after) || 0 : 0;
  db.prepare(
    `INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, remark, created_at)
     VALUES (?, 'recharge', 'test', ?, ?, 'S13测试充值', NOW())`
  ).run(uid, points, balance + points);
}

before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  cleanup();
  db.prepare(`
    INSERT INTO dramas (id, title, status, metadata, created_by, created_at, updated_at)
    VALUES (?, 'S13 自动化测试项目', 'draft', '{}', ?, NOW(), NOW())
  `).run(T_DRAMA, U_OWNER);
});

after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// S13-T01 会员等级体系
// ===========================================================================

describe('[S13-T01] 会员等级体系', () => {
  it('四级套餐齐全且按 level_rank 递增', () => {
    const plans = membership.listPlans(db);
    const codes = plans.map((p) => p.level_code);
    for (const c of ['free', 'basic', 'pro', 'enterprise']) assert.ok(codes.includes(c), `缺少套餐 ${c}`);
    const ranks = plans.map((p) => Number(p.level_rank));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'level_rank 应升序');
  });

  it('配额定义可解析：free 有限额、enterprise 无限制(-1)', () => {
    const free = membership.getPlanByLevel(db, 'free');
    const ent = membership.getPlanByLevel(db, 'enterprise');
    assert.equal(free.quota.monthly_generations, 30);
    assert.equal(free.quota.max_projects, 3);
    assert.equal(ent.quota.monthly_generations, -1, '企业版生成次数应无限制');
    assert.equal(ent.quota.max_collaborators, -1);
  });

  it('价格读取：pro 月付/年付有值，free 无终身价', () => {
    const pro = membership.getPlanByLevel(db, 'pro');
    assert.equal(membership.priceForCycle(pro, 'monthly'), 99);
    assert.equal(membership.priceForCycle(pro, 'yearly'), 999);
    const free = membership.getPlanByLevel(db, 'free');
    assert.equal(membership.priceForCycle(free, 'lifetime'), null);
  });
});

// ===========================================================================
// S13-T02 会员计费系统
// ===========================================================================

describe('[S13-T02] 会员计费系统', () => {
  it('无会员用户默认 free 且视为有效', () => {
    const info = membership.getUserMembership(db, U_OWNER);
    assert.equal(info.levelCode, 'free');
    assert.equal(info.isActive, true);
  });

  it('首购 basic 月付 → 订单类型 new，金额为原价 29', () => {
    const basic = membership.getPlanByLevel(db, 'basic');
    const r = membership.computeOrderAmount(db, U_OWNER, basic, 'monthly');
    assert.equal(r.orderType, 'new');
    assert.equal(r.amount, 29);
    assert.equal(r.credit, 0);
  });

  it('开通 basic 月付后再购 basic → renew；升级 pro → upgrade 且有折抵', () => {
    const basic = membership.getPlanByLevel(db, 'basic');
    membership.activateMembership(db, {
      userId: U_OWNER, plan: basic, cycle: 'monthly', orderType: 'new', orderId: null, autoRenew: false,
    });
    const cur = membership.getUserMembership(db, U_OWNER);
    assert.equal(cur.levelCode, 'basic');
    assert.equal(cur.isActive, true);

    // 同级续费
    const renew = membership.computeOrderAmount(db, U_OWNER, basic, 'monthly');
    assert.equal(renew.orderType, 'renew');

    // 升级到 pro：应折抵 basic 剩余价值（>0），实付 < 99
    const pro = membership.getPlanByLevel(db, 'pro');
    const up = membership.computeOrderAmount(db, U_OWNER, pro, 'monthly');
    assert.equal(up.orderType, 'upgrade');
    assert.ok(up.credit > 0, '升级应产生剩余价值折抵');
    assert.ok(up.amount < 99, '升级实付应低于原价');
  });

  it('续费在原到期时间上顺延（不损失剩余时长）', () => {
    const before = db.prepare('SELECT expires_at FROM user_memberships WHERE user_id = ?').get(U_OWNER);
    const basic = membership.getPlanByLevel(db, 'basic');
    membership.activateMembership(db, {
      userId: U_OWNER, plan: basic, cycle: 'monthly', orderType: 'renew', orderId: null, autoRenew: false,
    });
    const after = db.prepare('SELECT expires_at FROM user_memberships WHERE user_id = ?').get(U_OWNER);
    assert.ok(new Date(after.expires_at) > new Date(before.expires_at), '续费后到期时间应顺延');
    cleanupUser(U_OWNER);
  });

  it('到期扫描：手动置过期后 processExpirations 落 expired', () => {
    const basic = membership.getPlanByLevel(db, 'basic');
    membership.activateMembership(db, {
      userId: U_A, plan: basic, cycle: 'monthly', orderType: 'new', orderId: null, autoRenew: false,
    });
    // 强制过期
    db.prepare('UPDATE user_memberships SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE user_id = ?').run(U_A);
    const n = membership.processExpirations(db, log);
    assert.ok(n >= 1);
    const info = membership.getUserMembership(db, U_A);
    assert.equal(info.levelCode, 'free', '过期后降级为 free');
    cleanupUser(U_A);
  });
});

// ===========================================================================
// S13-T04 支付集成
// ===========================================================================

describe('[S13-T04] 支付集成', () => {
  it('下单生成唯一订单号，pending 落库', () => {
    const { order } = payment.createOrder(db, log, {
      userId: U_OWNER, levelCode: 'basic', cycle: 'monthly', payMethod: 'wechat', autoRenew: false,
    });
    assert.match(order.order_no, /^MO/);
    assert.equal(order.pay_status, 'pending');
    assert.equal(order.amount, 29);
    // 未配置微信商户凭据时 gateway.configured=false（不伪造支付串）
    const g = payment.preparePayment(db, log, order, {});
    assert.equal(g.configured, false);
  });

  it('积分抵扣支付：余额充足时开通会员并扣积分', () => {
    grantPoints(U_OWNER, 5000); // 5000 积分 = 50 元，足够 basic 月付 29 元
    const { order } = payment.createOrder(db, log, {
      userId: U_OWNER, levelCode: 'basic', cycle: 'monthly', payMethod: 'points', autoRenew: true,
    });
    const before = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(U_OWNER);
    const res = payment.handlePaymentSuccess(db, log, { orderNo: order.order_no, autoRenew: true });
    assert.equal(res.alreadyPaid, false);
    assert.equal(res.membership.level_code, 'basic');
    assert.equal(Number(res.membership.auto_renew), 1);
    const after = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(U_OWNER);
    assert.equal(Number(before.balance_after) - Number(after.balance_after), 2900, '应扣减 2900 积分(29元)');
  });

  it('支付回调幂等：重复确认已支付订单返回 alreadyPaid=true 且不重复扣费', () => {
    const order = db.prepare("SELECT * FROM membership_orders WHERE user_id = ? AND pay_status='paid' ORDER BY id DESC LIMIT 1").get(U_OWNER);
    const balBefore = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(U_OWNER);
    const res = payment.handlePaymentSuccess(db, log, { orderNo: order.order_no });
    assert.equal(res.alreadyPaid, true);
    const balAfter = db.prepare('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(U_OWNER);
    assert.equal(Number(balBefore.balance_after), Number(balAfter.balance_after), '幂等回调不应二次扣费');
    cleanupUser(U_OWNER);
  });

  it('积分不足：下单预检即拒绝(INSUFFICIENT_POINTS)，不产生 pending 订单', () => {
    // 积分渠道在 createOrder→preparePayment 阶段就做余额预检，
    // 余额不足直接抛错，避免生成无法支付的 pending 订单（更佳的下单前置校验）。
    cleanupUser(U_B); // 确保 U_B 无足额积分
    assert.throws(
      () => payment.createOrder(db, log, {
        userId: U_B, levelCode: 'pro', cycle: 'yearly', payMethod: 'points', autoRenew: false,
      }),
      (e) => e.code === 'INSUFFICIENT_POINTS'
    );
    // 预检失败不应遗留该用户的 pending 会员订单
    const pending = db.prepare(
      "SELECT COUNT(*) c FROM membership_orders WHERE user_id = ? AND level_code = 'pro' AND pay_status = 'pending'"
    ).get(U_B).c;
    assert.equal(Number(pending), 0, '预检失败不应遗留 pending 订单');
    cleanupUser(U_B);
  });

  it('超时关单：pending 订单超时后置 closed', () => {
    const { order } = payment.createOrder(db, log, {
      userId: U_B, levelCode: 'basic', cycle: 'monthly', payMethod: 'wechat', autoRenew: false,
    });
    db.prepare('UPDATE membership_orders SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE id = ?').run(order.id);
    const closed = payment.closeExpiredOrders(db, log, 30);
    assert.ok(closed >= 1);
    const after = payment.getOrder(db, order.id);
    assert.equal(after.pay_status, 'closed');
    cleanupUser(U_B);
  });
});

// ===========================================================================
// S13-T05 功能配额限制
// ===========================================================================

describe('[S13-T05] 功能配额限制', () => {
  it('生成次数原子占用：free 用户 30 次内允许，超出抛 QUOTA_EXCEEDED', () => {
    cleanupUser(U_A); // free 用户
    // 直接把本月计数写到 29，再消费 1 次应成功，第 31 次应超限
    const period = quota.currentPeriodKey();
    db.prepare(
      `INSERT INTO membership_quota_usage (user_id, metric, period_key, used, updated_at)
       VALUES (?, 'generation', ?, 29, NOW())`
    ).run(U_A, period);
    const r = quota.checkAndConsumeGeneration(db, U_A); // 第30次
    assert.equal(r.used, 30);
    assert.equal(r.remaining, 0);
    assert.throws(
      () => quota.checkAndConsumeGeneration(db, U_A), // 第31次
      (e) => e.code === 'QUOTA_EXCEEDED'
    );
    cleanupUser(U_A);
  });

  it('企业版生成次数无限制', () => {
    const ent = membership.getPlanByLevel(db, 'enterprise');
    membership.activateMembership(db, {
      userId: U_A, plan: ent, cycle: 'yearly', orderType: 'new', orderId: null, autoRenew: false,
    });
    const c = quota.check(db, U_A, 'generation');
    assert.equal(c.unlimited, true);
    assert.equal(c.allowed, true);
    cleanupUser(U_A);
  });

  it('项目数统计真实来自 dramas（测试项目计入 owner）', () => {
    const used = quota.usedProjects(db, U_OWNER);
    assert.ok(used >= 1, '至少包含测试项目 99411');
  });

  it('配额总览返回四指标结构（含 project/generation/storage）', () => {
    const s = quota.summary(db, U_OWNER, { dramaId: T_DRAMA });
    assert.ok(s.metrics.generation && s.metrics.project && s.metrics.storage);
    assert.ok(s.metrics.collaborator, '带 dramaId 时应含协作人数指标');
    assert.equal(typeof s.period_key, 'string');
  });
});

// ===========================================================================
// S13-T06 评论批注系统
// ===========================================================================

describe('[S13-T06] 评论批注系统', () => {
  before(() => {
    // 建立协作成员，使 @提及与通知有对象
    const collab = require(path.resolve(__dirname, '..', 'src', 'services', 'collaborationService.js'));
    collab.addMember(db, T_DRAMA, U_A, 'artist', U_OWNER);
    collab.addMember(db, T_DRAMA, U_B, 'editor', U_OWNER);
  });

  it('节点评论 + 时间戳批注落库', () => {
    const c = comments.createComment(db, log, {
      dramaId: T_DRAMA, nodeKey: 'storyboard:1', authorId: U_OWNER, authorName: 'owner',
      content: '这一镜头节奏偏慢', timestampMs: 3500,
    });
    assert.equal(c.node_key, 'storyboard:1');
    assert.equal(Number(c.timestamp_ms), 3500);
    assert.equal(c.status, 'open');
    assert.equal(Number(c.root_id), Number(c.id), '顶层评论 root_id=自身');
  });

  it('线程回复继承 root/node，且列表聚合为线程', () => {
    const root = comments.createComment(db, log, {
      dramaId: T_DRAMA, nodeKey: 'character:1', authorId: U_A, authorName: 'A', content: '角色发型需调整',
    });
    const reply = comments.createComment(db, log, {
      dramaId: T_DRAMA, parentId: root.id, authorId: U_OWNER, authorName: 'owner', content: '同意，已安排',
    });
    assert.equal(Number(reply.root_id), Number(root.id));
    assert.equal(reply.node_key, 'character:1', '回复继承父节点定位');
    const threads = comments.listComments(db, T_DRAMA, { nodeKey: 'character:1', viewerId: U_B });
    const t = threads.find((x) => Number(x.id) === Number(root.id));
    assert.ok(t && t.replies.length === 1, '应聚合出 1 条回复');
  });

  it('@提及：给被提及者写入 comment_mentions + 定向通知', () => {
    const uname = db.prepare('SELECT username FROM users WHERE id = ?').get(U_B).username;
    const c = comments.createComment(db, log, {
      dramaId: T_DRAMA, nodeKey: 'scene:1', authorId: U_A, authorName: 'A',
      content: `请 @${uname} 复核这个场景`,
    });
    const men = db.prepare('SELECT * FROM comment_mentions WHERE comment_id = ?').all(c.id);
    assert.equal(men.length, 1);
    assert.equal(Number(men[0].mentioned_user_id), U_B);
    const notif = db.prepare(
      "SELECT * FROM collaboration_notifications WHERE drama_id = ? AND recipient_id = ? AND type = 'comment_mention'"
    ).all(T_DRAMA, U_B);
    assert.ok(notif.length >= 1, '被 @ 用户应收到通知');
  });

  it('已读未读：新评论对他人未读，markRead 后变已读', () => {
    const c = comments.createComment(db, log, {
      dramaId: T_DRAMA, nodeKey: 'scene:2', authorId: U_OWNER, authorName: 'owner', content: '待办：补光',
    });
    const beforeCnt = comments.unreadCount(db, T_DRAMA, U_A);
    assert.ok(beforeCnt >= 1, 'U_A 对他人评论应有未读');
    comments.markRead(db, c.id, U_A);
    const list = comments.listComments(db, T_DRAMA, { nodeKey: 'scene:2', viewerId: U_A });
    const item = list.find((x) => Number(x.id) === Number(c.id));
    assert.equal(item.unread, false, 'markRead 后应为已读');
  });

  it('markAllRead 清零未读；作者自评不计未读', () => {
    comments.markAllRead(db, T_DRAMA, U_A);
    assert.equal(comments.unreadCount(db, T_DRAMA, U_A), 0);
    // U_A 自己发的评论不应计入自己的未读
    comments.createComment(db, log, {
      dramaId: T_DRAMA, nodeKey: 'scene:3', authorId: U_A, authorName: 'A', content: '我的备注',
    });
    assert.equal(comments.unreadCount(db, T_DRAMA, U_A), 0, '作者自评不计未读');
  });

  it('批量回复：对多条评论一次性回复相同内容', () => {
    const c1 = comments.createComment(db, log, { dramaId: T_DRAMA, nodeKey: 'prop:1', authorId: U_B, authorName: 'B', content: '道具1问题' });
    const c2 = comments.createComment(db, log, { dramaId: T_DRAMA, nodeKey: 'prop:2', authorId: U_B, authorName: 'B', content: '道具2问题' });
    const created = comments.batchReply(db, log, {
      dramaId: T_DRAMA, commentIds: [c1.id, c2.id], authorId: U_OWNER, authorName: 'owner', content: '已处理',
    });
    assert.equal(created.length, 2);
    assert.equal(Number(created[0].parent_id), Number(c1.id));
    assert.equal(Number(created[1].parent_id), Number(c2.id));
  });

  it('解决状态：标记 resolved 记录解决人，可重开', () => {
    const c = comments.createComment(db, log, { dramaId: T_DRAMA, nodeKey: 'timeline:1', authorId: U_A, authorName: 'A', content: '时间轴对齐' });
    const resolved = comments.setStatus(db, c.id, 'resolved', U_OWNER);
    assert.equal(resolved.status, 'resolved');
    assert.equal(Number(resolved.resolved_by), U_OWNER);
    const reopened = comments.setStatus(db, c.id, 'open', U_OWNER);
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.resolved_by, null);
  });

  it('软删除：deleteComment 后不在列表出现', () => {
    const c = comments.createComment(db, log, { dramaId: T_DRAMA, nodeKey: 'scene:9', authorId: U_A, authorName: 'A', content: '待删除' });
    assert.equal(comments.deleteComment(db, c.id), true);
    const list = comments.listComments(db, T_DRAMA, { nodeKey: 'scene:9', viewerId: U_A });
    assert.equal(list.length, 0);
  });
});
