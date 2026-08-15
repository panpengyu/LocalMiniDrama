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
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试 drama_id 使用高位
//       ID 隔离，beforeEach 清理。AI 客户端为外部依赖 stub（仅
//       拦截外部 AI API 调用，不产生任何测试数据）。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

function db() {
  return getDb(loadConfig().database);
}

// 清理本测试产生的数据（高位 drama_id 区间）
function cleanup() {
  db().prepare('DELETE FROM ai_storyboard_generations WHERE drama_id IN (99100, 99101, 99200)').run();
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

// AI 客户端外部依赖 stub（仅拦截外部 AI API 调用）
let mockResponse = null;
const aiClientStub = {
  generateText: async () => mockResponse || '[]',
};
require.cache[require.resolve('../src/services/aiClient')] = { exports: aiClientStub };

const sbGenService = require('../src/services/storyboardGenService');

test.beforeEach(cleanup);
test.after(() => closeDb());

test('S4-T01-1: AI正常返回分镜数组 → 解析+规范化+落库', async () => {
  const d = db();
  const log = makeLog();
  mockResponse = JSON.stringify([
    { frame_number: 1, shot_type: 'close_up', camera_movement: 'push', composition: 'rule_of_thirds',
      emotion: 'tense', duration: '3秒', transition: 'cut', visual_description: '特写：主角惊恐的眼神',
      prompt: 'comic panel, close_up, tense', characters: ['林深'] },
    { frame_number: 2, shot_type: 'wide', camera_movement: 'static', composition: 'symmetry',
      emotion: 'epic', duration: '5秒', transition: 'fade_in', visual_description: '大远景：城市夜景',
      prompt: 'comic panel, wide shot, epic', characters: [] },
  ]);

  const result = await sbGenService.generate(d, log, {
    scriptText: '林深推开门，看到满地碎片，他惊恐地后退。',
    dramaId: 99100, count: 2, style: 'vertical_916', userId: 1,
  });

  assert.equal(result.count, 2);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].shot_type, 'close_up');
  assert.equal(result.frames[0].shot_type_label, '特写');
  assert.equal(result.frames[0].camera_movement_label, '推镜头');
  assert.equal(result.frames[1].emotion_label, '史诗');
  assert.ok(result.generationId);

  // 验证落库（真实 MySQL）
  const rows = d.prepare('SELECT * FROM ai_storyboard_generations WHERE drama_id = ?').all(99100);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].frame_count, 2);
  assert.equal(rows[0].status, 'completed');
});

test('S4-T01-2: AI返回空 → 兜底分镜生成', async () => {
  const d = db();
  const log = makeLog();
  mockResponse = '';

  const result = await sbGenService.generate(d, log, {
    scriptText: '一段没有标点的剧本文字',
    count: 5,
    dramaId: 99100,
  });

  assert.ok(result.frames.length > 0);
  assert.ok(result.frames.length <= 5);
  assert.equal(result.frames[0].frame_number, 1);
  assert.ok(result.frames[0].prompt);
  assert.ok(result.frames[0].visual_description);
});

test('S4-T01-3: AI返回 {frames:[...]} 包装结构', async () => {
  const d = db();
  const log = makeLog();
  mockResponse = JSON.stringify({ frames: [
    { frame_number: 1, shot_type: 'medium', visual_description: '测试', prompt: 'test' }
  ]});

  const result = await sbGenService.generate(d, log, {
    scriptText: '测试剧本', count: 1, dramaId: 99101,
  });

  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].shot_type, 'medium');
});

test('S4-T01-4: polishFramePrompt 提示词润色', async () => {
  const d = db();
  const log = makeLog();
  mockResponse = 'comic panel, masterpiece, best quality, close_up shot, tense atmosphere, detailed scene';

  const result = await sbGenService.polishFramePrompt(d, log, {
    frame: { shot_type: 'close_up', emotion: 'tense', visual_description: '主角惊恐' },
    style: 'vertical_916',
  });

  assert.ok(result.prompt);
  assert.ok(result.prompt.includes('comic panel'));
});

test('S4-T01-5: listGenerations/getGeneration 查询', async () => {
  const d = db();
  const log = makeLog();
  mockResponse = JSON.stringify([{ frame_number: 1, shot_type: 'medium' }]);

  await sbGenService.generate(d, log, { scriptText: '测试', count: 1, dramaId: 99200, userId: 5 });

  const list = sbGenService.listGenerations(d, { dramaId: 99200 });
  assert.ok(list.length >= 1);
  assert.equal(list[0].dramaId, 99200);

  const detail = sbGenService.getGeneration(d, list[0].generationId);
  assert.ok(detail);
  assert.equal(detail.frames.length, 1);
});

test('S4-T01-6: 分镜字典常量校验', () => {
  assert.ok(Object.keys(sbGenService.SHOT_TYPES).length >= 7);
  assert.ok(sbGenService.SHOT_TYPES.close_up);
  assert.ok(Object.keys(sbGenService.CAMERA_MOVEMENTS).length >= 8);
  assert.ok(Object.keys(sbGenService.EMOTIONS).length >= 8);
  assert.ok(Object.keys(sbGenService.TRANSITIONS).length >= 5);
  assert.ok(Object.keys(sbGenService.COMPOSITIONS).length >= 5);
});
