// ============================================================
// s4ContentModeration.test.js — Sprint 4
// S4-T08: 内容审核服务测试
// 覆盖场景：
//   1) 文本审核-安全内容
//   2) 文本审核-违规内容（色情/暴力/政治敏感/垃圾信息）
//   3) 图片审核-安全URL
//   4) 图片审核-可疑URL
//   5) moderate() 统一入口-文本
//   6) moderate() 统一入口-拦截违规
//   7) 三种审核模式阈值差异
//   8) 审核记录落库+查询
//   9) 人工复审
//  10) 批量审核
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试 user_id 使用高位
//       ID（996xxx）隔离真实日志数据，beforeEach 清理。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

function db() {
  return getDb(loadConfig().database);
}

// 清理本测试产生的数据（高位 user_id 区间）
function cleanup() {
  db().prepare('DELETE FROM content_moderation_logs WHERE user_id >= 996000 AND user_id <= 996999').run();
}

function makeLog() {
  return {
    info: () => {}, warn: () => {}, error: () => {},
  };
}

const modService = require('../src/services/contentModerationService');

test.beforeEach(cleanup);
test.after(() => closeDb());

test('S4-T08-1: 文本审核-安全内容', () => {
  const result = modService.moderateTextBuiltin('这是一段正常的剧本台词，主角走在街上。');
  assert.equal(result.verdict, 'safe');
  assert.equal(result.riskScore, 0);
});

test('S4-T08-2: 文本审核-色情违规', () => {
  const result = modService.moderateTextBuiltin('这个色情视频太露骨了，包含裸体画面');
  assert.equal(result.verdict, 'violation');
  assert.ok(result.riskScore >= 30);
  assert.equal(result.riskLabel, 'porn');
});

test('S4-T08-3: 文本审核-暴力违规', () => {
  const result = modService.moderateTextBuiltin('描述了杀人分尸的恐怖场景');
  assert.equal(result.verdict, 'violation');
  assert.ok(result.riskScore >= 30);
  assert.equal(result.riskLabel, 'violence');
});

test('S4-T08-4: 文本审核-垃圾信息', () => {
  const result = modService.moderateTextBuiltin('免费领取点击链接加微信代开发票');
  assert.ok(result.riskScore > 0);
  assert.equal(result.riskLabel, 'spam');
});

test('S4-T08-5: 图片审核-安全URL', () => {
  const result = modService.moderateImageBuiltin('https://example.com/images/scene_01.png', '');
  assert.equal(result.verdict, 'safe');
  assert.equal(result.riskScore, 0);
});

test('S4-T08-6: 图片审核-可疑URL', () => {
  const result = modService.moderateImageBuiltin('https://example.com/nsfw_adult_content.jpg', '');
  assert.ok(result.riskScore >= 70);
  assert.equal(result.riskLabel, 'porn');
});

test('S4-T08-7: moderate() 统一入口-文本安全', async () => {
  const d = db();
  const log = makeLog();
  const result = await modService.moderate(d, log, {
    resourceType: 'text',
    contentSnapshot: '正常的剧本内容',
    mode: 'standard',
    userId: 996101,
  });
  assert.equal(result.verdict, 'safe');
  assert.equal(result.isBlocked, false);
  assert.ok(result.logId);
});

test('S4-T08-8: moderate() 统一入口-拦截违规', async () => {
  const d = db();
  const log = makeLog();
  const result = await modService.moderate(d, log, {
    resourceType: 'text',
    contentSnapshot: '色情裸体成人视频',
    mode: 'standard',
  });
  assert.equal(result.verdict, 'violation');
  assert.equal(result.isBlocked, true);
  assert.ok(result.logId);
});

test('S4-T08-9: 三种审核模式阈值差异', async () => {
  const d = db();
  const log = makeLog();
  // "色情" 一个词：score=30
  // strict 阈值30 → block
  const strictResult = await modService.moderate(d, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'strict',
  });
  assert.equal(strictResult.isBlocked, true);

  // standard 阈值60 → 30 < 60 → safe
  const standardResult = await modService.moderate(d, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'standard',
  });
  assert.equal(standardResult.isBlocked, false);

  // loose 阈值80 → 30 < 80 → safe
  const looseResult = await modService.moderate(d, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'loose',
  });
  assert.equal(looseResult.isBlocked, false);
});

test('S4-T08-10: 审核记录落库+查询', async () => {
  const d = db();
  const log = makeLog();
  await modService.moderate(d, log, { resourceType: 'text', contentSnapshot: '安全内容', mode: 'standard', userId: 996110 });
  await modService.moderate(d, log, { resourceType: 'text', contentSnapshot: '色情内容', mode: 'standard', userId: 996110 });

  const logs = modService.listLogs(d, { userId: 996110 });
  assert.equal(logs.length, 2);

  const detail = modService.getLog(d, logs[0].id);
  assert.ok(detail);
  assert.ok(detail.contentSnapshot);
});

test('S4-T08-11: 人工复审', async () => {
  const d = db();
  const log = makeLog();
  const r = await modService.moderate(d, log, { resourceType: 'text', contentSnapshot: '安全内容', mode: 'standard' });
  const reviewed = modService.review(d, log, r.logId, { verdict: 'violation', reviewNote: '人工判定违规', reviewedBy: 996199 });
  assert.equal(reviewed.verdict, 'violation');
  assert.equal(reviewed.isBlocked, true);

  const detail = modService.getLog(d, r.logId);
  assert.equal(detail.verdict, 'violation');
  assert.equal(detail.reviewNote, '人工判定违规');
});

test('S4-T08-12: 批量审核', async () => {
  const d = db();
  const log = makeLog();
  const items = [
    { resourceType: 'text', contentSnapshot: '安全内容1' },
    // 多关键词命中确保超过 standard 阈值60：色情+裸体+成人视频 → score=60 → block
    { resourceType: 'text', contentSnapshot: '色情裸体成人视频' },
    { resourceType: 'text', contentSnapshot: '安全内容2' },
  ];
  const result = await modService.moderateBatch(d, log, items, 'standard');
  assert.equal(result.total, 3);
  assert.equal(result.results.length, 3);
  // 至少有一条违规
  const violations = result.results.filter(r => r.verdict === 'violation');
  assert.ok(violations.length >= 1);
});
