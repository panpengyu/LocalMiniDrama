// ============================================================
// s4TtsPipeline.test.js — Sprint 4
// S4-T03: 智能配音流水线测试
// 覆盖场景：
//   1) 角色音色绑定 CRUD（bindVoice / listVoiceBindings / deleteVoiceBinding）
//   2) 音色绑定更新（同一角色重复绑定 → UPDATE）
//   3) 台词提取 extractDialogues（支持 "角色名:台词" 格式 + 旁白兜底）
//   4) listVoices / listEmotions 常量字典校验
//   5) batchSynthesize 错误处理（无TTS配置 → 全部失败 → 批次记录落库）
//   6) listDubbingByEpisode 查询
//   7) 情感参数映射校验（EMOTION_PARAMS 覆盖核心情绪）
// ============================================================
'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const ttsService = require(path.resolve(__dirname, '..', 'src', 'services', 'ttsService.js'));

// ============================================================
// 数据约束：所有测试数据真实写入 MySQL（configs/config.yaml），
// 不使用 mock / SQLite。测试用固定 dramaId/episodeId 隔离，
// before 清理残留，after 彻底清理。
// ============================================================
let db;

function cleanup() {
  if (!db) return;
  // 本文件测试使用的 episodeId: 10(991010), 991011；dramaId: 1, 2, 500, 501
  db.prepare("DELETE FROM storyboard_dubbing WHERE episode_id IN (10, 991010, 991011)").run();
  db.prepare("DELETE FROM tts_batch_jobs WHERE episode_id IN (10, 991010, 991011) OR drama_id IN (1, 2)").run();
  db.prepare("DELETE FROM character_voice_bindings WHERE drama_id IN (1, 2, 500, 501)").run();
  db.prepare("DELETE FROM storyboards WHERE episode_id IN (10, 991010, 991011)").run();
  db.prepare("DELETE FROM episodes WHERE id IN (10, 11, 991010, 991011)").run();
}

before(() => {
  db = getDb(loadConfig().database);
});

beforeEach(() => {
  cleanup();
});

after(() => {
  cleanup();
  closeDb();
});

function makeDb() {
  // 真实 MySQL 单例连接，不创建临时库
  return { db };
}

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

// ---------- 角色音色绑定 CRUD ----------

test('S4-T03-1: 角色音色绑定 CRUD', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 新增绑定
  const r1 = ttsService.bindVoice(db, log, {
    dramaId: 1, characterId: 101, characterName: '林深',
    voiceId: 'male_deep', voiceName: '男声-沉稳男主',
    emotion: 'tense', isDefault: true,
  });
  assert.ok(r1.id);
  assert.equal(r1.updated, false);

  // 查询
  const list = ttsService.listVoiceBindings(db, { dramaId: 1 });
  assert.equal(list.length, 1);
  assert.equal(list[0].characterName, '林深');
  assert.equal(list[0].voiceId, 'male_deep');
  assert.equal(list[0].isDefault, true);

  // 删除
  const del = ttsService.deleteVoiceBinding(db, log, r1.id);
  assert.equal(del.deleted, true);
  assert.equal(ttsService.listVoiceBindings(db, { dramaId: 1 }).length, 0);

  // 数据由 before/after 统一清理（真实 MySQL）
});

test('S4-T03-2: 同一角色重复绑定 → UPDATE', () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  ttsService.bindVoice(db, log, {
    dramaId: 2, characterId: 200, characterName: '苏暖',
    voiceId: 'female_soft', emotion: 'neutral',
  });
  // 重复绑定 → 更新
  const r2 = ttsService.bindVoice(db, log, {
    dramaId: 2, characterId: 200, characterName: '苏暖',
    voiceId: 'female_sweet', emotion: 'happy',
  });
  assert.equal(r2.updated, true);

  const list = ttsService.listVoiceBindings(db, { dramaId: 2 });
  assert.equal(list.length, 1);
  assert.equal(list[0].voiceId, 'female_sweet');
  assert.equal(list[0].emotion, 'happy');

  // 数据由 before/after 统一清理（真实 MySQL）
});

// ---------- 台词提取 ----------

test('S4-T03-3: 台词提取 extractDialogues（"角色名:台词"格式 + 旁白兜底）', () => {
  const { db, dir } = makeDb();

  // 插入分镜数据（使用测试专用高位 id，避免与真实数据冲突）
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, dialogue, deleted_at) VALUES
    (991001, 10, 1, '林深:这里到底发生过什么？\n苏暖:(低下头)我…我不想再提起。', NULL),
    (991002, 10, 2, '夜色渐深，城市灯火通明。', NULL),
    (991003, 10, 3, '', NULL)`).run();

  const items = ttsService.extractDialogues(db, { episodeId: 10 });
  assert.ok(items.length >= 3);
  // 第一条：角色台词
  assert.equal(items[0].characterName, '林深');
  assert.ok(items[0].text.includes('这里到底'));
  // 第二条：角色台词（带括号动作）
  assert.equal(items[1].characterName, '苏暖');
  // 第三条：旁白
  const narration = items.find(i => i.characterName === '旁白');
  assert.ok(narration, '应识别出旁白');
  assert.ok(narration.text.includes('夜色'));

  // 数据由 before/after 统一清理（真实 MySQL）
});

test('S4-T03-3b: 台词提取按 dramaId 查询（通过 episodes 表关联）', () => {
  const { db, dir } = makeDb();

  db.prepare(`INSERT INTO episodes (id, drama_id, deleted_at) VALUES (991010, 500, NULL), (991011, 501, NULL)`).run();
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, dialogue, deleted_at) VALUES
    (991004, 991010, 1, '角色A:台词一', NULL),
    (991005, 991011, 1, '角色B:台词二', NULL)`).run();

  const items = ttsService.extractDialogues(db, { dramaId: 500 });
  assert.equal(items.length, 1);
  assert.equal(items[0].characterName, '角色A');

  // 数据由 before/after 统一清理（真实 MySQL）
});

// ---------- 常量字典 ----------

test('S4-T03-4: listVoices / listEmotions 常量字典校验', () => {
  const voices = ttsService.listVoices();
  assert.ok(voices.length >= 6, '应至少有6种预设音色');
  const female = voices.find(v => v.id === 'female_soft');
  assert.ok(female, '应有 female_soft 音色');
  assert.ok(female.name);
  assert.ok(female.voice_id);

  const emotions = ttsService.listEmotions();
  assert.ok(emotions.length >= 10, '应至少有10种情感参数');
  const neutral = emotions.find(e => e.emotion === 'neutral');
  assert.ok(neutral);
  assert.equal(neutral.speed, 1.00);
});

test('S4-T03-4b: 情感参数映射覆盖核心情绪', () => {
  const emotions = ttsService.listEmotions();
  const keys = emotions.map(e => e.emotion);
  // 核心情绪必须覆盖
  ['neutral', 'happy', 'sad', 'angry', 'tense', 'epic'].forEach(emo => {
    assert.ok(keys.includes(emo), `情感参数应包含 ${emo}`);
  });
  // happy 应比 neutral 快
  const happy = emotions.find(e => e.emotion === 'happy');
  const sad = emotions.find(e => e.emotion === 'sad');
  assert.ok(happy.speed > sad.speed, 'happy 语速应快于 sad');
});

// ---------- batchSynthesize 错误处理 ----------

test('S4-T03-5: batchSynthesize 无TTS配置 → 全部失败 → 批次记录落库', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  // 临时禁用 TTS 配置（真实 MySQL，测试后恢复），确保走"未配置 → 失败"路径
  db.prepare("UPDATE ai_service_configs SET is_active = 0 WHERE service_type = 'tts'").run();
  try {
    const items = [
      { characterName: '林深', text: '这里到底发生过什么？', storyboardId: 991001 },
      { characterName: '苏暖', text: '我不想再提起。', storyboardId: 991001 },
    ];

    const result = await ttsService.batchSynthesize(db, log, {
      dramaId: 1, episodeId: 10, items, userId: 1, storageBase: os.tmpdir(),
    });

    assert.ok(result.batchId);
    assert.equal(result.total, 2);
    assert.equal(result.success, 0);
    assert.equal(result.failed, 2);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].status, 'failed');

    // 批次记录落库
    const batchRow = db.prepare('SELECT * FROM tts_batch_jobs WHERE id = ?').get(result.batchId);
    assert.ok(batchRow);
    assert.equal(batchRow.status, 'failed');
    assert.equal(batchRow.total_count, 2);
    assert.equal(batchRow.failed_count, 2);
  } finally {
    // 恢复 TTS 配置激活状态
    db.prepare("UPDATE ai_service_configs SET is_active = 1 WHERE service_type = 'tts'").run();
    // 数据由 before/after 统一清理（真实 MySQL）
  }
});

test('S4-T03-5b: batchSynthesize 空台词列表 → 抛出错误', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  await assert.rejects(
    () => ttsService.batchSynthesize(db, log, { dramaId: 1, items: [] }),
    /台词列表不能为空/
  );

  // 数据由 before/after 统一清理（真实 MySQL）
});

// ---------- listDubbingByEpisode ----------

test('S4-T03-6: listDubbingByEpisode 查询', () => {
  const { db, dir } = makeDb();

  db.prepare(`INSERT INTO storyboard_dubbing
    (drama_id, episode_id, storyboard_id, character_name, dialogue_text, voice_id, emotion, audio_path, sort_order, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    1, 10, 1, '林深', '测试台词', 'male_deep', 'tense', 'audio/tts_test.mp3', 0, 'synthesized'
  );

  const list = ttsService.listDubbingByEpisode(db, 10);
  assert.equal(list.length, 1);
  assert.equal(list[0].characterName, '林深');
  assert.equal(list[0].voiceId, 'male_deep');
  assert.equal(list[0].audioPath, 'audio/tts_test.mp3');
  assert.equal(list[0].status, 'synthesized');

  // 数据由 before/after 统一清理（真实 MySQL）
});
