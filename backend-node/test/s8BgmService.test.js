'use strict';

/**
 * s8BgmService.test.js
 * Sprint 8 - S8-T04: BGM生成接口 单元测试
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      created_by INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE bgm_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      episode_id INTEGER,
      title TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT 'neutral',
      genre TEXT,
      duration_sec INTEGER,
      audio_url TEXT,
      provider TEXT,
      model TEXT,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      tempo_bpm INTEGER,
      instruments TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO dramas (id, title, created_by, deleted_at) VALUES
      (99001, '测试短剧A', 99000, NULL),
      (99002, '测试短剧B', 99000, NULL);
  `);

  return db;
}

const bgmService = require('../src/services/bgmService');

describe('S8-T04: BGM生成接口', () => {
  let db;

  before(() => { db = createTestDb(); });
  after(() => { db.close(); });

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
      drama_id: 99001,
      mood: 'tense',
      title: '紧张BGM',
      genre: 'electronic',
      duration_sec: 30,
      created_by: 99000,
      skipAsync: true,
    });
    assert.ok(bgm.id);
    assert.strictEqual(bgm.drama_id, 99001);
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
      await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'invalid' });
    }, /mood/);
  });

  test('6. createBgm — genre 非法值应报错', async () => {
    await assert.rejects(async () => {
      await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'happy', genre: 'invalid' });
    }, /genre/);
  });

  test('7. getBgm — 获取详情', async () => {
    const bgm = await bgmService.createBgm(db, console, {
      drama_id: 99001, mood: 'epic', title: '史诗BGM', created_by: 99000, skipAsync: true,
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
    await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'calm', created_by: 99000, skipAsync: true });
    await bgmService.createBgm(db, console, { drama_id: 99002, mood: 'dark', created_by: 99000, skipAsync: true });
    const list1 = bgmService.listBgm(db, { drama_id: 99001 });
    const list2 = bgmService.listBgm(db, { drama_id: 99002 });
    assert.ok(list1.length >= 2);
    assert.ok(list2.length >= 1);
    assert.ok(list1.every(t => t.drama_id === 99001));
    assert.ok(list2.every(t => t.drama_id === 99002));
  });

  test('10. listBgm — 按 mood 筛选', () => {
    const list = bgmService.listBgm(db, { drama_id: 99001, mood: 'epic' });
    assert.ok(list.length >= 1);
    assert.ok(list.every(t => t.mood === 'epic'));
  });

  test('11. matchBgmByMood — 优先匹配同项目同情绪', async () => {
    // 创建一条 completed 的 BGM
    const bgm = await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'romantic', created_by: 99000, skipAsync: true });
    // 手动标记为 completed
    db.prepare("UPDATE bgm_tracks SET status = 'completed', audio_url = '/static/bgm/test.mp3' WHERE id = ?").run(bgm.id);
    const matched = bgmService.matchBgmByMood(db, 99001, null, 'romantic');
    assert.ok(matched);
    assert.strictEqual(matched.mood, 'romantic');
    assert.strictEqual(matched.status, 'completed');
  });

  test('12. matchBgmByMood — 无匹配返回 null', () => {
    const matched = bgmService.matchBgmByMood(db, 99999, null, 'happy');
    assert.strictEqual(matched, null);
  });

  test('13. matchBgmByMood — 非法 mood 降级为 neutral', async () => {
    const bgm = await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'neutral', created_by: 99000, skipAsync: true });
    db.prepare("UPDATE bgm_tracks SET status = 'completed', audio_url = '/static/bgm/neutral.mp3' WHERE id = ?").run(bgm.id);
    const matched = bgmService.matchBgmByMood(db, 99001, null, 'invalid_mood');
    assert.ok(matched);
  });

  test('14. deleteBgm — 正常删除', async () => {
    const bgm = await bgmService.createBgm(db, console, { drama_id: 99001, mood: 'happy', created_by: 99000, skipAsync: true });
    const deleted = bgmService.deleteBgm(db, bgm.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(bgmService.getBgm(db, bgm.id), null);
  });

  test('15. deleteBgm — 不存在返回 false', () => {
    const deleted = bgmService.deleteBgm(db, 99999);
    assert.strictEqual(deleted, false);
  });
});
