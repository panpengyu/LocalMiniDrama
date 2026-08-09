// ============================================================
// s4StoryboardGen.test.js — Sprint 4
// S4-T01: 智能分镜生成服务测试
// 覆盖场景：
//   1) AI正常返回分镜数组 → 解析+规范化+落库
//   2) AI返回空 → 兜底分镜生成
//   3) AI返回 {frames:[...]} 包装结构
//   4) polishFramePrompt 提示词润色
//   5) listGenerations/getGeneration 查询
//   6) 分镜字典常量校验
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4sb-'));
  const dbFile = path.join(dir, 'test.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE ai_storyboard_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id VARCHAR(64) NOT NULL,
      drama_id BIGINT, episode_id BIGINT, user_id BIGINT,
      script_text TEXT, style VARCHAR(32), frame_count INT,
      status VARCHAR(32), result_json TEXT,
      created_at DATETIME, updated_at DATETIME
    );
  `);
  return { db, dir };
}

function makeLog() {
  const buf = [];
  return {
    _buf: buf,
    info: (m, o) => buf.push({ lvl: 'info', msg: m, meta: o }),
    warn: (m, o) => buf.push({ lvl: 'warn', msg: m, meta: o }),
    error: (m, o) => buf.push({ lvl: 'error', msg: m, meta: o }),
  };
}

// Mock aiClient
let mockResponse = null;
const originalRequire = require;
const aiClientStub = {
  generateText: async () => mockResponse || '[]',
};
require.cache[require.resolve('../src/services/aiClient')] = { exports: aiClientStub };

const sbGenService = require('../src/services/storyboardGenService');

test('S4-T01-1: AI正常返回分镜数组 → 解析+规范化+落库', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  mockResponse = JSON.stringify([
    { frame_number: 1, shot_type: 'close_up', camera_movement: 'push', composition: 'rule_of_thirds',
      emotion: 'tense', duration: '3秒', transition: 'cut', visual_description: '特写：主角惊恐的眼神',
      prompt: 'comic panel, close_up, tense', characters: ['林深'] },
    { frame_number: 2, shot_type: 'wide', camera_movement: 'static', composition: 'symmetry',
      emotion: 'epic', duration: '5秒', transition: 'fade_in', visual_description: '大远景：城市夜景',
      prompt: 'comic panel, wide shot, epic', characters: [] },
  ]);

  const result = await sbGenService.generate(db, log, {
    scriptText: '林深推开门，看到满地碎片，他惊恐地后退。',
    dramaId: 100, count: 2, style: 'vertical_916', userId: 1,
  });

  assert.equal(result.count, 2);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].shot_type, 'close_up');
  assert.equal(result.frames[0].shot_type_label, '特写');
  assert.equal(result.frames[0].camera_movement_label, '推镜头');
  assert.equal(result.frames[1].emotion_label, '史诗');
  assert.ok(result.generationId);

  // 验证落库
  const rows = db.prepare('SELECT * FROM ai_storyboard_generations').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].frame_count, 2);
  assert.equal(rows[0].status, 'completed');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T01-2: AI返回空 → 兜底分镜生成', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  mockResponse = '';

  const result = await sbGenService.generate(db, log, {
    scriptText: '一段没有标点的剧本文字',
    count: 5,
  });

  assert.ok(result.frames.length > 0);
  assert.ok(result.frames.length <= 5);
  assert.equal(result.frames[0].frame_number, 1);
  assert.ok(result.frames[0].prompt);
  assert.ok(result.frames[0].visual_description);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T01-3: AI返回 {frames:[...]} 包装结构', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  mockResponse = JSON.stringify({ frames: [
    { frame_number: 1, shot_type: 'medium', visual_description: '测试', prompt: 'test' }
  ]});

  const result = await sbGenService.generate(db, log, {
    scriptText: '测试剧本', count: 1,
  });

  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].shot_type, 'medium');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T01-4: polishFramePrompt 提示词润色', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  mockResponse = 'comic panel, masterpiece, best quality, close_up shot, tense atmosphere, detailed scene';

  const result = await sbGenService.polishFramePrompt(db, log, {
    frame: { shot_type: 'close_up', emotion: 'tense', visual_description: '主角惊恐' },
    style: 'vertical_916',
  });

  assert.ok(result.prompt);
  assert.ok(result.prompt.includes('comic panel'));

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T01-5: listGenerations/getGeneration 查询', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  mockResponse = JSON.stringify([{ frame_number: 1, shot_type: 'medium' }]);

  await sbGenService.generate(db, log, { scriptText: '测试', count: 1, dramaId: 200, userId: 5 });

  const list = sbGenService.listGenerations(db, { dramaId: 200 });
  assert.ok(list.length >= 1);
  assert.equal(list[0].dramaId, 200);

  const detail = sbGenService.getGeneration(db, list[0].generationId);
  assert.ok(detail);
  assert.equal(detail.frames.length, 1);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T01-6: 分镜字典常量校验', () => {
  assert.ok(Object.keys(sbGenService.SHOT_TYPES).length >= 7);
  assert.ok(sbGenService.SHOT_TYPES.close_up);
  assert.ok(Object.keys(sbGenService.CAMERA_MOVEMENTS).length >= 8);
  assert.ok(Object.keys(sbGenService.EMOTIONS).length >= 8);
  assert.ok(Object.keys(sbGenService.TRANSITIONS).length >= 5);
  assert.ok(Object.keys(sbGenService.COMPOSITIONS).length >= 5);
});
