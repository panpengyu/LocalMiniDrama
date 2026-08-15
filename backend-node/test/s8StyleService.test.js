'use strict';

/**
 * s8StyleService.test.js
 * Sprint 8 - S8-T01/T02: 风格配置系统 + 风格统一引擎 单元测试
 *
 * 使用 SQLite in-memory 数据库，测试环境独立
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

/**
 * 使用真实 MySQL 数据库（configs/config.yaml），测试数据以高位 ID 隔离。
 * 不使用 mock、不使用 SQLite。
 */
function createTestDb() {
  const db = getDb(loadConfig().database);
  // 清理本测试可能残留的数据（高位 ID 区间）
  db.prepare('DELETE FROM style_configs WHERE drama_id >= 99000').run();
  db.prepare('DELETE FROM dramas WHERE id >= 99000').run();
  // 种子数据（与真实数据 id 区间隔离）
  db.prepare('INSERT INTO dramas (id, title, style, created_by) VALUES (?, ?, ?, ?)')
    .run(99001, '测试短剧A', 'anime', 99000);
  db.prepare('INSERT INTO dramas (id, title, style, created_by) VALUES (?, ?, ?, ?)')
    .run(99002, '测试短剧B', 'realistic', 99000);
  db.prepare('INSERT INTO dramas (id, title, style, created_by) VALUES (?, ?, ?, ?)')
    .run(99003, '测试短剧C', null, 99000);
  return db;
}

const styleService = require('../src/services/styleService');

describe('S8-T01: 风格配置系统 CRUD', () => {
  let db;

  before(() => { db = createTestDb(); });
  after(() => { closeDb(); });

  test('1. 创建风格配置 — 正常流程', () => {
    const config = styleService.createStyleConfig(db, {
      drama_id: 99001,
      global_style: 'anime',
      color_palette: ['#FF6B6B', '#4ECDC4', '#FFE66D'],
      line_weight: 'medium',
      shading_style: 'cel-shading',
      composition_rule: 'rule-of-thirds',
      created_by: 99000,
    });
    assert.ok(config.id);
    assert.strictEqual(config.drama_id, 99001);
    assert.strictEqual(config.global_style, 'anime');
    assert.deepStrictEqual(config.color_palette, ['#FF6B6B', '#4ECDC4', '#FFE66D']);
    assert.strictEqual(config.is_active, true);
  });

  test('2. 获取风格配置', () => {
    const config = styleService.getStyleConfig(db, 99001);
    assert.ok(config);
    assert.strictEqual(config.global_style, 'anime');
  });

  test('3. 创建风格配置 — drama_id 为空应报错', () => {
    assert.throws(() => {
      styleService.createStyleConfig(db, { global_style: 'anime' });
    }, /drama_id/);
  });

  test('4. 创建风格配置 — global_style 非法值应报错', () => {
    assert.throws(() => {
      styleService.createStyleConfig(db, { drama_id: 99002, global_style: 'invalid_style' });
    }, /global_style/);
  });

  test('5. 创建风格配置 — line_weight 非法值应报错', () => {
    assert.throws(() => {
      styleService.createStyleConfig(db, { drama_id: 99002, line_weight: 'extra_thick' });
    }, /line_weight/);
  });

  test('6. 创建风格配置 — 重复创建应报错', () => {
    assert.throws(() => {
      styleService.createStyleConfig(db, { drama_id: 99001, global_style: 'anime' });
    }, /已有风格配置/);
  });

  test('7. 更新风格配置 — 修改 global_style 和 color_palette', () => {
    const updated = styleService.updateStyleConfig(db, 99001, {
      global_style: 'cinematic',
      color_palette: ['#1a1a2e', '#16213e'],
    });
    assert.strictEqual(updated.global_style, 'cinematic');
    assert.deepStrictEqual(updated.color_palette, ['#1a1a2e', '#16213e']);
  });

  test('8. 更新风格配置 — 不存在的项目应报错', () => {
    assert.throws(() => {
      styleService.updateStyleConfig(db, 99999, { global_style: 'anime' });
    }, /无风格配置/);
  });

  test('9. 更新风格配置 — 禁用风格统一', () => {
    const updated = styleService.updateStyleConfig(db, 99001, { is_active: false });
    assert.strictEqual(updated.is_active, false);
  });

  test('10. 获取风格概要', () => {
    // 先重新启用
    styleService.updateStyleConfig(db, 99001, { is_active: true });
    const summary = styleService.getStyleSummary(db, 99001);
    assert.ok(summary);
    assert.strictEqual(summary.global_style, 'cinematic');
    assert.strictEqual(summary.is_active, true);
    assert.ok(Array.isArray(summary.color_palette));
  });

  test('11. 删除风格配置', () => {
    const deleted = styleService.deleteStyleConfig(db, 99001);
    assert.strictEqual(deleted, true);
    const config = styleService.getStyleConfig(db, 99001);
    assert.strictEqual(config, null);
  });

  test('12. 删除不存在的风格配置', () => {
    const deleted = styleService.deleteStyleConfig(db, 99999);
    assert.strictEqual(deleted, false);
  });
});

describe('S8-T02: 风格统一引擎 — 提示词注入', () => {
  let db;

  before(() => {
    db = createTestDb();
    styleService.createStyleConfig(db, {
      drama_id: 99001,
      global_style: 'anime',
      color_palette: ['#FF6B6B', '#4ECDC4'],
      line_weight: 'medium',
      shading_style: 'cel-shading',
      composition_rule: 'rule-of-thirds',
      created_by: 99000,
    });
  });
  after(() => { closeDb(); });

  test('13. injectStyleToPrompt — 无风格配置时返回原始 prompt', () => {
    const result = styleService.injectStyleToPrompt(db, 99999, 'a girl standing');
    assert.strictEqual(result, 'a girl standing');
  });

  test('14. injectStyleToPrompt — 禁用时返回原始 prompt', () => {
    styleService.updateStyleConfig(db, 99001, { is_active: false });
    const result = styleService.injectStyleToPrompt(db, 99001, 'a girl standing');
    assert.strictEqual(result, 'a girl standing');
    styleService.updateStyleConfig(db, 99001, { is_active: true });
  });

  test('15. injectStyleToPrompt — 正常注入风格参数', () => {
    const result = styleService.injectStyleToPrompt(db, 99001, 'a girl standing');
    assert.ok(result.includes('a girl standing'));
    assert.ok(result.includes('anime style'));
    assert.ok(result.includes('medium line weight'));
    assert.ok(result.includes('cel shading'));
    assert.ok(result.includes('rule of thirds'));
    assert.ok(result.includes('color palette'));
  });

  test('16. injectStyleToPrompt — 空 prompt 也能注入风格', () => {
    const result = styleService.injectStyleToPrompt(db, 99001, '');
    assert.ok(result.includes('anime style'));
    assert.ok(!result.startsWith(','));
  });

  test('17. injectStyleToPrompt — 角色覆盖生效', () => {
    styleService.updateStyleConfig(db, 99001, {
      character_overrides: [{ id: 42, style: 'realistic' }],
    });
    const result = styleService.injectStyleToPrompt(db, 99001, 'a hero', { characterId: 42 });
    assert.ok(result.includes('realistic'));
    assert.ok(!result.includes('anime style'));
  });

  test('18. injectStyleToPrompt — 场景覆盖生效', () => {
    styleService.updateStyleConfig(db, 99001, {
      scene_overrides: [{ id: 7, style: 'watercolor' }],
    });
    const result = styleService.injectStyleToPrompt(db, 99001, 'a castle', { sceneId: 7 });
    assert.ok(result.includes('watercolor'));
  });

  test('19. buildNegativePrompt — 无配置时返回原始值', () => {
    const result = styleService.buildNegativePrompt(db, 99999, 'blurry, low quality');
    assert.strictEqual(result, 'blurry, low quality');
  });

  test('20. buildNegativePrompt — 追加风格统一负面词', () => {
    styleService.updateStyleConfig(db, 99001, {
      negative_prompt_suffix: 'deformed hands',
      is_active: true,
    });
    const result = styleService.buildNegativePrompt(db, 99001, 'blurry');
    assert.ok(result.includes('blurry'));
    assert.ok(result.includes('deformed hands'));
    assert.ok(result.includes('inconsistent style'));
  });

  test('21. buildNegativePrompt — 无原始负面词也能构建', () => {
    const result = styleService.buildNegativePrompt(db, 99001, null);
    assert.ok(result.includes('inconsistent style'));
  });
});
