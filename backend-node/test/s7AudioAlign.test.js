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
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试数据使用高位 ID
//       （996xxx）与真实数据隔离，beforeEach 清理。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

function db() {
  return getDb(loadConfig().database);
}

// 测试专用高位 ID 区间
const SB = { a: 996001, b: 996002, c: 996003 };
const EP = 996100;
const DRAMA = 996000;
const OTHER_DRAMA = 88000;

// 清理本测试产生的数据（高位 ID 区间）
function cleanup() {
  const d = db();
  d.prepare('DELETE FROM audio_align_logs WHERE drama_id IN (?, ?) OR storyboard_id BETWEEN 996000 AND 996999').run(DRAMA, OTHER_DRAMA);
  d.prepare('DELETE FROM audio_generations WHERE storyboard_id BETWEEN 996000 AND 996999').run();
  d.prepare('DELETE FROM storyboards WHERE id BETWEEN 996000 AND 996999').run();
  d.prepare('DELETE FROM episodes WHERE id BETWEEN 996000 AND 996999').run();
}

// batchAlign 走 episodes JOIN（真实 storyboards 无 drama_id 列），需要 episode 记录
function seedEpisode(d, id = EP, dramaId = DRAMA) {
  d.prepare('INSERT INTO episodes (id, drama_id, episode_number, title) VALUES (?, ?, ?, ?)')
    .run(id, dramaId, 1, 'S7-AUDIO 测试分集');
}

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const audioAlignService = require('../src/services/audioAlignService');

test.beforeEach(cleanup);
test.after(() => closeDb());

// ============================================================
// 1. alignStoryboard — stretch 策略
// ============================================================

test('S7-AUDIO-01: alignStoryboard — stretch 策略（音频时长 + 300ms）', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration, dialogue) VALUES (?, ?, ?, ?)`)
    .run(SB.a, EP, 3.0, '林深:这里到底发生过什么？');
  const log = makeLog();
  const result = audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    drama_id: DRAMA,
    episode_id: EP,
    audio_url: '/aud/sb1.mp3',
    audio_duration_ms: 2800,
    original_duration_ms: 3000,
    strategy: 'stretch',
  });
  assert.strictEqual(result.storyboard_id, SB.a);
  assert.strictEqual(result.audio_duration_ms, 2800);
  assert.strictEqual(result.original_duration_ms, 3000);
  // stretch: 2800 + 300 = 3100ms
  assert.strictEqual(result.adjusted_duration_ms, 3100);
  assert.strictEqual(result.adjusted_duration_sec, 3.1);
  assert.strictEqual(result.strategy, 'stretch');
  // 验证分镜时长已更新（真实 MySQL）
  const sb = d.prepare('SELECT duration FROM storyboards WHERE id = ?').get(SB.a);
  assert.strictEqual(sb.duration, 3.1);
});

// ============================================================
// 2. alignStoryboard — trim 策略
// ============================================================

test('S7-AUDIO-02: alignStoryboard — trim 策略（保持原时长）', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 4.0);
  const log = makeLog();
  const result = audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    audio_duration_ms: 6000, // 配音比画面长
    original_duration_ms: 4000,
    strategy: 'trim',
  });
  // trim: 保持原时长 4000ms
  assert.strictEqual(result.adjusted_duration_ms, 4000);
  assert.strictEqual(result.strategy, 'trim');
});

// ============================================================
// 3. alignStoryboard — loop 策略
// ============================================================

test('S7-AUDIO-03: alignStoryboard — loop 策略（取最大值）', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 3.0);
  const log = makeLog();
  const result = audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    audio_duration_ms: 5000,
    original_duration_ms: 3000,
    strategy: 'loop',
  });
  // loop: max(5000+300, 3000) = 5300ms
  assert.strictEqual(result.adjusted_duration_ms, 5300);
  assert.strictEqual(result.strategy, 'loop');
});

// ============================================================
// 4. alignStoryboard — silence 策略
// ============================================================

test('S7-AUDIO-04: alignStoryboard — silence 策略（音频 + 500ms）', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 3.0);
  const log = makeLog();
  const result = audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    audio_duration_ms: 4000,
    original_duration_ms: 3000,
    strategy: 'silence',
  });
  // silence: 4000 + 500 = 4500ms
  assert.strictEqual(result.adjusted_duration_ms, 4500);
  assert.strictEqual(result.strategy, 'silence');
});

// ============================================================
// 5. alignStoryboard — 无音频时长时使用原时长
// ============================================================

test('S7-AUDIO-05: alignStoryboard — 无音频时长时保持原时长', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 3.5);
  const log = makeLog();
  const result = audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    audio_duration_ms: null,
    original_duration_ms: 3500,
    strategy: 'stretch',
  });
  // 无音频时长 → adjustedDurationMs = originalDurationMs
  assert.strictEqual(result.adjusted_duration_ms, 3500);
});

// ============================================================
// 6. alignStoryboard — 分镜不存在时抛错
// ============================================================

test('S7-AUDIO-06: alignStoryboard — 分镜不存在时抛错', () => {
  const d = db();
  const log = makeLog();
  assert.throws(() => {
    audioAlignService.alignStoryboard(d, log, {
      storyboard_id: 996999,
      audio_duration_ms: 3000,
    });
  }, /分镜不存在/);
});

// ============================================================
// 7. alignStoryboard — 缺少 storyboard_id 抛错
// ============================================================

test('S7-AUDIO-07: alignStoryboard — 缺少 storyboard_id 抛错', () => {
  const d = db();
  const log = makeLog();
  assert.throws(() => {
    audioAlignService.alignStoryboard(d, log, {
      audio_duration_ms: 3000,
    });
  }, /storyboard_id 必填/);
});

// ============================================================
// 8. alignStoryboard — 对齐日志落库
// ============================================================

test('S7-AUDIO-08: alignStoryboard — 对齐日志写入 audio_align_logs', () => {
  const d = db();
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 3.0);
  const log = makeLog();
  audioAlignService.alignStoryboard(d, log, {
    storyboard_id: SB.a,
    drama_id: DRAMA,
    episode_id: EP,
    audio_url: '/aud/sb1.mp3',
    audio_duration_ms: 2800,
    original_duration_ms: 3000,
    strategy: 'stretch',
  });
  const logs = d.prepare('SELECT * FROM audio_align_logs WHERE storyboard_id = ?').all(SB.a);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].drama_id, DRAMA);
  assert.strictEqual(logs[0].episode_id, EP);
  assert.strictEqual(logs[0].audio_url, '/aud/sb1.mp3');
  assert.strictEqual(logs[0].audio_duration_ms, 2800);
  assert.strictEqual(logs[0].original_duration_ms, 3000);
  assert.strictEqual(logs[0].adjusted_duration_ms, 3100);
  assert.strictEqual(logs[0].alignment_strategy, 'stretch');
  assert.strictEqual(logs[0].status, 'aligned');
});

// ============================================================
// 9. batchAlign — 批量对齐分集配音
// ============================================================

test('S7-AUDIO-09: batchAlign — 批量对齐多个分镜', async () => {
  const d = db();
  seedEpisode(d);
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)`)
    .run(SB.a, EP, 3.0, SB.b, EP, 2.5, SB.c, EP, 4.0);
  d.prepare(`INSERT INTO audio_generations (storyboard_id, audio_url, duration, status) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`)
    .run(SB.a, '/aud/1.mp3', 2800, 'completed', SB.b, '/aud/2.mp3', 2200, 'completed', SB.c, '/aud/3.mp3', 3800, 'completed');
  const log = makeLog();
  const result = await audioAlignService.batchAlign(d, log, {
    drama_id: DRAMA,
    episode_id: EP,
    strategy: 'stretch',
  });
  assert.strictEqual(result.total, 3);
  assert.strictEqual(result.aligned_count, 3);
  assert.strictEqual(result.failed_count, 0);
  assert.strictEqual(result.results.length, 3);
  // 验证每个分镜的时长已更新（真实 MySQL）
  const sb1 = d.prepare('SELECT duration FROM storyboards WHERE id = ?').get(SB.a);
  const sb2 = d.prepare('SELECT duration FROM storyboards WHERE id = ?').get(SB.b);
  const sb3 = d.prepare('SELECT duration FROM storyboards WHERE id = ?').get(SB.c);
  // stretch: audio + 300ms
  assert.strictEqual(sb1.duration, 3.1);  // (2800+300)/1000
  assert.strictEqual(sb2.duration, 2.5);  // (2200+300)/1000
  assert.strictEqual(sb3.duration, 4.1);  // (3800+300)/1000
});

// ============================================================
// 10. batchAlign — 无配音分镜时返回 aligned_count=0
// ============================================================

test('S7-AUDIO-10: batchAlign — 无配音分镜返回 0', async () => {
  const d = db();
  seedEpisode(d);
  d.prepare(`INSERT INTO storyboards (id, episode_id, duration) VALUES (?, ?, ?)`).run(SB.a, EP, 3.0);
  // 无 audio_generations 记录
  const log = makeLog();
  const result = await audioAlignService.batchAlign(d, log, {
    drama_id: DRAMA,
    episode_id: EP,
  });
  assert.strictEqual(result.aligned_count, 0);
  assert.ok(result.message.includes('没有找到'));
});

test('S7-AUDIO-10b: batchAlign — 缺少 drama_id 抛错', async () => {
  const d = db();
  const log = makeLog();
  await assert.rejects(
    async () => audioAlignService.batchAlign(d, log, { episode_id: EP }),
    /drama_id 必填/
  );
});

// ============================================================
// 11. getAlignLogs — 按分集查询
// ============================================================

test('S7-AUDIO-11: getAlignLogs — 按 episode_id 筛选', () => {
  const d = db();
  d.prepare(`INSERT INTO audio_align_logs (drama_id, episode_id, storyboard_id, audio_duration_ms, original_duration_ms, adjusted_duration_ms, alignment_strategy, status, created_at) VALUES
    (?, ?, ?, 2800, 3000, 3100, 'stretch', 'aligned', '2026-08-10 12:00:00'),
    (?, ?, ?, 2200, 2500, 2500, 'trim', 'aligned', '2026-08-10 12:01:00'),
    (?, ?, ?, 3800, 4000, 4100, 'stretch', 'aligned', '2026-08-10 12:02:00')`
  ).run(DRAMA, EP, SB.a, DRAMA, EP, SB.b, DRAMA, 996101, SB.c);
  const logs100 = audioAlignService.getAlignLogs(d, { episode_id: EP });
  assert.strictEqual(logs100.length, 2);
  const logs101 = audioAlignService.getAlignLogs(d, { episode_id: 996101 });
  assert.strictEqual(logs101.length, 1);
  assert.strictEqual(logs101[0].storyboard_id, SB.c);
});

// ============================================================
// 12. getAlignLogs — 按项目查询
// ============================================================

test('S7-AUDIO-12: getAlignLogs — 按 drama_id 筛选', () => {
  const d = db();
  d.prepare(`INSERT INTO audio_align_logs (drama_id, episode_id, storyboard_id, alignment_strategy, status, created_at) VALUES
    (?, ?, ?, 'stretch', 'aligned', '2026-08-10 12:00:00'),
    (?, ?, ?, 'stretch', 'aligned', '2026-08-10 12:01:00'),
    (?, ?, ?, 'stretch', 'aligned', '2026-08-10 12:02:00')`
  ).run(DRAMA, EP, SB.a, DRAMA, 996101, SB.b, OTHER_DRAMA, 200, 3);
  const logs99000 = audioAlignService.getAlignLogs(d, { drama_id: DRAMA });
  assert.strictEqual(logs99000.length, 2);
  const logs88000 = audioAlignService.getAlignLogs(d, { drama_id: OTHER_DRAMA });
  assert.strictEqual(logs88000.length, 1);
});
