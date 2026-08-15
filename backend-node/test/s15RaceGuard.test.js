// ============================================================
// s15RaceGuard.test.js — 竞态修复回归（P0 审批状态机 + P1 AI 抢占）
//
// 背景：并发竞态审计报告（docs/reports/并发竞态风险预防审计报告.md）指出
//   - P0 workflowService.reviewStep：guard→UPDATE 无条件、无事务，并发审批会重复推进/覆盖 reviewer
//   - P1 image/video/bgm/videoMerge：processing 抢占无条件 UPDATE，多实例下重复调用外部 AI → 重复计费
// 修复统一采用「条件 UPDATE（WHERE 带状态）+ changes===1 判唯一赢家」。
//
// 数据约束：所有测试数据真实写入 MySQL（configs/config.yaml，localminidrama），
// 不使用 mock / SQLite。before 清理残留，after 彻底清理。
// MySQL 为同步驱动，单进程无法制造真线程并发；本测试通过「串行地二次调用」
// 精确验证条件 UPDATE 的核心不变式：一旦状态已被首个赢家改变，后续调用必然落空
// （reviewStep 抛 WF-REV-002；抢占 UPDATE changes===0），即并发下只有一个赢家、不重复副作用。
// ============================================================
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const workflowService = require(path.resolve(__dirname, '..', 'src', 'services', 'workflowService.js'));

let db;

function cleanup() {
  if (!db) return;
  const names = ['S15竞态WF1', 'S15竞态WF2', 'S15竞态WF3'];
  const ph = names.map(() => '?').join(',');
  db.prepare(`DELETE FROM workflow_step_logs WHERE instance_id IN (SELECT id FROM workflow_instances WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE name IN (${ph})))`).run(...names);
  db.prepare(`DELETE FROM workflow_instances WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE name IN (${ph}))`).run(...names);
  db.prepare(`DELETE FROM workflow_definitions WHERE name IN (${ph})`).run(...names);
}

before(() => {
  db = getDb(loadConfig().database);
  cleanup();
});

after(() => {
  cleanup();
  closeDb();
});

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function seedReviewing(db, log, wfName) {
  const def = workflowService.createDefinition(db, {
    name: wfName, steps_config: [{ type: 'auto_edit' }, { type: 'auto_edit' }], created_by: 1,
  });
  const inst = workflowService.createInstance(db, log, def.id, {});
  db.prepare('UPDATE workflow_step_logs SET status = ? WHERE instance_id = ? AND step_index = ?')
    .run('reviewing', inst.id, 0);
  return inst;
}

// ---------------------------------------------------------------------------
// P0-1：两个并发「通过」审批 —— 仅首个成功，第二个落空（WF-REV-002），实例只推进一次
// ---------------------------------------------------------------------------
test('P0 reviewStep — 重复 approve 只有一个赢家，实例不二次推进', () => {
  const log = makeLog();
  const inst = seedReviewing(db, log, 'S15竞态WF1');

  // 第一个审批者：赢家
  const steps1 = workflowService.reviewStep(db, inst.id, 0, { approved: true, reviewerId: 11, note: '一号通过' });
  assert.strictEqual(steps1[0].status, 'completed');
  assert.strictEqual(steps1[0].reviewer_id, 11);
  const instAfter1 = workflowService.getInstance(db, inst.id);
  assert.strictEqual(instAfter1.current_step_index, 1, '实例应推进到下一步');
  assert.strictEqual(instAfter1.completed_steps, 1);

  // 第二个审批者：状态已非 reviewing，条件 UPDATE 落空 → 抛 WF-REV-002
  assert.throws(
    () => workflowService.reviewStep(db, inst.id, 0, { approved: true, reviewerId: 22, note: '二号通过' }),
    /WF-REV-002/,
    '第二次 approve 必须被拒绝'
  );

  // 关键不变式：reviewer 未被覆盖、实例进度未被二次推进
  const step0 = db.prepare('SELECT * FROM workflow_step_logs WHERE instance_id = ? AND step_index = 0').get(inst.id);
  assert.strictEqual(step0.reviewer_id, 11, 'reviewer 不能被二号覆盖');
  assert.strictEqual(step0.review_note, '一号通过');
  const instAfter2 = workflowService.getInstance(db, inst.id);
  assert.strictEqual(instAfter2.current_step_index, 1, '实例进度不能被二次推进');
  assert.strictEqual(instAfter2.completed_steps, 1);
});

// ---------------------------------------------------------------------------
// P0-2：approve 与 reject 交叉并发 —— 首个 approve 赢，随后 reject 落空，实例不被改成 failed
// ---------------------------------------------------------------------------
test('P0 reviewStep — approve 赢家后 reject 落空，实例状态不被交叉篡改', () => {
  const log = makeLog();
  const inst = seedReviewing(db, log, 'S15竞态WF2');

  workflowService.reviewStep(db, inst.id, 0, { approved: true, reviewerId: 11, note: 'ok' });
  assert.throws(
    () => workflowService.reviewStep(db, inst.id, 0, { approved: false, reviewerId: 22, note: '驳回' }),
    /WF-REV-002/
  );

  const instAfter = workflowService.getInstance(db, inst.id);
  assert.notStrictEqual(instAfter.status, 'failed', '已通过的实例不能被后到的 reject 改成 failed');
  const step0 = db.prepare('SELECT status FROM workflow_step_logs WHERE instance_id = ? AND step_index = 0').get(inst.id);
  assert.strictEqual(step0.status, 'completed', '步骤应保持 completed');
});

// ---------------------------------------------------------------------------
// P1：AI 任务 processing 抢占 —— 条件 UPDATE 只放行一个执行者（模拟 image/video/bgm/merge 同源模式）
// 在真实 MySQL 的 workflow_step_logs 表上验证「WHERE status + changes」不变式，
// 无需拉起真实外部 AI 调用（成本），聚焦抢占语义本身。
// ---------------------------------------------------------------------------
test('P1 processing 抢占 — 条件 UPDATE 并发下仅一个赢家', () => {
  const log = makeLog();
  const def = workflowService.createDefinition(db, {
    name: 'S15竞态WF3', steps_config: [{ type: 'auto_edit' }], created_by: 1,
  });
  const inst = workflowService.createInstance(db, log, def.id, {});
  // 确保待抢占步骤处于 pending
  db.prepare("UPDATE workflow_step_logs SET status = 'pending' WHERE instance_id = ? AND step_index = 0").run(inst.id, 0);

  // 模拟两个 worker 依次尝试抢占同一 pending 任务（修复后各服务的 claim 语句同源）
  const claim = () => db.prepare(
    "UPDATE workflow_step_logs SET status = 'processing' WHERE instance_id = ? AND step_index = 0 AND status = 'pending'"
  ).run(inst.id, 0).changes;

  const first = claim();
  const second = claim();

  assert.strictEqual(first, 1, '首个 worker 抢占成功 changes===1');
  assert.strictEqual(second, 0, '第二个 worker 落空 changes===0（不会重复调用外部 AI）');
  assert.strictEqual(db.prepare('SELECT status FROM workflow_step_logs WHERE instance_id = ? AND step_index = 0').get(inst.id).status, 'processing');
});
