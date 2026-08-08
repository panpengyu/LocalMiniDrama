/**
 * consistencyService.test.js — Sprint 2 角色一致性服务单元测试
 *
 * 覆盖 S2-T05~T08 核心逻辑：
 *   - _cosineSimilarity: 余弦相似度计算
 *   - _parseEmbedding: embedding 解析
 *   - generateCharacterEmbedding: 角色指纹生成（AI 成功 + 降级方案）
 *   - checkConsistency: 一致性校验（余弦路径 + 视觉模型兜底 + 结构化降级）
 *   - listConsistencyLogs: 校验历史查询
 *   - getCharacterConsistencyStats: 角色一致性统计
 *
 * 使用 SQLite in-memory 数据库 + mock AI 服务，确保测试环境独立。
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// ---- mock aiClient ----
const aiClient = require('../src/services/aiClient');
const origGenerateText = aiClient.generateText;

function mockAi(responseText) {
  aiClient.generateText = async () => responseText;
}
function mockAiFn(fn) {
  aiClient.generateText = fn;
}
function restoreAi() {
  aiClient.generateText = origGenerateText;
}

const consistencyService = require('../src/services/consistencyService');

// ---- mock log ----
const mockLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

// ---- 创建内存 SQLite 数据库 ----
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      role TEXT,
      description TEXT,
      personality TEXT,
      appearance TEXT,
      image_url TEXT,
      local_path TEXT,
      ref_image TEXT,
      four_view_image_url TEXT,
      identity_anchors TEXT,
      face_embedding TEXT,
      embedding_model TEXT,
      embedding_generated_at TEXT,
      consistency_threshold REAL DEFAULT 0.85,
      sort_order INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE character_libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      local_path TEXT,
      ref_image TEXT,
      four_view_image_url TEXT,
      identity_anchors TEXT,
      appearance TEXT,
      face_embedding TEXT,
      embedding_model TEXT,
      embedding_generated_at TEXT,
      consistency_threshold REAL DEFAULT 0.85,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE character_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      character_type TEXT DEFAULT 'project',
      drama_id INTEGER,
      view_angle TEXT DEFAULT 'front',
      image_url TEXT,
      embedding TEXT NOT NULL,
      embedding_model TEXT,
      embedding_dim INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE consistency_check_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_id TEXT NOT NULL UNIQUE,
      drama_id INTEGER,
      storyboard_id INTEGER,
      character_id INTEGER,
      generated_image_url TEXT,
      reference_image_url TEXT,
      similarity_score REAL NOT NULL DEFAULT 0,
      threshold REAL DEFAULT 0.85,
      passed INTEGER DEFAULT 0,
      check_method TEXT DEFAULT 'cosine_embedding',
      detail_json TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);
  return db;
}

function insertTestCharacter(db, overrides = {}) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const defaults = {
    drama_id: 1,
    name: '测试角色',
    role: 'protagonist',
    appearance: '黑色长发，蓝色眼睛，身穿白色长裙',
    image_url: 'https://example.com/char_front.png',
    identity_anchors: JSON.stringify({ hair: '黑色长发', eyes: '蓝色', outfit: '白色长裙' }),
    consistency_threshold: 0.85,
  };
  const data = { ...defaults, ...overrides };
  const result = db.prepare(
    `INSERT INTO characters (drama_id, name, role, appearance, image_url, identity_anchors, consistency_threshold, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.drama_id, data.name, data.role, data.appearance, data.image_url, data.identity_anchors, data.consistency_threshold, now, now);
  return result.lastInsertRowid;
}

// 生成一个固定维度的伪 embedding 向量
function makeVector(dim, fillFn) {
  const arr = new Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = fillFn(i);
  return arr;
}

// ============ 测试开始 ============

describe('consistencyService - 工具函数', () => {
  describe('_cosineSimilarity', () => {
    it('相同向量相似度为 1', () => {
      const v = makeVector(128, (i) => (i % 7) / 7);
      const score = consistencyService._cosineSimilarity(Float64Array.from(v), Float64Array.from(v));
      assert.ok(score > 0.999, `expected ~1, got ${score}`);
    });

    it('正交向量相似度约 0.5（归一化后）', () => {
      // [1,0,0,...] 和 [0,1,0,...] 点积=0，余弦=0，归一化后=0.5
      const v1 = makeVector(128, (i) => (i === 0 ? 1 : 0));
      const v2 = makeVector(128, (i) => (i === 1 ? 1 : 0));
      const score = consistencyService._cosineSimilarity(Float64Array.from(v1), Float64Array.from(v2));
      assert.ok(Math.abs(score - 0.5) < 0.01, `expected ~0.5, got ${score}`);
    });

    it('维度不一致返回 0', () => {
      const v1 = Float64Array.from([1, 2, 3]);
      const v2 = Float64Array.from([1, 2]);
      assert.equal(consistencyService._cosineSimilarity(v1, v2), 0);
    });

    it('空向量返回 0', () => {
      assert.equal(consistencyService._cosineSimilarity(new Float64Array(0), new Float64Array(0)), 0);
      assert.equal(consistencyService._cosineSimilarity(null, null), 0);
    });

    it('同向向量相似度接近 1', () => {
      const v1 = Float64Array.from([1, 2, 3, 4, 5]);
      const v2 = Float64Array.from([2, 4, 6, 8, 10]); // 同向放大
      const score = consistencyService._cosineSimilarity(v1, v2);
      assert.ok(score > 0.999, `expected ~1, got ${score}`);
    });
  });

  describe('_parseEmbedding', () => {
    it('解析 JSON 字符串数组', () => {
      const emb = consistencyService._parseEmbedding('[0.1, 0.2, 0.3]');
      assert.ok(emb instanceof Float64Array);
      assert.equal(emb.length, 3);
      assert.equal(emb[0], 0.1);
    });

    it('解析原生数组', () => {
      const emb = consistencyService._parseEmbedding([1, 2, 3]);
      assert.ok(emb instanceof Float64Array);
      assert.equal(emb.length, 3);
    });

    it('无效输入返回 null', () => {
      assert.equal(consistencyService._parseEmbedding(null), null);
      assert.equal(consistencyService._parseEmbedding(''), null);
      assert.equal(consistencyService._parseEmbedding('not json'), null);
      assert.equal(consistencyService._parseEmbedding('{}'), null);
    });
  });
});

// ============================================================
// S2-T07: 角色指纹系统 — generateCharacterEmbedding
// ============================================================
describe('consistencyService - S2-T07 generateCharacterEmbedding', () => {
  let db;
  before(() => { db = createTestDb(); });
  after(() => { db.close(); restoreAi(); });

  it('角色不存在时抛出错误', async () => {
    await assert.rejects(
      () => consistencyService.generateCharacterEmbedding(db, mockLog, 99999, { characterType: 'project' }),
      /角色不存在/
    );
  });

  it('角色无图片时抛出错误', async () => {
    const charId = insertTestCharacter(db, { image_url: null, ref_image: null, four_view_image_url: null, local_path: null });
    await assert.rejects(
      () => consistencyService.generateCharacterEmbedding(db, mockLog, charId),
      /没有关联的图片/
    );
  });

  it('AI 返回有效 embedding 时正常存储', async () => {
    const charId = insertTestCharacter(db, { name: 'AI成功角色' });
    const fakeEmbedding = makeVector(512, (i) => Math.sin(i));
    mockAi(JSON.stringify(fakeEmbedding));

    const result = await consistencyService.generateCharacterEmbedding(db, mockLog, charId, { characterType: 'project' });

    assert.equal(result.success, true);
    assert.equal(result.characterId, charId);
    assert.equal(result.embeddingDim, 512);
    assert.ok(result.embeddingId);

    // 验证 character_embeddings 表
    const embRow = db.prepare('SELECT * FROM character_embeddings WHERE character_id = ?').get(charId);
    assert.ok(embRow);
    assert.equal(embRow.view_angle, 'front');
    const stored = JSON.parse(embRow.embedding);
    assert.equal(stored.length, 512);

    // 验证 characters.face_embedding 同步
    const charRow = db.prepare('SELECT face_embedding, embedding_model FROM characters WHERE id = ?').get(charId);
    assert.ok(charRow.face_embedding);
    assert.equal(charRow.embedding_model, 'vision-embedding');
  });

  it('AI 调用失败时走降级方案（伪 embedding）', async () => {
    const charId = insertTestCharacter(db, { name: '降级角色' });
    // mock AI 抛出异常
    mockAiFn(async () => { throw new Error('AI 服务不可用'); });

    const result = await consistencyService.generateCharacterEmbedding(db, mockLog, charId);

    assert.equal(result.success, true);
    assert.equal(result.embeddingModel, 'pseudo-identity-anchors-v1');
    assert.equal(result.embeddingDim, 256);

    // 验证降级 embedding 已存储
    const embRow = db.prepare('SELECT embedding_model FROM character_embeddings WHERE character_id = ?').get(charId);
    assert.equal(embRow.embedding_model, 'pseudo-identity-anchors-v1');
  });

  it('AI 返回非数组 JSON 时走降级方案', async () => {
    const charId = insertTestCharacter(db, { name: '非数组角色' });
    mockAi(JSON.stringify({ error: 'unsupported' }));

    const result = await consistencyService.generateCharacterEmbedding(db, mockLog, charId);

    assert.equal(result.success, true);
    assert.equal(result.embeddingModel, 'pseudo-identity-anchors-v1');
  });

  it('支持 library 类型角色', async () => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const ins = db.prepare(
      'INSERT INTO character_libraries (name, image_url, identity_anchors, appearance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('库角色', 'https://example.com/lib_char.png', JSON.stringify({ hair: '短发' }), '短发，圆脸', now, now);
    const libCharId = ins.lastInsertRowid;

    mockAi(JSON.stringify(makeVector(256, (i) => i / 256)));
    const result = await consistencyService.generateCharacterEmbedding(db, mockLog, libCharId, { characterType: 'library' });

    assert.equal(result.success, true);
    assert.equal(result.characterId, libCharId);

    // 验证 character_libraries.face_embedding 同步
    const row = db.prepare('SELECT face_embedding FROM character_libraries WHERE id = ?').get(libCharId);
    assert.ok(row.face_embedding);
  });
});

// ============================================================
// S2-T07: generateEmbeddingsForDrama — 批量生成
// ============================================================
describe('consistencyService - S2-T07 generateEmbeddingsForDrama', () => {
  let db;
  before(() => { db = createTestDb(); });
  after(() => { db.close(); restoreAi(); });

  it('批量为剧中角色生成 embedding', async () => {
    insertTestCharacter(db, { name: '角色A', drama_id: 100 });
    insertTestCharacter(db, { name: '角色B', drama_id: 100 });
    insertTestCharacter(db, { name: '其他剧角色', drama_id: 200 });

    mockAi(JSON.stringify(makeVector(256, (i) => Math.cos(i))));
    const result = await consistencyService.generateEmbeddingsForDrama(db, mockLog, 100);

    assert.equal(result.dramaId, 100);
    assert.equal(result.total, 2);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.success));
  });

  it('剧中无角色时返回空结果', async () => {
    const result = await consistencyService.generateEmbeddingsForDrama(db, mockLog, 999);
    assert.equal(result.total, 0);
    assert.equal(result.results.length, 0);
  });
});

// ============================================================
// S2-T08: checkConsistency — 一致性校验
// ============================================================
describe('consistencyService - S2-T08 checkConsistency', () => {
  let db;
  let charId;

  before(() => { db = createTestDb(); });
  after(() => { db.close(); restoreAi(); });

  beforeEach(async () => {
    // 每个测试前重新插入角色并生成 embedding
    db.exec('DELETE FROM characters; DELETE FROM character_embeddings; DELETE FROM consistency_check_logs;');
    charId = insertTestCharacter(db, { name: '一致性测试角色', consistency_threshold: 0.8 });

    // 为角色生成 embedding（使用 mock）
    const refEmbedding = makeVector(256, (i) => Math.sin(i * 0.1));
    mockAi(JSON.stringify(refEmbedding));
    await consistencyService.generateCharacterEmbedding(db, mockLog, charId);
  });

  it('缺少 generatedImageUrl 时抛出错误', async () => {
    await assert.rejects(
      () => consistencyService.checkConsistency(db, mockLog, { characterId: charId }),
      /缺少 generatedImageUrl/
    );
  });

  it('缺少 characterId 和 referenceImageUrl 时抛出错误', async () => {
    await assert.rejects(
      () => consistencyService.checkConsistency(db, mockLog, { generatedImageUrl: 'https://example.com/gen.png' }),
      /缺少 characterId 或 referenceImageUrl/
    );
  });

  it('余弦相似度路径：高相似度通过校验', async () => {
    // 生成图 embedding 与参考图几乎相同 → 高相似度
    const similarEmbedding = makeVector(256, (i) => Math.sin(i * 0.1) + 0.001);
    mockAi(JSON.stringify(similarEmbedding));

    const result = await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_high.png',
      characterType: 'project',
    });

    assert.ok(result.checkId);
    assert.equal(result.method, 'cosine_embedding');
    assert.ok(result.similarityScore > 0.8, `expected >0.8, got ${result.similarityScore}`);
    assert.equal(result.passed, true);

    // 验证日志落库
    const logRow = db.prepare('SELECT * FROM consistency_check_logs WHERE check_id = ?').get(result.checkId);
    assert.ok(logRow);
    assert.equal(logRow.passed, 1);
    assert.equal(logRow.check_method, 'cosine_embedding');
  });

  it('余弦相似度路径：低相似度不通过校验', async () => {
    // 生成图 embedding 与参考图差异大 → 低相似度
    const diffEmbedding = makeVector(256, (i) => Math.cos(i * 0.5));
    mockAi(JSON.stringify(diffEmbedding));

    const result = await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_low.png',
      characterType: 'project',
    });

    assert.ok(result.similarityScore < 0.8, `expected <0.8, got ${result.similarityScore}`);
    // 注意：余弦相似度归一化后可能仍在 0.5 左右，取决于阈值
    const expectedPassed = result.similarityScore >= 0.8;
    assert.equal(result.passed, expectedPassed);
  });

  it('视觉模型兜底路径：AI embedding 提取失败时降级到 visual_llm', async () => {
    // 第一次调用（提取生成图 embedding）抛异常 → 走视觉模型兜底
    let callCount = 0;
    mockAiFn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('embedding 提取失败');
      // 视觉模型兜底返回
      return JSON.stringify({
        isSameCharacter: true,
        similarityScore: 0.92,
        analysis: '面部特征高度一致',
        confidence: 0.9,
      });
    });

    const result = await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_visual.png',
      characterType: 'project',
    });

    assert.equal(result.method, 'visual_llm');
    assert.ok(result.similarityScore > 0);
    assert.ok(result.detail.visualAnalysis);
  });

  it('结构化降级路径：视觉模型也失败时走 structural', async () => {
    // 所有 AI 调用都失败
    mockAiFn(async () => { throw new Error('AI 完全不可用'); });

    const result = await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_structural.png',
      characterType: 'project',
    });

    assert.equal(result.method, 'structural');
    assert.ok(result.detail.structuralFallback === true);
    // structural 降级给 0.75（有 identity_anchors）
    assert.equal(result.similarityScore, 0.75);
  });

  it('使用自定义 threshold 覆盖角色默认值', async () => {
    // 构造一个与参考图相似度约 0.9 的向量（介于默认阈值 0.8 和自定义阈值 0.99 之间）
    // 方法：ref 向量与正交向量按 0.8:0.6 混合（raw cosine ≈ 0.8 → 归一化 ≈ 0.9）
    const refVec = makeVector(256, (i) => Math.sin(i * 0.1));
    const orthoVec = makeVector(256, (i) => (i < 128 ? 1 : -1)); // 与 ref 近似正交
    const mixedVec = refVec.map((v, i) => 0.8 * v + 0.6 * orthoVec[i]);
    mockAi(JSON.stringify(mixedVec));

    const result = await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_threshold.png',
      characterType: 'project',
      threshold: 0.99, // 极高阈值
    });

    assert.equal(result.threshold, 0.99);
    // 自定义 threshold 已覆盖角色默认值(0.8)
    // 相似度约 0.9，低于 0.99 → 不通过
    assert.equal(result.passed, false);
  });

  it('校验记录写入 consistency_check_logs 表', async () => {
    const similarEmbedding = makeVector(256, (i) => Math.sin(i * 0.1));
    mockAi(JSON.stringify(similarEmbedding));

    const before = db.prepare('SELECT COUNT(*) as c FROM consistency_check_logs').get().c;
    await consistencyService.checkConsistency(db, mockLog, {
      characterId: charId,
      generatedImageUrl: 'https://example.com/gen_log.png',
      storyboardId: 42,
      dramaId: 1,
    });
    const after = db.prepare('SELECT COUNT(*) as c FROM consistency_check_logs').get().c;

    assert.equal(after, before + 1);

    const row = db.prepare('SELECT * FROM consistency_check_logs WHERE storyboard_id = 42').get();
    assert.ok(row);
    assert.equal(row.drama_id, 1);
    assert.equal(row.character_id, charId);
    assert.ok(row.detail_json);
  });
});

// ============================================================
// listConsistencyLogs + getCharacterConsistencyStats
// ============================================================
describe('consistencyService - 校验历史与统计', () => {
  let db;
  let charId;

  before(() => {
    db = createTestDb();
    charId = insertTestCharacter(db, { name: '统计角色', drama_id: 50 });
    // 手动插入校验日志
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const insertLog = db.prepare(
      `INSERT INTO consistency_check_logs (check_id, drama_id, storyboard_id, character_id, generated_image_url, reference_image_url, similarity_score, threshold, passed, check_method, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertLog.run('cchk_001', 50, 101, charId, 'gen1.png', 'ref1.png', 0.95, 0.85, 1, 'cosine_embedding', '{"score":0.95}', now);
    insertLog.run('cchk_002', 50, 102, charId, 'gen2.png', 'ref2.png', 0.78, 0.85, 0, 'visual_llm', '{"score":0.78}', now);
    insertLog.run('cchk_003', 50, 103, charId, 'gen3.png', 'ref3.png', 0.90, 0.85, 1, 'cosine_embedding', '{"score":0.90}', now);
  });
  after(() => { db.close(); });

  describe('listConsistencyLogs', () => {
    it('按 characterId 查询', () => {
      const logs = consistencyService.listConsistencyLogs(db, { characterId: charId });
      assert.equal(logs.length, 3);
      // 按时间倒序
      assert.ok(logs[0].checkId);
    });

    it('按 dramaId 查询', () => {
      const logs = consistencyService.listConsistencyLogs(db, { dramaId: 50 });
      assert.equal(logs.length, 3);
    });

    it('按 passed 过滤', () => {
      const passed = consistencyService.listConsistencyLogs(db, { characterId: charId, passed: true });
      assert.equal(passed.length, 2);
      const failed = consistencyService.listConsistencyLogs(db, { characterId: charId, passed: false });
      assert.equal(failed.length, 1);
    });

    it('支持 limit 分页', () => {
      const logs = consistencyService.listConsistencyLogs(db, { characterId: charId, limit: 2 });
      assert.equal(logs.length, 2);
    });

    it('返回字段驼峰映射正确', () => {
      const logs = consistencyService.listConsistencyLogs(db, { characterId: charId, limit: 1 });
      const log = logs[0];
      assert.ok('checkId' in log);
      assert.ok('dramaId' in log);
      assert.ok('storyboardId' in log);
      assert.ok('characterId' in log);
      assert.ok('similarityScore' in log);
      assert.ok('threshold' in log);
      assert.ok('passed' in log);
      assert.ok('method' in log);
      assert.ok('createdAt' in log);
    });

    it('detail_json 正确解析为对象', () => {
      const logs = consistencyService.listConsistencyLogs(db, { characterId: charId, limit: 1 });
      assert.ok(typeof logs[0].detail === 'object');
      assert.ok('score' in logs[0].detail);
    });
  });

  describe('getCharacterConsistencyStats', () => {
    it('返回正确的统计数据', () => {
      const stats = consistencyService.getCharacterConsistencyStats(db, charId);
      assert.equal(stats.totalChecks, 3);
      assert.ok(stats.avgScore > 0);
      assert.ok(stats.passRate > 0);
      assert.ok(stats.recentScore !== null);
    });

    it('无校验记录时返回空统计', () => {
      const stats = consistencyService.getCharacterConsistencyStats(db, 99999);
      assert.equal(stats.totalChecks, 0);
      assert.equal(stats.avgScore, 0);
      assert.equal(stats.passRate, 0);
      assert.equal(stats.recentScore, null);
    });

    it('passRate 计算正确（2/3 通过）', () => {
      const stats = consistencyService.getCharacterConsistencyStats(db, charId);
      assert.ok(Math.abs(stats.passRate - 0.6667) < 0.01, `expected ~0.6667, got ${stats.passRate}`);
    });
  });
});

// ============================================================
// getCharacterEmbedding
// ============================================================
describe('consistencyService - getCharacterEmbedding', () => {
  let db;
  let charId;
  before(() => {
    db = createTestDb();
    charId = insertTestCharacter(db, { name: '查询角色' });
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE characters SET face_embedding = ?, embedding_model = ?, embedding_generated_at = ?, consistency_threshold = ? WHERE id = ?')
      .run(JSON.stringify(makeVector(128, (i) => i / 128)), 'test-model', now, 0.9, charId);
  });
  after(() => { db.close(); });

  it('返回角色的 embedding 信息', () => {
    const emb = consistencyService.getCharacterEmbedding(db, charId, 'project');
    assert.ok(emb);
    assert.ok(emb.embedding instanceof Float64Array);
    assert.equal(emb.embedding.length, 128);
    assert.equal(emb.embeddingModel, 'test-model');
    assert.equal(emb.threshold, 0.9);
  });

  it('角色无 embedding 时返回 null', () => {
    const emb = consistencyService.getCharacterEmbedding(db, 99999, 'project');
    assert.equal(emb, null);
  });

  it('支持 library 类型查询', () => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const ins = db.prepare('INSERT INTO character_libraries (name, image_url, face_embedding, embedding_model, embedding_generated_at, consistency_threshold, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('库角色2', 'lib.png', JSON.stringify(makeVector(64, (i) => i)), 'lib-model', now, 0.8, now, now);
    const emb = consistencyService.getCharacterEmbedding(db, ins.lastInsertRowid, 'library');
    assert.ok(emb);
    assert.equal(emb.embedding.length, 64);
    assert.equal(emb.embeddingModel, 'lib-model');
  });
});
