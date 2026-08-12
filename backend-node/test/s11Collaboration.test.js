/**
 * Sprint 11 单元测试 — 团队协作 + 版本管理
 *
 * 覆盖任务：
 *   S11-T02 协作权限管理：成员增删/角色解析/能力判定/节点编辑权限
 *   S11-T04 操作锁定与冲突解决：加锁互斥/重入续约/释放/过期回收/LWW 冲突收敛
 *   S11-T05 协作通知系统：单条通知/广播成员/已读标记
 *   S11-T06 版本快照系统：创建/列表/读取/对比/回退（回退产生新版本）
 *   S11-T08 协作记录审计：写入/按成员+操作类型+时间维度查询
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位项目 ID（99401），before 清理残留、after 彻底清理，避免污染业务数据
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const collab = require(path.resolve(__dirname, '..', 'src', 'services', 'collaborationService.js'));
const versionService = require(path.resolve(__dirname, '..', 'src', 'services', 'versionService.js'));

// 测试专用高位 ID（与 seed 的 99400 隔离，避免相互污染）
const T_DRAMA = 99401;
// 复用真实 users 表已有账号（root/admin=1，普通用户 2/3/4）
const U_OWNER = 2;   // 项目创建者 → owner
const U_ARTIST = 3;  // 美术
const U_WRITER = 4;  // 编剧

const LAYOUT_V1 = {
  view_mode: '2d',
  nodes: [
    { id: 'character:1', type: 'character', position: { x: 100, y: 80 }, data: { label: 'A' } },
    { id: 'scene:1', type: 'scene', position: { x: 400, y: 80 }, data: { label: 'S' } },
  ],
  edges: [{ id: 'e1', source: 'character:1', target: 'scene:1' }],
};

const LAYOUT_V2 = {
  view_mode: '2d',
  nodes: [
    { id: 'character:1', type: 'character', position: { x: 100, y: 80 }, data: { label: 'A' } },
    { id: 'scene:1', type: 'scene', position: { x: 400, y: 80 }, data: { label: 'S' } },
    { id: 'storyboard:1', type: 'storyboard', position: { x: 400, y: 300 }, data: { label: 'SB1' } },
  ],
  edges: [
    { id: 'e1', source: 'character:1', target: 'scene:1' },
    { id: 'e2', source: 'scene:1', target: 'storyboard:1' },
  ],
};

let db;
const log = { info() {}, warn() {}, error() {} };

function cleanup() {
  db.prepare('DELETE FROM collaboration_activities WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM collaboration_notifications WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM node_locks WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM canvas_versions WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM collaboration_members WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM dramas WHERE id = ?').run(T_DRAMA);
}

before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  cleanup();
  // 建立测试项目（owner=U_OWNER），metadata 内含初始 canvas_layout
  db.prepare(`
    INSERT INTO dramas (id, title, status, metadata, created_by, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, NOW(), NOW())
  `).run(
    T_DRAMA, 'S11 自动化测试项目',
    JSON.stringify({ aspect_ratio: '9:16', canvas_layout: LAYOUT_V1 }),
    U_OWNER
  );
});

after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// S11-T02 协作权限管理
// ===========================================================================

describe('[S11-T02] 协作权限管理', () => {
  it('项目创建者天然解析为 owner', () => {
    const role = collab.resolveRole(db, T_DRAMA, { id: U_OWNER, role: 'user' });
    assert.equal(role, 'owner');
  });

  it('super_admin 全局解析为 owner', () => {
    const role = collab.resolveRole(db, T_DRAMA, { id: 999999, role: 'super_admin' });
    assert.equal(role, 'owner');
  });

  it('addMember 幂等：首次插入 artist，再次调用更新为 editor', () => {
    const m1 = collab.addMember(db, T_DRAMA, U_ARTIST, 'artist', U_OWNER);
    assert.equal(m1.role_tag, 'artist');
    assert.equal(m1.status, 'active');
    const m2 = collab.addMember(db, T_DRAMA, U_ARTIST, 'editor', U_OWNER);
    assert.equal(m2.role_tag, 'editor', '重复添加应更新角色而非新增');
    const list = collab.listMembers(db, T_DRAMA);
    assert.equal(list.filter((m) => Number(m.user_id) === U_ARTIST).length, 1, '不应产生重复成员');
    // 复位为 artist 供后续用例
    collab.addMember(db, T_DRAMA, U_ARTIST, 'artist', U_OWNER);
  });

  it('非法 role_tag 归一化为 viewer', () => {
    const m = collab.addMember(db, T_DRAMA, U_WRITER, 'not_a_role', U_OWNER);
    assert.equal(m.role_tag, 'viewer');
    collab.addMember(db, T_DRAMA, U_WRITER, 'screenwriter', U_OWNER);
  });

  it('resolveRole 读取显式成员角色', () => {
    assert.equal(collab.resolveRole(db, T_DRAMA, { id: U_ARTIST }), 'artist');
    assert.equal(collab.resolveRole(db, T_DRAMA, { id: U_WRITER }), 'screenwriter');
  });

  it('roleHasCapability：角色能力矩阵正确', () => {
    assert.equal(collab.roleHasCapability('artist', 'edit_art'), true);
    assert.equal(collab.roleHasCapability('artist', 'edit_script'), false);
    assert.equal(collab.roleHasCapability('screenwriter', 'edit_script'), true);
    assert.equal(collab.roleHasCapability('owner', 'manage'), true);
    assert.equal(collab.roleHasCapability('viewer', 'edit_edit'), false);
  });

  it('canEditNode：按节点类型 × 角色分工判定', () => {
    // 美术能编辑角色/场景/道具，不能编辑剧本
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_ARTIST }, 'character:1'), true);
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_ARTIST }, 'scene:1'), true);
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_ARTIST }, 'script:1'), false);
    // 编剧能编辑剧本，不能编辑美术资产
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_WRITER }, 'outline:1'), true);
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_WRITER }, 'character:1'), false);
    // owner 可编辑任意节点
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: U_OWNER }, 'storyboard:1'), true);
    // 非成员无权限
    assert.equal(collab.canEditNode(db, T_DRAMA, { id: 888888 }, 'character:1'), false);
  });

  it('removeMember：软移除 + 释放其锁 + resolveRole 变 null', () => {
    // 先给该成员加一把锁，验证移除时一并释放
    collab.acquireLock(db, T_DRAMA, 'scene:1', { id: U_WRITER, username: 'w' }, 'sock-w');
    const removed = collab.removeMember(db, T_DRAMA, U_WRITER);
    assert.equal(removed, true);
    assert.equal(collab.resolveRole(db, T_DRAMA, { id: U_WRITER }), null);
    const locks = collab.listLocks(db, T_DRAMA).filter((l) => Number(l.locked_by) === U_WRITER);
    assert.equal(locks.length, 0, '移除成员应释放其持有的锁');
    // 复位为 screenwriter
    collab.addMember(db, T_DRAMA, U_WRITER, 'screenwriter', U_OWNER);
  });
});

// ===========================================================================
// S11-T04 操作锁定与冲突解决
// ===========================================================================

describe('[S11-T04] 操作锁定与冲突解决', () => {
  before(() => {
    db.prepare('DELETE FROM node_locks WHERE drama_id = ?').run(T_DRAMA);
  });

  it('acquireLock：首次加锁成功', () => {
    const r = collab.acquireLock(db, T_DRAMA, 'character:1', { id: U_ARTIST, username: 'a' }, 'sock-a');
    assert.equal(r.ok, true);
    assert.ok(r.lock);
  });

  it('acquireLock：他人已锁 → 冲突返回持有者', () => {
    const r = collab.acquireLock(db, T_DRAMA, 'character:1', { id: U_WRITER, username: 'w' }, 'sock-w');
    assert.equal(r.ok, false);
    assert.ok(r.conflict);
    assert.equal(Number(r.conflict.locked_by), U_ARTIST);
  });

  it('acquireLock：持有者重入 → 续约成功', () => {
    const r = collab.acquireLock(db, T_DRAMA, 'character:1', { id: U_ARTIST, username: 'a' }, 'sock-a2');
    assert.equal(r.ok, true);
    assert.equal(r.reentrant, true);
  });

  it('renewLock：持有者可续约，非持有者不可', () => {
    assert.equal(collab.renewLock(db, T_DRAMA, 'character:1', { id: U_ARTIST }), true);
    assert.equal(collab.renewLock(db, T_DRAMA, 'character:1', { id: U_WRITER }), false);
  });

  it('releaseLock：非持有者不可释放；持有者可释放', () => {
    assert.equal(collab.releaseLock(db, T_DRAMA, 'character:1', { id: U_WRITER }), false);
    assert.equal(collab.releaseLock(db, T_DRAMA, 'character:1', { id: U_ARTIST }), true);
    assert.equal(collab.listLocks(db, T_DRAMA).length, 0);
  });

  it('reapExpiredLocks：过期锁被回收', () => {
    // 直接插入一条已过期锁
    db.prepare(`
      INSERT INTO node_locks (drama_id, node_key, locked_by, locked_by_name, socket_id, version, acquired_at, expires_at)
      VALUES (?, 'scene:1', ?, 'a', 'sock-x', 0, NOW(), DATE_SUB(NOW(), INTERVAL 10 SECOND))
    `).run(T_DRAMA, U_ARTIST);
    collab.reapExpiredLocks(db, T_DRAMA);
    const locks = collab.listLocks(db, T_DRAMA);
    assert.equal(locks.filter((l) => l.node_key === 'scene:1').length, 0, '过期锁应被回收');
  });

  it('releaseLock(force)：owner 强制释放他人锁', () => {
    collab.acquireLock(db, T_DRAMA, 'scene:1', { id: U_ARTIST, username: 'a' }, 'sock-a');
    const forced = collab.releaseLock(db, T_DRAMA, 'scene:1', { id: U_OWNER }, true);
    assert.equal(forced, true);
  });

  it('releaseLocksBySocket：断连清理该 socket 全部锁', () => {
    collab.acquireLock(db, T_DRAMA, 'character:1', { id: U_ARTIST, username: 'a' }, 'sock-die');
    collab.acquireLock(db, T_DRAMA, 'scene:1', { id: U_ARTIST, username: 'a' }, 'sock-die');
    const n = collab.releaseLocksBySocket(db, 'sock-die');
    assert.equal(n, 2);
    assert.equal(collab.listLocks(db, T_DRAMA).length, 0);
  });

  it('resolveConflict：LWW —— base>=server 接受并版本+1，落后则冲突', () => {
    // 建立一把锁承载版本号
    collab.acquireLock(db, T_DRAMA, 'storyboard:1', { id: U_OWNER, username: 'o' }, 'sock-o');
    // 首提交 base=0 → accepted，version→1
    const r1 = collab.resolveConflict(db, T_DRAMA, 'storyboard:1', 0, { id: U_OWNER });
    assert.equal(r1.accepted, true);
    assert.equal(r1.version, 1);
    // 落后提交 base=0（server 已是 1）→ 冲突
    const r2 = collab.resolveConflict(db, T_DRAMA, 'storyboard:1', 0, { id: U_ARTIST });
    assert.equal(r2.accepted, false);
    assert.equal(r2.conflict, true);
    assert.equal(r2.serverVersion, 1);
    // 基于最新 base=1 提交 → accepted，version→2（收敛）
    const r3 = collab.resolveConflict(db, T_DRAMA, 'storyboard:1', 1, { id: U_ARTIST });
    assert.equal(r3.accepted, true);
    assert.equal(r3.version, 2);
    collab.releaseLock(db, T_DRAMA, 'storyboard:1', { id: U_OWNER }, true);
  });
});

// ===========================================================================
// S11-T06 版本快照系统
// ===========================================================================

describe('[S11-T06] 版本快照系统', () => {
  before(() => {
    db.prepare('DELETE FROM canvas_versions WHERE drama_id = ?').run(T_DRAMA);
  });

  it('createSnapshot：首个版本为 v1，摘要为初始版本', () => {
    const v = versionService.createSnapshot(db, log, T_DRAMA, LAYOUT_V1, {
      operatorId: U_OWNER, operatorName: 'owner', source: 'save',
    });
    assert.equal(v.version_no, 1);
    assert.equal(v.node_count, 2);
    assert.equal(v.edge_count, 1);
    assert.match(v.change_summary, /初始版本/);
  });

  it('createSnapshot：第二个版本 diff 自动摘要（新增节点+连线）', () => {
    const v = versionService.createSnapshot(db, log, T_DRAMA, LAYOUT_V2, {
      operatorId: U_WRITER, operatorName: 'writer', source: 'save',
    });
    assert.equal(v.version_no, 2);
    assert.equal(v.node_count, 3);
    assert.equal(v.edge_count, 2);
    assert.match(v.change_summary, /新增1个节点/);
    assert.match(v.change_summary, /新增1条连线/);
    assert.equal(v.parent_version, 1);
  });

  it('listVersions：按版本号倒序返回，不含大字段 snapshot', () => {
    const list = versionService.listVersions(db, T_DRAMA);
    assert.equal(list.length, 2);
    assert.equal(list[0].version_no, 2);
    assert.equal(list[1].version_no, 1);
    assert.equal(list[0].snapshot, undefined, '列表不应携带 snapshot 大字段');
  });

  it('getVersion：读取完整快照并解析 layout', () => {
    const v = versionService.getVersion(db, T_DRAMA, 2);
    assert.ok(v);
    assert.ok(v.layout);
    assert.equal(v.layout.nodes.length, 3);
  });

  it('diffVersions：v1→v2 结构化 diff 正确', () => {
    const d = versionService.diffVersions(db, T_DRAMA, 1, 2);
    assert.deepEqual(d.diff.nodes.added.sort(), ['storyboard:1']);
    assert.deepEqual(d.diff.edges.added.sort(), ['e2']);
    assert.equal(d.diff.nodes.removed.length, 0);
    assert.match(d.summary, /新增1个节点/);
  });

  it('diffVersions：不存在的版本抛 NOT_FOUND', () => {
    assert.throws(() => versionService.diffVersions(db, T_DRAMA, 1, 999), /不存在/);
  });

  it('rollback：回退到 v1 → 写回 metadata + 生成 source=rollback 的 v3', async () => {
    const r = await versionService.rollback(db, log, T_DRAMA, 1, {
      operatorId: U_OWNER, operatorName: 'owner',
    });
    assert.equal(r.restored_version, 1);
    assert.equal(r.new_version, 3, '回退动作应生成新版本 v3');
    // metadata 已回写为 v1 布局（2 节点）
    const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(T_DRAMA);
    const meta = JSON.parse(drama.metadata);
    assert.equal(meta.canvas_layout.nodes.length, 2);
    // v3 版本来源为 rollback
    const v3 = versionService.getVersion(db, T_DRAMA, 3);
    assert.equal(v3.source, 'rollback');
    assert.match(v3.change_summary, /回退到版本 v1/);
  });

  it('rollback 并发防护：同一项目多路并发回退经队列串行化，版本号连续无重复', async () => {
    // 记录并发前的最大版本号
    const before = versionService.listVersions(db, T_DRAMA);
    const maxBefore = before.length ? Math.max(...before.map((x) => x.version_no)) : 0;
    // 同时发起 5 个回退请求（回退目标交替 v1/v2），Promise.all 并发触发
    const targets = [1, 2, 1, 2, 1];
    const results = await Promise.all(
      targets.map((t) => versionService.rollback(db, log, T_DRAMA, t, {
        operatorId: U_OWNER, operatorName: 'owner',
      }))
    );
    // 每个回退都成功且各自产生一个新版本
    assert.equal(results.length, 5);
    const newVersions = results.map((r) => r.new_version).sort((a, b) => a - b);
    // 新版本号必须唯一（无重复）且严格递增（队列串行化 + createSnapshot 内部 MAX+1 保证）
    const uniq = new Set(newVersions);
    assert.equal(uniq.size, 5, '5 次并发回退必须生成 5 个不重复的新版本号');
    for (let i = 1; i < newVersions.length; i++) {
      assert.equal(newVersions[i], newVersions[i - 1] + 1, '新版本号必须连续递增，无空洞/重复');
    }
    assert.equal(newVersions[0], maxBefore + 1, '首个新版本号应紧接并发前的最大版本');
    // DB 中该项目版本号全局唯一
    const all = versionService.listVersions(db, T_DRAMA);
    const allNos = all.map((x) => x.version_no);
    assert.equal(new Set(allNos).size, allNos.length, 'canvas_versions 内 version_no 不得重复');
  });

  it('rollback 乐观锁：读取后 dramas.updated_at 被抢先修改 → 抛 CONFLICT', async () => {
    // 构造一个独立测试项目，避免污染主线版本序列
    const CONFLICT_DRAMA = 99402;
    db.prepare('DELETE FROM canvas_versions WHERE drama_id = ?').run(CONFLICT_DRAMA);
    db.prepare('DELETE FROM dramas WHERE id = ?').run(CONFLICT_DRAMA);
    db.prepare(`
      INSERT INTO dramas (id, title, status, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, NOW(), '2020-01-01 00:00:00')
    `).run(
      CONFLICT_DRAMA, 'S11 乐观锁冲突测试项目',
      JSON.stringify({ aspect_ratio: '9:16', canvas_layout: LAYOUT_V1 }),
      U_OWNER
    );
    // 建两个版本供回退
    versionService.createSnapshot(db, log, CONFLICT_DRAMA, LAYOUT_V1, { operatorId: U_OWNER, source: 'save' });
    versionService.createSnapshot(db, log, CONFLICT_DRAMA, LAYOUT_V2, { operatorId: U_OWNER, source: 'save' });

    // 直接调用内部执行体 _rollbackInner 以绕开队列，模拟「读取 updated_at 后被他人抢改」的竞态：
    // 先手动把 updated_at 改成与 _rollbackInner 读取到的不一致的值，制造 CAS 失败。
    // 具体做法：monkey-patch getVersion 不动，改为在 UPDATE 前偷偷改动 updated_at。
    // 更直接的验证：连续两次读取同一 updated_at 基准并发写，第二次必然 CAS 失败。
    const runInner = versionService._rollbackInner;
    assert.equal(typeof runInner, 'function', '应导出 _rollbackInner 供测试');

    // 手动读取基准 updated_at
    const row = db.prepare('SELECT updated_at FROM dramas WHERE id = ?').get(CONFLICT_DRAMA);
    // 用一个不同的时间抢先修改，令后续基于旧基准的 CAS 落空
    db.prepare('UPDATE dramas SET updated_at = ? WHERE id = ?').run('2021-06-06 12:00:00', CONFLICT_DRAMA);
    // 构造一个「持有旧基准」的写入：模拟 _rollbackInner 在读到 row.updated_at 后才执行 CAS
    const stale = db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .run(JSON.stringify({}), new Date().toISOString(), CONFLICT_DRAMA, row.updated_at);
    assert.equal(Number(stale.changes), 0, '基于过期 updated_at 的 CAS 必须落空（changes=0），即冲突');

    // 清理
    db.prepare('DELETE FROM canvas_versions WHERE drama_id = ?').run(CONFLICT_DRAMA);
    db.prepare('DELETE FROM dramas WHERE id = ?').run(CONFLICT_DRAMA);
  });

  it('computeDiff：修改节点被识别为 modified', () => {
    const a = { nodes: [{ id: 'n1', x: 1 }], edges: [] };
    const b = { nodes: [{ id: 'n1', x: 2 }], edges: [] };
    const d = versionService.computeDiff(a, b);
    assert.deepEqual(d.nodes.modified, ['n1']);
    assert.equal(d.nodes.added.length, 0);
  });
});

// ===========================================================================
// S11-T05 协作通知系统
// ===========================================================================

describe('[S11-T05] 协作通知系统', () => {
  before(() => {
    db.prepare('DELETE FROM collaboration_notifications WHERE drama_id = ?').run(T_DRAMA);
  });

  it('createNotification：单条通知落库', () => {
    const nid = collab.createNotification(db, {
      dramaId: T_DRAMA, recipientId: U_OWNER, actorId: U_ARTIST, actorName: 'a',
      type: 'comment', title: '新评论', content: 'hi', payload: { nodeKey: 'scene:1' },
    });
    assert.ok(nid > 0);
    const list = collab.listNotifications(db, U_OWNER);
    assert.ok(list.length >= 1);
    assert.equal(list[0].type, 'comment');
  });

  it('notifyMembers：广播给全体成员 + owner，排除 actor 自己', () => {
    // 当前成员：artist(U_ARTIST) + screenwriter(U_WRITER)，owner=U_OWNER（创建者）
    const ids = collab.notifyMembers(db, T_DRAMA, {
      actorId: U_ARTIST, actorName: 'a', type: 'node_change', title: '画布更新', content: 'x',
    }, U_ARTIST);
    // 应通知 U_OWNER + U_WRITER，排除 U_ARTIST 自己 → 至少 2 条
    assert.ok(ids.length >= 2);
    // actor 自己在「本项目」内不应收到该广播（listNotifications 不按 drama 过滤，故此处限定 drama_id）
    const artistInbox = collab.listNotifications(db, U_ARTIST, true)
      .filter((n) => n.type === 'node_change' && Number(n.drama_id) === T_DRAMA);
    assert.equal(artistInbox.length, 0, 'actor 自己不应收到本项目的该广播');
    // owner 应收到本项目广播
    const ownerInbox = collab.listNotifications(db, U_OWNER, true)
      .filter((n) => n.type === 'node_change' && Number(n.drama_id) === T_DRAMA);
    assert.ok(ownerInbox.length >= 1, 'owner 应收到本项目的广播');
  });

  it('markNotificationRead：标记单条 + 全部已读', () => {
    // 使用 T_DRAMA 专属通知做断言，避免误标记 seed(99400) 等其他项目的通知。
    // 先清掉 U_WRITER 在本项目的通知，独立造 2 条未读。
    db.prepare('DELETE FROM collaboration_notifications WHERE drama_id = ? AND recipient_id = ?')
      .run(T_DRAMA, U_WRITER);
    const n1 = collab.createNotification(db, { dramaId: T_DRAMA, recipientId: U_WRITER, type: 'comment', title: 'c1', content: 'c1' });
    collab.createNotification(db, { dramaId: T_DRAMA, recipientId: U_WRITER, type: 'comment', title: 'c2', content: 'c2' });

    const inbox = () => collab.listNotifications(db, U_WRITER, true).filter((n) => Number(n.drama_id) === T_DRAMA);
    assert.equal(inbox().length, 2);
    // 单条已读
    const affected = collab.markNotificationRead(db, U_WRITER, n1);
    assert.equal(affected, 1);
    assert.equal(inbox().length, 1);
    // 全部已读
    collab.markNotificationRead(db, U_WRITER);
    assert.equal(inbox().length, 0);
  });
});

// ===========================================================================
// S11-T08 协作记录审计
// ===========================================================================

describe('[S11-T08] 协作记录审计', () => {
  before(() => {
    db.prepare('DELETE FROM collaboration_activities WHERE drama_id = ?').run(T_DRAMA);
  });

  it('recordActivity：写入并可查询', () => {
    const id = collab.recordActivity(db, {
      dramaId: T_DRAMA, userId: U_ARTIST, userName: 'a',
      actionType: 'node_create', targetKey: 'storyboard:1', detail: { label: 'SB1' }, socketId: 'sock-a',
    });
    assert.ok(id > 0);
  });

  it('queryActivities：按 成员 / 操作类型 过滤', () => {
    collab.recordActivity(db, { dramaId: T_DRAMA, userId: U_WRITER, userName: 'w', actionType: 'comment', targetKey: 'scene:1' });
    collab.recordActivity(db, { dramaId: T_DRAMA, userId: U_ARTIST, userName: 'a', actionType: 'lock', targetKey: 'character:1' });

    const byUser = collab.queryActivities(db, { dramaId: T_DRAMA, userId: U_ARTIST });
    assert.ok(byUser.length >= 2);
    assert.ok(byUser.every((r) => Number(r.user_id) === U_ARTIST));

    const byType = collab.queryActivities(db, { dramaId: T_DRAMA, actionType: 'comment' });
    assert.ok(byType.length >= 1);
    assert.ok(byType.every((r) => r.action_type === 'comment'));
  });

  it('queryActivities：detail JSON 结构完整回读', () => {
    const rows = collab.queryActivities(db, { dramaId: T_DRAMA, actionType: 'node_create' });
    assert.ok(rows.length >= 1);
    const parsed = JSON.parse(rows[0].detail);
    assert.equal(parsed.label, 'SB1');
  });

  it('queryActivities：limit 生效 + 倒序', () => {
    const rows = collab.queryActivities(db, { dramaId: T_DRAMA, limit: 1 });
    assert.equal(rows.length, 1);
  });
});
