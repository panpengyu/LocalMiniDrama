// ============================================================
// taskService.test.js — 异步任务服务测试
// 覆盖：启动孤儿任务清理（failOrphanedAsyncTasksOnStartup）+ 用户取消任务
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试任务 id 使用唯一
//       前缀（ldtest-）隔离真实任务，beforeEach 清理。
// ============================================================
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const taskService = require('../src/services/taskService');

const PREFIX = 'ldtest-';

function db() {
  return getDb(loadConfig().database);
}

// 清理本测试产生的任务
function cleanup() {
  db().prepare(`DELETE FROM async_tasks WHERE id LIKE '${PREFIX}%'`).run();
}

describe('taskService.failOrphanedAsyncTasksOnStartup', () => {
  beforeEach(cleanup);
  after(() => { cleanup(); closeDb(); });

  it('marks pending and processing tasks as failed on startup', () => {
    const d = db();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const idPending = PREFIX + 'pending';
    const idProcessing = PREFIX + 'processing';
    const idDone = PREFIX + 'done';
    d.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run(idPending, 'background_extraction', 'pending', '42', now, now);
    d.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run(idProcessing, 'background_extraction', 'processing', '42', now, now);
    d.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 100, '', ?, ?, ?, ?)`
    ).run(idDone, 'background_extraction', 'completed', '42', now, now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(d, { warn() {}, info() {} });
    assert.equal(count, 2);

    const pending = taskService.getTask(d, idPending);
    const processing = taskService.getTask(d, idProcessing);
    const done = taskService.getTask(d, idDone);

    assert.equal(pending.status, 'failed');
    assert.equal(processing.status, 'failed');
    assert.equal(pending.error, taskService.ORPHAN_ASYNC_TASK_MSG);
    assert.equal(done.status, 'completed');
  });

  it('cancelTask marks active task as failed', () => {
    const d = db();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const idActive = PREFIX + 'active';
    d.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run(idActive, 'background_extraction', 'processing', '42', now, now);

    const result = taskService.cancelTask(d, { info() {} }, idActive);
    assert.equal(result.ok, true);
    const task = taskService.getTask(d, idActive);
    assert.equal(task.status, 'failed');
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  });
});
