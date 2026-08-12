/**
 * Sprint 12 单元测试 — 素材管理 + 对象存储（S12-T01 ~ S12-T03）
 *
 * 覆盖任务：
 *   S12-T01 素材智能标签系统：确定性规则打标签(ruleTags) + AI JSON 解析(parseAiTagJson)
 *                             + 标签落库/幂等关联(tagMaterial/upsertTag) + 按标签检索 + 词典统计
 *   S12-T02 三级素材库：作用域切换(个人/团队/公共) + 跨项目复用(reuseToProject) + 作用域概览
 *   S12-T03 存储层抽象：LocalAdapter 读写/删除/存在性/URL + 工厂类型解析 + MinIO 惰性校验
 *
 * 约束（用户要求）：
 *   - 不使用 mock；素材与项目数据全部落地本地真实 MySQL（configs/config.yaml）
 *   - AI 未配置时 tagMaterial 走确定性规则降级路径（无 Key 也稳定可测）
 *   - 使用测试专用高位 ID（drama 99601 / 素材由自增插入并在 after 中彻底清理）
 *   - 存储适配器测试使用系统临时目录，测试后清理，不污染业务存储根
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));

const materialTagService = require(path.resolve(__dirname, '..', 'src', 'services', 'materialTagService.js'));
const libraryScopeService = require(path.resolve(__dirname, '..', 'src', 'services', 'libraryScopeService.js'));
const storage = require(path.resolve(__dirname, '..', 'src', 'services', 'storage', 'index.js'));
const LocalAdapter = require(path.resolve(__dirname, '..', 'src', 'services', 'storage', 'LocalAdapter.js'));

// 测试专用高位项目 ID / 用户 / 团队（与业务及其它 Sprint 隔离）
const T_DRAMA = 99601;
const T_DRAMA_TARGET = 99602; // 跨项目复用目标
const T_USER = 99610;
const T_TEAM = 99620;

let db;
const log = { info() {}, warn() {}, error() {} };

// 记录本测试新增的素材行，after 精确清理
const created = { character_libraries: [], scene_libraries: [], prop_libraries: [] };

function cleanup() {
  // 先删标签关联（外层不设外键，手动清），再删素材、项目
  for (const table of Object.keys(created)) {
    db.prepare(`DELETE FROM material_tag_relations WHERE material_table = ? AND material_id IN (SELECT id FROM ${table} WHERE drama_id IN (?, ?))`)
      .run(table, T_DRAMA, T_DRAMA_TARGET);
    db.prepare(`DELETE FROM ${table} WHERE drama_id IN (?, ?)`).run(T_DRAMA, T_DRAMA_TARGET);
    // 个人/团队/公共库素材 drama_id 可能被置空，按 owner/team 兜底清理
    db.prepare(`DELETE FROM ${table} WHERE owner_id = ? OR team_id = ?`).run(T_USER, T_TEAM);
  }
  db.prepare('DELETE FROM dramas WHERE id IN (?, ?)').run(T_DRAMA, T_DRAMA_TARGET);
}

function insertCharacter(fields) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO character_libraries (drama_id, name, category, description, source_type, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'project', ?, ?)`
  ).run(T_DRAMA, fields.name || '', fields.category || null, fields.description || null, fields.source_type || 'manual', now, now);
  const id = info.lastInsertRowid || info.insertId;
  created.character_libraries.push(id);
  return id;
}

before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '测试要求 config.yaml 数据库类型为 mysql（真实库，不用 mock）');
  db = getDb(cfg.database);
  cleanup();
  // 建立源项目与复用目标项目
  const now = new Date().toISOString();
  for (const id of [T_DRAMA, T_DRAMA_TARGET]) {
    db.prepare(
      `INSERT INTO dramas (id, title, status, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)`
    ).run(id, `S12 素材测试项目 ${id}`, T_USER, now, now);
  }
});

after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// S12-T01 素材智能标签系统
// ===========================================================================
describe('S12-T01 素材智能标签系统', () => {
  it('ruleTags: 依据描述文本 + 库表兜底生成五维度标签（确定性降级）', () => {
    const tags = materialTagService.ruleTags('character_libraries', {
      name: '古风女主角',
      description: '国风水墨风格，暖色调，情绪温馨的主角立绘',
      category: '主角',
    });
    // 命中的维度集合
    const dims = new Set(tags.map((t) => t.dimension));
    assert.ok(dims.has('content'), '应含内容维度');
    assert.ok(dims.has('style'), '应含风格维度(国风/水墨)');
    assert.ok(dims.has('emotion'), '应含情绪维度(温馨)');
    assert.ok(dims.has('color'), '应含色彩维度(暖色)');
    // 具体命中检查
    const names = tags.map((t) => t.name);
    assert.ok(names.includes('国风'), '应命中「国风」');
    assert.ok(names.includes('温馨'), '应命中「温馨」');
    assert.ok(names.includes('暖色'), '应命中「暖色」');
    // 全部标记为 rule 来源
    assert.ok(tags.every((t) => t.source === 'rule'));
  });

  it('ruleTags: 无描述文本时按库表兜底给出 content/usage 标签', () => {
    const tags = materialTagService.ruleTags('scene_libraries', {});
    assert.ok(tags.some((t) => t.dimension === 'content' && t.name === '场景'));
    assert.ok(tags.some((t) => t.dimension === 'usage' && t.name === '背景'));
  });

  it('parseAiTagJson: 解析带 ```json 包裹的模型输出，超额截断为每维 2 个', () => {
    const raw = '```json\n{"content":["人物","场景","多余"],"style":["动漫"],"emotion":[],"color":["冷色"],"usage":["主体形象"]}\n```';
    const parsed = materialTagService.parseAiTagJson(raw);
    assert.ok(parsed && parsed.length);
    const content = parsed.filter((t) => t.dimension === 'content');
    assert.equal(content.length, 2, 'content 维度最多保留 2 个');
    assert.ok(parsed.every((t) => t.source === 'ai'));
  });

  it('parseAiTagJson: 非法输入返回 null（供调用方降级）', () => {
    assert.equal(materialTagService.parseAiTagJson('这不是JSON'), null);
    assert.equal(materialTagService.parseAiTagJson(''), null);
  });

  it('tagMaterial: 真实素材打标签落库（AI 未配置→规则降级），列表/词典/检索一致', async () => {
    const id = insertCharacter({
      name: '赛博朋克男主',
      description: '未来都市霓虹，冷色调，紧张氛围的主角形象',
      category: '主角',
    });
    const res = await materialTagService.tagMaterial(db, log, { table: 'character_libraries', materialId: id });
    assert.equal(res.ok, true);
    assert.ok(['ai', 'rule'].includes(res.source));
    assert.ok(res.tags.length > 0, '应生成至少一个标签');

    // 列表读取与保存一致
    const listed = materialTagService.listMaterialTags(db, 'character_libraries', id);
    assert.equal(listed.length, res.tags.length);

    // 冗余 tags 字段已回写
    const row = db.prepare('SELECT tags FROM character_libraries WHERE id = ?').get(id);
    assert.ok(row.tags && row.tags.length > 0, '*_libraries.tags 冗余字段应回写');

    // 幂等：重复打标签不新增关联行数
    const before = materialTagService.listMaterialTags(db, 'character_libraries', id).length;
    await materialTagService.tagMaterial(db, log, { table: 'character_libraries', materialId: id });
    const after = materialTagService.listMaterialTags(db, 'character_libraries', id).length;
    assert.equal(after, before, '重复打标签应幂等，不产生重复关联');

    // 按标签检索命中该素材
    const anyTagName = listed[0].name;
    const hitIds = materialTagService.searchMaterialIdsByTags(db, { table: 'character_libraries', tags: [anyTagName] });
    assert.ok(hitIds.includes(id), '按标签检索应命中已打标素材');

    // 词典统计包含该标签且 usage_count >= 1
    const dict = materialTagService.listTagDictionary(db, { table: 'character_libraries' });
    const dictEntry = dict.find((d) => d.name === anyTagName);
    assert.ok(dictEntry && dictEntry.usage_count >= 1);
  });

  it('addManualTag / removeMaterialTag: 手动标签增删', async () => {
    const id = insertCharacter({ name: '手动标签测试', description: '普通素材' });
    const add = materialTagService.addManualTag(db, 'character_libraries', id, 'usage', '封面');
    assert.equal(add.ok, true);
    assert.ok(add.tag_id);
    const listed = materialTagService.listMaterialTags(db, 'character_libraries', id);
    assert.ok(listed.some((t) => t.name === '封面' && t.source === 'manual'));
    const rm = materialTagService.removeMaterialTag(db, 'character_libraries', id, add.tag_id);
    assert.equal(rm.removed, true);
    assert.equal(materialTagService.listMaterialTags(db, 'character_libraries', id).length, 0);
  });

  it('tagMaterial: 非法库表抛错，素材不存在返回 ok:false', async () => {
    await assert.rejects(
      () => materialTagService.tagMaterial(db, log, { table: 'not_a_table', materialId: 1 }),
      /不支持的素材库表/
    );
    const res = await materialTagService.tagMaterial(db, log, { table: 'character_libraries', materialId: 99990001 });
    assert.equal(res.ok, false);
  });
});

// ===========================================================================
// S12-T02 三级素材库
// ===========================================================================
describe('S12-T02 三级素材库', () => {
  it('collectToPersonal: 收藏到个人库设置 scope/owner_id/visibility', () => {
    const id = insertCharacter({ name: '个人库素材', description: '收藏测试' });
    const res = libraryScopeService.collectToPersonal(db, log, { kind: 'character', id, userId: T_USER });
    assert.equal(res.ok, true);
    assert.equal(res.item.scope, 'personal');
    assert.equal(Number(res.item.owner_id), T_USER);
    assert.equal(res.item.visibility, 'private');
  });

  it('publishToTeam: 发布到团队库；无团队则拒绝', () => {
    const id = insertCharacter({ name: '团队库素材', description: '团队测试' });
    const ok = libraryScopeService.publishToTeam(db, log, { kind: 'character', id, teamId: T_TEAM });
    assert.equal(ok.ok, true);
    assert.equal(ok.item.scope, 'team');
    assert.equal(Number(ok.item.team_id), T_TEAM);

    const noTeam = libraryScopeService.publishToTeam(db, log, { kind: 'character', id, teamId: null });
    assert.equal(noTeam.ok, false);
  });

  it('publishToPublic: 发布到公共库 scope=public/visibility=public', () => {
    const id = insertCharacter({ name: '公共库素材', description: '公共测试' });
    const res = libraryScopeService.publishToPublic(db, log, { kind: 'character', id });
    assert.equal(res.ok, true);
    assert.equal(res.item.scope, 'public');
    assert.equal(res.item.visibility, 'public');
  });

  it('setScope: 非法 scope / 素材不存在的健壮处理', () => {
    const id = insertCharacter({ name: '非法scope', description: 'x' });
    assert.equal(libraryScopeService.setScope(db, log, { kind: 'character', id, scope: 'bad' }).ok, false);
    assert.equal(libraryScopeService.setScope(db, log, { kind: 'character', id: 99990002, scope: 'public' }).ok, false);
  });

  it('reuseToProject: 跨项目复用生成目标项目新行，保留来源信息并复制标签', async () => {
    const srcId = insertCharacter({ name: '可复用素材', description: '国风角色，暖色', category: '主角' });
    // 先给源素材打标签，验证复用会连带复制标签关联
    await materialTagService.tagMaterial(db, log, { table: 'character_libraries', materialId: srcId });
    const srcTagCount = materialTagService.listMaterialTags(db, 'character_libraries', srcId).length;
    assert.ok(srcTagCount > 0);

    const res = libraryScopeService.reuseToProject(db, log, { kind: 'character', id: srcId, targetDramaId: T_DRAMA_TARGET });
    assert.equal(res.ok, true);
    created.character_libraries.push(res.id);
    assert.equal(Number(res.item.drama_id), T_DRAMA_TARGET, '新行归属目标项目');
    assert.equal(res.item.scope, 'project');
    assert.equal(res.item.source_type, 'reuse', '来源类型标记为 reuse');
    assert.equal(String(res.item.source_id), String(srcId), 'source_id 指向源素材');

    // 标签关联已复制到新素材
    const newTagCount = materialTagService.listMaterialTags(db, 'character_libraries', res.id).length;
    assert.equal(newTagCount, srcTagCount, '复用应连带复制标签关联');
  });

  it('reuseToProject: 目标项目不存在 / 源素材不存在时拒绝', () => {
    const srcId = insertCharacter({ name: '复用校验', description: 'x' });
    assert.equal(libraryScopeService.reuseToProject(db, log, { kind: 'character', id: srcId, targetDramaId: 99990003 }).ok, false);
    assert.equal(libraryScopeService.reuseToProject(db, log, { kind: 'character', id: 99990004, targetDramaId: T_DRAMA_TARGET }).ok, false);
  });

  it('scopeSummary: 各作用域计数为真实聚合数值', () => {
    const summary = libraryScopeService.scopeSummary(db, { userId: T_USER, teamId: T_TEAM });
    assert.ok(summary.character, '应含 character 维度');
    assert.ok(typeof summary.character.personal === 'number');
    assert.ok(typeof summary.character.team === 'number');
    assert.ok(typeof summary.character.public === 'number');
    // 前面用例已把 1 条收藏到个人库、1 条到团队库
    assert.ok(summary.character.personal >= 1);
    assert.ok(summary.character.team >= 1);
  });

  it('resolveTable: 支持别名与全名，非法类型抛错', () => {
    assert.equal(libraryScopeService.resolveTable('character'), 'character_libraries');
    assert.equal(libraryScopeService.resolveTable('scene_libraries'), 'scene_libraries');
    assert.throws(() => libraryScopeService.resolveTable('unknown'), /不支持的素材类型/);
  });
});

// ===========================================================================
// S12-T03 存储层抽象与对象存储迁移
// ===========================================================================
describe('S12-T03 存储层抽象', () => {
  let tmpRoot;
  let adapter;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's12-storage-'));
    adapter = new LocalAdapter({ root: tmpRoot, baseUrl: 'http://localhost:5679/static' });
  });

  after(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('LocalAdapter: put/get/exists/delete 全链路', async () => {
    const key = 'projects/99601/images/cover.png';
    const payload = Buffer.from('local-mini-drama-test-bytes');

    const put = await adapter.putObject(key, payload, { contentType: 'image/png' });
    assert.equal(put.backend, 'local');
    assert.equal(put.size, payload.length);
    assert.equal(put.objectKey, key);

    assert.equal(await adapter.exists(key), true);
    const got = await adapter.getObject(key);
    assert.equal(got.toString(), payload.toString());

    const del = await adapter.deleteObject(key);
    assert.equal(del, true);
    assert.equal(await adapter.exists(key), false);
    assert.equal(await adapter.deleteObject(key), false, '重复删除返回 false');
  });

  it('LocalAdapter: publicUrl 规范化前导斜杠与反斜杠', () => {
    assert.equal(adapter.publicUrl('/a\\b/c.png'), 'http://localhost:5679/static/a/b/c.png');
  });

  it('LocalAdapter: healthCheck 校验存储根可写', async () => {
    const h = await adapter.healthCheck();
    assert.equal(h.ok, true);
    assert.equal(h.backend, 'local');
  });

  it('工厂 createAdapter: 依据 type 返回对应适配器实例', () => {
    const local = storage.createAdapter({ storage: { type: 'local', local_path: tmpRoot } });
    assert.equal(local.backend, 'local');

    // MinIO/OSS/COS 走同一 S3 协议适配器；SDK 采用惰性加载（MinIO 可选）。
    // 未安装 @aws-sdk/client-s3 时，构造应抛出清晰的安装提示；已安装则返回 minio 后端实例。
    const minioCfg = { storage: { type: 'minio', endpoint: 'http://127.0.0.1:9000', bucket: 'localminidrama', access_key: 'k', secret_key: 's' } };
    let s3Installed = true;
    try { require('@aws-sdk/client-s3'); } catch (_) { s3Installed = false; }
    if (s3Installed) {
      const minio = storage.createAdapter(minioCfg);
      assert.equal(minio.backend, 'minio');
    } else {
      assert.throws(() => storage.createAdapter(minioCfg), /npm i @aws-sdk\/client-s3/);
    }

    // 缺少 bucket 配置应立即报错（早于 SDK 加载）
    assert.throws(() => storage.createAdapter({ storage: { type: 'minio', endpoint: 'http://127.0.0.1:9000' } }), /bucket/);

    assert.throws(() => storage.createAdapter({ storage: { type: 'unknown' } }), /未知存储后端类型/);
  });

  it('工厂 getAdapter: 本地后端单例缓存', () => {
    storage.resetAdapter();
    const a1 = storage.getAdapter({ storage: { type: 'local', local_path: tmpRoot } });
    const a2 = storage.getAdapter({ storage: { type: 'local', local_path: tmpRoot } });
    assert.equal(a1, a2, '同类型应命中缓存返回同一实例');
    assert.equal(a1.backend, 'local');
    storage.resetAdapter();
  });
});
