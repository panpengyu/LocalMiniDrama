'use strict';

/**
 * Sprint 20 - T20-01 分支叙事 + T20-02 语音评论 集成测试
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock、无 SQLite 内存库。
 *   - 数据真实落库 episodes / storyboards / canvas_comments / comment_reads / comment_mentions。
 *   - 独立 ID 区间（9000009xx）+ s20t_ 前缀隔离，before 清理残留、after 精确清理，与其它测试并行不冲突。
 *
 * 覆盖：
 *   [1] listBranches：初始仅主线（episode_count 汇总）
 *   [2] createBranch：复制源集 + 分镜，branch_id/branch_type/branch_name 落库，分镜继承分支列
 *   [3] renameBranch：重命名生效；空名 EMPTY_NAME；主线不可重命名 MAIN_BRANCH_IMMUTABLE
 *   [4] setStoryboardCondition：条件连线 JSON + target_scene_id 落库；缺失分镜 SCENE_NOT_FOUND
 *   [5] exportByBranch：主线导出含集号/台词/条件分支标注；分支导出只含该分支内容
 *   [6] moveEpisode：集移动到分支 / 移回主线，两侧 episode_count 联动
 *   [7] deleteBranch：删除分支下全部集与分镜，主线不受影响
 *   [8] 语音评论：仅语音（无文字）可发表；语音字段落库；两者皆空 EMPTY_CONTENT
 *   [9] 语音评论列表：voice_url / voice_duration 随线程结构返回
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const branch = require(path.resolve(__dirname, '..', 'src', 'services', 'branchService.js'));
const comments = require(path.resolve(__dirname, '..', 'src', 'services', 'commentService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);

const T_DRAMA = 900000910;
const U_OWNER = 900000911;
const U_VIEWER = 900000912;
const EP_MAIN = 900000913;    // 第 1 集（主线，含分镜 SCENE_A）
const EP_MAIN_2 = 900000914;  // 第 2 集（主线，含分镜 SCENE_B）
const SCENE_A = 900000921;    // 分镜 A 的 scene_id
const SCENE_B = 900000922;    // 分镜 B 的 scene_id

let branchAId;                // createBranch 生成的分支 ID
let branchEps;                // 分支下的集 ID
let voiceCommentId;

function cleanup() {
  db.prepare('DELETE FROM comment_reads WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM comment_mentions WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM canvas_comments WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM collaboration_notifications WHERE drama_id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM storyboards WHERE episode_id IN (?, ?) OR scene_id IN (?, ?)')
    .run(EP_MAIN, EP_MAIN_2, SCENE_A, SCENE_B);
  db.prepare('DELETE FROM episodes WHERE id IN (?, ?)').run(EP_MAIN, EP_MAIN_2);
  db.prepare('DELETE FROM dramas WHERE id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(U_OWNER, U_VIEWER);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();

  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, status)
     VALUES (?, ?, 'x', 'user', ?, 1)`
  ).run(U_OWNER, `s20t_owner_${TAG}`, `s20t_owner_nick_${TAG}`);
  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, status)
     VALUES (?, ?, 'x', 'user', ?, 1)`
  ).run(U_VIEWER, `s20t_viewer_${TAG}`, `s20t_viewer_nick_${TAG}`);

  db.prepare(`
    INSERT INTO dramas (id, title, status, metadata, created_by, created_at, updated_at)
    VALUES (?, 'S20 分支叙事测试项目', 'draft', '{}', ?, NOW(), NOW())
  `).run(T_DRAMA, U_OWNER);

  // 主线两集
  db.prepare(`
    INSERT INTO episodes (id, drama_id, episode_number, title, script_content, description, status, created_at, updated_at)
    VALUES (?, ?, 1, '第1集·正片', '正片剧本正文', '分支测试源集', 'draft', NOW(), NOW())
  `).run(EP_MAIN, T_DRAMA);
  db.prepare(`
    INSERT INTO episodes (id, drama_id, episode_number, title, script_content, description, status, created_at, updated_at)
    VALUES (?, ?, 2, '第2集·正片', '第二集剧本正文', '移动测试源集', 'draft', NOW(), NOW())
  `).run(EP_MAIN_2, T_DRAMA);

  // 分镜 A（挂 EP_MAIN）：用于条件连线
  db.prepare(`
    INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, dialogue, action, shot_type, angle, status, created_at, updated_at)
    VALUES (?, ?, 1, '开场镜头', '你好，我是主角', '推门而入', '特写', '平视', 'draft', NOW(), NOW())
  `).run(EP_MAIN, SCENE_A);
  // 分镜 B（挂 EP_MAIN_2）
  db.prepare(`
    INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, dialogue, action, shot_type, angle, status, created_at, updated_at)
    VALUES (?, ?, 1, '第二集镜头', '第二集台词', '转身离开', '中景', '仰角', 'draft', NOW(), NOW())
  `).run(EP_MAIN_2, SCENE_B);
});

test.after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// [1] 分支列表：初始仅主线
// ===========================================================================
test('[S20-T01][1] 初始分支列表仅主线，episode_count 汇总两集', () => {
  const items = branch.listBranches(db, T_DRAMA);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, null, '主线 branch_id 为 null');
  assert.equal(items[0].type, 'main');
  assert.equal(items[0].name, '主线');
  assert.equal(items[0].episodeCount, 2);
});

// ===========================================================================
// [2] 创建分支：复制源集 + 分镜
// ===========================================================================
test('[S20-T01][2] createBranch 复制源集与分镜并落库分支列', () => {
  const out = branch.createBranch(db, log, {
    dramaId: T_DRAMA,
    sourceEpisodeId: EP_MAIN,
    name: '亲情线',
  });
  assert.ok(out.id, '应返回分支 ID');
  assert.equal(out.name, '亲情线');
  assert.equal(out.type, 'branch');
  assert.equal(out.episode.episodeNumber, 1, '分支集沿用源集集号');
  assert.equal(out.copiedStoryboards, 1, '源集 1 个分镜应被复制');
  branchAId = String(out.id);
  branchEps = [Number(out.episode.id)];

  // 分支列表：主线 + 分支
  const items = branch.listBranches(db, T_DRAMA);
  assert.equal(items.length, 2);
  const branchItem = items.find((b) => String(b.id) === branchAId);
  assert.ok(branchItem, '列表应包含新建分支');
  assert.equal(branchItem.name, '亲情线');
  assert.equal(branchItem.episodeCount, 1);

  // 落库校验：分支集与分镜
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(branchEps[0]);
  assert.equal(String(ep.branch_id), branchAId);
  assert.equal(ep.branch_type, 'branch');
  assert.equal(ep.branch_name, '亲情线');
  assert.equal(ep.episode_number, 1);

  const board = db.prepare('SELECT * FROM storyboards WHERE episode_id = ?').get(branchEps[0]);
  assert.ok(board, '分支分镜应存在');
  assert.equal(String(board.branch_id), branchAId);
  assert.equal(board.branch_type, 'branch');
  assert.equal(board.dialogue, '你好，我是主角', '分镜内容继承源分镜');
  assert.equal(board.scene_id, null, '分支分镜不与主线 scene_id 冲突');
});

// ===========================================================================
// [3] 重命名分支
// ===========================================================================
test('[S20-T01][3] renameBranch 生效；空名与主线不可重命名被拒', () => {
  const out = branch.renameBranch(db, log, { dramaId: T_DRAMA, branchId: branchAId, name: '亲情线·加长版' });
  assert.equal(out.name, '亲情线·加长版');
  const ep = db.prepare('SELECT branch_name FROM episodes WHERE id = ?').get(branchEps[0]);
  assert.equal(ep.branch_name, '亲情线·加长版');

  assert.throws(
    () => branch.renameBranch(db, log, { dramaId: T_DRAMA, branchId: branchAId, name: '  ' }),
    (err) => err.code === 'EMPTY_NAME'
  );
  assert.throws(
    () => branch.renameBranch(db, log, { dramaId: T_DRAMA, branchId: null, name: '主线改名' }),
    (err) => err.code === 'MAIN_BRANCH_IMMUTABLE'
  );
});

// ===========================================================================
// [4] 条件连线
// ===========================================================================
test('[S20-T01][4] setStoryboardCondition 落库条件 JSON 与目标分镜', () => {
  const out = branch.setStoryboardCondition(db, log, {
    sceneId: SCENE_A,
    condition: '若主角犹豫则进入亲情支线',
    targetSceneId: SCENE_B,
  });
  assert.equal(out.condition, '若主角犹豫则进入亲情支线');
  assert.equal(out.targetSceneId, SCENE_B);

  const row = db.prepare('SELECT * FROM storyboards WHERE scene_id = ?').get(SCENE_A);
  const cond = JSON.parse(row.branch_condition);
  assert.equal(cond.condition, '若主角犹豫则进入亲情支线');
  assert.equal(cond.target_scene_id, SCENE_B);
  assert.equal(Number(row.branch_target_scene_id), SCENE_B);

  // 缺失分镜
  assert.throws(
    () => branch.setStoryboardCondition(db, log, { sceneId: 900000999, condition: 'x' }),
    (err) => err.code === 'SCENE_NOT_FOUND'
  );
});

// ===========================================================================
// [5] 按分支导出剧本
// ===========================================================================
test('[S20-T01][5] exportByBranch 主线/分支导出内容正确', () => {
  // 主线：两集 + 分镜 A 台词 + 条件分支标注
  const main = branch.exportByBranch(db, log, { dramaId: T_DRAMA, branchId: null });
  assert.equal(main.branchName, '主线');
  assert.equal(main.episodes, 2);
  assert.ok(main.text.includes('第 1 集'), '主线导出应含第 1 集');
  assert.ok(main.text.includes('第 2 集'), '主线导出应含第 2 集');
  assert.ok(main.text.includes('台词：你好，我是主角'));
  assert.ok(main.text.includes('◆ 条件分支：若主角犹豫则进入亲情支线'));
  assert.ok(main.text.includes(`跳转分镜 ${SCENE_B}`));

  // 分支：仅分支内 1 集（复制自第 1 集），不含第 2 集内容
  const sub = branch.exportByBranch(db, log, { dramaId: T_DRAMA, branchId: branchAId });
  assert.equal(sub.branchName, '亲情线·加长版');
  assert.equal(sub.episodes, 1);
  assert.ok(sub.text.includes('第 1 集'));
  assert.ok(!sub.text.includes('第 2 集'), '分支导出不应包含主线第 2 集');
  assert.ok(sub.text.includes('台词：你好，我是主角'), '分支分镜台词应导出');
});

// ===========================================================================
// [6] 移动剧集跨分支
// ===========================================================================
test('[S20-T01][6] moveEpisode 移入分支/移回主线，两侧计数联动', () => {
  const moved = branch.moveEpisode(db, log, { episodeId: EP_MAIN_2, branchId: branchAId });
  assert.equal(String(moved.branchId), branchAId);
  assert.equal(moved.branchType, 'branch');

  let items = branch.listBranches(db, T_DRAMA);
  let sub = items.find((b) => String(b.id) === branchAId);
  let main = items.find((b) => b.id === null);
  assert.equal(sub.episodeCount, 2, '分支应含 2 集');
  assert.equal(main.episodeCount, 1, '主线应剩 1 集');

  // 分支导出含第 2 集
  const subExport = branch.exportByBranch(db, log, { dramaId: T_DRAMA, branchId: branchAId });
  assert.ok(subExport.text.includes('第 2 集'));
  assert.ok(subExport.text.includes('台词：第二集台词'));

  // 移回主线
  const back = branch.moveEpisode(db, log, { episodeId: EP_MAIN_2, branchId: null });
  assert.equal(back.branchId, null);
  assert.equal(back.branchType, 'main');
  items = branch.listBranches(db, T_DRAMA);
  assert.equal(items.find((b) => String(b.id) === branchAId).episodeCount, 1);
  assert.equal(items.find((b) => b.id === null).episodeCount, 2);

  // 不存在集
  assert.throws(
    () => branch.moveEpisode(db, log, { episodeId: 900000998, branchId: null }),
    (err) => err.code === 'EPISODE_NOT_FOUND'
  );
});

// ===========================================================================
// [7] 删除分支
// ===========================================================================
test('[S20-T01][7] deleteBranch 级联删除分支集与分镜，主线不受影响', () => {
  const out = branch.deleteBranch(db, log, { dramaId: T_DRAMA, branchId: branchAId });
  assert.equal(out.deletedEpisodes, 1);
  assert.equal(out.deletedStoryboards, 1);

  const epsLeft = db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL').all(T_DRAMA);
  assert.equal(epsLeft.length, 2, '主线两集应保留');
  const boardsLeft = db.prepare('SELECT id FROM storyboards WHERE episode_id = ?').all(EP_MAIN);
  assert.equal(boardsLeft.length, 1, '主线分镜应保留');

  const items = branch.listBranches(db, T_DRAMA);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, null);

  // 主线不可删除
  assert.throws(
    () => branch.deleteBranch(db, log, { dramaId: T_DRAMA, branchId: null }),
    (err) => err.code === 'MAIN_BRANCH_IMMUTABLE'
  );
});

// ===========================================================================
// [8] 语音评论：仅语音可发表 + 空内容拒绝
// ===========================================================================
test('[S20-T02][8] 仅语音（无文字）可发表，语音字段真实落库', () => {
  const voice = comments.createComment(db, log, {
    dramaId: T_DRAMA,
    nodeKey: 'storyboard:1',
    authorId: U_OWNER,
    authorName: `s20t_owner_nick_${TAG}`,
    content: '',
    voiceUrl: '/static/uploads/voice/s20t_demo_comment.mp3',
    voiceDuration: 12.5,
  });
  assert.ok(voice.id);
  assert.equal(voice.content, '');
  assert.equal(voice.voice_url, '/static/uploads/voice/s20t_demo_comment.mp3');
  assert.equal(Number(voice.voice_duration), 12.5);
  voiceCommentId = voice.id;

  const row = db.prepare('SELECT * FROM canvas_comments WHERE id = ?').get(voiceCommentId);
  assert.equal(row.voice_url, '/static/uploads/voice/s20t_demo_comment.mp3');
  assert.equal(Number(row.voice_duration), 12.5);
  assert.equal(row.is_deleted, 0);

  // 文字 + 语音并存
  const both = comments.createComment(db, log, {
    dramaId: T_DRAMA,
    nodeKey: 'storyboard:2',
    authorId: U_VIEWER,
    authorName: `s20t_viewer_nick_${TAG}`,
    content: '这条带语音',
    voiceUrl: '/static/uploads/voice/s20t_both.mp3',
    voiceDuration: 3.2,
  });
  assert.equal(both.content, '这条带语音');
  assert.equal(both.voice_url, '/static/uploads/voice/s20t_both.mp3');
  assert.equal(Number(both.voice_duration), 3.2);

  // 两者皆空 → 拒绝
  assert.throws(
    () => comments.createComment(db, log, {
      dramaId: T_DRAMA,
      authorId: U_OWNER,
      authorName: 'x',
      content: '',
      voiceUrl: null,
    }),
    (err) => err.code === 'EMPTY_CONTENT'
  );
});

// ===========================================================================
// [9] 语音评论随线程列表返回
// ===========================================================================
test('[S20-T02][9] listComments 线程结构携带语音字段', () => {
  const items = comments.listComments(db, T_DRAMA, { nodeKey: 'storyboard:1' });
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].id), voiceCommentId);
  assert.equal(items[0].voice_url, '/static/uploads/voice/s20t_demo_comment.mp3');
  assert.equal(Number(items[0].voice_duration), 12.5);

  // 语音评论可被回复
  const reply = comments.createComment(db, log, {
    dramaId: T_DRAMA,
    parentId: voiceCommentId,
    authorId: U_VIEWER,
    authorName: `s20t_viewer_nick_${TAG}`,
    content: '回复语音评论',
  });
  assert.ok(reply.id);
  const roots = comments.listComments(db, T_DRAMA, {});
  const root = roots.find((r) => Number(r.id) === voiceCommentId);
  assert.ok(root, '语音评论应作为线程根存在');
  assert.ok(root.replies.some((r) => r.content === '回复语音评论'), '回复应挂在语音评论线程下');
});
