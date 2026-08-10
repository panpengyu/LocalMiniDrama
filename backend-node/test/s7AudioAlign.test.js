// ============================================================
// s7AudioAlign.test.js — Sprint 7
// S7-T08: 配音与视频自动对齐测试
// 覆盖场景：
//   1) alignStoryboard — stretch 策略（拉伸分镜时长匹配配音 + 300ms 缓冲）
//   2) alignStoryboard — trim 策略（保持分镜时长不变）
//   3) alignStoryboard — loop 策略（取最大值）
//   4) alignStoryboard — silence 策略（配音时长 + 500ms 静音）
//   5) alignStoryboard — 无音频时长时使用原时长
//   6) alignStoryboard — 分镜不存在时抛错
//   7) alignStoryboard — 缺少 storyboard_id 抛错
//   8) alignStoryboard — 对齐日志落库
//   9) batchAlign — 批量对齐分集配音
//  10) batchAlign — 无配音分镜时返回 aligned_count=0
//  11) getAlignLogs — 按分集查询对齐记录
//  12) getAlignLogs — 按项目查询对齐记录
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's7audio-'));
  const dbFile = path.join(dir, 'test.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT, episode_id BIGINT, storyboard_number INT,
      duration DOUBLE, narration TEXT, dialogue TEXT,
      deleted_at DATETIME
    );
    CREATE TABLE audio_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id BIGINT, audio_url VARCHAR(512),
      local_path VARCHAR(512), duration INT, status VARCHAR(32)
    );
    CREATE TABLE audio_align_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT, episode_id BIGINT, storyboard_id BIGINT,
      audio_url VARCHAR(512), audio_duration_ms BIGINT,
      original_duration_ms BIGINT, adjusted_duration_ms BIGINT,
      alignment_strategy VARCHAR(32) DEFAULT 'stretch',
      status VARCHAR(16) DEFAULT 'pending',
      created_at DATETIME, updated_at DATETIME
    );
  `);
  return { db, dir };
}

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const audioAlignService = require('../src/services/audioAlignService');

// ============================================================
// 1. alignStoryboard — stretch 策略
// ============================================================

test('S7-AUDIO-01: alignStoryboard — stretch 策略（音频时长 + 300ms）', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration, dialogue) VALUES (1, 99000, 100, 3.0, '林深:这里到底发生过什么？')`).run();
    const log = makeLog();
    const result = audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      drama_id: 99000,
      episode_id: 100,
      audio_url: '/aud/sb1.mp3',
      audio_duration_ms: 2800,
      original_duration_ms: 3000,
      strategy: 'stretch',
    });
    assert.strictEqual(result.storyboard_id, 1);
    assert.strictEqual(result.audio_duration_ms, 2800);
    assert.strictEqual(result.original_duration_ms, 3000);
    // stretch: 2800 + 300 = 3100ms
    assert.strictEqual(result.adjusted_duration_ms, 3100);
    assert.strictEqual(result.adjusted_duration_sec, 3.1);
    assert.strictEqual(result.strategy, 'stretch');
    // 验证分镜时长已更新
    const sb = db.prepare('SELECT duration FROM storyboards WHERE id = ?').get(1);
    assert.strictEqual(sb.duration, 3.1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 2. alignStoryboard — trim 策略
// ============================================================

test('S7-AUDIO-02: alignStoryboard — trim 策略（保持原时长）', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 4.0)`).run();
    const log = makeLog();
    const result = audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      audio_duration_ms: 6000, // 配音比画面长
      original_duration_ms: 4000,
      strategy: 'trim',
    });
    // trim: 保持原时长 4000ms
    assert.strictEqual(result.adjusted_duration_ms, 4000);
    assert.strictEqual(result.strategy, 'trim');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 3. alignStoryboard — loop 策略
// ============================================================

test('S7-AUDIO-03: alignStoryboard — loop 策略（取最大值）', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 3.0)`).run();
    const log = makeLog();
    const result = audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      audio_duration_ms: 5000,
      original_duration_ms: 3000,
      strategy: 'loop',
    });
    // loop: max(5000+300, 3000) = 5300ms
    assert.strictEqual(result.adjusted_duration_ms, 5300);
    assert.strictEqual(result.strategy, 'loop');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 4. alignStoryboard — silence 策略
// ============================================================

test('S7-AUDIO-04: alignStoryboard — silence 策略（音频 + 500ms）', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 3.0)`).run();
    const log = makeLog();
    const result = audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      audio_duration_ms: 4000,
      original_duration_ms: 3000,
      strategy: 'silence',
    });
    // silence: 4000 + 500 = 4500ms
    assert.strictEqual(result.adjusted_duration_ms, 4500);
    assert.strictEqual(result.strategy, 'silence');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 5. alignStoryboard — 无音频时长时使用原时长
// ============================================================

test('S7-AUDIO-05: alignStoryboard — 无音频时长时保持原时长', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 3.5)`).run();
    const log = makeLog();
    const result = audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      audio_duration_ms: null,
      original_duration_ms: 3500,
      strategy: 'stretch',
    });
    // 无音频时长 → adjustedDurationMs = originalDurationMs
    assert.strictEqual(result.adjusted_duration_ms, 3500);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 6. alignStoryboard — 分镜不存在时抛错
// ============================================================

test('S7-AUDIO-06: alignStoryboard — 分镜不存在时抛错', () => {
  const { db, dir } = makeDb();
  try {
    const log = makeLog();
    assert.throws(() => {
      audioAlignService.alignStoryboard(db, log, {
        storyboard_id: 99999,
        audio_duration_ms: 3000,
      });
    }, /分镜不存在/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 7. alignStoryboard — 缺少 storyboard_id 抛错
// ============================================================

test('S7-AUDIO-07: alignStoryboard — 缺少 storyboard_id 抛错', () => {
  const { db, dir } = makeDb();
  try {
    const log = makeLog();
    assert.throws(() => {
      audioAlignService.alignStoryboard(db, log, {
        audio_duration_ms: 3000,
      });
    }, /storyboard_id 必填/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 8. alignStoryboard — 对齐日志落库
// ============================================================

test('S7-AUDIO-08: alignStoryboard — 对齐日志写入 audio_align_logs', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 3.0)`).run();
    const log = makeLog();
    audioAlignService.alignStoryboard(db, log, {
      storyboard_id: 1,
      drama_id: 99000,
      episode_id: 100,
      audio_url: '/aud/sb1.mp3',
      audio_duration_ms: 2800,
      original_duration_ms: 3000,
      strategy: 'stretch',
    });
    const logs = db.prepare('SELECT * FROM audio_align_logs WHERE storyboard_id = ?').all(1);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].drama_id, 99000);
    assert.strictEqual(logs[0].episode_id, 100);
    assert.strictEqual(logs[0].audio_url, '/aud/sb1.mp3');
    assert.strictEqual(logs[0].audio_duration_ms, 2800);
    assert.strictEqual(logs[0].original_duration_ms, 3000);
    assert.strictEqual(logs[0].adjusted_duration_ms, 3100);
    assert.strictEqual(logs[0].alignment_strategy, 'stretch');
    assert.strictEqual(logs[0].status, 'aligned');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 9. batchAlign — 批量对齐分集配音
// ============================================================

test('S7-AUDIO-09: batchAlign — 批量对齐多个分镜', async () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES
      (1, 99000, 100, 3.0),
      (2, 99000, 100, 2.5),
      (3, 99000, 100, 4.0)`).run();
    db.prepare(`INSERT INTO audio_generations (storyboard_id, audio_url, duration, status) VALUES
      (1, '/aud/1.mp3', 2800, 'completed'),
      (2, '/aud/2.mp3', 2200, 'completed'),
      (3, '/aud/3.mp3', 3800, 'completed')`).run();
    const log = makeLog();
    const result = await audioAlignService.batchAlign(db, log, {
      drama_id: 99000,
      episode_id: 100,
      strategy: 'stretch',
    });
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.aligned_count, 3);
    assert.strictEqual(result.failed_count, 0);
    assert.strictEqual(result.results.length, 3);
    // 验证每个分镜的时长已更新
    const sb1 = db.prepare('SELECT duration FROM storyboards WHERE id = 1').get();
    const sb2 = db.prepare('SELECT duration FROM storyboards WHERE id = 2').get();
    const sb3 = db.prepare('SELECT duration FROM storyboards WHERE id = 3').get();
    // stretch: audio + 300ms
    assert.strictEqual(sb1.duration, 3.1);  // (2800+300)/1000
    assert.strictEqual(sb2.duration, 2.5);  // (2200+300)/1000
    assert.strictEqual(sb3.duration, 4.1);  // (3800+300)/1000
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 10. batchAlign — 无配音分镜时返回 aligned_count=0
// ============================================================

test('S7-AUDIO-10: batchAlign — 无配音分镜返回 0', async () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO storyboards (id, drama_id, episode_id, duration) VALUES (1, 99000, 100, 3.0)`).run();
    // 无 audio_generations 记录
    const log = makeLog();
    const result = await audioAlignService.batchAlign(db, log, {
      drama_id: 99000,
      episode_id: 100,
    });
    assert.strictEqual(result.aligned_count, 0);
    assert.ok(result.message.includes('没有找到'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S7-AUDIO-10b: batchAlign — 缺少 drama_id 抛错', async () => {
  const { db, dir } = makeDb();
  try {
    const log = makeLog();
    await assert.rejects(
      async () => audioAlignService.batchAlign(db, log, { episode_id: 100 }),
      /drama_id 必填/
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 11. getAlignLogs — 按分集查询
// ============================================================

test('S7-AUDIO-11: getAlignLogs — 按 episode_id 筛选', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO audio_align_logs (drama_id, episode_id, storyboard_id, audio_duration_ms, original_duration_ms, adjusted_duration_ms, alignment_strategy, status, created_at) VALUES
      (99000, 100, 1, 2800, 3000, 3100, 'stretch', 'aligned', '2026-08-10 12:00:00'),
      (99000, 100, 2, 2200, 2500, 2500, 'trim', 'aligned', '2026-08-10 12:01:00'),
      (99000, 101, 3, 3800, 4000, 4100, 'stretch', 'aligned', '2026-08-10 12:02:00')`).run();
    const logs100 = audioAlignService.getAlignLogs(db, { episode_id: 100 });
    assert.strictEqual(logs100.length, 2);
    const logs101 = audioAlignService.getAlignLogs(db, { episode_id: 101 });
    assert.strictEqual(logs101.length, 1);
    assert.strictEqual(logs101[0].storyboard_id, 3);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// 12. getAlignLogs — 按项目查询
// ============================================================

test('S7-AUDIO-12: getAlignLogs — 按 drama_id 筛选', () => {
  const { db, dir } = makeDb();
  try {
    db.prepare(`INSERT INTO audio_align_logs (drama_id, episode_id, storyboard_id, alignment_strategy, status, created_at) VALUES
      (99000, 100, 1, 'stretch', 'aligned', '2026-08-10 12:00:00'),
      (99000, 101, 2, 'stretch', 'aligned', '2026-08-10 12:01:00'),
      (88000, 200, 3, 'stretch', 'aligned', '2026-08-10 12:02:00')`).run();
    const logs99000 = audioAlignService.getAlignLogs(db, { drama_id: 99000 });
    assert.strictEqual(logs99000.length, 2);
    const logs88000 = audioAlignService.getAlignLogs(db, { drama_id: 88000 });
    assert.strictEqual(logs88000.length, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
