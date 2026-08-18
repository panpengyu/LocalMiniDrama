'use strict';

/**
 * S21-T01 自研版权指纹（aHash + dHash 组合感知哈希）
 *
 * 版权安全约束：
 *   - 纯 Node 实现，零第三方图像库：手写 PNG 解码（zlib inflate + 逐行 unfilter）
 *   - 比对基准仅限「本项目自有素材」的 asset_fingerprint 库
 *   - 不联网、不比对任何第三方图片库
 *
 * 支持格式：8-bit 非隔行 PNG（灰度/RGB/RGBA 等 colorType 0/2/4/6）
 * 不支持（返回 null）：JPEG/GIF/WebP 像素解码、隔行 PNG、非 8bit 深度
 * 此时仍保留文件级 SHA-256，状态标记 unsupported。
 */

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { snowflakeId } = require('../utils/snowflake');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_THRESHOLD = 8; // Hamming 距离 ≤ 8 判定疑似

// ---------------------------------------------------------------------------
// PNG 解码（纯 Node）
// ---------------------------------------------------------------------------

function isPng(buf) {
  return buf && buf.length > 8 && PNG_MAGIC.equals(buf.subarray(0, 8));
}

/**
 * 解码 8-bit 非隔行 PNG → 灰度矩阵（每行 width 个 0-255 亮度值）。
 * @param {Buffer} buf
 * @returns {{width:number, height:number, rows:number[][]}|null}
 */
function decodePng(buf) {
  if (!isPng(buf)) return null;
  const len = buf.length;
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];

  while (pos + 8 <= len) {
    const chunkLen = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    const dataEnd = dataStart + chunkLen;
    if (dataEnd + 4 > len) return null;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataEnd + 4; // 跳过 CRC
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  // colorType: 0 灰度(1ch) 2 RGB(3ch) 4 灰度+alpha(2ch) 6 RGBA(4ch)
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) return null;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (_) {
    return null;
  }

  const stride = width * channels;
  const rows = [];
  let p = 0;
  let prev = null;
  for (let y = 0; y < height; y++) {
    if (p >= raw.length) return null;
    const filter = raw[p];
    p += 1;
    const cur = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    switch (filter) {
      case 0: break; // None
      case 1: // Sub
        for (let x = channels; x < stride; x++) cur[x] = (cur[x] + cur[x - channels]) & 0xff;
        break;
      case 2: // Up
        if (prev) for (let x = 0; x < stride; x++) cur[x] = (cur[x] + prev[x]) & 0xff;
        break;
      case 3: // Average
        for (let x = 0; x < stride; x++) {
          const a = x >= channels ? cur[x - channels] : 0;
          const b = prev ? prev[x] : 0;
          cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let x = 0; x < stride; x++) {
          const a = x >= channels ? cur[x - channels] : 0;
          const b = prev ? prev[x] : 0;
          const c = (x >= channels && prev) ? prev[x - channels] : 0;
          cur[x] = (cur[x] + paethPredictor(a, b, c)) & 0xff;
        }
        break;
      default:
        return null;
    }
    // 转灰度行
    const gray = new Array(width);
    for (let x = 0; x < width; x++) {
      if (colorType === 0) {
        gray[x] = cur[x];
      } else {
        const r = cur[x * channels];
        const g = cur[x * channels + 1];
        const b = cur[x * channels + 2];
        gray[x] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      }
    }
    rows.push(gray);
    prev = cur;
  }
  return { width, height, rows };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ---------------------------------------------------------------------------
// 感知哈希
// ---------------------------------------------------------------------------

/** 双线性盒采样缩放为 w x h 灰度矩阵（简化：平均抽样） */
function resizeGray(rows, srcW, srcH, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    const sy0 = (y * srcH) / h;
    const sy1 = ((y + 1) * srcH) / h;
    for (let x = 0; x < w; x++) {
      const sx0 = (x * srcW) / w;
      const sx1 = ((x + 1) * srcW) / w;
      let sum = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          sum += rows[Math.min(sy, srcH - 1)][Math.min(sx, srcW - 1)];
          n++;
        }
      }
      row[x] = sum / n;
    }
    out.push(row);
  }
  return out;
}

/** aHash：8x8 均值哈希 → 64bit BigInt */
function ahash(rows) {
  const g = resizeGray(rows, rows[0].length, rows.length, 8, 8);
  let sum = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += g[y][x];
  const avg = sum / 64;
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (g[y][x] >= avg ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** dHash：9x8 相邻列差哈希 → 64bit BigInt */
function dhash(rows) {
  const g = resizeGray(rows, rows[0].length, rows.length, 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (g[y][x] >= g[y][x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** Hamming 距离（两 hex 哈希差异位数量） */
function hammingDistance(hexA, hexB) {
  if (!hexA || !hexB) return 64;
  const a = BigInt('0x' + hexA);
  const b = BigInt('0x' + hexB);
  const x = a ^ b;
  let cnt = 0;
  for (let n = x; n > 0n; n &= n - 1n) cnt += 1;
  return cnt;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 计算素材感知指纹。
 * @param {Buffer} buf 文件内容
 * @returns {{ahash:string, dhash:string, file_sha256:string, width:number, height:number}|null}
 *          null 表示无法解码像素（非 8bit 非隔行 PNG）→ 只能做文件哈希
 */
function computeFingerprint(buf) {
  if (!buf || !buf.length) return null;
  const fileSha = sha256(buf);
  const img = decodePng(buf);
  if (!img) return { file_sha256: fileSha, ahash: null, dhash: null, width: null, height: null };
  return {
    file_sha256: fileSha,
    ahash: ahash(img.rows),
    dhash: dhash(img.rows),
    width: img.width,
    height: img.height,
  };
}

// ---------------------------------------------------------------------------
// 指纹落库与版权比对
// ---------------------------------------------------------------------------

/** upsert 指纹到 asset_fingerprint */
function upsertFingerprint(db, log, assetId, buf) {
  const fp = computeFingerprint(buf);
  const assetIdN = Number(assetId);
  const existing = db.prepare('SELECT id FROM asset_fingerprint WHERE asset_id = ?').get(assetIdN);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE asset_fingerprint
       SET ahash = ?, dhash = ?, file_sha256 = ?, width = ?, height = ?, updated_at = ?
       WHERE asset_id = ?`
    ).run(fp.ahash, fp.dhash, fp.file_sha256, fp.width, fp.height, now, assetIdN);
  } else {
    db.prepare(
      `INSERT INTO asset_fingerprint (id, asset_id, ahash, dhash, file_sha256, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(snowflakeId(), assetIdN, fp.ahash, fp.dhash, fp.file_sha256, fp.width, fp.height, now, now);
  }
  return fp;
}

/** 解析素材本地文件绝对路径（支持 local_path 相对值 / url 以 /static/ 开头） */
function resolveAssetPath(cfg, asset) {
  const storageRoot = path.isAbsolute(cfg?.storage?.local_path || './data/storage')
    ? (cfg?.storage?.local_path || './data/storage')
    : path.join(process.cwd(), cfg?.storage?.local_path || './data/storage');
  if (asset.local_path) {
    const p = path.isAbsolute(asset.local_path) ? asset.local_path : path.join(storageRoot, asset.local_path);
    if (fs.existsSync(p)) return p;
  }
  if (asset.url && asset.url.startsWith('/static/')) {
    const p = path.join(storageRoot, asset.url.replace('/static/', ''));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 版权检测：计算指纹 → 与指纹库（仅自有素材，排除自身）比对 → 更新状态。
 * @returns {{asset_id, status, distance, matched_asset_id, matched_name, fingerprint}}
 */
function detectCopyright(db, log, cfg, { asset_id, assetId, threshold = DEFAULT_THRESHOLD } = {}) {
  const targetId = asset_id ?? assetId; // 兼容 asset_id（routes/测试）与 assetId 两种入参
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(targetId));
  if (!asset) {
    const err = new Error('素材不存在');
    err.code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const filePath = resolveAssetPath(cfg, asset);
  if (!filePath) {
    db.prepare('UPDATE assets SET copyright_status = ?, copyright_checked_at = NOW() WHERE id = ?')
      .run('pending', Number(targetId));
    return { asset_id: Number(targetId), status: 'pending', reason: '本地文件缺失，待上传后重检', distance: null, matched_asset_id: null, matched_name: null };
  }
  const buf = fs.readFileSync(filePath);
  const fp = upsertFingerprint(db, log, targetId, buf);

  if (!fp.ahash || !fp.dhash) {
    db.prepare('UPDATE assets SET copyright_status = ?, copyright_checked_at = NOW() WHERE id = ?')
      .run('unsupported', Number(targetId));
    return { asset_id: Number(targetId), status: 'unsupported', reason: '非 8bit 非隔行 PNG，仅文件级 SHA-256', distance: null, matched_asset_id: null, matched_name: null, fingerprint: fp };
  }

  // 与指纹库比对（排除自身，仅本项目自有素材）
  const library = db.prepare(
    `SELECT f.asset_id, f.ahash, f.dhash, a.name
     FROM asset_fingerprint f LEFT JOIN assets a ON a.id = f.asset_id
     WHERE f.asset_id <> ? AND f.ahash IS NOT NULL AND f.dhash IS NOT NULL`
  ).all(Number(targetId)) || [];

  let best = null;
  for (const item of library) {
    const dist = Math.min(hammingDistance(fp.ahash, item.ahash), hammingDistance(fp.dhash, item.dhash));
    if (!best || dist < best.distance) {
      best = { asset_id: item.asset_id, name: item.name, distance: dist };
    }
  }

  const status = best && best.distance <= threshold ? 'suspect' : 'clear';
  db.prepare('UPDATE assets SET copyright_status = ?, copyright_checked_at = NOW() WHERE id = ?')
    .run(status, Number(targetId));
  return {
    asset_id: Number(targetId),
    status,
    reason: status === 'suspect'
      ? `与素材「${best.name}」感知距离 ${best.distance}（阈值 ${threshold}）`
      : `与 ${library.length} 条自有素材比对无重复`,
    distance: best ? best.distance : null,
    matched_asset_id: best ? best.asset_id : null,
    matched_name: best ? best.name : null,
    fingerprint: fp,
  };
}

/** 版权状态列表 */
function listCopyrightStatus(db, { page = 1, pageSize = 20, status } = {}) {
  const where = ['a.deleted_at IS NULL'];
  const params = [];
  if (status && status !== 'all') { where.push('a.copyright_status = ?'); params.push(String(status)); }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM assets a WHERE ${whereSql}`).get(...params).c || 0;
  const pageN = Math.max(Number(page) || 1, 1);
  const pageSizeN = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const items = db.prepare(
    `SELECT a.id, a.name, a.type, a.url, a.copyright_status, a.copyright_checked_at, a.created_at,
            f.ahash, f.dhash, f.file_sha256, f.width, f.height
     FROM assets a LEFT JOIN asset_fingerprint f ON f.asset_id = a.id
     WHERE ${whereSql}
     ORDER BY a.id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSizeN, (pageN - 1) * pageSizeN) || [];
  return { total, page: pageN, pageSize: pageSizeN, items };
}

module.exports = {
  isPng,
  decodePng,
  computeFingerprint,
  hammingDistance,
  sha256,
  upsertFingerprint,
  resolveAssetPath,
  detectCopyright,
  listCopyrightStatus,
  DEFAULT_THRESHOLD,
};
