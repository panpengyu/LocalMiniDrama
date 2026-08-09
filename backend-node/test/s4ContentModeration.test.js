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
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4mod-'));
  const dbFile = path.join(dir, 'test.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE content_moderation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id BIGINT, drama_id BIGINT,
      resource_type VARCHAR(32), resource_id BIGINT, resource_url VARCHAR(1024),
      content_snapshot TEXT, provider VARCHAR(64), verdict VARCHAR(16),
      risk_label VARCHAR(64), risk_score DECIMAL(5,2), confidence DECIMAL(5,2),
      detail_json TEXT, mode VARCHAR(16), is_blocked TINYINT(1) DEFAULT 0,
      reviewed_by BIGINT, reviewed_at DATETIME, review_note TEXT,
      created_at DATETIME, updated_at DATETIME
    );
    CREATE TABLE content_moderation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode VARCHAR(16), category VARCHAR(32), threshold DECIMAL(5,2),
      action VARCHAR(16), is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME, updated_at DATETIME,
      UNIQUE(mode, category)
    );
    INSERT INTO content_moderation_rules (mode, category, threshold, action) VALUES
      ('strict','porn',30,'block'), ('strict','violence',40,'block'),
      ('standard','porn',60,'block'), ('standard','violence',70,'block'),
      ('loose','porn',80,'block'), ('loose','violence',85,'block');
  `);
  return { db, dir };
}

function makeLog() {
  return {
    info: () => {}, warn: () => {}, error: () => {},
  };
}

const modService = require('../src/services/contentModerationService');

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
  const { db, dir } = makeDb();
  const log = makeLog();
  const result = await modService.moderate(db, log, {
    resourceType: 'text',
    contentSnapshot: '正常的剧本内容',
    mode: 'standard',
    userId: 1,
  });
  assert.equal(result.verdict, 'safe');
  assert.equal(result.isBlocked, false);
  assert.ok(result.logId);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T08-8: moderate() 统一入口-拦截违规', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  const result = await modService.moderate(db, log, {
    resourceType: 'text',
    contentSnapshot: '色情裸体成人视频',
    mode: 'standard',
  });
  assert.equal(result.verdict, 'violation');
  assert.equal(result.isBlocked, true);
  assert.ok(result.logId);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T08-9: 三种审核模式阈值差异', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  // "色情" 一个词：score=30
  // strict 阈值30 → block
  const strictResult = await modService.moderate(db, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'strict',
  });
  assert.equal(strictResult.isBlocked, true);

  // standard 阈值60 → 30 < 60 → safe
  const standardResult = await modService.moderate(db, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'standard',
  });
  assert.equal(standardResult.isBlocked, false);

  // loose 阈值80 → 30 < 80 → safe
  const looseResult = await modService.moderate(db, log, {
    resourceType: 'text', contentSnapshot: '色情', mode: 'loose',
  });
  assert.equal(looseResult.isBlocked, false);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T08-10: 审核记录落库+查询', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  await modService.moderate(db, log, { resourceType: 'text', contentSnapshot: '安全内容', mode: 'standard', userId: 10 });
  await modService.moderate(db, log, { resourceType: 'text', contentSnapshot: '色情内容', mode: 'standard', userId: 10 });

  const logs = modService.listLogs(db, { userId: 10 });
  assert.equal(logs.length, 2);

  const detail = modService.getLog(db, logs[0].id);
  assert.ok(detail);
  assert.ok(detail.contentSnapshot);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T08-11: 人工复审', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  const r = await modService.moderate(db, log, { resourceType: 'text', contentSnapshot: '安全内容', mode: 'standard' });
  const reviewed = modService.review(db, log, r.logId, { verdict: 'violation', reviewNote: '人工判定违规', reviewedBy: 99 });
  assert.equal(reviewed.verdict, 'violation');
  assert.equal(reviewed.isBlocked, true);

  const detail = modService.getLog(db, r.logId);
  assert.equal(detail.verdict, 'violation');
  assert.equal(detail.reviewNote, '人工判定违规');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T08-12: 批量审核', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();
  const items = [
    { resourceType: 'text', contentSnapshot: '安全内容1' },
    // 多关键词命中确保超过 standard 阈值60：色情+裸体+成人视频 → score=60 → block
    { resourceType: 'text', contentSnapshot: '色情裸体成人视频' },
    { resourceType: 'text', contentSnapshot: '安全内容2' },
  ];
  const result = await modService.moderateBatch(db, log, items, 'standard');
  assert.equal(result.total, 3);
  assert.equal(result.results.length, 3);
  // 至少有一条违规
  const violations = result.results.filter(r => r.verdict === 'violation');
  assert.ok(violations.length >= 1);

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
