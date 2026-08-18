'use strict';

/**
 * Sprint 21 - T21-01 版权指纹 + T21-02 运维自动化 集成测试
 *
 * 约束：
 *   - 真实 MySQL（config.yaml type=mysql），指纹/状态落库 asset_fingerprint / assets
 *   - 独立 ID 区间（9000021xx）+ s21_ 前缀隔离
 *   - 测试 PNG 由「自研 PNG 编码器」在内存生成（zlib deflate + 逐行无滤波），
 *     零第三方图像库、零版权素材；写入 os.tmpdir，不污染真实 storage
 *   - backup 脚本真实执行（输出到临时目录），不执行 restore/rollback 等破坏性动作
 *
 * 覆盖：
 *   [1] hammingDistance 汉明距离计算
 *   [2] 首个素材检测 → clear（指纹库为空基准）
 *   [3] 重复内容素材 → suspect（与库内自有素材距离 0）
 *   [4] 完全不同素材 → clear
 *   [5] 非 PNG 素材 → unsupported（仅文件级 SHA-256）
 *   [6] listCopyrightStatus 状态筛选与指纹字段回显
 *   [7] getScalingAdvice 真实指标结构（CPU/内存/队列/DB）
 *   [8] runScript 白名单校验 + backup 脚本真实执行
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const zlib = require('node:zlib');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const fingerprint = require(path.resolve(__dirname, '..', 'src', 'services', 'fingerprintService.js'));
const opsService = require(path.resolve(__dirname, '..', 'src', 'services', 'opsService.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);

const A1 = 900002101; // 素材A（基础图）
const A2 = 900002102; // 素材A 的完全副本 → 疑似
const A3 = 900002103; // 完全不同图 → 无风险
const A4 = 900002104; // 音频（非 PNG）→ 不支持感知哈希
const U_OWNER = 900002105;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's21_'));
const pngA = path.join(tmpDir, 'a.png');
const pngB = path.join(tmpDir, 'b.png');
const pngC = path.join(tmpDir, 'c.png');
const audioFile = path.join(tmpDir, 'sfx.mp3');

// ---------------------------------------------------------------------------
// 测试用 PNG 编码器（纯 Node，RFC 2083 最小实现：8-bit RGB、filter=0）
// ---------------------------------------------------------------------------
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makePng(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function cleanup() {
  db.prepare('DELETE FROM asset_fingerprint WHERE asset_id IN (?, ?, ?, ?)').run(A1, A2, A3, A4);
  db.prepare('DELETE FROM assets WHERE id IN (?, ?, ?, ?)').run(A1, A2, A3, A4);
  db.prepare('DELETE FROM users WHERE id = ?').run(U_OWNER);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  cleanup();

  // 生成真实 PNG 文件（A 基础图、B 与 A 完全一致、C 完全不同）
  fs.writeFileSync(pngA, makePng(64, 48, (x, y) => [Math.floor(x * 4), Math.floor(y * 5), 180]));
  fs.writeFileSync(pngB, makePng(64, 48, (x, y) => [Math.floor(x * 4), Math.floor(y * 5), 180])); // 副本
  fs.writeFileSync(pngC, makePng(64, 48, (x, y) => [((x + y) % 8) * 32, 60, 220 - ((x * y) % 40)]));
  fs.writeFileSync(audioFile, Buffer.from('s21 test audio bytes - not an image'));

  db.prepare(
    `INSERT INTO users (id, username, password, role, nickname, status)
     VALUES (?, ?, 'x', 'user', ?, 1)`
  ).run(U_OWNER, `s21_owner_${TAG}`, `s21_owner_nick_${TAG}`);

  const insertAsset = (id, name, type, filePath, mime) => {
    db.prepare(
      `INSERT INTO assets (id, name, type, category, url, local_path, file_size, mime_type, created_at, updated_at)
       VALUES (?, ?, ?, '素材', ?, ?, ?, ?, NOW(), NOW())`
    ).run(id, name, type, `/static/uploads/${path.basename(filePath)}`, filePath, fs.statSync(filePath).size, mime);
  };
  insertAsset(A1, '原创分镜图A', 'image', pngA, 'image/png');
  insertAsset(A2, '重复内容图B', 'image', pngB, 'image/png');
  insertAsset(A3, '原创分镜图C', 'image', pngC, 'image/png');
  insertAsset(A4, '自制音效', 'audio', audioFile, 'audio/mpeg');
});

test.after(async () => {
  try { cleanup(); } catch (_) { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
  // 关闭 Bull/ioredis 连接，避免事件循环被保持导致测试进程无法退出
  try {
    const qs = require(path.resolve(__dirname, '..', 'src', 'services', 'queueService.js'));
    await Promise.race([qs.closeQueue(), new Promise((r) => setTimeout(r, 3000))]);
  } catch (_) { /* ignore */ }
});

// ===========================================================================
// [1] 汉明距离
// ===========================================================================
test('[S21-T01][1] hammingDistance 计算正确', () => {
  assert.equal(fingerprint.hammingDistance('0000000000000000', '0000000000000000'), 0);
  // 0x0 vs 0xFFFF...(64位) → 距离 64
  assert.equal(fingerprint.hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);
  // 单 bit 差异
  assert.equal(fingerprint.hammingDistance('0000000000000000', '8000000000000000'), 1);
});

// ===========================================================================
// [2] 首个素材 → clear
// ===========================================================================
test('[S21-T01][2] 指纹库为空时首个素材判定 clear 并落库指纹', () => {
  const cfg = loadConfig();
  const r = fingerprint.detectCopyright(db, log, cfg, { asset_id: A1 });
  assert.equal(r.status, 'clear');
  assert.equal(r.asset_id, A1);
  assert.ok(r.fingerprint.ahash, '应计算 aHash');
  assert.ok(r.fingerprint.dhash, '应计算 dHash');
  assert.match(r.fingerprint.file_sha256, /^[0-9a-f]{64}$/, '应生成 SHA-256');

  const fp = db.prepare('SELECT * FROM asset_fingerprint WHERE asset_id = ?').get(A1);
  assert.ok(fp, '指纹应真实落库');
  assert.equal(fp.ahash, r.fingerprint.ahash);
  assert.equal(fp.width, 64);
  assert.equal(fp.height, 48);

  const asset = db.prepare('SELECT copyright_status FROM assets WHERE id = ?').get(A1);
  assert.equal(asset.copyright_status, 'clear');
});

// ===========================================================================
// [3] 重复内容 → suspect
// ===========================================================================
test('[S21-T01][3] 与库内素材内容一致的素材判定 suspect（感知距离 0）', () => {
  const cfg = loadConfig();
  const r = fingerprint.detectCopyright(db, log, cfg, { asset_id: A2 });
  assert.equal(r.status, 'suspect');
  assert.equal(r.matched_asset_id, A1, '应命中素材 A');
  assert.ok(r.distance <= fingerprint.DEFAULT_THRESHOLD, `距离 ${r.distance} 应 ≤ 阈值`);
  assert.equal(r.distance, 0, '完全相同图片感知距离应为 0');
  assert.ok(r.reason.includes('感知距离'));
});

// ===========================================================================
// [4] 完全不同素材 → clear
// ===========================================================================
test('[S21-T01][4] 完全不同内容的素材判定 clear', () => {
  const cfg = loadConfig();
  const r = fingerprint.detectCopyright(db, log, cfg, { asset_id: A3 });
  assert.equal(r.status, 'clear');
  assert.ok(r.distance === null || r.distance > fingerprint.DEFAULT_THRESHOLD, '距离应超过阈值或不匹配');
});

// ===========================================================================
// [5] 非 PNG → unsupported
// ===========================================================================
test('[S21-T01][5] 音频等非 8bit 非隔行 PNG 素材标记 unsupported', () => {
  const cfg = loadConfig();
  const r = fingerprint.detectCopyright(db, log, cfg, { asset_id: A4 });
  assert.equal(r.status, 'unsupported');
  assert.ok(r.fingerprint.file_sha256, '仍应有文件级 SHA-256');
  assert.equal(r.fingerprint.ahash, null, '无感知哈希');
});

// ===========================================================================
// [6] 版权状态列表
// ===========================================================================
test('[S21-T01][6] listCopyrightStatus 支持状态筛选并回显指纹字段', () => {
  const all = fingerprint.listCopyrightStatus(db, { page: 1, pageSize: 20, status: 'all' });
  assert.ok(all.total >= 4, '应包含全部测试素材');
  const byId = all.items.find((i) => i.id === A1);
  assert.ok(byId, '列表应包含素材 A');
  assert.equal(byId.copyright_status, 'clear');
  assert.ok(byId.ahash && byId.file_sha256, '列表应回显指纹字段');

  const suspect = fingerprint.listCopyrightStatus(db, { status: 'suspect' });
  assert.ok(suspect.items.some((i) => i.id === A2), 'suspect 筛选应含素材 B');

  const clear = fingerprint.listCopyrightStatus(db, { status: 'clear' });
  assert.ok(clear.items.some((i) => i.id === A1), 'clear 筛选应含素材 A');
});

// ===========================================================================
// [7] 扩缩容建议
// ===========================================================================
test('[S21-T02][7] getScalingAdvice 返回真实指标与建议', async () => {
  const advice = await opsService.getScalingAdvice(db, log);
  assert.ok(['normal', 'watch', 'scale-up'].includes(advice.level), 'level 应为枚举值');
  assert.ok(advice.suggestion.length > 0, '应有建议文案');
  assert.ok(Number.isFinite(advice.metrics.cpu_pct), 'CPU 占比应为数字');
  assert.ok(Number.isFinite(advice.metrics.mem_pct), '内存占比应为数字');
  assert.ok(Number.isFinite(advice.metrics.queue_waiting), '队列积压应为数字');
  assert.ok(advice.metrics.db_threads_connected >= 0, 'DB 连接数应为数字');
  assert.ok(advice.sampled_at, '应有采样时间');
  // 纯函数：强度建议
  assert.ok(Array.isArray(advice.reasons) && advice.reasons.length > 0, '应有判定理由');
});

// ===========================================================================
// [8] 运维脚本触发
// ===========================================================================
test('[S21-T02][8] runScript 白名单校验 + backup 脚本真实执行', async () => {
  // 非法动作直接拒绝
  await assert.rejects(
    opsService.runScript('drop_database'),
    (err) => err.code === 'BAD_ACTION'
  );

  // backup 真实执行（输出到临时目录）。
  // 跳过 DB/存储两大重资源步骤（真实数据量 286MB+，全量会拖慢测试），
  // 通过 runScript 透传的环境变量驱动，脚本链路（解析配置/建目录/复制配置）仍真实执行。
  process.env.OPS_SKIP_DB = '1';
  process.env.OPS_SKIP_STORAGE = '1';
  const backupOut = fs.mkdtempSync(path.join(tmpDir, 'backup_'));
  let result;
  try {
    result = await opsService.runScript('backup', { args: [backupOut], timeoutMs: 30000 });
  } finally {
    delete process.env.OPS_SKIP_DB;
    delete process.env.OPS_SKIP_STORAGE;
  }
  assert.equal(result.code, 0, 'backup 脚本应成功退出');
  assert.ok(result.output.includes('备份完成'), '输出应包含完成标记');
  assert.ok(result.output.includes('已跳过数据库备份'), '跳过 DB 应有提示');
  assert.ok(result.output.includes('已跳过存储备份'), '跳过存储应有提示');
  const files = fs.readdirSync(backupOut).filter((f) => f !== '.DS_Store');
  assert.ok(files.length >= 1, '应生成备份目录');

  // 备份产物位于 <backupOut>/<时间戳>/ 子目录内（backup.sh 以 STAMP 建目录）
  const stampDir = path.join(backupOut, files.find((f) => {
    try { return fs.statSync(path.join(backupOut, f)).isDirectory(); } catch (_) { return false; }
  }));
  assert.ok(fs.existsSync(stampDir), '应有时间戳备份子目录');
  const cfgBackup = fs.readdirSync(stampDir).find((f) => f === 'config.yaml');
  assert.ok(cfgBackup, '备份中应有 config.yaml');
});
