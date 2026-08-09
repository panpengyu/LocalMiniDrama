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

const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4tts-'));
  const dbFile = path.join(dir, 'test.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE character_voice_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT NOT NULL,
      character_id BIGINT NOT NULL,
      character_name VARCHAR(128),
      voice_id VARCHAR(128) NOT NULL,
      voice_name VARCHAR(128),
      provider VARCHAR(64) DEFAULT 'openai',
      emotion VARCHAR(32) DEFAULT 'neutral',
      speed DECIMAL(3,2) DEFAULT 1.00,
      pitch INT DEFAULT 0,
      language VARCHAR(16) DEFAULT 'zh',
      is_default TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(drama_id, character_id)
    );
    CREATE TABLE tts_batch_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT, episode_id BIGINT, user_id BIGINT,
      status VARCHAR(32) DEFAULT 'pending',
      total_count INT DEFAULT 0, success_count INT DEFAULT 0, failed_count INT DEFAULT 0,
      items_json TEXT, error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE storyboard_dubbing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT, episode_id BIGINT, storyboard_id BIGINT,
      character_id BIGINT, character_name VARCHAR(128),
      dialogue_text TEXT, voice_id VARCHAR(128),
      emotion VARCHAR(32) DEFAULT 'neutral',
      audio_path VARCHAR(512), duration_ms INT DEFAULT 0,
      sort_order INT DEFAULT 0, status VARCHAR(32) DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id BIGINT, storyboard_number INT,
      title VARCHAR(255), dialogue TEXT, narration TEXT,
      deleted_at DATETIME
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id BIGINT, deleted_at DATETIME
    );
  `);
  return { db, dir };
}

function makeLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const ttsService = require('../src/services/ttsService');

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

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
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

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 台词提取 ----------

test('S4-T03-3: 台词提取 extractDialogues（"角色名:台词"格式 + 旁白兜底）', () => {
  const { db, dir } = makeDb();

  // 插入分镜数据
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, dialogue, deleted_at) VALUES
    (1, 10, 1, '林深:这里到底发生过什么？\n苏暖:(低下头)我…我不想再提起。', NULL),
    (2, 10, 2, '夜色渐深，城市灯火通明。', NULL),
    (3, 10, 3, '', NULL)`).run();

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

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T03-3b: 台词提取按 dramaId 查询（通过 episodes 表关联）', () => {
  const { db, dir } = makeDb();

  db.prepare(`INSERT INTO episodes (id, drama_id, deleted_at) VALUES (10, 500, NULL), (11, 501, NULL)`).run();
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, dialogue, deleted_at) VALUES
    (1, 10, 1, '角色A:台词一', NULL),
    (2, 11, 1, '角色B:台词二', NULL)`).run();

  const items = ttsService.extractDialogues(db, { dramaId: 500 });
  assert.equal(items.length, 1);
  assert.equal(items[0].characterName, '角色A');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
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

  const items = [
    { characterName: '林深', text: '这里到底发生过什么？', storyboardId: 1 },
    { characterName: '苏暖', text: '我不想再提起。', storyboardId: 1 },
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

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('S4-T03-5b: batchSynthesize 空台词列表 → 抛出错误', async () => {
  const { db, dir } = makeDb();
  const log = makeLog();

  await assert.rejects(
    () => ttsService.batchSynthesize(db, log, { dramaId: 1, items: [] }),
    /台词列表不能为空/
  );

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
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

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
