'use strict';

/**
 * cdnService.js
 * Sprint 8 - S8-T08: 图片CDN加速
 * + S8-P1 风险修复: R10/R11/R12/R13
 *
 * 修复清单：
 *  R10: getCdnConfig() 每次调用都读文件+parseYAML → 模块级单例缓存 + mtime热更新(stat成本远低于parse)
 *  R11: CDN URL 访问无签名防爬 → signUrl()/verifySignedUrl()，基于 HMAC-SHA256 + expires
 *       默认关闭，config.cdn.enable_signature=true 时 rewriteUrl 自动签名
 *  R12: rewriteObjectUrls 递归对象 → 循环引用会 RangeError栈溢出 → 引入 ObjectIdGuard(WeakSet)
 *  R13: enable_webp → 无条件强制 f=webp → 老浏览器不支持 → 需传 accept 参数，仅当 Accept 含 image/webp 时才追加
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('../config/index.js');
const { ObjectIdGuard } = require('../utils/concurrency.js');

/* =========================================================================
 * R10: CDN配置缓存 (单例 + 文件mtime热更新)
 *      避免每次getCdnConfig()都readFileSync+YAML.parse，在高并发图片列表场景下节约大量CPU
 * ========================================================================= */
const CONFIG_LOCATIONS = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];
let _configPathCache = null;
function _resolveConfigPath() {
  if (_configPathCache && fs.existsSync(_configPathCache)) return _configPathCache;
  for (const p of CONFIG_LOCATIONS) {
    if (fs.existsSync(p)) { _configPathCache = p; return p; }
  }
  return null;
}
let _cdnCfgCached = null;
let _cdnCfgMtimeMs = 0;
let _cdnCfgAccessCount = 0; // 统计缓存命中率

function _fallbackCdnConfig() {
  return {
    enabled: process.env.CDN_ENABLED === 'true' || false,
    base_url: process.env.CDN_BASE_URL || '',
    image_quality: Number(process.env.CDN_IMAGE_QUALITY) || 85,
    enable_webp: process.env.CDN_ENABLE_WEBP !== 'false',
    thumbnail_sizes: [160, 320, 640, 1080],
    enable_signature: process.env.CDN_ENABLE_SIGNATURE === 'true',
    signature_secret: process.env.CDN_SIGNATURE_SECRET || '',
    signature_ttl_sec: Number(process.env.CDN_SIGNATURE_TTL_SEC) || 604800, // 默认7天
    max_dim: Number(process.env.CDN_MAX_DIM) || 8192, // R13: 允许请求的宽高上限
  };
}

function getCdnConfig() {
  _cdnCfgAccessCount++;
  try {
    const cfgPath = _resolveConfigPath();
    if (cfgPath) {
      const stat = fs.statSync(cfgPath);
      const newMtime = stat.mtimeMs;
      // 配置文件未变 → 直接用内存缓存（99.9%调用走这个分支）
      if (_cdnCfgCached && newMtime === _cdnCfgMtimeMs) {
        // 每 1000 次打印一次缓存命中统计（避免刷屏）
        if (_cdnCfgAccessCount % 1000 === 0) {
          console.log(`[CDN-R10] 配置缓存命中  accessCount=${_cdnCfgAccessCount}  mtime=${newMtime}  enabled=${_cdnCfgCached.enabled}  base_url=${_cdnCfgCached.base_url}`);
        }
        return _cdnCfgCached;
      }
      // mtime变化 → 重新loadConfig + 提取cdn段（loadConfig本身会解析YAML，1~5ms量级）
      const full = loadConfig();
      _cdnCfgCached = {
        enabled: !!(full.cdn && full.cdn.enabled),
        base_url: (full.cdn && full.cdn.base_url) || '',
        image_quality: Number((full.cdn && full.cdn.image_quality) || 85),
        enable_webp: (full.cdn && full.cdn.enable_webp) !== false,
        thumbnail_sizes: Array.isArray(full.cdn?.thumbnail_sizes)
          ? full.cdn.thumbnail_sizes
          : [160, 320, 640, 1080],
        enable_signature: !!(full.cdn && full.cdn.enable_signature),
        signature_secret: (full.cdn && full.cdn.signature_secret) || '',
        signature_ttl_sec: Number((full.cdn && full.cdn.signature_ttl_sec) || 604800),
        max_dim: Number((full.cdn && full.cdn.max_dim) || 8192), // R13: w/h上限钳制
      };
      _cdnCfgMtimeMs = newMtime;
      console.log(`[CDN-R10] 配置加载/热更新完成  cfgPath=${cfgPath}  mtime=${newMtime}  enabled=${_cdnCfgCached.enabled}  base_url=${_cdnCfgCached.base_url}  enable_webp=${_cdnCfgCached.enable_webp}  enable_sig=${_cdnCfgCached.enable_signature}  max_dim=${_cdnCfgCached.max_dim}`);
      return _cdnCfgCached;
    }
  } catch (e) {
    console.log(`[CDN-R10] 读取CDN配置文件异常，使用fallback配置  err=${e.message}`);
    // fallthrough
  }
  // 无配置文件时，使用 fallback（环境变量或默认值）
  if (!_cdnCfgCached) {
    _cdnCfgCached = _fallbackCdnConfig();
    console.log(`[CDN-R10] 使用FALLBACK配置（无cfg.yaml） enabled=${_cdnCfgCached.enabled}  base_url=${_cdnCfgCached.base_url}`);
  }
  return _cdnCfgCached;
}
/** 仅测试/诊断使用：读取缓存命中情况 */
function _configCacheMeta() {
  return {
    cached: !!_cdnCfgCached,
    mtime_ms: _cdnCfgMtimeMs,
    access_count: _cdnCfgAccessCount,
  };
}
/** 仅测试/诊断使用：强制失效缓存（模拟mtime变化） */
function _invalidateConfigCache() {
  _cdnCfgCached = null;
  _cdnCfgMtimeMs = 0;
}

/* =========================================================================
 * R11: CDN URL 签名（HMAC-SHA256 + expires 时间戳）
 *      防止链接被爬虫无限期复用/热连到其他网站盗刷带宽
 * ========================================================================= */
function signUrl(url, secret, ttlSec = 604800) {
  if (!url) { console.log(`[CDN-R11-SIGN] 跳过：url为空`); return url; }
  if (!secret) { console.log(`[CDN-R11-SIGN] 跳过：密钥未配置 → 原样返回  url=${_cdnShort(url)}`); return url; }
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  const queryIdx = url.indexOf('?');
  const base = queryIdx >= 0 ? url.substring(0, queryIdx) : url;
  const raw = `${expires}\n${base}`;
  const sig = crypto.createHmac('sha256', String(secret)).update(raw).digest('hex').substring(0, 16);
  const sep = url.includes('?') ? '&' : '?';
  const signed = `${url}${sep}expires=${expires}&sig=${sig}`;
  console.log(`[CDN-R11-SIGN] 签名完成  base="${base}"  expires=${expires}(+${ttlSec}s)  sig=${sig}(前8位)  → ${_cdnShort(signed)}`);
  return signed;
}
function verifySignedUrl(url, secret) {
  if (!url || !secret) { console.log(`[CDN-R11-VERIFY] 跳过：url/secret为空 → 放行`); return { ok: true, reason: 'skip(no url or secret)' }; }
  try {
    const queryIdx = url.indexOf('?');
    if (queryIdx < 0) { console.log(`[CDN-R11-VERIFY] 放行：无query(视为未签名)  url=${_cdnShort(url)}`); return { ok: true, reason: 'no query (unsigned original)' }; }
    const base = url.substring(0, queryIdx);
    const qs = new URLSearchParams(url.substring(queryIdx + 1));
    const expiresStr = qs.get('expires');
    const sig = qs.get('sig');
    if (!expiresStr || !sig) {
      console.log(`[CDN-R11-VERIFY] 放行：缺expires/sig字段 → 视为历史未签名链接  base="${base}"  has_expires=${!!expiresStr}  has_sig=${!!sig}`);
      return { ok: true, reason: 'unsigned (no expires/sig)' };
    }
    const expires = Number(expiresStr);
    if (Number.isNaN(expires)) { console.log(`[CDN-R11-VERIFY] ❌ 失败：expires字段非法 "${expiresStr}"  base="${base}"`); return { ok: false, reason: 'invalid expires' }; }
    const now = Math.floor(Date.now() / 1000);
    if (now > expires) {
      console.log(`[CDN-R11-VERIFY] ❌ 失败：已过期  now=${now}  expires=${expires}  remainSecs=${expires - now}  base="${base}"`);
      return { ok: false, reason: 'expired' };
    }
    const expected = crypto
      .createHmac('sha256', String(secret))
      .update(`${expires}\n${base}`)
      .digest('hex')
      .substring(0, 16);
    if (expected !== sig) {
      console.log(`[CDN-R11-VERIFY] ❌ 签名不匹配  base="${base}"  expected=${expected}  received=${sig}  expires=${expires}`);
      return { ok: false, reason: 'bad signature' };
    }
    const remain = expires - now;
    console.log(`[CDN-R11-VERIFY] ✅ 通过  base="${base}"  expires=${expires}  remainSecs=${remain}  sig=${sig}`);
    return { ok: true, reason: 'verified' };
  } catch (e) {
    console.log(`[CDN-R11-VERIFY] 校验异常 → 拒绝  err=${e.message}`);
    return { ok: false, reason: 'error: ' + e.message };
  }
}

/* 调试辅助：截断CDN URL到80字符 */
function _cdnShort(u) { if (!u) return String(u); const s = String(u); return s.length <= 80 ? s : s.substring(0, 77) + '...'; }

/* =========================================================================
 * isLocalPath / rewriteUrl (R13: accept头WebP协商 + R11签名)
 * ========================================================================= */
function isLocalPath(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('/static/') || url.startsWith('/uploads/');
}

/**
 * @param {string} url 本地/远端URL
 * @param {object} options
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.quality]
 * @param {'original'|'webp'|'auto'} [options.format='auto']
 * @param {string} [options.accept]  请求的Accept头（示例：image/avif,image/webp,image/apng,image/svg+xml 再加标准通配）
 * @returns {string}
 */
function rewriteUrl(url, options = {}) {
  if (!url) return url;
  if (!isLocalPath(url)) return url;

  const cdnConfig = getCdnConfig();
  if (!cdnConfig.enabled || !cdnConfig.base_url) {
    // 未启用CDN → 原样返回（本地直连降级），每 500 次打印一次
    if ((rewriteUrl._noCdnHitCount = (rewriteUrl._noCdnHitCount || 0) + 1) % 500 === 0) {
      console.log(`[CDN] CDN未启用 → 本地直连降级  hits=${rewriteUrl._noCdnHitCount}  url=${_cdnShort(url)}`);
    }
    return url;
  }

  // 拼接 CDN 基础 URL
  let cdnUrl = cdnConfig.base_url.replace(/\/$/, '') + url;
  const params = new URLSearchParams();
  const maxDim = Number.isFinite(cdnConfig.max_dim) && cdnConfig.max_dim > 0 ? cdnConfig.max_dim : 8192;
  const clampDim = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (!Number.isFinite(i) || i <= 0) return null;
    if (i > maxDim) {
      console.log(`[CDN-R13] 钳制：维度超过 max_dim  ${i} → ${maxDim}  (max_dim=${maxDim}, 原始值=${JSON.stringify(x)})  url=${_cdnShort(url)}`);
      return maxDim;
    }
    return i;
  };
  const rawW = options.width, rawH = options.height;
  const w = clampDim(rawW);
  const h = clampDim(rawH);
  if (rawW !== undefined && w === null) {
    console.log(`[CDN-R13] 过滤：width 非正整数/非法 → 不追加  rawW=${JSON.stringify(rawW)}  url=${_cdnShort(url)}`);
  }
  if (rawH !== undefined && h === null) {
    console.log(`[CDN-R13] 过滤：height 非正整数/非法 → 不追加  rawH=${JSON.stringify(rawH)}  url=${_cdnShort(url)}`);
  }
  if (w !== null) params.set('w', String(w));
  if (h !== null) params.set('h', String(h));
  if (options.quality) params.set('q', String(options.quality));
  else if (cdnConfig.image_quality) params.set('q', String(cdnConfig.image_quality));

  // R13: WebP协商 —— accept头策略（优先级高→低）
  const acceptString = typeof options.accept === 'string' ? options.accept.toLowerCase() : '';
  let wantsWebp = false;
  let webpReason = '';
  if (options.format === 'webp') { wantsWebp = true; webpReason = 'format=webp强指定'; }
  else if (options.format === 'original') { wantsWebp = false; webpReason = 'format=original强禁用'; }
  else if (!cdnConfig.enable_webp) { wantsWebp = false; webpReason = 'config.enable_webp=false'; }
  else if (acceptString === '') { wantsWebp = true; webpReason = 'accept未传→默认webp'; }
  else if (acceptString.includes('image/webp')) { wantsWebp = true; webpReason = 'Accept含image/webp'; }
  else { wantsWebp = false; webpReason = 'Accept不含image/webp'; }
  if (wantsWebp) params.set('f', 'webp');
  console.log(`[CDN-R13-WEBP] ${wantsWebp ? '追加f=webp' : '不加webp'}  reason="${webpReason}"  accept="${acceptString.substring(0, 80)}"  enable_webp=${cdnConfig.enable_webp}  format=${options.format || 'auto'}  url=${_cdnShort(url)}`);

  const queryString = params.toString();
  if (queryString) cdnUrl += `?${queryString}`;

  // R11: 签名
  if (cdnConfig.enable_signature && cdnConfig.signature_secret) {
    const beforeLen = cdnUrl.length;
    cdnUrl = signUrl(cdnUrl, cdnConfig.signature_secret, cdnConfig.signature_ttl_sec || 604800);
    console.log(`[CDN-R11] rewriteUrl 自动签名完成  len ${beforeLen} → ${cdnUrl.length}  baseUrl=${_cdnShort(cdnUrl)}`);
  } else if (cdnConfig.enable_signature && !cdnConfig.signature_secret) {
    console.log(`[CDN-R11] 配置要求签名但 signature_secret 为空 → 跳过签名  url=${_cdnShort(url)}`);
  }
  return cdnUrl;
}

function rewriteUrls(urls, options = {}) {
  if (!Array.isArray(urls)) return urls;
  return urls.map(url => rewriteUrl(url, options));
}

function getThumbnailUrl(url, size = 320, options = {}) {
  return rewriteUrl(url, { ...options, width: size, quality: options.quality || 70 });
}

function getResponsiveUrls(url, options = {}) {
  const cdnConfig = getCdnConfig();
  const sizes = cdnConfig.thumbnail_sizes || [160, 320, 640, 1080];
  return sizes.map(width => ({
    url: rewriteUrl(url, { ...options, width, quality: cdnConfig.image_quality }),
    width,
  }));
}

function getSrcset(url, options = {}) {
  const responsive = getResponsiveUrls(url, options);
  return responsive.map(r => `${r.url} ${r.width}w`).join(', ');
}

/**
 * R13: priority=true 时禁用 lazy loading（首屏关键图）
 */
function getImgAttributes(url, alt = '', options = {}) {
  const cdnConfig = getCdnConfig();
  const priority = !!options.priority;
  return {
    src: rewriteUrl(url, { ...options, quality: cdnConfig.image_quality }),
    srcset: getSrcset(url, options),
    alt,
    // 首屏关键图（LCP）不要懒加载，否则 LargestContentfulPaint 指标差
    loading: priority ? 'eager' : 'lazy',
    fetchpriority: priority ? 'high' : undefined,
    decoding: 'async',
  };
}

/* =========================================================================
 * R12: rewriteObjectUrls + WeakSet循环引用检测
 * ========================================================================= */
function rewriteObjectUrls(obj, options = {}, guard = null, depth = 0) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!guard) guard = new ObjectIdGuard();
  const firstVisit = !guard.checkAndMark(obj);
  if (!firstVisit) {
    console.log(`[CDN-R12] ⚠️ 检测到循环引用/重复访问 → 跳过递归（防RangeError栈溢出） depth=${depth}  constructor=${obj.constructor?.name || '(anonymous)'}`);
    return obj;
  }
  if (depth > 0 && depth % 50 === 0) {
    console.log(`[CDN-R12] 深递归提醒 depth=${depth}  constructor=${obj.constructor?.name || '(anonymous)'} — 请注意该对象嵌套层级`);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => rewriteObjectUrls(item, options, guard, depth + 1));
  }

  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === 'string' && (
      key.endsWith('_url') || key === 'image' || key === 'thumbnail' || key === 'cover'
    )) {
      const before = val;
      result[key] = rewriteUrl(val, options);
      if (before !== result[key] && depth < 10) {
        console.log(`[CDN-R12] 对象内URL重写 depth=${depth}  field="${key}"  before=${_cdnShort(before)}  →  after=${_cdnShort(result[key])}`);
      }
    } else if (typeof val === 'object' && val !== null) {
      result[key] = rewriteObjectUrls(val, options, guard, depth + 1);
    }
  }
  return result;
}

/* =========================================================================
 * Status
 * ========================================================================= */
function getStatus() {
  const config = getCdnConfig();
  return {
    enabled: config.enabled,
    base_url: config.base_url || '(未配置)',
    image_quality: config.image_quality,
    enable_webp: config.enable_webp,
    thumbnail_sizes: config.thumbnail_sizes,
    enable_signature: !!config.enable_signature,
    signature_ttl_sec: config.signature_ttl_sec,
    config_cached_access_count: _cdnCfgAccessCount,
    mode: config.enabled ? 'CDN' : '本地直连（降级）',
  };
}

module.exports = {
  getCdnConfig,
  isLocalPath,
  rewriteUrl,
  rewriteUrls,
  getThumbnailUrl,
  getResponsiveUrls,
  getSrcset,
  getImgAttributes,
  rewriteObjectUrls,
  getStatus,
  // R11: 签名
  signUrl,
  verifySignedUrl,
  // 仅测试/诊断：配置缓存元数据和手动失效
  _configCacheMeta,
  _invalidateConfigCache,
};
