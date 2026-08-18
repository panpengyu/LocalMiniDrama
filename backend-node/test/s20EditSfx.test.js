'use strict';

/**
 * Sprint 20 - T20-03 智能剪辑效果参数 + T20-04 音效智能匹配 集成测试
 *
 * 约束：
 *   - 真实 MySQL（config.yaml type=mysql），数据落库 edit_tasks / assets / storyboards 等
 *   - 独立 ID 区间（9000011xx）+ s20e_ 前缀隔离，before 清理残留、after 精确清理
 *   - 音效匹配仅基于用户自有素材标签（不预置任何第三方版权音效）
 *   - autoEdit 通过 FFMPEG_PATH 指向不存在路径强制走「模拟完成」分支，
 *     避免依赖本机 ffmpeg / 真实渲染，同时完整验证参数落库与效果滤镜构建
 *
 * 覆盖：
 *   [1] listTags 聚合用户自有素材标签（去重排序）
 *   [2] matchSfx 关键词命中（名称/标签）与未命中过滤
 *   [3] matchSfx 标签集合过滤（全部命中优先）
 *   [4] matchSfx 无筛选返回最近素材 + strengthFor 强度模式
 *   [5] autoEdit 非法 color_grade / 缺 subtitle_text 校验拒绝
 *   [6] autoEdit 效果参数真实落库（含 sfx_matches JSON）
 *   [7] buildFFmpegArgs 滤镜链：调色 eq / 字幕 drawtext / 水印 drawtext / 无效果回退 [outv]
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const editService = require(path.resolve(__dirname, '..', 'src', 'services', 'editService.js'));
const sfxService = require(path.resolve(__dirname, '..', 'src', 'services', 'sfxService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);

const T_DRAMA = 900001110;
const T_EP = 900001111;
const T_SB = 900001121;
const T_IMG_GEN = 900001122;
const ASSET_SUS = 900001131;   // audio 悬疑
const ASSET_PIANO = 900001132; // voice 温馨
const ASSET_BATTLE = 900001133; // music 热血
const U_OWNER = 900001134;

let createdTaskId = null;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's20e_'));

function cleanup() {
  db.prepare('DELETE FROM edit_tasks WHERE drama_id = ? OR created_by = ?').run(T_DRAMA, U_OWNER);
  db.prepare('DELETE FROM image_generations WHERE id = ?').run(T_IMG_GEN);
  db.prepare('DELETE FROM storyboards WHERE id = ? OR scene_id = ?').run(T_SB, T_SB);
  db.prepare('DELETE FROM episodes WHERE id = ?').run(T_EP);
  db.prepare('DELETE FROM dramas WHERE id = ?').run(T_DRAMA);
  db.prepare('DELETE FROM assets WHERE id IN (?, ?, ?)').run(ASSET_SUS, ASSET_PIANO, ASSET_BATTLE);
  db.prepare('DELETE FROM users WHERE id = ?').run(U_OWNER);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();

  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, status)
     VALUES (?, ?, 'x', 'user', ?, 1)`
  ).run(U_OWNER, `s20e_owner_${TAG}`, `s20e_owner_nick_${TAG}`);

  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_by, created_at, updated_at)
     VALUES (?, 'S20 剪辑与音效测试项目', 'draft', '{}', ?, NOW(), NOW())`
  ).run(T_DRAMA, U_OWNER);

  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, script_content, status, created_at, updated_at)
     VALUES (?, ?, 1, '第1集', '剪辑测试剧本', 'draft', NOW(), NOW())`
  ).run(T_EP, T_DRAMA);

  db.prepare(
    `INSERT INTO storyboards (id, episode_id, scene_id, storyboard_number, title, dialogue, duration, shot_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 1, '开场', '测试台词', 3, '特写', 'draft', NOW(), NOW())`
  ).run(T_SB, T_EP, T_SB);

  // collectClips 需要 completed 的 image_generations 提供 image_url
  db.prepare(
    `INSERT INTO image_generations (id, storyboard_id, drama_id, scene_id, provider, image_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test', '/static/uploads/s20e_test_frame.png', 'completed', NOW(), NOW())`
  ).run(T_IMG_GEN, T_SB, T_DRAMA, T_SB);

  // 用户自有音效素材（全部测试自建，无第三方版权音效）
  const insertAsset = (id, name, type, tags, duration) => {
    db.prepare(
      `INSERT INTO assets (id, name, type, category, url, duration, tags, created_at, updated_at)
       VALUES (?, ?, ?, '音效', ?, ?, ?, NOW(), NOW())`
    ).run(id, name, type, `/static/uploads/sfx/${id}.mp3`, duration, JSON.stringify(tags));
  };
  insertAsset(ASSET_SUS, '心跳鼓点', 'audio', ['悬疑', '紧张', '心跳'], 8.2);
  insertAsset(ASSET_PIANO, '温柔钢琴', 'voice', ['温馨', '钢琴', '舒缓'], 12.6);
  insertAsset(ASSET_BATTLE, '热血战斗', 'music', ['高潮', '热血', '战斗'], 15.1);
});

test.after(() => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

// ===========================================================================
// [1] 标签聚合
// ===========================================================================
test('[S20-T04][1] listTags 聚合用户自有素材标签（去重排序）', () => {
  const tags = sfxService.listTags(db);
  assert.ok(Array.isArray(tags), '应返回标签数组');
  assert.ok(tags.includes('悬疑'), '应包含素材1标签');
  assert.ok(tags.includes('钢琴'), '应包含素材2标签');
  assert.ok(tags.includes('战斗'), '应包含素材3标签');
  assert.equal(new Set(tags).size, tags.length, '标签不应重复');
  const sorted = [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  assert.deepEqual(tags, sorted, '标签应按中文排序');
});

// ===========================================================================
// [2] 关键词匹配
// ===========================================================================
test('[S20-T04][2] matchSfx 关键词命中名称/标签，未命中被过滤', () => {
  const byName = sfxService.matchSfx(db, log, { query: '钢琴', limit: 10 });
  assert.equal(byName.length, 1, '名称含「钢琴」应唯一命中');
  assert.equal(byName[0].id, ASSET_PIANO);
  assert.ok(byName[0].score >= 5);
  assert.ok(byName[0].matchReason.includes('名称含「钢琴」'));

  const byTag = sfxService.matchSfx(db, log, { query: '紧张' });
  assert.equal(byTag.length, 1, '标签含「紧张」应命中心跳鼓点');
  assert.equal(byTag[0].id, ASSET_SUS);
  assert.ok(byTag[0].matchReason.includes('标签命中'));

  const none = sfxService.matchSfx(db, log, { query: '不存在的音效' });
  assert.equal(none.length, 0, '关键词无命中应返回空数组（不 mock）');
});

// ===========================================================================
// [3] 标签集合过滤
// ===========================================================================
test('[S20-T04][3] matchSfx 标签集合过滤（全部命中优先）', () => {
  const multi = sfxService.matchSfx(db, log, { tags: '悬疑,紧张' });
  assert.ok(multi.length >= 1, '应至少命中心跳鼓点');
  assert.equal(multi[0].id, ASSET_SUS, '全部标签命中的素材应排最前');
  assert.ok(multi[0].matchReason.includes('标签:悬疑/紧张'));

  const partial = sfxService.matchSfx(db, log, { tags: '温馨,悬疑' });
  assert.equal(partial.length, 2, '部分命中应返回两个素材（各命中一个标签）');

  const none = sfxService.matchSfx(db, log, { tags: '完全不存在的标签' });
  assert.equal(none.length, 0, '标签完全未命中应返回空数组');
});

// ===========================================================================
// [4] 无筛选 + 强度模式
// ===========================================================================
test('[S20-T04][4] 无筛选返回最近素材；强度模式输出合理音量建议', () => {
  const all = sfxService.matchSfx(db, log, { limit: 50 });
  // 无筛选返回全部用户素材；多测试文件并行共享同一真实库（S21 版权测试会插入音效素材），
  // 因此按“包含本测试三条素材”断言而非“恰好 3 条”
  assert.ok(all.length >= 3, '无筛选应返回本测试的全部 3 条用户素材');
  const allIds = all.map((i) => i.id);
  assert.ok(allIds.includes(ASSET_SUS) && allIds.includes(ASSET_PIANO) && allIds.includes(ASSET_BATTLE),
    '应包含心跳鼓点/温柔钢琴/热血战斗三条素材');
  for (const item of all) {
    if (!allIds.includes(item.id)) continue; // 跳过其他集成测试的同类型素材（如 S21 版权测试的音效素材）
    assert.ok(item.suggestedStrength >= 0.1 && item.suggestedStrength <= 1, '强度应在 0~1');
    assert.ok(item.tags.length > 0, '应携带标签');
  }
  const intense = sfxService.matchSfx(db, log, { query: '钢琴', mode: 'intense' })[0];
  const light = sfxService.matchSfx(db, log, { query: '钢琴', mode: 'light' })[0];
  assert.ok(intense.suggestedStrength > light.suggestedStrength, 'intense 强度应高于 light');
  // score=5 时等于模式基准音量；score 越低音量略降
  assert.equal(sfxService.strengthFor('light', 5), 0.35);
  assert.equal(sfxService.strengthFor('normal', 5), 0.6);
  assert.equal(sfxService.strengthFor('intense', 5), 0.85);
  assert.ok(sfxService.strengthFor('light', 1) < 0.35, '低分匹配强度应更低');
});

// ===========================================================================
// [5] 剪辑入参校验
// ===========================================================================
test('[S20-T03][5] autoEdit 非法调色/缺失字幕文本被拒绝', async () => {
  const base = { drama_id: T_DRAMA, episode_id: T_EP, user_id: U_OWNER, resolution: '720x1280', fps: 30 };
  await assert.rejects(
    editService.autoEdit(db, log, { ...base, color_grade: 'neon' }),
    /EDIT-000/
  );
  await assert.rejects(
    editService.autoEdit(db, log, { ...base, subtitle_enabled: true, subtitle_text: '' }),
    /EDIT-000.*subtitle_text/
  );
});

// ===========================================================================
// [6] 效果参数落库
// ===========================================================================
test('[S20-T03][6] autoEdit 字幕/水印/调色/音效匹配参数真实落库', async () => {
  // 强制走「模拟完成」：FFMPEG_PATH 指向不存在 → isToolAvailable=false
  process.env.FFMPEG_PATH = '/nonexistent/s20e_ffmpeg';
  try {
    const sfx = sfxService.matchSfx(db, log, { query: '紧张' });
    const result = await editService.autoEdit(db, log, {
      drama_id: T_DRAMA,
      episode_id: T_EP,
      user_id: U_OWNER,
      title: 'S20 效果测试剪辑',
      resolution: '720x1280',
      fps: 30,
      transition_default: 'fade',
      beat_sync: true,
      subtitle_enabled: true,
      subtitle_text: '这扇门后，是另一个世界。',
      subtitle_style: JSON.stringify({ fontsize: 40, position: 'bottom', color: 'white' }),
      watermark_text: '本地短剧助手',
      watermark_position: 'top-left',
      color_grade: 'warm',
      brightness: 0.05,
      contrast: 0.1,
      saturation: 0.2,
      sfx_matches: sfx,
    });
    assert.equal(result.status, 'completed');
    assert.ok(result.task_id, '应返回任务 ID');
    assert.ok(result.simulated, '应标记 simulated（无 ffmpeg 环境）');
    createdTaskId = result.task_id;

    const row = db.prepare('SELECT * FROM edit_tasks WHERE id = ?').get(result.task_id);
    assert.equal(row.subtitle_enabled, 1);
    assert.equal(row.subtitle_text, '这扇门后，是另一个世界。');
    assert.equal(row.watermark_text, '本地短剧助手');
    assert.equal(row.watermark_position, 'top-left');
    assert.equal(row.color_grade, 'warm');
    assert.equal(Number(row.brightness), 0.05);
    assert.equal(Number(row.contrast), 0.1);
    assert.equal(Number(row.saturation), 0.2);
    assert.ok(row.sfx_matches, 'sfx_matches 应落库');
    const storedSfx = JSON.parse(row.sfx_matches);
    assert.ok(Array.isArray(storedSfx) && storedSfx.length >= 1, '音效匹配结果应为数组');
    assert.equal(storedSfx[0].id, ASSET_SUS, '最匹配音效应为心跳鼓点');
    assert.ok(storedSfx[0].suggestedStrength > 0);
  } finally {
    delete process.env.FFMPEG_PATH;
  }
});

// ===========================================================================
// [7] ffmpeg 滤镜链构建
// ===========================================================================
test('[S20-T03][7] buildFFmpegArgs 效果滤镜链（调色/字幕/水印）与无效果回退', () => {
  const clips = [{ duration: 3, image_url: '/static/uploads/frame.png' }];

  // 全效果：concat → eq(调色) → drawtext(字幕) → drawtext(水印) → [vfx]
  const withFx = editService.buildFFmpegArgs(clips, path.join(tmpDir, 'fx.mp4'), {
    resolution: '1080x1920',
    fps: 30,
    effects: {
      color_grade: 'warm',
      brightness: 0.05,
      subtitle_enabled: true,
      subtitle_text: '测试字幕',
      subtitle_style: JSON.stringify({ fontsize: 40, position: 'bottom', color: 'white' }),
      watermark_text: '水印',
      watermark_position: 'top-right',
    },
    workDir: tmpDir,
    tag: 'fx',
  });
  const fc = withFx.findIndex((a) => a === '-filter_complex');
  const chain = withFx[fc + 1];
  assert.ok(chain.includes('eq=brightness='), '应包含调色 eq 滤镜');
  assert.ok(chain.includes('drawtext=textfile='), '应包含 drawtext 滤镜');
  assert.ok(chain.includes('subtitle_fx.txt'), '应写入字幕 textfile');
  assert.ok(chain.includes('watermark_fx.txt'), '应写入水印 textfile');
  assert.ok(chain.endsWith('[vfx]'), '滤镜链应以 [vfx] 结尾');
  assert.ok(withFx.includes('[vfx]'), '应 map [vfx]');
  assert.ok(fs.existsSync(path.join(tmpDir, 'subtitle_fx.txt')), '字幕文本文件应真实写入');
  assert.ok(fs.existsSync(path.join(tmpDir, 'watermark_fx.txt')), '水印文本文件应真实写入');

  // 无效果：保持 [outv] 直出
  const noFx = editService.buildFFmpegArgs(clips, path.join(tmpDir, 'plain.mp4'), {
    resolution: '1080x1920',
    fps: 30,
    effects: { color_grade: 'none' },
    workDir: tmpDir,
    tag: 'plain',
  });
  const fc2 = noFx.findIndex((a) => a === '-filter_complex');
  assert.ok(!noFx[fc2 + 1].includes('drawtext'), '无效果时不应有 drawtext');
  assert.ok(noFx.includes('[outv]'), '无效果时 map [outv]');
  assert.ok(!noFx.includes('[vfx]'), '无效果时不应 map [vfx]');
});
