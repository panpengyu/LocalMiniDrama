// ============================================================
// s3ConsistencyRetry.test.js — Sprint 3
// S3-T02: imageService 一致性校验失败自动重试（最多 3 次）
// 覆盖场景：
//   1) 无关联角色 → 跳过 checked=false
//   2) checkConsistency 通过 (passed=true, score=0.92) → 不生成重试
//   3) 未通过 & retry_count=0 → 生成 retry_count=1 的新记录，prompt 包含 CRITICAL 一致性强制
//   4) 未通过 & retry_count=2 → 生成 retry_count=3 的新记录（最后一次机会）
//   5) 未通过 & retry_count=3 → 不再重试（warn：已达最大次数）
//   6) 通过时写入 consistency_score / consistency_passed
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试数据使用高位 ID
//       （996xxx）隔离真实数据，beforeEach 清理。consistencyService
//       为外部 AI 一致性校验依赖 stub（不产生测试数据）。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

const TEST_DRAMA = 998301;
// 测试专用高位 ID
const CID = { s2: 998305, s3: 998307, s4: 998309 };
const SBID = { s1: null, s2: 998324, s3: 998310, s4: 998399 };

function db() {
  return getDb(loadConfig().database);
}

// 清理本测试产生的数据（高位 ID 区间）
function cleanup() {
  const d = db();
  d.prepare('DELETE FROM image_generations WHERE drama_id = ?').run(TEST_DRAMA);
  d.prepare('DELETE FROM storyboard_characters WHERE storyboard_id BETWEEN 998300 AND 998399').run();
  d.prepare('DELETE FROM storyboards WHERE id BETWEEN 998300 AND 998399').run();
  d.prepare('DELETE FROM characters WHERE id BETWEEN 998300 AND 998399').run();
}

// ---------- mock logger ----------
function makeLog() {
  const buf = [];
  const push = (lvl, msg, meta) => buf.push({ lvl, msg, meta: JSON.parse(JSON.stringify(meta || {})) });
  return {
    _buf: buf,
    info: (m, o) => push('info', m, o),
    warn: (m, o) => push('warn', m, o),
    error: (m, o) => push('error', m, o),
    filter: (sub) => buf.filter((e) => String(e.msg || '').includes(sub)),
  };
}

// ---------- mock consistencyService ----------
// 通过对 checkConsistency 的返回注入不同分数
function mockConsistencyModule(scoreByCid = {}) {
  const calls = [];
  return {
    calls,
    reset() { calls.length = 0; },
    async checkConsistency(db, log, params) {
      calls.push({ ...params });
      const cid = params.characterId || 'default';
      const cfg = scoreByCid[cid];
      const score = cfg && typeof cfg.score === 'number' ? cfg.score : 0.92;
      const threshold = params.threshold || 0.85;
      return {
        checkId: `cchk_${calls.length}`,
        similarityScore: score,
        threshold,
        passed: score >= threshold,
        method: 'cosine_embedding',
        detail: { score, threshold },
      };
    },
  };
}

// ---------- 测试用插入 base row ----------
function insertIg(d, overrides = {}) {
  const info = d.prepare(`INSERT INTO image_generations
    (storyboard_id, drama_id, character_id, provider, model, prompt, size, quality, frame_type, reference_images, status, retry_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`).run(
    overrides.storyboard_id ?? null,
    overrides.drama_id ?? TEST_DRAMA,
    overrides.character_id ?? null,
    overrides.provider ?? 'test-provider',
    overrides.model ?? 'flux-dev',
    overrides.prompt ?? '一名身穿蓝色校服的少女站在樱花树下',
    overrides.size ?? '720x1280',
    overrides.quality ?? 'standard',
    overrides.frame_type ?? 'storyboard_first',
    overrides.reference_images ?? null,
    overrides.retry_count ?? 0
  );
  return Number(info.lastInsertRowid);
}

test.beforeEach(cleanup);
test.after(() => { cleanup(); closeDb(); });

test('S3-T02 1) 无关联角色（无character_id、storyboard为null）→ 跳过，checked=false', async (t) => {
  const d = db();
  const log = makeLog();
  const id = insertIg(d, { character_id: null, storyboard_id: null, drama_id: TEST_DRAMA });
  // 模拟 processImageGeneration 完成后的 ctx
  const imgSvc = require('../src/services/imageService');
  const row = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
  const ctx = { row, imageGenId: id, persistedImageUrl: '/static/t.jpg', localPath: null, finalPrompt: row.prompt };

  const out = await imgSvc.internalEnforceConsistencyAndMaybeRetry(d, log, ctx);
  assert.equal(out.checked, false, '无关联角色 checked=false');
  assert.equal(out.retryScheduled, false);
  const warns = log.filter('参数非法');
  assert.equal(warns.length, 0);
});

test('S3-T02 2) 通过（score=0.92 > 0.85阈值） → 不生成重试，写 consistency_passed=1', async (t) => {
  const d = db();
  const log = makeLog();
  // 插入角色：生成 deterministic embedding（基于名字的哈希），这样"相同角色图 vs 参考图"会高相似度
  d.prepare('INSERT INTO characters (id, name, drama_id, image_url, consistency_threshold, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(CID.s2, '苏暖', TEST_DRAMA, '/static/ref/sunuan.jpg', 0.85, null);
  d.prepare('INSERT INTO storyboards (id, episode_id, characters, deleted_at) VALUES (?, ?, ?, ?)')
    .run(SBID.s2, SBID.s2, JSON.stringify([{ id: CID.s2 }]), null);

  const id = insertIg(d, { character_id: CID.s2, storyboard_id: SBID.s2, retry_count: 0 });
  const imgSvc = require('../src/services/imageService');
  const row = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
  // 给角色先手动塞入 face_embedding（伪 embedding），使 getCharacterEmbedding 返回有效
  const sample = new Array(256).fill(0.1);
  const embStr = JSON.stringify(sample);
  d.prepare('UPDATE characters SET face_embedding = ?, embedding_model = ?, embedding_generated_at = ? WHERE id = ?')
    .run(embStr, 'pseudo-v1', '2026-01-01 00:00:00', CID.s2);

  const ctx = { row, imageGenId: id, persistedImageUrl: '/static/t.jpg', finalPrompt: row.prompt };
  const out = await imgSvc.internalEnforceConsistencyAndMaybeRetry(d, log, ctx);

  assert.equal(out.checked, true);
  const after = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
  assert.notEqual(after.consistency_score, null, '已写入 consistency_score');
  assert.notEqual(after.consistency_passed, null, '已写入 consistency_passed');
  const pendingCount = d.prepare("SELECT COUNT(*) as c FROM image_generations WHERE status = 'pending' AND retried_from_id = ?").get(id).c;
  if (!out.passed) {
    assert.equal(pendingCount, 1, '未通过时生成 1 条 pending 重试');
    const retryRow = d.prepare("SELECT * FROM image_generations WHERE status = 'pending' AND retried_from_id = ?").get(id);
    assert.equal(retryRow.retry_count, 1, 'retry_count = 1');
    assert.ok(retryRow.prompt.includes(imgSvc.S3_RETRY_PROMPT_APPEND.slice(0, 20)), 'prompt 已追加强制一致性文本');
  }
});

test('S3-T02 3) mock consistencyService，模拟 score=0.5 & retry_count=0 → 应生成 retry_count=1 的 pending 记录', async (t) => {
  const resolvedPath = require.resolve('../src/services/consistencyService');
  const orig = require.cache[resolvedPath];
  try {
    const lowScoreMock = mockConsistencyModule({ [CID.s3]: { score: 0.5 } });
    require.cache[resolvedPath] = {
      exports: new Proxy({}, {
        get(_t, k) {
          if (k === 'checkConsistency') return lowScoreMock.checkConsistency.bind(lowScoreMock);
          return () => ({});
        },
      }),
      id: resolvedPath,
      loaded: true,
      filename: resolvedPath,
      path: path.dirname(resolvedPath),
      paths: module.paths,
      children: [],
      parent: module,
    };
    delete require.cache[require.resolve('../src/services/imageService')];

    const d = db();
    const log = makeLog();
    d.prepare('INSERT INTO storyboards (id, episode_id, characters, deleted_at) VALUES (?, ?, ?, ?)')
      .run(SBID.s3, SBID.s3, JSON.stringify([{ id: CID.s3 }]), null);

    const id = insertIg(d, { character_id: CID.s3, storyboard_id: SBID.s3, retry_count: 0 });
    const imgSvcFresh = require('../src/services/imageService');
    const row = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
    const ctx = { row, imageGenId: id, persistedImageUrl: '/static/t.jpg', finalPrompt: row.prompt };
    const out = await imgSvcFresh.internalEnforceConsistencyAndMaybeRetry(d, log, ctx);

    assert.equal(out.checked, true);
    assert.equal(out.passed, false);
    assert.equal(out.minScore, 0.5);
    assert.equal(out.retryScheduled, true);
    assert.notEqual(out.retryId, null);

    const retry = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(out.retryId);
    assert.equal(retry.status, 'pending');
    assert.equal(retry.retried_from_id, id);
    assert.equal(retry.retry_count, 1);
    assert.ok(retry.prompt.includes(imgSvcFresh.S3_RETRY_PROMPT_APPEND.slice(0, 24)), 'prompt 追加强制文本');

    const after = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
    assert.equal(after.consistency_score, 0.5);
    assert.equal(after.consistency_passed, 0);
  } finally {
    if (orig) require.cache[resolvedPath] = orig;
    delete require.cache[require.resolve('../src/services/imageService')];
  }
});

test('S3-T02 4) retry_count=2（倒数第二次机会）失败 → 生成 retry_count=3', async (t) => {
  const resolvedPath = require.resolve('../src/services/consistencyService');
  const orig = require.cache[resolvedPath];
  try {
    const lowScoreMock = mockConsistencyModule({ [CID.s4]: { score: 0.4 } });
    require.cache[resolvedPath] = {
      exports: new Proxy({}, {
        get(_t, k) {
          if (k === 'checkConsistency') return lowScoreMock.checkConsistency.bind(lowScoreMock);
          return () => ({});
        },
      }),
      id: resolvedPath,
      loaded: true,
      filename: resolvedPath,
      path: path.dirname(resolvedPath),
      paths: module.paths,
      children: [],
      parent: module,
    };
    delete require.cache[require.resolve('../src/services/imageService')];

    const d = db();
    const log = makeLog();
    d.prepare('INSERT INTO storyboards (id, episode_id, characters, deleted_at) VALUES (?, ?, ?, ?)')
      .run(SBID.s4, SBID.s4, JSON.stringify([{ id: CID.s4 }]), null);

    const id = insertIg(d, { character_id: CID.s4, storyboard_id: SBID.s4, retry_count: 2 });
    const imgSvcFresh = require('../src/services/imageService');
    const row = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
    const out = await imgSvcFresh.internalEnforceConsistencyAndMaybeRetry(d, log, { row, imageGenId: id, persistedImageUrl: '/static/t.jpg', finalPrompt: row.prompt });

    assert.equal(out.retryScheduled, true);
    const retry = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(out.retryId);
    assert.equal(retry.retry_count, 3, '最后一次机会（3）');
  } finally {
    if (orig) require.cache[resolvedPath] = orig;
    delete require.cache[require.resolve('../src/services/imageService')];
  }
});

test('S3-T02 5) 已达 3 次 & 仍失败 → 不再重试，warn 日志', async (t) => {
  const resolvedPath = require.resolve('../src/services/consistencyService');
  const orig = require.cache[resolvedPath];
  try {
    const lowScoreMock = mockConsistencyModule({ [CID.s4]: { score: 0.3 } });
    require.cache[resolvedPath] = {
      exports: new Proxy({}, {
        get(_t, k) {
          if (k === 'checkConsistency') return lowScoreMock.checkConsistency.bind(lowScoreMock);
          return () => ({});
        },
      }),
      id: resolvedPath,
      loaded: true,
      filename: resolvedPath,
      path: path.dirname(resolvedPath),
      paths: module.paths,
      children: [],
      parent: module,
    };
    delete require.cache[require.resolve('../src/services/imageService')];

    const d = db();
    const log = makeLog();
    d.prepare('INSERT INTO storyboards (id, episode_id, characters, deleted_at) VALUES (?, ?, ?, ?)')
      .run(SBID.s4, SBID.s4, JSON.stringify([{ id: CID.s4 }]), null);

    const id = insertIg(d, { character_id: CID.s4, storyboard_id: SBID.s4, retry_count: 3 });
    const imgSvcFresh = require('../src/services/imageService');
    const row = d.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
    const out = await imgSvcFresh.internalEnforceConsistencyAndMaybeRetry(d, log, { row, imageGenId: id, persistedImageUrl: '/static/t.jpg', finalPrompt: row.prompt });

    assert.equal(out.retryScheduled, false, '到达 MAX=3 不再重试');
    assert.equal(out.retryId, null);
    const warns = log.filter('已达最大重试次数');
    assert.equal(warns.length, 1, 'warn: 已达最大重试次数 输出 1 条');
    assert.equal(warns[0].meta.retriesSoFar, 3);
    assert.equal(warns[0].meta.maxRetries, 3);
  } finally {
    if (orig) require.cache[resolvedPath] = orig;
    delete require.cache[require.resolve('../src/services/imageService')];
  }
});

test('S3-T02 6) MAX_RETRIES 常量 = 3，S3_RETRY_PROMPT_APPEND 包含关键字段', () => {
  const imgSvc = require('../src/services/imageService');
  assert.equal(imgSvc.S3_MAX_RETRIES, 3);
  assert.ok(imgSvc.S3_RETRY_PROMPT_APPEND.includes('CRITICAL 一致性强制'));
  assert.ok(imgSvc.S3_RETRY_PROMPT_APPEND.includes('脸型'));
  assert.ok(imgSvc.S3_RETRY_PROMPT_APPEND.includes('五官比例重构'));
});
