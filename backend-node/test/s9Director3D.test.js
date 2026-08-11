'use strict';

/**
 * s9Director3D.test.js
 * Sprint 9 - 3D导演台单元测试
 *
 * 覆盖范围：
 *   A. 后端 3D 字段校验（validate3DFields）
 *   B. 后端 canvas_layouts 表 3D 字段同步（sync3DFieldsToTable）
 *   C. 后端 saveCanvasLayout 完整流程（含3D字段持久化）
 *   D. 前端 canvasLayout.js 3D 工具函数（通过动态 import）
 *
 * 运行命令: cd backend-node && node --test test/s9Director3D.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');

/* ============================================================
 * A. validate3DFields 单元测试
 * ============================================================ */

describe('A. validate3DFields 3D字段校验', () => {
  const { _validate3DFields } = require('../src/services/dramaService');

  test('A1. 合法 view_mode=2d 通过', () => {
    const result = _validate3DFields({ view_mode: '2d' });
    assert.strictEqual(result.view_mode, '2d');
    assert.strictEqual(result.camera_3d, null);
    assert.strictEqual(result.camera_preset, null);
  });

  test('A2. 合法 view_mode=3d 通过', () => {
    const result = _validate3DFields({ view_mode: '3d' });
    assert.strictEqual(result.view_mode, '3d');
  });

  test('A3. 非法 view_mode 抛出 BAD_REQUEST', () => {
    assert.throws(
      () => _validate3DFields({ view_mode: '4d' }),
      (err) => err.code === 'BAD_REQUEST' && err.message.includes('view_mode')
    );
  });

  test('A4. view_mode=null 跳过校验（向后兼容）', () => {
    const result = _validate3DFields({});
    assert.strictEqual(result.view_mode, null);
  });

  test('A5. 合法 camera_preset=front 通过', () => {
    const result = _validate3DFields({ camera_preset: 'front' });
    assert.strictEqual(result.camera_preset, 'front');
  });

  test('A6. 合法 camera_preset=bird_view 通过', () => {
    const result = _validate3DFields({ camera_preset: 'bird_view' });
    assert.strictEqual(result.camera_preset, 'bird_view');
  });

  test('A7. 非法 camera_preset 抛出 BAD_REQUEST', () => {
    assert.throws(
      () => _validate3DFields({ camera_preset: 'invalid_preset' }),
      (err) => err.code === 'BAD_REQUEST' && err.message.includes('camera_preset')
    );
  });

  test('A8. 合法 camera_3d 对象通过', () => {
    const cam = {
      position: { x: 15, y: 10, z: 20 },
      target: { x: 0, y: 0, z: 0 },
      fov: 50,
      preset: 'free',
    };
    const result = _validate3DFields({ camera_3d: cam });
    assert.strictEqual(result.camera_3d.position.x, 15);
    assert.strictEqual(result.camera_3d.target.z, 0);
    assert.strictEqual(result.camera_3d.fov, 50);
    assert.strictEqual(result.camera_3d.preset, 'free');
  });

  test('A9. camera_3d 缺少 target 抛出 BAD_REQUEST', () => {
    assert.throws(
      () => _validate3DFields({ camera_3d: { position: { x: 1, y: 2, z: 3 } } }),
      (err) => err.code === 'BAD_REQUEST' && err.message.includes('target')
    );
  });

  test('A10. camera_3d.position 含 NaN 抛出 BAD_REQUEST', () => {
    assert.throws(
      () => _validate3DFields({
        camera_3d: {
          position: { x: 'abc', y: 2, z: 3 },
          target: { x: 0, y: 0, z: 0 },
        }
      }),
      (err) => err.code === 'BAD_REQUEST' && err.message.includes('有限数值')
    );
  });

  test('A11. camera_3d 非法 preset 规范化为 free', () => {
    const cam = {
      position: { x: 0, y: 0, z: 25 },
      target: { x: 0, y: 0, z: 0 },
      fov: 50,
      preset: 'invalid',
    };
    const result = _validate3DFields({ camera_3d: cam });
    assert.strictEqual(result.camera_3d.preset, 'free');
  });

  test('A12. camera_3d 缺少 fov 默认为 50', () => {
    const cam = {
      position: { x: 0, y: 0, z: 25 },
      target: { x: 0, y: 0, z: 0 },
    };
    const result = _validate3DFields({ camera_3d: cam });
    assert.strictEqual(result.camera_3d.fov, 50);
  });

  test('A13. nodes_3d 合法对象通过', () => {
    const nodes3D = {
      'node_1': { x: 10, y: 20, z: 100, layer: 'midground' },
      'node_2': { x: -5, y: 15, z: 200, layer: 'background' },
    };
    const result = _validate3DFields({ nodes_3d: nodes3D });
    assert.strictEqual(result.nodes_3d.node_1.x, 10);
    assert.strictEqual(result.nodes_3d.node_2.layer, 'background');
  });

  test('A14. nodes_3d 为数组抛出 BAD_REQUEST', () => {
    assert.throws(
      () => _validate3DFields({ nodes_3d: [] }),
      (err) => err.code === 'BAD_REQUEST' && err.message.includes('nodes_3d')
    );
  });

  test('A15. 空对象通过校验（全部字段为 null）', () => {
    const result = _validate3DFields({});
    assert.strictEqual(result.view_mode, null);
    assert.strictEqual(result.camera_3d, null);
    assert.strictEqual(result.camera_preset, null);
    assert.strictEqual(result.nodes_3d, null);
  });
});

/* ============================================================
 * B. sync3DFieldsToTable 单元测试（使用 SQLite 模拟）
 * ============================================================ */

function _createCanvasLayoutsTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // 模拟 canvas_layouts 表结构（与 MySQL migration 42 一致）
  db.exec(`
    CREATE TABLE canvas_layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL UNIQUE,
      viewport TEXT,
      nodes TEXT,
      zone_collapsed TEXT,
      view_mode TEXT NOT NULL DEFAULT '2d',
      camera_3d TEXT,
      camera_preset TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe('B. sync3DFieldsToTable canvas_layouts表同步', () => {
  const { _sync3DFieldsToTable } = require('../src/services/dramaService');

  test('B1. 首次写入3D布局（INSERT）', () => {
    const db = _createCanvasLayoutsTestDb();
    const fakeLog = { warn: () => {} };
    const layout = {
      viewport: { x: 10, y: 20, zoom: 0.75 },
      nodes: { node_1: { x: 100, y: 200 } },
      view_mode: '3d',
      camera_3d: { position: { x: 15, y: 10, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 50, preset: 'free' },
      camera_preset: 'free',
    };
    _sync3DFieldsToTable(db, 99001, layout, fakeLog);

    const row = db.prepare('SELECT * FROM canvas_layouts WHERE drama_id = ?').get(99001);
    assert.ok(row);
    assert.strictEqual(row.view_mode, '3d');
    assert.strictEqual(row.camera_preset, 'free');
    const cam3D = JSON.parse(row.camera_3d);
    assert.strictEqual(cam3D.position.x, 15);
    assert.strictEqual(cam3D.target.z, 0);
    db.close();
  });

  test('B2. 重复写入触发 ON CONFLICT UPDATE（UPSERT）', () => {
    const db = _createCanvasLayoutsTestDb();
    const fakeLog = { warn: () => {} };

    // 第一次写入
    _sync3DFieldsToTable(db, 99002, {
      view_mode: '2d',
      camera_preset: null,
    }, fakeLog);

    // 第二次写入（更新）
    _sync3DFieldsToTable(db, 99002, {
      view_mode: '3d',
      camera_3d: { position: { x: 0, y: 30, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 60, preset: 'top' },
      camera_preset: 'top',
    }, fakeLog);

    const rows = db.prepare('SELECT * FROM canvas_layouts WHERE drama_id = ?').all(99002);
    assert.strictEqual(rows.length, 1); // 不应产生重复行
    assert.strictEqual(rows[0].view_mode, '3d');
    assert.strictEqual(rows[0].camera_preset, 'top');
    db.close();
  });

  test('B3. view_mode 缺失时默认 2d', () => {
    const db = _createCanvasLayoutsTestDb();
    const fakeLog = { warn: () => {} };
    _sync3DFieldsToTable(db, 99003, {
      viewport: { x: 0, y: 0, zoom: 1 },
    }, fakeLog);

    const row = db.prepare('SELECT view_mode FROM canvas_layouts WHERE drama_id = ?').get(99003);
    assert.strictEqual(row.view_mode, '2d');
    db.close();
  });

  test('B4. camera_preset 从 camera_3d.preset 推断', () => {
    const db = _createCanvasLayoutsTestDb();
    const fakeLog = { warn: () => {} };
    _sync3DFieldsToTable(db, 99004, {
      view_mode: '3d',
      camera_3d: { position: { x: 0, y: 0, z: 25 }, target: { x: 0, y: 0, z: 0 }, fov: 50, preset: 'front' },
      // camera_preset 不直接提供
    }, fakeLog);

    const row = db.prepare('SELECT camera_preset FROM canvas_layouts WHERE drama_id = ?').get(99004);
    assert.strictEqual(row.camera_preset, 'front');
    db.close();
  });

  test('B5. camera_3d 为 null 时 camera_preset 也为 null', () => {
    const db = _createCanvasLayoutsTestDb();
    const fakeLog = { warn: () => {} };
    _sync3DFieldsToTable(db, 99005, {
      view_mode: '2d',
    }, fakeLog);

    const row = db.prepare('SELECT camera_3d, camera_preset FROM canvas_layouts WHERE drama_id = ?').get(99005);
    assert.strictEqual(row.camera_3d, null);
    assert.strictEqual(row.camera_preset, null);
    db.close();
  });
});

/* ============================================================
 * C. saveCanvasLayout 完整流程测试（含3D字段持久化）
 * ============================================================ */

function _createDramaTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT, genre TEXT, style TEXT, status TEXT DEFAULT 'draft',
      total_episodes INTEGER, total_duration INTEGER, thumbnail TEXT, tags TEXT,
      metadata TEXT, created_by INTEGER, enterprise_id INTEGER, team_id INTEGER,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE canvas_layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL UNIQUE,
      viewport TEXT,
      nodes TEXT,
      zone_collapsed TEXT,
      view_mode TEXT NOT NULL DEFAULT '2d',
      camera_3d TEXT,
      camera_preset TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- getDrama() 关联查询所需的最小表集（空表即可，避免 SQLITE_ERROR）
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER, title TEXT, episode_number INTEGER,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER, storyboard_number INTEGER,
      duration INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER, prop_id INTEGER
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER, name TEXT, sort_order INTEGER,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE episode_characters (
      episode_id INTEGER, character_id INTEGER
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER, episode_id INTEGER,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER, episode_id INTEGER,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO dramas (id, title, metadata, created_at, updated_at) VALUES
      (99001, '测试短剧-3D', '{}', '2026-08-11 00:00:00', '2026-08-11 00:00:00');
  `);
  return db;
}

describe('C. saveCanvasLayout 完整流程（含3D字段）', () => {
  const dramaService = require('../src/services/dramaService');

  test('C1. 保存含3D字段的布局 → metadata.canvas_layout 包含 view_mode/camera_3d', () => {
    const db = _createDramaTestDb();
    const log = {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const layout = {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 0.75 },
      nodes: { 'sb_1': { x: 100, y: 200 } },
      view_mode: '3d',
      camera_3d: {
        position: { x: 15, y: 10, z: 20 },
        target: { x: 0, y: 0, z: 0 },
        fov: 50,
        preset: 'free',
      },
      camera_preset: 'free',
      nodes_3d: {
        'sb_1': { x: 100, y: 200, z: 100, layer: 'midground' },
      },
    };

    const result = dramaService.saveCanvasLayout(db, log, 99001, { canvas_layout: layout });
    assert.ok(result);

    // 验证 metadata.canvas_layout 包含3D字段
    const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(99001);
    const meta = JSON.parse(drama.metadata);
    assert.ok(meta.canvas_layout);
    assert.strictEqual(meta.canvas_layout.view_mode, '3d');
    assert.strictEqual(meta.canvas_layout.camera_preset, 'free');
    assert.strictEqual(meta.canvas_layout.camera_3d.position.x, 15);
    assert.strictEqual(meta.canvas_layout.nodes_3d.sb_1.z, 100);

    // 验证 canvas_layouts 表也同步了3D字段
    const clRow = db.prepare('SELECT * FROM canvas_layouts WHERE drama_id = ?').get(99001);
    assert.ok(clRow);
    assert.strictEqual(clRow.view_mode, '3d');
    assert.strictEqual(clRow.camera_preset, 'free');

    db.close();
  });

  test('C2. 保存仅2D布局 → view_mode 默认为 2d，camera_3d 为 null', () => {
    const db = _createDramaTestDb();
    const log = { info: () => {}, warn: () => {}, error: () => {} };

    const layout = {
      version: 2,
      viewport: { x: 10, y: 20, zoom: 0.5 },
      nodes: { 'sb_1': { x: 50, y: 60 } },
    };

    dramaService.saveCanvasLayout(db, log, 99001, { canvas_layout: layout });

    const clRow = db.prepare('SELECT * FROM canvas_layouts WHERE drama_id = ?').get(99001);
    assert.strictEqual(clRow.view_mode, '2d');
    assert.strictEqual(clRow.camera_3d, null);
    db.close();
  });

  test('C3. 非法 view_mode 抛出 BAD_REQUEST 不写入', () => {
    const db = _createDramaTestDb();
    const log = { info: () => {}, warn: () => {}, error: () => {} };

    assert.throws(
      () => dramaService.saveCanvasLayout(db, log, 99001, {
        canvas_layout: { view_mode: 'invalid' }
      }),
      (err) => err.code === 'BAD_REQUEST'
    );

    // 确认未写入
    const clRow = db.prepare('SELECT * FROM canvas_layouts WHERE drama_id = ?').get(99001);
    assert.strictEqual(clRow, undefined);
    db.close();
  });

  test('C4. 更新已有3D布局 → camera_preset 正确更新', () => {
    const db = _createDramaTestDb();
    const log = { info: () => {}, warn: () => {}, error: () => {} };

    // 第一次保存：free 机位
    dramaService.saveCanvasLayout(db, log, 99001, {
      canvas_layout: {
        viewport: { x: 0, y: 0, zoom: 1 },
        view_mode: '3d',
        camera_3d: { position: { x: 15, y: 10, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 50, preset: 'free' },
        camera_preset: 'free',
      }
    });

    // 第二次保存：切换到 top 机位
    dramaService.saveCanvasLayout(db, log, 99001, {
      canvas_layout: {
        viewport: { x: 0, y: 0, zoom: 1 },
        view_mode: '3d',
        camera_3d: { position: { x: 0, y: 30, z: 0.01 }, target: { x: 0, y: 0, z: 0 }, fov: 50, preset: 'top' },
        camera_preset: 'top',
      }
    });

    const clRow = db.prepare('SELECT camera_preset, camera_3d FROM canvas_layouts WHERE drama_id = ?').get(99001);
    assert.strictEqual(clRow.camera_preset, 'top');
    const cam3D = JSON.parse(clRow.camera_3d);
    assert.strictEqual(cam3D.preset, 'top');
    assert.strictEqual(cam3D.position.y, 30);
    db.close();
  });
});

/* ============================================================
 * D. 前端 canvasLayout.js 3D 工具函数测试
 *    通过动态 import 加载 ES 模块
 * ============================================================ */

describe('D. 前端 canvasLayout.js 3D工具函数', () => {
  let canvasLayout;

  before(async () => {
    const modulePath = path.resolve(__dirname, '../../front-user/src/utils/canvasLayout.js');
    canvasLayout = await import('file://' + modulePath);
  });

  test('D1. resolveViewMode 返回已保存的 3d', () => {
    const layout = { view_mode: '3d' };
    assert.strictEqual(canvasLayout.resolveViewMode(layout), '3d');
  });

  test('D2. resolveViewMode 无字段时返回默认 2d', () => {
    assert.strictEqual(canvasLayout.resolveViewMode({}), '2d');
    assert.strictEqual(canvasLayout.resolveViewMode(null), '2d');
  });

  test('D3. resolveViewMode 非法值返回 fallback', () => {
    assert.strictEqual(canvasLayout.resolveViewMode({ view_mode: '4d' }), '2d');
  });

  test('D4. resolveCamera3D 返回完整摄像机状态', () => {
    const layout = {
      camera_3d: {
        position: { x: 15, y: 10, z: 20 },
        target: { x: 0, y: 0, z: 0 },
        fov: 50,
        preset: 'free',
      }
    };
    const cam = canvasLayout.resolveCamera3D(layout);
    assert.strictEqual(cam.position.x, 15);
    assert.strictEqual(cam.target.z, 0);
    assert.strictEqual(cam.fov, 50);
    assert.strictEqual(cam.preset, 'free');
  });

  test('D5. resolveCamera3D 缺少 position 返回 fallback', () => {
    const layout = { camera_3d: { target: { x: 0, y: 0, z: 0 } } };
    assert.strictEqual(canvasLayout.resolveCamera3D(layout, 'fallback'), 'fallback');
  });

  test('D6. resolveCamera3D null 布局返回 fallback', () => {
    assert.strictEqual(canvasLayout.resolveCamera3D(null, null), null);
  });

  test('D7. resolveCameraPreset 返回已保存机位', () => {
    assert.strictEqual(canvasLayout.resolveCameraPreset({ camera_preset: 'front' }), 'front');
    assert.strictEqual(canvasLayout.resolveCameraPreset({ camera_preset: 'bird_view' }), 'bird_view');
  });

  test('D8. resolveCameraPreset 非法值返回 fallback', () => {
    assert.strictEqual(canvasLayout.resolveCameraPreset({ camera_preset: 'invalid' }), 'free');
  });

  test('D9. resolveNode3DPosition 使用已保存的 z 深度', () => {
    const layout = {
      nodes: {
        'sb_1': { x: 100, y: 200, z: 150, layer: 'midground' },
      }
    };
    const pos = canvasLayout.resolveNode3DPosition(layout, 'sb_1', 'storyboard', { x: 0, y: 0 });
    assert.strictEqual(pos.x, 100);
    assert.strictEqual(pos.y, 200);
    assert.strictEqual(pos.z, 150);
    assert.strictEqual(pos.layer, 'midground');
  });

  test('D10. resolveNode3DPosition 无 z 时按节点类型取默认深度', () => {
    const layout = { nodes: { 'scene_1': { x: 50, y: 60 } } };
    const pos = canvasLayout.resolveNode3DPosition(layout, 'scene_1', 'scene', { x: 0, y: 0 });
    assert.strictEqual(pos.z, 200); // scene 默认深度 200
    assert.strictEqual(pos.layer, 'background');
  });

  test('D11. resolveNode3DPosition 节点不存在时使用 fallback2D + 默认深度', () => {
    const pos = canvasLayout.resolveNode3DPosition(null, 'unknown', 'character', { x: 30, y: 40 });
    assert.strictEqual(pos.x, 30);
    assert.strictEqual(pos.y, 40);
    assert.strictEqual(pos.z, 80); // character 默认深度 80
    assert.strictEqual(pos.layer, 'midground');
  });

  test('D12. build3DLayoutPayload 构建完整3D布局', () => {
    const payload = canvasLayout.build3DLayoutPayload({
      camera3D: {
        position: { x: 15, y: 10, z: 20 },
        target: { x: 0, y: 0, z: 0 },
        fov: 50,
        preset: 'free',
      },
      nodes3D: {
        'sb_1': { x: 100, y: 200, z: 100, layer: 'midground' },
        'char_1': { x: 50, y: 60, z: 80, layer: 'midground' },
      },
      viewMode: '3d',
    });

    assert.strictEqual(payload.view_mode, '3d');
    assert.strictEqual(payload.camera_3d.position.x, 15);
    assert.strictEqual(payload.camera_preset, 'free');
    assert.strictEqual(payload.nodes_3d.sb_1.z, 100);
    assert.strictEqual(payload.nodes_3d.char_1.layer, 'midground');
  });

  test('D13. build3DLayoutPayload 继承已有2D字段', () => {
    const existing = {
      viewport: { x: 10, y: 20, zoom: 0.75 },
      nodes: { 'sb_1': { x: 100, y: 200 } },
      zone_collapsed: { characters: true },
    };
    const payload = canvasLayout.build3DLayoutPayload({
      camera3D: null,
      nodes3D: {},
      viewMode: '3d',
    }, existing);

    assert.ok(payload.viewport);
    assert.strictEqual(payload.viewport.x, 10);
    assert.ok(payload.nodes);
    assert.ok(payload.zone_collapsed);
  });

  test('D14. merge3DFieldsIntoPayload 合并3D字段到2D payload', () => {
    const payload = {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 0.75 },
      nodes: { 'sb_1': { x: 100, y: 200 } },
    };
    const layout3D = {
      view_mode: '3d',
      camera_3d: { position: { x: 15, y: 10, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 50, preset: 'free' },
      camera_preset: 'free',
      nodes_3d: { 'sb_1': { x: 100, y: 200, z: 100, layer: 'midground' } },
    };
    const merged = canvasLayout.merge3DFieldsIntoPayload(payload, layout3D);

    // 2D 字段保留
    assert.strictEqual(merged.version, 2);
    assert.ok(merged.viewport);
    assert.ok(merged.nodes);
    // 3D 字段合并
    assert.strictEqual(merged.view_mode, '3d');
    assert.strictEqual(merged.camera_preset, 'free');
    assert.strictEqual(merged.nodes_3d.sb_1.z, 100);
  });

  test('D15. merge3DFieldsIntoPayload 非法 view_mode 不合并', () => {
    const payload = { version: 2 };
    const layout3D = { view_mode: 'invalid' };
    const merged = canvasLayout.merge3DFieldsIntoPayload(payload, layout3D);
    assert.strictEqual(merged.view_mode, undefined);
  });

  test('D16. NODE_DEPTH_DEFAULTS 常量正确', () => {
    assert.strictEqual(canvasLayout.NODE_DEPTH_DEFAULTS.scene, 200);
    assert.strictEqual(canvasLayout.NODE_DEPTH_DEFAULTS.storyboard, 100);
    assert.strictEqual(canvasLayout.NODE_DEPTH_DEFAULTS.character, 80);
    assert.strictEqual(canvasLayout.NODE_DEPTH_DEFAULTS.prop, 50);
    assert.strictEqual(canvasLayout.NODE_DEPTH_DEFAULTS.episode, 250);
  });

  test('D17. NODE_LAYER_DEFAULTS 常量正确', () => {
    assert.strictEqual(canvasLayout.NODE_LAYER_DEFAULTS.scene, 'background');
    assert.strictEqual(canvasLayout.NODE_LAYER_DEFAULTS.storyboard, 'midground');
    assert.strictEqual(canvasLayout.NODE_LAYER_DEFAULTS.character, 'midground');
    assert.strictEqual(canvasLayout.NODE_LAYER_DEFAULTS.prop, 'foreground');
  });

  test('D18. VIEW_MODE 常量正确', () => {
    assert.strictEqual(canvasLayout.VIEW_MODE.MODE_2D, '2d');
    assert.strictEqual(canvasLayout.VIEW_MODE.MODE_3D, '3d');
  });
});
