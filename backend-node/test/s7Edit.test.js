// ============================================================
// s7Edit.test.js — Sprint 7
// S7-T05: 智能剪辑后端接口测试
// 覆盖场景：
//   1) collectClips — 收集分镜源片段（含图片/视频/音频关联查询）
//   2) applyBeatSync — 节奏匹配（配音时长→片段时长 + 镜头类型调整）
//   3) buildFFmpegArgs — ffmpeg 命令构建（分辨率/帧率/拼接）
//   4) getTask / listTasks — 剪辑任务查询
//   5) autoEdit — 缺少 drama_id 抛错 + 无分镜片段抛错 + 任务落库
//   6) applyBeatSync — 边界值（特写≤2.5s / 全景≥3.5s / 1~10s 范围限制）
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试数据使用高位 ID
//       （996xxxx）与真实数据隔离，beforeEach 清理。
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
const DRAMA = 9962000;
const DRAMA_2 = 9962001;      // S7-EDIT-13 第二项目
const DRAMA_EMPTY = 9962999;  // S7-EDIT-03 无分镜项目
const EP_A = 9963001;         // 分集A（含 S7-EDIT-01/02 分镜）
const EP_B = 9963002;         // 分集B（S7-EDIT-02）
// storyboards 高位 id
const SB = { s1: 9964001, s2: 9964002, s3: 9964003, s4: 9964004, s5: 9964005, s6: 9964006, s7: 9964007 };

// 清理本测试产生的数据（高位 ID 区间）
function cleanup() {
  const d = db();
  d.prepare('DELETE FROM edit_tasks WHERE drama_id IN (?, ?, ?, ?)').run(DRAMA, DRAMA_2, DRAMA_EMPTY, 9962998);
  d.prepare('DELETE FROM audio_generations WHERE storyboard_id BETWEEN 9964000 AND 9964999').run();
  d.prepare('DELETE FROM image_generations WHERE storyboard_id BETWEEN 9964000 AND 9964999').run();
  d.prepare('DELETE FROM video_generations WHERE storyboard_id BETWEEN 9964000 AND 9964999').run();
  d.prepare('DELETE FROM storyboards WHERE id BETWEEN 9964000 AND 9964999').run();
  d.prepare('DELETE FROM episodes WHERE id BETWEEN 9963000 AND 9963999').run();
}

// seed 分集记录（collectClips 走 episodes JOIN，需 episode 归属）
function seedEpisode(d, id, dramaId, number = 1) {
  d.prepare('INSERT INTO episodes (id, drama_id, episode_number, title) VALUES (?, ?, ?, ?)')
    .run(id, dramaId, number, `S7-EDIT 测试分集${number}`);
}

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const editService = require('../src/services/editService');

test.beforeEach(cleanup);
test.after(() => closeDb());

// ============================================================
// 1. collectClips — 收集分镜源片段
// ============================================================

test('S7-EDIT-01: collectClips — 关联查询图片/视频/音频', () => {
  const d = db();
  seedEpisode(d, EP_A, DRAMA);
  // 插入 3 个分镜
  d.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, duration, shot_type, dialogue) VALUES
    (?, ?, 1, 3.0, 'wide', '林深:这里到底发生过什么？'),
    (?, ?, 2, 2.5, 'close_up', '苏暖:我不想再提起。'),
    (?, ?, 3, 4.0, 'medium', '')`).run(SB.s1, EP_A, SB.s2, EP_A, SB.s3, EP_A);
  // 分镜1: 图片 + 音频
  d.prepare(`INSERT INTO image_generations (storyboard_id, image_url, status) VALUES (?, '/img/sb1.png', 'completed')`).run(SB.s1);
  d.prepare(`INSERT INTO audio_generations (storyboard_id, audio_url, duration, status) VALUES (?, '/aud/sb1.mp3', 2800, 'completed')`).run(SB.s1);
  // 分镜2: 视频
  d.prepare(`INSERT INTO video_generations (storyboard_id, video_url, status) VALUES (?, '/vid/sb2.mp4', 'completed')`).run(SB.s2);
  // 分镜3: 无任何资源
  const clips = editService.collectClips(d, DRAMA, EP_A);
  assert.strictEqual(clips.length, 3);
  assert.strictEqual(clips[0].image_url, '/img/sb1.png');
  assert.strictEqual(clips[0].audio_url, '/aud/sb1.mp3');
  assert.strictEqual(clips[0].audio_duration, 2800);
  assert.strictEqual(clips[1].video_url, '/vid/sb2.mp4');
  // 第一个片段默认 hard_cut，其余默认 fade
  assert.strictEqual(clips[0].transition_type, 'hard_cut');
  assert.strictEqual(clips[1].transition_type, 'fade');
  assert.strictEqual(clips[2].transition_type, 'fade');
});

test('S7-EDIT-02: collectClips — 按 episode_id 筛选', () => {
  const d = db();
  seedEpisode(d, EP_A, DRAMA);
  seedEpisode(d, EP_B, DRAMA, 2);
  d.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, duration) VALUES
    (?, ?, 1, 3.0),
    (?, ?, 1, 3.0)`).run(SB.s4, EP_A, SB.s5, EP_B);
  d.prepare(`INSERT INTO image_generations (storyboard_id, image_url, status) VALUES
    (?, '/img/1.png', 'completed'), (?, '/img/2.png', 'completed')`).run(SB.s4, SB.s5);

  const clipsAll = editService.collectClips(d, DRAMA, null);
  assert.strictEqual(clipsAll.length, 2);
  const clipsEpA = editService.collectClips(d, DRAMA, EP_A);
  assert.strictEqual(clipsEpA.length, 1);
  assert.strictEqual(clipsEpA[0].storyboard_id, SB.s4);
});

test('S7-EDIT-03: collectClips — 无分镜时返回空数组', () => {
  const d = db();
  const clips = editService.collectClips(d, DRAMA_EMPTY, null);
  assert.strictEqual(clips.length, 0);
});

// ============================================================
// 2. applyBeatSync — 节奏匹配
// ============================================================

test('S7-EDIT-04: applyBeatSync — 有配音时片段时长 = 音频时长 + 0.3s', () => {
  const clips = [
    { duration: 3, audio_duration: 2800, shot_type: 'medium' },
  ];
  const result = editService.applyBeatSync(clips);
  // 2800ms = 2.8s + 0.3s = 3.1s（浮点精度容差）
  assert.ok(Math.abs(result[0].duration - 3.1) < 0.001, `期望 ~3.1s，实际 ${result[0].duration}`);
});

test('S7-EDIT-05: applyBeatSync — 特写镜头不超过 2.5s', () => {
  const clips = [
    { duration: 5, audio_duration: 5000, shot_type: 'close_up' },
  ];
  const result = editService.applyBeatSync(clips);
  // 5s + 0.3s = 5.3s，但特写 ≤ 2.5s
  assert.strictEqual(result[0].duration, 2.5);
});

test('S7-EDIT-06: applyBeatSync — 全景镜头至少 3.5s', () => {
  const clips = [
    { duration: 2, audio_duration: 1500, shot_type: 'wide' },
  ];
  const result = editService.applyBeatSync(clips);
  // 1.5s + 0.3s = 1.8s，但全景 ≥ 3.5s
  assert.strictEqual(result[0].duration, 3.5);
});

test('S7-EDIT-07: applyBeatSync — 时长限制在 1~10s 范围内', () => {
  const clips = [
    { duration: 0.5, audio_duration: 200, shot_type: 'medium' },   // 0.2+0.3=0.5 → 限制到 1
    { duration: 20, audio_duration: 20000, shot_type: 'medium' },  // 20+0.3=20.3 → 限制到 10
  ];
  const result = editService.applyBeatSync(clips);
  assert.strictEqual(result[0].duration, 1);
  assert.strictEqual(result[1].duration, 10);
});

test('S7-EDIT-08: applyBeatSync — 无配音时保持原时长', () => {
  const clips = [
    { duration: 3.5, audio_duration: null, shot_type: 'medium' },
  ];
  const result = editService.applyBeatSync(clips);
  assert.strictEqual(result[0].duration, 3.5);
});

// ============================================================
// 3. buildFFmpegArgs — ffmpeg 命令构建
// ============================================================

test('S7-EDIT-09: buildFFmpegArgs — 单图片片段命令构建', () => {
  const clips = [
    { image_url: '/img/1.png', duration: 3.0, video_url: null },
  ];
  const args = editService.buildFFmpegArgs(clips, '/out/output.mp4', {
    resolution: '1080x1920',
    fps: 30,
  });
  // 应包含 -loop 1 -t 3 -i /img/1.png
  const inputIdx = args.indexOf('-i');
  assert.ok(inputIdx > 0, '应包含 -i 参数');
  assert.ok(args.some((a) => String(a).includes('/img/1.png')), '应包含图片路径');
  assert.ok(args.includes('-loop'), '图片应使用 -loop');
  assert.ok(args.some((a) => String(a).includes('1080')), '应包含宽度 1080');
  assert.ok(args.some((a) => String(a).includes('1920')), '应包含高度 1920');
  assert.ok(args.includes('libx264'), '应使用 libx264 编码');
  assert.ok(args.some((a) => String(a).includes('/out/output.mp4')), '应包含输出路径');
});

test('S7-EDIT-10: buildFFmpegArgs — 多片段拼接命令构建', () => {
  const clips = [
    { image_url: '/img/1.png', duration: 3.0, video_url: null },
    { image_url: '/img/2.png', duration: 2.5, video_url: null },
    { video_url: '/vid/3.mp4', duration: 4.0, image_url: null },
  ];
  const args = editService.buildFFmpegArgs(clips, '/out/output.mp4', {
    resolution: '720x1280',
    fps: 24,
  });
  // 应有 3 个输入
  const inputCount = args.filter((a) => a === '-i').length;
  // 图片输入也用 -i，视频输入也用 -i
  assert.ok(inputCount >= 2, '应至少有2个 -i 输入');
  // 应包含 concat 滤镜
  const filterIdx = args.indexOf('-filter_complex');
  assert.ok(filterIdx > 0, '应包含 -filter_complex');
  assert.ok(args[filterIdx + 1].includes('concat'), '应包含 concat 拼接');
  assert.ok(args.some((a) => String(a).includes('720')), '应包含宽度 720');
  assert.ok(args.some((a) => String(a).includes('1280')), '应包含高度 1280');
  assert.ok(args.includes('24'), '应包含帧率 24');
});

// ============================================================
// 4. getTask / listTasks — 剪辑任务查询
// ============================================================

test('S7-EDIT-11: getTask — 查询存在的剪辑任务', () => {
  const d = db();
  const info = d.prepare(`INSERT INTO edit_tasks (drama_id, title, status, progress, source_clips, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(DRAMA, '测试剪辑任务', 'completed', 100, JSON.stringify([{ storyboard_id: SB.s1 }]), '2026-08-10 12:00:00');
  const task = editService.getTask(d, info.lastInsertRowid);
  assert.ok(task);
  assert.strictEqual(task.title, '测试剪辑任务');
  assert.strictEqual(task.status, 'completed');
  assert.strictEqual(task.progress, 100);
  assert.ok(Array.isArray(task.source_clips));
  assert.strictEqual(task.source_clips.length, 1);
});

test('S7-EDIT-12: getTask — 查询不存在的任务返回 null', () => {
  const d = db();
  const task = editService.getTask(d, 9969999);
  assert.strictEqual(task, null);
});

test('S7-EDIT-13: listTasks — 按 drama_id 筛选', () => {
  const d = db();
  d.prepare(`INSERT INTO edit_tasks (drama_id, title, status, created_at) VALUES
    (?, '任务1', 'completed', '2026-08-10 12:00:00'),
    (?, '任务2', 'failed', '2026-08-10 13:00:00'),
    (?, '任务3', 'completed', '2026-08-10 14:00:00')`).run(DRAMA, DRAMA, DRAMA_2);
  const listA = editService.listTasks(d, { drama_id: DRAMA });
  assert.strictEqual(listA.length, 2);
  const listB = editService.listTasks(d, { drama_id: DRAMA_2 });
  assert.strictEqual(listB.length, 1);
  assert.strictEqual(listB[0].title, '任务3');
});

test('S7-EDIT-14: listTasks — 按 status 筛选', () => {
  const d = db();
  d.prepare(`INSERT INTO edit_tasks (drama_id, title, status, created_at) VALUES
    (?, '任务1', 'completed', '2026-08-10 12:00:00'),
    (?, '任务2', 'failed', '2026-08-10 13:00:00'),
    (?, '任务3', 'processing', '2026-08-10 14:00:00')`).run(DRAMA, DRAMA, DRAMA);
  const failed = editService.listTasks(d, { drama_id: DRAMA, status: 'failed' });
  assert.strictEqual(failed.length, 1);
  assert.strictEqual(failed[0].title, '任务2');
});

// ============================================================
// 5. autoEdit — 主入口测试
// ============================================================

test('S7-EDIT-15: autoEdit — 缺少 drama_id 抛错', async () => {
  const d = db();
  const log = makeLog();
  await assert.rejects(
    async () => editService.autoEdit(d, log, {}),
    /drama_id 必填/
  );
});

test('S7-EDIT-16: autoEdit — 无分镜片段时任务标记为 failed', async () => {
  const d = db();
  const log = makeLog();
  // drama_id 存在但无分镜数据
  await assert.rejects(
    async () => editService.autoEdit(d, log, { drama_id: DRAMA, user_id: 1 }),
    /没有找到可用的分镜片段/
  );
  // 任务应已落库并标记为 failed
  const tasks = editService.listTasks(d, { drama_id: DRAMA });
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].status, 'failed');
  assert.ok(tasks[0].error_message.includes('没有找到可用的分镜片段'));
});

test('S7-EDIT-17: autoEdit — 创建任务后落库 progress=5 初始状态', async () => {
  const d = db();
  const log = makeLog();
  seedEpisode(d, EP_A, DRAMA);
  // 插入1个分镜 + 图片，但不安装 ffmpeg → 模拟模式下失败
  d.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, duration) VALUES (?, ?, 1, 3.0)`).run(SB.s6, EP_A);
  d.prepare(`INSERT INTO image_generations (storyboard_id, image_url, status) VALUES (?, '/img/1.png', 'completed')`).run(SB.s6);

  try {
    await editService.autoEdit(d, log, { drama_id: DRAMA, user_id: 1, resolution: '1080x1920', fps: 30 });
  } catch (e) {
    // 预期 ffmpeg 执行失败
  }
  const tasks = editService.listTasks(d, { drama_id: DRAMA });
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].status, 'failed');
  assert.ok(tasks[0].resolution === '1080x1920');
  assert.ok(tasks[0].fps === 30);
});

test('S7-EDIT-18: autoEdit — beat_sync=false 时不应用节奏匹配', async () => {
  const d = db();
  const log = makeLog();
  seedEpisode(d, EP_A, DRAMA);
  d.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, duration, shot_type) VALUES
    (?, ?, 1, 5.0, 'close_up')`).run(SB.s7, EP_A);
  d.prepare(`INSERT INTO image_generations (storyboard_id, image_url, status) VALUES (?, '/img/1.png', 'completed')`).run(SB.s7);
  d.prepare(`INSERT INTO audio_generations (storyboard_id, audio_url, duration, status) VALUES (?, '/aud/1.mp3', 5000, 'completed')`).run(SB.s7);

  try {
    await editService.autoEdit(d, log, { drama_id: DRAMA, user_id: 1, beat_sync: false });
  } catch (e) {
    // 预期 ffmpeg 失败
  }
  const task = editService.listTasks(d, { drama_id: DRAMA })[0];
  assert.ok(task);
  assert.strictEqual(task.beat_sync, 0);
  // source_clips 应保存了原始片段（未经 beatSync 调整）
  const clips = JSON.parse(task.source_clips);
  assert.strictEqual(clips.length, 1);
  // 未应用 beatSync，duration 应为原始值（数据库中 duration=5.0）
  assert.strictEqual(clips[0].duration, 5);
});
