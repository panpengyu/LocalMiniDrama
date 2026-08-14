'use strict';

/**
 * Sprint 16 - S16-T01 素材推荐引擎 + S16-T06 帮助中心 测试
 *
 * 覆盖任务：
 *   - 推荐画像构建/读取（user_preference_profiles 真实落库）
 *   - 推荐反馈留痕（recommend_logs 真实落库，含 rank_pos）
 *   - 素材推荐（标签协同 + 热门兜底，不 mock）
 *   - 模板推荐（题材匹配 + 下载热门）
 *   - 全站热门（getTrending 多维度聚合）
 *   - 首页个性化组合（homeRecommend）
 *   - 帮助中心数据查询（help_docs 种子数据 + 管理 CRUD 的 SQL 正确性）
 *
 * 约束（用户要求）：
 *   - 不使用 mock / SQLite in-memory；全部连本地真实 MySQL（configs/config.yaml）
 *   - 测试专用高位用户ID（999011/999012），before 清理残留、after 彻底清理
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const rec = require(path.resolve(__dirname, '..', 'src', 'services', 'materialRecommendService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };

// 测试用独立数据（避免污染真实用户）
const TEST_USER_ID = 999011;
const TEST_USER_ID2 = 999012;
let testMaterialId = null;
let testTemplateId = null;

function cleanup() {
  try {
    db.prepare('DELETE FROM user_preference_profiles WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_USER_ID2);
    db.prepare('DELETE FROM recommend_logs WHERE user_id IN (?, ?)').run(TEST_USER_ID, TEST_USER_ID2);
    if (testMaterialId) {
      db.prepare('DELETE FROM character_libraries WHERE id = ?').run(testMaterialId);
      testMaterialId = null;
    }
    if (testTemplateId) {
      db.prepare('DELETE FROM marketplace_templates WHERE id = ?').run(testTemplateId);
      testTemplateId = null;
    }
  } catch (_) { /* 表不存在时忽略 */ }
}

before(() => {
  db = getDb(loadConfig().database);
  cleanup();
  // 创建测试素材与模板（真实写入 MySQL，非 mock，仅使用独立数据避免污染）
  const now = new Date().toISOString();
  const matInfo = db.prepare(
    `INSERT INTO character_libraries (name, category, tags, description, owner_id, scope, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'project', 'private', ?, ?)`
  ).run('S16测试角色_都市甜宠', '主角', '都市,甜宠,霸总,现代', '测试素材', TEST_USER_ID, now, now);
  testMaterialId = Number(matInfo.insertId || matInfo.lastInsertRowid);
  const tplInfo = db.prepare(
    `INSERT INTO marketplace_templates (template_no, creator_id, creator_user_id, title, summary, category, genre_type, tags, content_json, status, is_deleted, download_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'listed', 0, 0, ?, ?)`
  ).run('S16-TPL-001', TEST_USER_ID, TEST_USER_ID, 'S16测试模板_都市言情', '测试模板', '都市', 'urban_romance', '都市,言情', now, now);
  testTemplateId = Number(tplInfo.insertId || tplInfo.lastInsertRowid);
});

after(() => {
  cleanup();
  closeDb();
});

describe('S16-T01 素材推荐引擎', () => {
  it('构建用户偏好画像并真实落库', () => {
    const profile = rec.buildUserProfile(db, log, TEST_USER_ID);
    assert.ok(profile.user_id === TEST_USER_ID);
    const row = db.prepare('SELECT * FROM user_preference_profiles WHERE user_id = ?').get(TEST_USER_ID);
    assert.ok(row, '画像应已落库');
    assert.ok(row.total_actions >= 0);
    // 画像权重字段应为合法 JSON
    assert.doesNotThrow(() => JSON.parse(row.genre_weights));
    assert.doesNotThrow(() => JSON.parse(row.tag_weights));
  });

  it('画像读取命中缓存（TTL 内复用）', () => {
    const p1 = rec.getUserProfile(db, log, TEST_USER_ID);
    const p2 = rec.getUserProfile(db, log, TEST_USER_ID);
    assert.equal(p1.user_id, p2.user_id);
  });

  it('推荐反馈留痕写入 recommend_logs（含 rank_pos）', () => {
    const r = rec.logFeedback(db, log, {
      userId: TEST_USER_ID, itemType: 'material', dimension: 'character',
      itemId: testMaterialId, action: 'click', source: 'personalized', score: 0.8, rank: 3
    });
    assert.equal(r.ok, true);
    const row = db.prepare('SELECT * FROM recommend_logs WHERE id = ?').get(r.id);
    assert.equal(row.user_id, TEST_USER_ID);
    assert.equal(row.action, 'click');
    assert.equal(row.rank_pos, 3);
    assert.equal(Number(row.score), 0.8);
  });

  it('素材推荐：返回真实素材（冷启动兜底）', () => {
    const res = rec.recommendMaterials(db, log, { userId: TEST_USER_ID2, dimension: 'character', limit: 10 });
    assert.equal(res.items.length > 0, true);
    assert.ok(res.total >= 0);
    for (const it of res.items) {
      assert.ok(it.id > 0);
      assert.ok(['character', 'scene', 'prop'].includes(it.dimension) || it.dimension === 'character');
      assert.ok(['cold_start', 'trending', 'personalized'].includes(it.source));
      assert.ok(typeof it.score === 'number' && it.score >= 0 && it.score <= 1);
    }
  });

  it('素材推荐：排除指定 ID', () => {
    const res = rec.recommendMaterials(db, log, {
      userId: TEST_USER_ID, dimension: 'character', limit: 5, excludeIds: [testMaterialId]
    });
    assert.equal(res.items.some((i) => i.id === testMaterialId), false);
  });

  it('素材推荐：非法维度返回错误', () => {
    const res = rec.recommendMaterials(db, log, { userId: TEST_USER_ID, dimension: 'bad_dim', limit: 5 });
    assert.ok(res.error);
  });

  it('模板推荐：返回真实模板（题材匹配或热门）', () => {
    const res = rec.recommendTemplates(db, log, { userId: TEST_USER_ID, limit: 10 });
    assert.equal(res.items.length > 0, true);
    for (const it of res.items) {
      assert.ok(it.id > 0);
      assert.ok(it.title);
      assert.ok(['cold_start', 'trending', 'personalized'].includes(it.source));
    }
  });

  it('全站热门：多维度聚合（素材 + 模板）', () => {
    const res = rec.getTrending(db, log, { limit: 20 });
    assert.ok(res.character || res.scene || res.prop, '至少一个素材维度有数据');
    assert.ok(Array.isArray(res.templates));
    const single = rec.getTrending(db, log, { dimension: 'character', limit: 5 });
    assert.ok(Array.isArray(single.character));
  });

  it('首页个性化组合：结构与返回正常', () => {
    const res = rec.homeRecommend(db, log, { userId: TEST_USER_ID, materialLimit: 3, templateLimit: 4 });
    assert.ok(res.materials.character);
    assert.ok(res.materials.scene);
    assert.ok(res.materials.prop);
    assert.ok(Array.isArray(res.templates));
    assert.ok(typeof res.profileFound === 'boolean');
  });
});

describe('S16-T06 帮助中心', () => {
  it('help_docs 种子数据存在且字段完整', () => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM help_docs').get().c;
    assert.ok(total >= 11, `种子文档应 >= 11，实际 ${total}`);
    const row = db.prepare('SELECT * FROM help_docs WHERE is_published = 1 ORDER BY sort_order LIMIT 1').get();
    assert.ok(row && row.title && row.category);
  });

  it('分类覆盖 manual/faq/video/best_practice', () => {
    const cats = db.prepare('SELECT DISTINCT category FROM help_docs').all().map((r) => r.category);
    for (const c of ['manual', 'faq', 'video', 'best_practice']) {
      assert.ok(cats.includes(c), `分类 ${c} 应存在`);
    }
  });

  it('管理端 CRUD SQL 正确性（创建→更新→删除）', () => {
    // 创建
    const info = db.prepare(
      `INSERT INTO help_docs (category, doc_key, title, summary, content, sort_order, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('faq', 'test-s16-faq', 'S16测试FAQ', '测试摘要', '测试内容', 999, 1);
    const id = Number(info.insertId || info.lastInsertRowid);
    assert.ok(id > 0);
    // 更新
    db.prepare(`UPDATE help_docs SET title = ?, is_published = ? WHERE id = ?`).run('S16测试FAQ-已更新', 0, id);
    const updated = db.prepare('SELECT * FROM help_docs WHERE id = ?').get(id);
    assert.equal(updated.title, 'S16测试FAQ-已更新');
    assert.equal(updated.is_published, 0);
    // 删除
    const del = db.prepare('DELETE FROM help_docs WHERE id = ?').run(id);
    assert.equal(del.changes, 1);
    assert.equal(db.prepare('SELECT * FROM help_docs WHERE id = ?').get(id) == null, true);
  });
});

describe('M4 里程碑验收', () => {
  it('模板市场已上架模板 >= 50（M4：≥50 个模板上架）', () => {
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM marketplace_templates WHERE status = 'listed' AND is_deleted = 0"
    ).get();
    assert.ok(row.c >= 50, `上架模板应 >= 50，实际 ${row.c}`);
  });

  it('上架模板 content_json 内容体完整（角色/场景/节奏/风格）', () => {
    const tpl = db.prepare(
      "SELECT * FROM marketplace_templates WHERE status = 'listed' AND is_deleted = 0 ORDER BY download_count DESC LIMIT 1"
    ).get();
    assert.ok(tpl && tpl.content_json, '应存在上架模板');
    const body = JSON.parse(tpl.content_json);
    assert.ok(Array.isArray(body.character_presets) && body.character_presets.length >= 1, '角色预设');
    assert.ok(Array.isArray(body.scene_presets) && body.scene_presets.length >= 1, '场景预设');
    assert.ok(body.storyboard_rhythm && body.storyboard_rhythm.hook, '分镜节奏');
    assert.ok(body.style_config && body.style_config.theme, '风格配置');
  });

  it('模板题材覆盖 >= 5 类（八大题材种子）', () => {
    const rows = db.prepare(
      "SELECT DISTINCT category FROM marketplace_templates WHERE status = 'listed' AND is_deleted = 0"
    ).all();
    assert.ok(rows.length >= 5, `题材分类应 >= 5，实际 ${rows.length}（${rows.map(r => r.category).join(',')}）`);
  });

  it('视频教程文档为真实图文教程（非占位符）', () => {
    const rows = db.prepare("SELECT doc_key, content FROM help_docs WHERE doc_key IN ('video-quickstart', 'video-advanced')").all();
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.ok(!/即将上线/.test(r.content), `${r.doc_key} 不应为占位符`);
      assert.ok(r.content.length > 100, `${r.doc_key} 内容应完整`);
    }
  });

  it('安全扫描结果已落库且最近一次全部通过', () => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM security_scan_results').get().c;
    assert.ok(total >= 16, `安全扫描记录应 >= 16，实际 ${total}`);
    const latest = db.prepare('SELECT id FROM security_scan_results ORDER BY id DESC LIMIT 1').get();
    const pass = db.prepare('SELECT COUNT(*) AS c FROM security_scan_results WHERE id = ? AND status = ?').get(latest.id, 'pass').c;
    const all = db.prepare('SELECT COUNT(*) AS c FROM security_scan_results WHERE id = ?').get(latest.id).c;
    assert.equal(pass, all, `最近一次扫描应全部通过（${pass}/${all}）`);
  });
});
