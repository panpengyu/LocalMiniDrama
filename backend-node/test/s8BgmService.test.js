'use strict';

/**
 * s8BgmService.test.js
 * Sprint 8 - S8-T04: BGM生成接口 单元测试
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

/**
 * 使用真实 MySQL 数据库（configs/config.yaml），测试数据以高位 ID 隔离。
 * 不使用 mock、不使用 SQLite。
 */
function createTestDb() {
  const db = getDb(loadConfig().database);
  // 清理本测试可能残留的数据（高位 ID 区间）
  db.prepare('DELETE FROM bgm_tracks WHERE drama_id BETWEEN 998500 AND 998599').run();
  db.prepare('DELETE FROM dramas WHERE id BETWEEN 998500 AND 998599').run();
  // 种子数据（与真实数据 id 区间隔离）
  db.prepare('INSERT INTO dramas (id, title, created_by, deleted_at) VALUES (?, ?, ?, ?)')
    .run(998501, '测试短剧A', 998500, null);
  db.prepare('INSERT INTO dramas (id, title, created_by, deleted_at) VALUES (?, ?, ?, ?)')
    .run(998502, '测试短剧B', 998500, null);
  return db;
}

const bgmService = require('../src/services/bgmService');

describe('S8-T04: BGM生成接口', () => {
  let db;

  before(() => { db = createTestDb(); });
  after(() => { closeDb(); });

  test('1. buildBgmPrompt — 构建生成提示词', () => {
    const prompt = bgmService.buildBgmPrompt('happy', { genre: 'orchestral', tempo_bpm: 120, instruments: ['piano', 'strings'] });
    assert.ok(prompt.includes('upbeat cheerful'));
    assert.ok(prompt.includes('orchestral'));
    assert.ok(prompt.includes('120 BPM'));
    assert.ok(prompt.includes('piano, strings'));
  });

  test('2. buildBgmPrompt — 未知 mood 使用 neutral', () => {
    const prompt = bgmService.buildBgmPrompt('unknown_mood');
    assert.ok(prompt.includes('neutral'));
  });

  test('3. createBgm — 正常创建', async () => {
    const bgm = await bgmService.createBgm(db, console, {
      drama_id: 998501,
      mood: 'tense',
      title: '紧张BGM',
      genre: 'electronic',
      duration_sec: 30,
      created_by: 998500,
      skipAsync: true,
    });
    assert.ok(bgm.id);
    assert.strictEqual(bgm.drama_id, 998501);
    assert.strictEqual(bgm.mood, 'tense');
    assert.strictEqual(bgm.status, 'pending');
    assert.strictEqual(bgm.tempo_bpm, 140); // tense => 140 BPM
    assert.ok(Array.isArray(bgm.instruments));
  });

  test('4. createBgm — drama_id 为空应报错', async () => {
    await assert.rejects(async () => {
      await bgmService.createBgm(db, console, { mood: 'happy' });
    }, /drama_id/);
  });

  test('5. createBgm — mood 非法值应报错', async () => {
    await assert.rejects(async () => {
      await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'invalid' });
    }, /mood/);
  });

  test('6. createBgm — genre 非法值应报错', async () => {
    await assert.rejects(async () => {
      await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'happy', genre: 'invalid' });
    }, /genre/);
  });

  test('7. getBgm — 获取详情', async () => {
    const bgm = await bgmService.createBgm(db, console, {
      drama_id: 998501, mood: 'epic', title: '史诗BGM', created_by: 998500, skipAsync: true,
    });
    const detail = bgmService.getBgm(db, bgm.id);
    assert.ok(detail);
    assert.strictEqual(detail.title, '史诗BGM');
    assert.strictEqual(detail.mood, 'epic');
  });

  test('8. getBgm — 不存在返回 null', () => {
    const detail = bgmService.getBgm(db, 99999);
    assert.strictEqual(detail, null);
  });

  test('9. listBgm — 按项目筛选', async () => {
    await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'calm', created_by: 998500, skipAsync: true });
    await bgmService.createBgm(db, console, { drama_id: 998502, mood: 'dark', created_by: 998500, skipAsync: true });
    const list1 = bgmService.listBgm(db, { drama_id: 998501 });
    const list2 = bgmService.listBgm(db, { drama_id: 998502 });
    assert.ok(list1.length >= 2);
    assert.ok(list2.length >= 1);
    assert.ok(list1.every(t => t.drama_id === 998501));
    assert.ok(list2.every(t => t.drama_id === 998502));
  });

  test('10. listBgm — 按 mood 筛选', () => {
    const list = bgmService.listBgm(db, { drama_id: 998501, mood: 'epic' });
    assert.ok(list.length >= 1);
    assert.ok(list.every(t => t.mood === 'epic'));
  });

  test('11. matchBgmByMood — 优先匹配同项目同情绪', async () => {
    // 创建一条 completed 的 BGM
    const bgm = await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'romantic', created_by: 998500, skipAsync: true });
    // 手动标记为 completed
    db.prepare("UPDATE bgm_tracks SET status = 'completed', audio_url = '/static/bgm/test.mp3' WHERE id = ?").run(bgm.id);
    const matched = bgmService.matchBgmByMood(db, 998501, null, 'romantic');
    assert.ok(matched);
    assert.strictEqual(matched.mood, 'romantic');
    assert.strictEqual(matched.status, 'completed');
  });

  test('12. matchBgmByMood — 无匹配返回 null', () => {
    const matched = bgmService.matchBgmByMood(db, 99999, null, 'happy');
    assert.strictEqual(matched, null);
  });

  test('13. matchBgmByMood — 非法 mood 降级为 neutral', async () => {
    const bgm = await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'neutral', created_by: 998500, skipAsync: true });
    db.prepare("UPDATE bgm_tracks SET status = 'completed', audio_url = '/static/bgm/neutral.mp3' WHERE id = ?").run(bgm.id);
    const matched = bgmService.matchBgmByMood(db, 998501, null, 'invalid_mood');
    assert.ok(matched);
  });

  test('14. deleteBgm — 正常删除', async () => {
    const bgm = await bgmService.createBgm(db, console, { drama_id: 998501, mood: 'happy', created_by: 998500, skipAsync: true });
    const deleted = bgmService.deleteBgm(db, bgm.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(bgmService.getBgm(db, bgm.id), null);
  });

  test('15. deleteBgm — 不存在返回 false', () => {
    const deleted = bgmService.deleteBgm(db, 99999);
    assert.strictEqual(deleted, false);
  });
});
