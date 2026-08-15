// ============================================================
// libraryDedup.test.js — 素材库去重（幂等性）测试
// 覆盖：角色/场景/道具加入项目库与全局素材库时幂等（重复添加不产生重复记录）
//
// 说明：所有测试数据真实写入 MySQL（configs/config.yaml），
//       不使用 mock 数据、不使用 SQLite。测试数据使用高位 ID
//       （99xxxx）隔离真实数据，beforeEach 清理。
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

const characterLibraryService = require('../src/services/characterLibraryService');
const sceneLibraryService = require('../src/services/sceneLibraryService');
const propLibraryService = require('../src/services/propLibraryService');

const log = {
  info() {},
  warn() {},
  error() {},
};

const TEST_DRAMA = 99001;
const TEST_ID = 996001;

function db() {
  return getDb(loadConfig().database);
}

// 清理本测试产生的数据（高位 ID 区间）
function cleanup() {
  const d = db();
  d.prepare('DELETE FROM character_libraries WHERE drama_id = ? OR source_id = ?').run(TEST_DRAMA, String(TEST_ID));
  d.prepare('DELETE FROM scene_libraries WHERE drama_id = ? OR source_id = ?').run(TEST_DRAMA, String(TEST_ID));
  d.prepare('DELETE FROM prop_libraries WHERE drama_id = ? OR source_id = ?').run(TEST_DRAMA, String(TEST_ID));
  d.prepare('DELETE FROM characters WHERE id = ?').run(TEST_ID);
  d.prepare('DELETE FROM scenes WHERE id = ?').run(TEST_ID);
  d.prepare('DELETE FROM props WHERE id = ?').run(TEST_ID);
  d.prepare('DELETE FROM dramas WHERE id = ?').run(TEST_DRAMA);
}

// seed 测试项目
function seedDrama() {
  db().prepare('INSERT INTO dramas (id, title) VALUES (?, ?)').run(TEST_DRAMA, 'Test drama');
}

function countRows(db, table, where) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
}

test.beforeEach(() => { cleanup(); seedDrama(); });
test.after(() => { cleanup(); closeDb(); });

test('adding the same character to drama and material libraries is idempotent', () => {
  const d = db();
  d.prepare(
    'INSERT INTO characters (id, drama_id, name, description, image_url, local_path) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(TEST_ID, TEST_DRAMA, 'Hero', 'original', '/static/projects/hero.png', 'projects/hero.png');

  const firstDrama = characterLibraryService.addCharacterToLibrary(d, log, TEST_ID);
  d.prepare('UPDATE characters SET name = ?, description = ? WHERE id = ?').run('Hero updated', 'updated', TEST_ID);
  const secondDrama = characterLibraryService.addCharacterToLibrary(d, log, TEST_ID);
  const firstMaterial = characterLibraryService.addCharacterToMaterialLibrary(d, log, TEST_ID);
  const secondMaterial = characterLibraryService.addCharacterToMaterialLibrary(d, log, TEST_ID);

  assert.equal(firstDrama.item.id, secondDrama.item.id);
  assert.equal(firstMaterial.item.id, secondMaterial.item.id);
  assert.equal(countRows(d, 'character_libraries', `drama_id = ${TEST_DRAMA} AND deleted_at IS NULL`), 1);
  assert.equal(
    countRows(d, 'character_libraries', `drama_id IS NULL AND source_id = '${TEST_ID}' AND deleted_at IS NULL`),
    1
  );
  assert.equal(secondDrama.item.name, 'Hero updated');
  assert.equal(
    d.prepare('SELECT source_id FROM character_libraries WHERE id = ?').get(secondDrama.item.id).source_id,
    String(TEST_ID)
  );
});

test('adding the same scene to drama and material libraries is idempotent', () => {
  const d = db();
  d.prepare(
    'INSERT INTO scenes (id, drama_id, location, time, prompt, image_url, local_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(TEST_ID, TEST_DRAMA, 'Village', 'day', 'quiet street', '/static/projects/village.png', 'projects/village.png');

  const firstDrama = sceneLibraryService.addSceneToLibrary(d, log, TEST_ID);
  d.prepare('UPDATE scenes SET location = ?, prompt = ? WHERE id = ?').run('Village updated', 'busy street', TEST_ID);
  const secondDrama = sceneLibraryService.addSceneToLibrary(d, log, TEST_ID);
  const firstMaterial = sceneLibraryService.addSceneToMaterialLibrary(d, log, TEST_ID);
  const secondMaterial = sceneLibraryService.addSceneToMaterialLibrary(d, log, TEST_ID);

  assert.equal(firstDrama.item.id, secondDrama.item.id);
  assert.equal(firstMaterial.item.id, secondMaterial.item.id);
  assert.equal(countRows(d, 'scene_libraries', `drama_id = ${TEST_DRAMA} AND deleted_at IS NULL`), 1);
  assert.equal(
    countRows(d, 'scene_libraries', `drama_id IS NULL AND source_id = '${TEST_ID}' AND deleted_at IS NULL`),
    1
  );
  assert.equal(secondDrama.item.location, 'Village updated');
  assert.equal(
    d.prepare('SELECT source_id FROM scene_libraries WHERE id = ?').get(secondDrama.item.id).source_id,
    String(TEST_ID)
  );
});

test('adding the same prop to drama and material libraries is idempotent', () => {
  const d = db();
  d.prepare(
    'INSERT INTO props (id, drama_id, name, description, prompt, image_url, local_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(TEST_ID, TEST_DRAMA, 'Sword', 'old blade', 'silver sword', '/static/projects/sword.png', 'projects/sword.png');

  const firstDrama = propLibraryService.addPropToLibrary(d, log, TEST_ID);
  d.prepare('UPDATE props SET name = ?, description = ? WHERE id = ?').run('Sword updated', 'polished blade', TEST_ID);
  const secondDrama = propLibraryService.addPropToLibrary(d, log, TEST_ID);
  const firstMaterial = propLibraryService.addPropToMaterialLibrary(d, log, TEST_ID);
  const secondMaterial = propLibraryService.addPropToMaterialLibrary(d, log, TEST_ID);

  assert.equal(firstDrama.item.id, secondDrama.item.id);
  assert.equal(firstMaterial.item.id, secondMaterial.item.id);
  assert.equal(countRows(d, 'prop_libraries', `drama_id = ${TEST_DRAMA} AND deleted_at IS NULL`), 1);
  assert.equal(
    countRows(d, 'prop_libraries', `drama_id IS NULL AND source_id = '${TEST_ID}' AND deleted_at IS NULL`),
    1
  );
  assert.equal(secondDrama.item.name, 'Sword updated');
  assert.equal(
    d.prepare('SELECT source_id FROM prop_libraries WHERE id = ?').get(secondDrama.item.id).source_id,
    String(TEST_ID)
  );
});
