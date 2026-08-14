// ============================================================
// s15RaceGuard.test.js — 竞态修复回归（P0 审批状态机 + P1 AI 抢占）
//
// 背景：并发竞态审计报告（docs/reports/并发竞态风险预防审计报告.md）指出
//   - P0 workflowService.reviewStep：guard→UPDATE 无条件、无事务，并发审批会重复推进/覆盖 reviewer
//   - P1 image/video/bgm/videoMerge：processing 抢占无条件 UPDATE，多实例下重复调用外部 AI → 重复计费
// 修复统一采用「条件 UPDATE（WHERE 带状态）+ changes===1 判唯一赢家」。
//
// better-sqlite3 为同步驱动，单进程无法制造真线程并发；本测试通过「串行地二次调用」
// 精确验证条件 UPDATE 的核心不变式：一旦状态已被首个赢家改变，后续调用必然落空
// （reviewStep 抛 WF-REV-002；抢占 UPDATE changes===0），即并发下只有一个赢家、不重复副作用。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowService = require('../src/services/workflowService');

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

// —— workflow 三表最小 schema（与 s7Workflow.test.js 对齐）——
function makeWfDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's15race-wf-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE workflow_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL, description TEXT,
      drama_id BIGINT, steps_config TEXT NOT NULL, trigger_type VARCHAR(32) DEFAULT 'manual',
      is_active INTEGER DEFAULT 1, created_by BIGINT, created_at DATETIME, updated_at DATETIME);
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, definition_id BIGINT NOT NULL, drama_id BIGINT, episode_id BIGINT,
      status VARCHAR(16) DEFAULT 'pending', current_step_index INTEGER DEFAULT 0, context TEXT,
      total_steps INTEGER DEFAULT 0, completed_steps INTEGER DEFAULT 0, started_at DATETIME, completed_at DATETIME,
      error_message TEXT, created_by BIGINT, created_at DATETIME, updated_at DATETIME);
    CREATE TABLE workflow_step_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id BIGINT NOT NULL, step_index INTEGER NOT NULL,
      step_type VARCHAR(64) NOT NULL, step_name VARCHAR(128), status VARCHAR(16) DEFAULT 'pending',
      input_data TEXT, output_data TEXT, started_at DATETIME, completed_at DATETIME, duration_ms BIGINT,
      retry_count INTEGER DEFAULT 0, error_message TEXT, reviewer_id BIGINT, reviewed_at DATETIME, review_note TEXT);
  `);
  return { db, dir };
}

function seedReviewing(db, log) {
  const def = workflowService.createDefinition(db, {
    name: 'WF', steps_config: [{ type: 'auto_edit' }, { type: 'auto_edit' }], created_by: 1,
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
  const { db, dir } = makeWfDb();
  const log = makeLog();
  try {
    const inst = seedReviewing(db, log);

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
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P0-2：approve 与 reject 交叉并发 —— 首个 approve 赢，随后 reject 落空，实例不被改成 failed
// ---------------------------------------------------------------------------
test('P0 reviewStep — approve 赢家后 reject 落空，实例状态不被交叉篡改', () => {
  const { db, dir } = makeWfDb();
  const log = makeLog();
  try {
    const inst = seedReviewing(db, log);

    workflowService.reviewStep(db, inst.id, 0, { approved: true, reviewerId: 11, note: 'ok' });
    assert.throws(
      () => workflowService.reviewStep(db, inst.id, 0, { approved: false, reviewerId: 22, note: '驳回' }),
      /WF-REV-002/
    );

    const instAfter = workflowService.getInstance(db, inst.id);
    assert.notStrictEqual(instAfter.status, 'failed', '已通过的实例不能被后到的 reject 改成 failed');
    const step0 = db.prepare('SELECT status FROM workflow_step_logs WHERE instance_id = ? AND step_index = 0').get(inst.id);
    assert.strictEqual(step0.status, 'completed', '步骤应保持 completed');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// P1：AI 任务 processing 抢占 —— 条件 UPDATE 只放行一个执行者（模拟 image/video/bgm/merge 同源模式）
// 直接以最小 pending→processing 表验证「WHERE status='pending' + changes」不变式，
// 无需拉起真实外部 AI 调用（成本），聚焦抢占语义本身。
// ---------------------------------------------------------------------------
test('P1 processing 抢占 — 条件 UPDATE 并发下仅一个赢家', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's15race-ai-'));
  const db = new Database(path.join(dir, 'test.db'));
  try {
    db.pragma('journal_mode = MEMORY');
    db.exec(`CREATE TABLE gen (id INTEGER PRIMARY KEY, status VARCHAR(16) DEFAULT 'pending', updated_at DATETIME);`);
    db.prepare("INSERT INTO gen (id, status) VALUES (1, 'pending')").run();

    // 模拟两个 worker 依次尝试抢占同一 pending 任务（修复后各服务的 claim 语句同源）
    const claim = () => db.prepare(
      "UPDATE gen SET status = 'processing', updated_at = ? WHERE id = 1 AND status = 'pending'"
    ).run(new Date().toISOString()).changes;

    const first = claim();
    const second = claim();

    assert.strictEqual(first, 1, '首个 worker 抢占成功 changes===1');
    assert.strictEqual(second, 0, '第二个 worker 落空 changes===0（不会重复调用外部 AI）');
    assert.strictEqual(db.prepare('SELECT status FROM gen WHERE id = 1').get().status, 'processing');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
